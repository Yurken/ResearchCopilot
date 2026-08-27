use crate::append_diagnostic_log;
use crate::codex_api_config::{write_codex_api_configuration, CodexApiImportResult};
use crate::codex_process::{
    allocate_loopback_port, format_exit_error, launch_app_server, path_available,
    resolve_executable, stop_child,
};
use crate::codex_web::{self, CodexWebServer};
use crate::dsh_api_config::resolve_xiaoyan_api;
use crate::state::AppState;
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
    process::Child,
    sync::Mutex,
    time::{timeout, Duration},
};

const MAX_LOG_LINES: usize = 120;
const CODEX_SOURCE: &str = "https://github.com/openai/codex";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexRuntimeMode {
    Path,
    External,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeConfig {
    pub mode: CodexRuntimeMode,
    pub external_executable: Option<String>,
    pub external_home: Option<String>,
    pub workspace_dir: Option<String>,
}

impl Default for CodexRuntimeConfig {
    fn default() -> Self {
        Self {
            mode: CodexRuntimeMode::Path,
            external_executable: None,
            external_home: None,
            workspace_dir: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CodexPhase {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeSnapshot {
    phase: CodexPhase,
    config: CodexRuntimeConfig,
    url: Option<String>,
    error: Option<String>,
    logs: Vec<String>,
    path_available: bool,
    path_executable: Option<String>,
    source: String,
    data_home: String,
}

struct RuntimeInner {
    config: CodexRuntimeConfig,
    phase: CodexPhase,
    child: Option<Child>,
    web_server: Option<CodexWebServer>,
    generation: u64,
    url: Option<String>,
    error: Option<String>,
    logs: VecDeque<String>,
}

impl RuntimeInner {
    fn new(config: CodexRuntimeConfig) -> Self {
        Self {
            config,
            phase: CodexPhase::Stopped,
            child: None,
            web_server: None,
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
                if let Some(server) = self.web_server.take() {
                    server.stop();
                }
                self.generation = self.generation.wrapping_add(1);
                self.url = None;
                if self.phase != CodexPhase::Stopped {
                    let was_starting = self.phase == CodexPhase::Starting;
                    self.phase = CodexPhase::Failed;
                    self.error = Some(format_exit_error(status, was_starting));
                }
            }
            Ok(None) => {}
            Err(error) => {
                self.child = None;
                if let Some(server) = self.web_server.take() {
                    server.stop();
                }
                self.generation = self.generation.wrapping_add(1);
                self.url = None;
                self.phase = CodexPhase::Failed;
                self.error = Some(format!("无法读取 Codex 进程状态：{error}"));
            }
        }
    }
}

#[derive(Clone)]
pub struct CodexRuntimeState {
    app_data_dir: PathBuf,
    inner: Arc<Mutex<RuntimeInner>>,
}

impl CodexRuntimeState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config = read_config(&app_data_dir).unwrap_or_default();
        Self {
            app_data_dir,
            inner: Arc::new(Mutex::new(RuntimeInner::new(config))),
        }
    }
    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join("codex/runtime.json")
    }
    fn isolated_home(&self) -> PathBuf {
        self.app_data_dir.join("codex/home")
    }
    fn data_home(&self, config: &CodexRuntimeConfig) -> PathBuf {
        config
            .external_home
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(default_user_codex_home)
            .unwrap_or_else(|| self.isolated_home())
    }
}

fn read_config(app_data_dir: &Path) -> Option<CodexRuntimeConfig> {
    serde_json::from_str(&fs::read_to_string(app_data_dir.join("codex/runtime.json")).ok()?).ok()
}
fn write_config(path: &Path, config: &CodexRuntimeConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 Codex 配置目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化 Codex 配置失败：{error}"))?;
    fs::write(path, format!("{content}\n")).map_err(|error| format!("保存 Codex 配置失败：{error}"))
}
fn default_user_codex_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .map(|home| home.join(".codex"))
}
fn normalize_config(mut config: CodexRuntimeConfig) -> CodexRuntimeConfig {
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
    config
}
fn validate_config(config: &CodexRuntimeConfig) -> Result<(), String> {
    if let Some(workspace) = config
        .workspace_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if !Path::new(workspace).is_dir() {
            return Err("所选工作目录不存在或不是文件夹".to_string());
        }
    }
    if config.mode == CodexRuntimeMode::External {
        resolve_executable(config)?;
    }
    Ok(())
}
fn workspace_dir(
    state: &CodexRuntimeState,
    config: &CodexRuntimeConfig,
) -> Result<PathBuf, String> {
    if let Some(path) = config
        .workspace_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(PathBuf::from(path));
    }
    let fallback = state.app_data_dir.join("codex/workspace");
    fs::create_dir_all(&fallback)
        .map_err(|error| format!("创建默认 Codex 工作目录失败：{error}"))?;
    Ok(fallback)
}

async fn snapshot(state: &CodexRuntimeState) -> CodexRuntimeSnapshot {
    let mut inner = state.inner.lock().await;
    inner.refresh_child_status();
    CodexRuntimeSnapshot {
        phase: inner.phase,
        config: inner.config.clone(),
        url: inner.url.clone(),
        error: inner.error.clone(),
        logs: inner.logs.iter().cloned().collect(),
        path_available: path_available(),
        path_executable: crate::codex_process::find_codex().map(|path| path.display().to_string()),
        source: CODEX_SOURCE.to_string(),
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

struct XiaoyanCodexRoute {
    model: String,
    base_url: String,
    api_key: String,
}
async fn current_xiaoyan_route(app_state: &AppState) -> Option<XiaoyanCodexRoute> {
    let settings = app_state.settings.read().await;
    let profile = resolve_xiaoyan_api(&settings).ok()?;
    if profile.protocol != "openai-completions" {
        return None;
    }
    Some(XiaoyanCodexRoute {
        model: profile.model,
        base_url: profile.base_url,
        api_key: profile.api_key,
    })
}

#[tauri::command]
pub async fn codex_runtime_status(
    state: State<'_, CodexRuntimeState>,
) -> Result<CodexRuntimeSnapshot, String> {
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn codex_runtime_configure(
    state: State<'_, CodexRuntimeState>,
    config: CodexRuntimeConfig,
) -> Result<CodexRuntimeSnapshot, String> {
    let config = normalize_config(config);
    validate_config(&config)?;
    {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 Codex，再切换运行时配置".to_string());
        }
        if let Some(server) = inner.web_server.take() {
            server.stop();
        }
        write_config(&state.config_path(), &config)?;
        inner.generation = inner.generation.wrapping_add(1);
        inner.config = config;
        inner.phase = CodexPhase::Stopped;
        inner.url = None;
        inner.error = None;
    }
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn codex_runtime_start(
    state: State<'_, CodexRuntimeState>,
    app_state: State<'_, AppState>,
) -> Result<CodexRuntimeSnapshot, String> {
    let route = current_xiaoyan_route(app_state.inner()).await;
    let (stdout, stderr, generation) = {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            drop(inner);
            return Ok(snapshot(state.inner()).await);
        }
        let config = inner.config.clone();
        let data_home = state.data_home(&config);
        fs::create_dir_all(&data_home)
            .map_err(|error| format!("创建 Codex 数据目录失败：{error}"))?;
        let workspace = workspace_dir(state.inner(), &config)?;
        let executable = resolve_executable(&config)?;
        let listen_url = format!("ws://127.0.0.1:{}", allocate_loopback_port()?);
        let mut command = launch_app_server(
            &executable,
            workspace.clone(),
            data_home,
            &listen_url,
            route.as_ref().map(|item| item.model.as_str()),
            route.as_ref().map(|item| item.base_url.as_str()),
            route.as_ref().map(|item| item.api_key.as_str()),
        );
        inner.phase = CodexPhase::Starting;
        inner.error = None;
        inner.logs.clear();
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("启动 Codex 失败：{error}");
                inner.phase = CodexPhase::Failed;
                inner.error = Some(message.clone());
                return Err(message);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let web_server = match codex_web::start(listen_url.clone(), &workspace).await {
            Ok(server) => server,
            Err(error) => {
                let _ = stop_child(child).await;
                inner.phase = CodexPhase::Failed;
                inner.error = Some(error.clone());
                return Err(error);
            }
        };
        let web_url = web_server.url.clone();
        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;
        inner.phase = CodexPhase::Running;
        inner.child = Some(child);
        inner.web_server = Some(web_server);
        inner.url = Some(web_url.clone());
        inner.push_log(format!(
            "[xiaoyan] Codex Web={web_url} app-server={listen_url} workspace={}",
            workspace.display()
        ));
        (stdout, stderr, generation)
    };
    append_diagnostic_log("codex: web runtime start requested");
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
    tokio::time::sleep(Duration::from_millis(150)).await;
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn codex_runtime_stop(
    state: State<'_, CodexRuntimeState>,
) -> Result<CodexRuntimeSnapshot, String> {
    let child = {
        let mut inner = state.inner.lock().await;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = CodexPhase::Stopped;
        inner.url = None;
        inner.error = None;
        if let Some(server) = inner.web_server.take() {
            server.stop();
        }
        inner.child.take()
    };
    if let Some(child) = child {
        stop_child(child).await?;
    }
    append_diagnostic_log("codex: web runtime stopped");
    Ok(snapshot(state.inner()).await)
}

#[tauri::command]
pub async fn codex_runtime_validate_external(executable: String) -> Result<String, String> {
    let executable = executable.trim();
    if executable.is_empty() {
        return Err("请先选择自定义 Codex 可执行文件".to_string());
    }
    let output = timeout(
        Duration::from_secs(8),
        tokio::process::Command::new(executable)
            .arg("--version")
            .output(),
    )
    .await
    .map_err(|_| "自定义 Codex 版本检查超时".to_string())?
    .map_err(|error| format!("无法执行自定义 Codex：{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("自定义 Codex 版本检查失败（{}）", output.status)
        } else {
            stderr
        });
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        Err("自定义 Codex 未返回版本号".to_string())
    } else {
        Ok(version)
    }
}

#[tauri::command]
pub async fn codex_runtime_import_xiaoyan_api(
    runtime_state: State<'_, CodexRuntimeState>,
    app_state: State<'_, AppState>,
) -> Result<CodexApiImportResult, String> {
    let profile = {
        let settings = app_state.settings.read().await;
        resolve_xiaoyan_api(&settings)?
    };
    let result = {
        let mut inner = runtime_state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 Codex，再同步小妍 API".to_string());
        }
        write_codex_api_configuration(&runtime_state.data_home(&inner.config), &profile)?
    };
    append_diagnostic_log("codex: xiaoyan api configuration updated");
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_runtime_uses_path_mode() {
        assert_eq!(CodexRuntimeConfig::default().mode, CodexRuntimeMode::Path);
    }
}
