use crate::append_diagnostic_log;
use crate::dsh_api_config::{resolve_xiaoyan_api, write_dsh_api_configuration, DshApiImportResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
    time::{timeout, Duration},
};

const DSH_MANIFEST_JSON: &str = include_str!("../resources/dsh/manifest.json");
const MAX_LOG_LINES: usize = 120;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshRuntimeMode {
    Bundled,
    External,
}

impl DshRuntimeMode {
    fn data_dir_name(self) -> &'static str {
        match self {
            Self::Bundled => "bundled-home",
            Self::External => "external-home",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshRuntimeConfig {
    pub mode: DshRuntimeMode,
    pub external_executable: Option<String>,
    pub external_home: Option<String>,
    pub profile: String,
    pub workspace_dir: Option<String>,
}

impl Default for DshRuntimeConfig {
    fn default() -> Self {
        Self {
            mode: DshRuntimeMode::Bundled,
            external_executable: None,
            external_home: None,
            profile: "web".to_string(),
            workspace_dir: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DshManifest {
    version: String,
    commit: String,
    node_requirement: String,
    source: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DshPhase {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshRuntimeSnapshot {
    phase: DshPhase,
    config: DshRuntimeConfig,
    url: Option<String>,
    error: Option<String>,
    logs: Vec<String>,
    bundled_available: bool,
    locked_version: String,
    locked_commit: String,
    node_requirement: String,
    source: String,
    data_home: String,
}

struct RuntimeInner {
    config: DshRuntimeConfig,
    phase: DshPhase,
    child: Option<Child>,
    generation: u64,
    url: Option<String>,
    error: Option<String>,
    logs: VecDeque<String>,
}

impl RuntimeInner {
    fn new(config: DshRuntimeConfig) -> Self {
        Self {
            config,
            phase: DshPhase::Stopped,
            child: None,
            generation: 0,
            url: None,
            error: None,
            logs: VecDeque::new(),
        }
    }

    fn push_log(&mut self, line: String) {
        if self.logs.len() >= MAX_LOG_LINES {
            self.logs.pop_front();
        }
        self.logs.push_back(line);
    }

    fn refresh_child_status(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                self.child = None;
                self.generation = self.generation.wrapping_add(1);
                self.url = None;
                if self.phase != DshPhase::Stopped {
                    self.phase = DshPhase::Failed;
                    self.error = Some(format!("DSH 进程已退出（{status}）"));
                }
            }
            Ok(None) => {}
            Err(error) => {
                self.child = None;
                self.generation = self.generation.wrapping_add(1);
                self.url = None;
                self.phase = DshPhase::Failed;
                self.error = Some(format!("无法读取 DSH 进程状态：{error}"));
            }
        }
    }
}

#[derive(Clone)]
pub struct DshRuntimeState {
    app_data_dir: PathBuf,
    inner: Arc<Mutex<RuntimeInner>>,
}

impl DshRuntimeState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config = read_config(&app_data_dir).unwrap_or_default();
        Self {
            app_data_dir,
            inner: Arc::new(Mutex::new(RuntimeInner::new(config))),
        }
    }

    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join("dsh").join("runtime.json")
    }

    fn bundled_home(&self) -> PathBuf {
        self.app_data_dir
            .join("dsh")
            .join(DshRuntimeMode::Bundled.data_dir_name())
    }

    fn external_home(&self, config: &DshRuntimeConfig) -> PathBuf {
        config
            .external_home
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(default_user_dsh_home)
            .unwrap_or_else(|| {
                self.app_data_dir
                    .join("dsh")
                    .join(DshRuntimeMode::External.data_dir_name())
            })
    }

    fn data_home(&self, config: &DshRuntimeConfig) -> PathBuf {
        match config.mode {
            DshRuntimeMode::Bundled => self.bundled_home(),
            DshRuntimeMode::External => self.external_home(config),
        }
    }
}

fn manifest() -> DshManifest {
    serde_json::from_str(DSH_MANIFEST_JSON).expect("bundled DSH manifest must be valid JSON")
}

fn read_config(app_data_dir: &Path) -> Option<DshRuntimeConfig> {
    let path = app_data_dir.join("dsh").join("runtime.json");
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_config(path: &Path, config: &DshRuntimeConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 DSH 配置目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化 DSH 配置失败：{error}"))?;
    fs::write(path, format!("{content}\n")).map_err(|error| format!("保存 DSH 配置失败：{error}"))
}

fn default_user_dsh_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .map(|home| home.join(".dsh"))
}

fn validate_profile(profile: &str) -> Result<(), String> {
    if profile.is_empty()
        || profile.len() > 80
        || !profile.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("DSH profile 只能包含字母、数字、点、短横线和下划线".to_string());
    }
    Ok(())
}

fn validate_config(config: &DshRuntimeConfig) -> Result<(), String> {
    validate_profile(config.profile.trim())?;
    if let Some(workspace) = config
        .workspace_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if !Path::new(workspace).is_dir() {
            return Err("所选工作目录不存在或不是文件夹".to_string());
        }
    }
    if config.mode == DshRuntimeMode::External {
        let executable = config
            .external_executable
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "请先选择外部 dsh 可执行文件".to_string())?;
        let path = Path::new(executable);
        if path.components().count() > 1 && !path.is_file() {
            return Err("外部 dsh 可执行文件不存在".to_string());
        }
    }
    Ok(())
}

fn bundled_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{error}"))?;
    let root = resource_dir.join("resources").join("dsh").join("runtime");
    let node = if cfg!(windows) {
        root.join("node.exe")
    } else {
        root.join("node")
    };
    let entry = root.join("app").join("lib").join("bin.js");
    if !node.is_file() || !entry.is_file() {
        return Err(
            "当前安装包未包含 DSH 运行时，请重新构建内置运行时或切换到外部 DSH".to_string(),
        );
    }
    Ok((node, entry))
}

fn bundled_available(app: &AppHandle) -> bool {
    bundled_paths(app).is_ok()
}

fn workspace_dir(state: &DshRuntimeState, config: &DshRuntimeConfig) -> Result<PathBuf, String> {
    if let Some(path) = config
        .workspace_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(PathBuf::from(path));
    }
    let fallback = state.app_data_dir.join("dsh").join("workspace");
    fs::create_dir_all(&fallback).map_err(|error| format!("创建默认 DSH 工作目录失败：{error}"))?;
    Ok(fallback)
}

fn launch_command(
    app: &AppHandle,
    state: &DshRuntimeState,
    config: &DshRuntimeConfig,
) -> Result<Command, String> {
    validate_config(config)?;
    let mut command = match config.mode {
        DshRuntimeMode::Bundled => {
            let (node, entry) = bundled_paths(app)?;
            let mut command = Command::new(node);
            command.arg(entry);
            command
        }
        DshRuntimeMode::External => Command::new(
            config
                .external_executable
                .as_deref()
                .expect("validated external executable"),
        ),
    };

    if config.profile == "web" {
        command.arg("web");
    } else {
        command.args(["--profile", config.profile.as_str()]);
    }
    command.args(["--host", "127.0.0.1", "--port", "0"]);
    command
        .current_dir(workspace_dir(state, config)?)
        .env("DSH_HOME", state.data_home(config))
        .env("DSH_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(command)
}

fn parse_loopback_url(line: &str) -> Option<String> {
    let start = line.find("http://127.0.0.1:")?;
    let candidate = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches('/');
    let parsed = reqwest::Url::parse(candidate).ok()?;
    if parsed.scheme() == "http"
        && parsed.host_str() == Some("127.0.0.1")
        && parsed.port().is_some()
    {
        Some(candidate.to_string())
    } else {
        None
    }
}

async fn consume_output(
    stream_name: &'static str,
    stream: impl tokio::io::AsyncRead + Unpin,
    inner: Arc<Mutex<RuntimeInner>>,
    generation: u64,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut runtime = inner.lock().await;
        apply_output_line(&mut runtime, generation, stream_name, line);
    }
}

fn apply_output_line(runtime: &mut RuntimeInner, generation: u64, stream_name: &str, line: String) {
    if runtime.generation != generation {
        return;
    }
    let url = if stream_name == "stdout" {
        parse_loopback_url(&line)
    } else {
        None
    };
    runtime.push_log(format!("[{stream_name}] {line}"));
    if let Some(url) = url {
        runtime.url = Some(url);
        runtime.phase = DshPhase::Running;
        runtime.error = None;
    }
}

async fn snapshot(app: &AppHandle, state: &DshRuntimeState) -> DshRuntimeSnapshot {
    let metadata = manifest();
    let mut inner = state.inner.lock().await;
    inner.refresh_child_status();
    DshRuntimeSnapshot {
        phase: inner.phase,
        config: inner.config.clone(),
        url: inner.url.clone(),
        error: inner.error.clone(),
        logs: inner.logs.iter().cloned().collect(),
        bundled_available: bundled_available(app),
        locked_version: metadata.version,
        locked_commit: metadata.commit,
        node_requirement: metadata.node_requirement,
        source: metadata.source,
        data_home: state.data_home(&inner.config).display().to_string(),
    }
}

#[tauri::command]
pub async fn dsh_runtime_status(
    app: AppHandle,
    state: State<'_, DshRuntimeState>,
) -> Result<DshRuntimeSnapshot, String> {
    Ok(snapshot(&app, state.inner()).await)
}

#[tauri::command]
pub async fn dsh_runtime_configure(
    app: AppHandle,
    state: State<'_, DshRuntimeState>,
    mut config: DshRuntimeConfig,
) -> Result<DshRuntimeSnapshot, String> {
    config.profile = config.profile.trim().to_string();
    config.external_executable = config
        .external_executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config.external_home = config
        .external_home
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config.workspace_dir = config
        .workspace_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    validate_config(&config)?;

    {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 DSH，再切换运行时配置".to_string());
        }
        write_config(&state.config_path(), &config)?;
        inner.generation = inner.generation.wrapping_add(1);
        inner.config = config;
        inner.phase = DshPhase::Stopped;
        inner.url = None;
        inner.error = None;
    }
    Ok(snapshot(&app, state.inner()).await)
}

#[tauri::command]
pub async fn dsh_runtime_start(
    app: AppHandle,
    state: State<'_, DshRuntimeState>,
) -> Result<DshRuntimeSnapshot, String> {
    let (stdout, stderr, generation) = {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            drop(inner);
            return Ok(snapshot(&app, state.inner()).await);
        }
        let config = inner.config.clone();
        fs::create_dir_all(state.data_home(&config))
            .map_err(|error| format!("创建 DSH 数据目录失败：{error}"))?;
        let workspace = workspace_dir(state.inner(), &config)?;
        let mut command = launch_command(&app, state.inner(), &config)?;
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("启动 DSH 失败：{error}");
                inner.generation = inner.generation.wrapping_add(1);
                inner.phase = DshPhase::Failed;
                inner.url = None;
                inner.error = Some(message.clone());
                return Err(message);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;
        inner.phase = DshPhase::Starting;
        inner.child = Some(child);
        inner.url = None;
        inner.error = None;
        inner.logs.clear();
        inner.push_log(format!(
            "[xiaoyan] 正在启动 {} profile={} workspace={}",
            match config.mode {
                DshRuntimeMode::Bundled => "内置 DSH",
                DshRuntimeMode::External => "外部 DSH",
            },
            config.profile,
            workspace.display()
        ));
        (stdout, stderr, generation)
    };
    append_diagnostic_log("dsh: runtime start requested");

    if let Some(stdout) = stdout {
        tauri::async_runtime::spawn(consume_output(
            "stdout",
            stdout,
            state.inner().inner.clone(),
            generation,
        ));
    }
    if let Some(stderr) = stderr {
        tauri::async_runtime::spawn(consume_output(
            "stderr",
            stderr,
            state.inner().inner.clone(),
            generation,
        ));
    }

    Ok(snapshot(&app, state.inner()).await)
}

#[tauri::command]
pub async fn dsh_runtime_stop(
    app: AppHandle,
    state: State<'_, DshRuntimeState>,
) -> Result<DshRuntimeSnapshot, String> {
    {
        let mut inner = state.inner.lock().await;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = DshPhase::Stopped;
        inner.url = None;
        inner.error = None;
        if let Some(mut child) = inner.child.take() {
            let already_exited = child
                .try_wait()
                .map_err(|error| format!("读取 DSH 退出状态失败：{error}"))?
                .is_some();
            if !already_exited {
                child
                    .kill()
                    .await
                    .map_err(|error| format!("停止 DSH 失败：{error}"))?;
            }
            let _ = child.wait().await;
        }
    }
    append_diagnostic_log("dsh: runtime stopped");
    Ok(snapshot(&app, state.inner()).await)
}

#[tauri::command]
pub async fn dsh_runtime_validate_external(executable: String) -> Result<String, String> {
    let executable = executable.trim();
    if executable.is_empty() {
        return Err("请先选择外部 dsh 可执行文件".to_string());
    }
    let output = timeout(
        Duration::from_secs(8),
        Command::new(executable).arg("--version").output(),
    )
    .await
    .map_err(|_| "外部 DSH 版本检查超时".to_string())?
    .map_err(|error| format!("无法执行外部 DSH：{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("外部 DSH 版本检查失败（{}）", output.status)
        } else {
            stderr
        });
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("外部 DSH 未返回版本号".to_string());
    }
    Ok(version)
}

#[tauri::command]
pub async fn dsh_runtime_import_xiaoyan_api(
    runtime_state: State<'_, DshRuntimeState>,
    app_state: State<'_, AppState>,
) -> Result<DshApiImportResult, String> {
    let profile = {
        let settings = app_state.settings.read().await;
        resolve_xiaoyan_api(&settings)?
    };
    let result = {
        let mut inner = runtime_state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 DSH，再同步小妍 API".to_string());
        }
        write_dsh_api_configuration(&runtime_state.data_home(&inner.config), &profile)?
    };
    append_diagnostic_log("dsh: xiaoyan api configuration updated");
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_loopback_runtime_urls() {
        assert_eq!(
            parse_loopback_url("dsh web: http://127.0.0.1:3080"),
            Some("http://127.0.0.1:3080".to_string())
        );
        assert_eq!(parse_loopback_url("dsh web: http://0.0.0.0:3080"), None);
        assert_eq!(parse_loopback_url("https://127.0.0.1:3080"), None);
    }

    #[test]
    fn profile_names_are_restricted() {
        assert!(validate_profile("web").is_ok());
        assert!(validate_profile("xiaoyan-dev_1").is_ok());
        assert!(validate_profile("../../escape").is_err());
        assert!(validate_profile("profile name").is_err());
    }

    #[test]
    fn ignores_output_from_an_old_runtime_generation() {
        let mut runtime = RuntimeInner::new(DshRuntimeConfig::default());
        runtime.generation = 2;

        apply_output_line(
            &mut runtime,
            1,
            "stdout",
            "dsh web: http://127.0.0.1:3080".to_string(),
        );

        assert_eq!(runtime.phase, DshPhase::Stopped);
        assert!(runtime.url.is_none());
        assert!(runtime.logs.is_empty());
    }

    #[test]
    fn accepts_output_from_the_current_runtime_generation() {
        let mut runtime = RuntimeInner::new(DshRuntimeConfig::default());
        runtime.generation = 2;

        apply_output_line(
            &mut runtime,
            2,
            "stdout",
            "dsh web: http://127.0.0.1:3080".to_string(),
        );

        assert_eq!(runtime.phase, DshPhase::Running);
        assert_eq!(runtime.url.as_deref(), Some("http://127.0.0.1:3080"));
        assert_eq!(runtime.logs.len(), 1);
    }
}
