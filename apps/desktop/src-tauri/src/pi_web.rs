use crate::runtime_installer::{managed_runtime_dir, ManagedRuntimeProvider};
use crate::{
    append_diagnostic_log,
    pi_web_process::{
        allocate_loopback_port, find_pi_web, launch_web, path_available, resolve_executable,
        stop_child, PiWebLaunchSpec,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::State;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    net::TcpStream,
    process::Child,
    sync::Mutex,
    time::Duration,
};

const MAX_LOG_LINES: usize = 120;
const PI_WEB_SOURCE: &str = "https://github.com/agegr/pi-web";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PiWebRuntimeMode {
    Auto,
    /// 小妍下载并维护的托管运行时
    Bundled,
    Path,
    External,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiWebRuntimeConfig {
    pub mode: PiWebRuntimeMode,
    pub external_executable: Option<String>,
    pub agent_dir: Option<String>,
    pub workspace_dir: Option<String>,
}

impl Default for PiWebRuntimeConfig {
    fn default() -> Self {
        Self {
            mode: PiWebRuntimeMode::Auto,
            external_executable: None,
            agent_dir: None,
            workspace_dir: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PiWebPhase {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiWebRuntimeSnapshot {
    phase: PiWebPhase,
    config: PiWebRuntimeConfig,
    url: Option<String>,
    error: Option<String>,
    logs: Vec<String>,
    bundled_available: bool,
    bundled_executable: Option<String>,
    path_available: bool,
    path_executable: Option<String>,
    source: String,
    data_home: String,
}

struct RuntimeInner {
    config: PiWebRuntimeConfig,
    phase: PiWebPhase,
    child: Option<Child>,
    generation: u64,
    url: Option<String>,
    error: Option<String>,
    logs: VecDeque<String>,
}

impl RuntimeInner {
    fn new(config: PiWebRuntimeConfig) -> Self {
        Self {
            config,
            phase: PiWebPhase::Stopped,
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
                self.url = None;
                self.generation = self.generation.wrapping_add(1);
                if self.phase != PiWebPhase::Stopped {
                    self.phase = PiWebPhase::Failed;
                    self.error = Some(format!("Pi 进程已退出（{status}）"));
                }
            }
            Ok(None) => {}
            Err(error) => {
                self.child = None;
                self.url = None;
                self.phase = PiWebPhase::Failed;
                self.error = Some(format!("无法读取 Pi 进程状态：{error}"));
            }
        }
    }
}

#[derive(Clone)]
pub struct PiWebRuntimeState {
    app_data_dir: PathBuf,
    inner: Arc<Mutex<RuntimeInner>>,
}

impl PiWebRuntimeState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config = normalize_config(read_config(&app_data_dir).unwrap_or_default());
        Self {
            app_data_dir,
            inner: Arc::new(Mutex::new(RuntimeInner::new(config))),
        }
    }

    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join("pi-web/runtime.json")
    }

    /// 托管运行时：按需下载到应用数据目录，不进入安装包。
    fn bundled_launch(&self) -> Option<PiWebLaunchSpec> {
        let runtime = managed_runtime_dir(&self.app_data_dir, ManagedRuntimeProvider::PiWeb);
        let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = runtime.join("bin").join("pi-web.js");
        if node.is_file() && entry.is_file() {
            let mut spec = PiWebLaunchSpec::direct(node);
            spec.prefix_args.push(entry);
            Some(spec)
        } else {
            None
        }
    }

    /// 自动模式优先本机版本，缺失时回退到小妍私有目录。
    fn resolve_launch(&self, config: &PiWebRuntimeConfig) -> Result<PiWebLaunchSpec, String> {
        match config.mode {
            PiWebRuntimeMode::Auto => find_pi_web()
                .map(PiWebLaunchSpec::direct)
                .or_else(|| self.bundled_launch())
                .ok_or_else(|| "未找到本机 Pi，请先一键安装".to_string()),
            PiWebRuntimeMode::Bundled => self
                .bundled_launch()
                .ok_or_else(|| "尚未安装 Pi 托管运行时，请先一键安装".to_string()),
            PiWebRuntimeMode::Path | PiWebRuntimeMode::External => {
                resolve_executable(config).map(PiWebLaunchSpec::direct)
            }
        }
    }

    fn data_home(&self, config: &PiWebRuntimeConfig) -> PathBuf {
        config
            .agent_dir
            .as_deref()
            .map(PathBuf::from)
            .or_else(default_pi_agent_dir)
            .unwrap_or_else(|| self.app_data_dir.join("pi-web/agent"))
    }
}

fn default_pi_agent_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .map(|home| home.join(".pi/agent"))
}

fn read_config(app_data_dir: &Path) -> Option<PiWebRuntimeConfig> {
    serde_json::from_str(&fs::read_to_string(app_data_dir.join("pi-web/runtime.json")).ok()?).ok()
}

fn write_config(path: &Path, config: &PiWebRuntimeConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 Pi 配置目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化 Pi 配置失败：{error}"))?;
    fs::write(path, format!("{content}\n")).map_err(|error| format!("保存 Pi 配置失败：{error}"))
}

fn normalize_config(mut config: PiWebRuntimeConfig) -> PiWebRuntimeConfig {
    if matches!(
        config.mode,
        PiWebRuntimeMode::Bundled | PiWebRuntimeMode::Path
    ) {
        config.mode = PiWebRuntimeMode::Auto;
    }
    config.external_executable = normalize_optional(config.external_executable);
    config.agent_dir = normalize_optional(config.agent_dir);
    config.workspace_dir = normalize_optional(config.workspace_dir);
    config
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn validate_config(state: &PiWebRuntimeState, config: &PiWebRuntimeConfig) -> Result<(), String> {
    for (label, path) in [
        ("工作目录", config.workspace_dir.as_deref()),
        ("Pi 数据目录", config.agent_dir.as_deref()),
    ] {
        if let Some(path) = path {
            if !Path::new(path).is_dir() {
                return Err(format!("所选{label}不存在或不是文件夹"));
            }
        }
    }
    if config.mode == PiWebRuntimeMode::External {
        resolve_executable(config)?;
    }
    if matches!(
        config.mode,
        PiWebRuntimeMode::Auto | PiWebRuntimeMode::Bundled
    ) {
        state.resolve_launch(config)?;
    }
    Ok(())
}

fn workspace_dir(
    state: &PiWebRuntimeState,
    config: &PiWebRuntimeConfig,
) -> Result<PathBuf, String> {
    if let Some(path) = config.workspace_dir.as_deref() {
        return Ok(PathBuf::from(path));
    }
    let fallback = state.app_data_dir.join("pi-web/workspace");
    fs::create_dir_all(&fallback).map_err(|error| format!("创建默认 Pi 工作目录失败：{error}"))?;
    Ok(fallback)
}

async fn snapshot(state: &PiWebRuntimeState) -> PiWebRuntimeSnapshot {
    let mut inner = state.inner.lock().await;
    inner.refresh_child_status();
    PiWebRuntimeSnapshot {
        phase: inner.phase,
        config: inner.config.clone(),
        url: inner.url.clone(),
        error: inner.error.clone(),
        logs: inner.logs.iter().cloned().collect(),
        bundled_executable: state.bundled_launch().and_then(|spec| {
            spec.prefix_args
                .first()
                .map(|path| path.display().to_string())
        }),
        bundled_available: state.bundled_launch().is_some(),
        path_available: path_available(),
        path_executable: find_pi_web().map(|path| path.display().to_string()),
        source: PI_WEB_SOURCE.to_string(),
        data_home: state.data_home(&inner.config).display().to_string(),
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
        if runtime.generation != generation {
            return;
        }
        runtime.push_log(format!("[{stream_name}] {line}"));
    }
}

async fn wait_for_loopback(port: u16) -> bool {
    for _ in 0..120 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[tauri::command]
pub async fn pi_web_runtime_status(
    state: State<'_, PiWebRuntimeState>,
) -> Result<PiWebRuntimeSnapshot, String> {
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn pi_web_runtime_configure(
    state: State<'_, PiWebRuntimeState>,
    config: PiWebRuntimeConfig,
) -> Result<PiWebRuntimeSnapshot, String> {
    let config = normalize_config(config);
    validate_config(state.inner(), &config)?;
    {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 Pi，再切换运行时配置".to_string());
        }
        write_config(&state.config_path(), &config)?;
        inner.config = config;
        inner.phase = PiWebPhase::Stopped;
        inner.url = None;
        inner.error = None;
    }
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn pi_web_runtime_start(
    state: State<'_, PiWebRuntimeState>,
) -> Result<PiWebRuntimeSnapshot, String> {
    let (stdout, stderr, generation, port) = {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            drop(inner);
            return Ok(snapshot(state.inner()).await);
        }
        let config = inner.config.clone();
        let workspace = workspace_dir(state.inner(), &config)?;
        let launch = state.resolve_launch(&config)?;
        let port = allocate_loopback_port()?;
        let agent_dir = config.agent_dir.as_deref().map(Path::new);
        let mut command = launch_web(&launch, &workspace, agent_dir, port);
        inner.phase = PiWebPhase::Starting;
        inner.error = None;
        inner.logs.clear();
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("启动 Pi 失败：{error}");
                inner.phase = PiWebPhase::Failed;
                inner.error = Some(message.clone());
                return Err(message);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;
        inner.child = Some(child);
        inner.url = Some(format!("http://127.0.0.1:{port}/"));
        inner.push_log(format!(
            "[xiaoyan] Pi=http://127.0.0.1:{port}/ workspace={} data={}",
            workspace.display(),
            state.data_home(&config).display()
        ));
        (stdout, stderr, generation, port)
    };
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
    if wait_for_loopback(port).await {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            inner.phase = PiWebPhase::Running;
            inner.error = None;
        }
    } else {
        let child = {
            let mut inner = state.inner.lock().await;
            inner.phase = PiWebPhase::Failed;
            inner.url = None;
            inner.error = Some("Pi 启动超时，请确认 Node.js 已升级到 22.19 或更高版本".to_string());
            inner.child.take()
        };
        if let Some(child) = child {
            let _ = stop_child(child).await;
        }
    }
    append_diagnostic_log("pi-web: runtime start requested");
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn pi_web_runtime_stop(
    state: State<'_, PiWebRuntimeState>,
) -> Result<PiWebRuntimeSnapshot, String> {
    let child = {
        let mut inner = state.inner.lock().await;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = PiWebPhase::Stopped;
        inner.url = None;
        inner.error = None;
        inner.child.take()
    };
    if let Some(child) = child {
        stop_child(child).await?;
    }
    append_diagnostic_log("pi-web: runtime stopped");
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn pi_web_runtime_validate_external(executable: String) -> Result<String, String> {
    let config = PiWebRuntimeConfig {
        mode: PiWebRuntimeMode::External,
        external_executable: Some(executable),
        ..PiWebRuntimeConfig::default()
    };
    let path = resolve_executable(&normalize_config(config))?;
    Ok(format!("已识别 Pi：{}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_runtime_uses_auto_mode() {
        assert_eq!(PiWebRuntimeConfig::default().mode, PiWebRuntimeMode::Auto);
    }

    #[test]
    fn legacy_modes_migrate_to_auto() {
        for mode in [PiWebRuntimeMode::Bundled, PiWebRuntimeMode::Path] {
            let config = normalize_config(PiWebRuntimeConfig {
                mode,
                ..PiWebRuntimeConfig::default()
            });
            assert_eq!(config.mode, PiWebRuntimeMode::Auto);
        }
    }

    #[test]
    fn optional_values_are_trimmed() {
        assert_eq!(
            normalize_optional(Some("  /tmp/pi  ".into())),
            Some("/tmp/pi".into())
        );
        assert_eq!(normalize_optional(Some("  ".into())), None);
    }
}
