use crate::{
    append_diagnostic_log,
    opencode_process::{
        allocate_loopback_port, find_opencode, launch_web, path_available, resolve_executable,
        stop_child, validate_secure_version,
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
const OPENCODE_SOURCE: &str = "https://github.com/anomalyco/opencode";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenCodeRuntimeMode {
    Path,
    External,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeRuntimeConfig {
    pub mode: OpenCodeRuntimeMode,
    pub external_executable: Option<String>,
    pub workspace_dir: Option<String>,
}
impl Default for OpenCodeRuntimeConfig {
    fn default() -> Self {
        Self {
            mode: OpenCodeRuntimeMode::Path,
            external_executable: None,
            workspace_dir: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OpenCodePhase {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeRuntimeSnapshot {
    phase: OpenCodePhase,
    config: OpenCodeRuntimeConfig,
    url: Option<String>,
    error: Option<String>,
    logs: Vec<String>,
    path_available: bool,
    path_executable: Option<String>,
    source: String,
}

struct RuntimeInner {
    config: OpenCodeRuntimeConfig,
    phase: OpenCodePhase,
    child: Option<Child>,
    generation: u64,
    url: Option<String>,
    error: Option<String>,
    logs: VecDeque<String>,
}
impl RuntimeInner {
    fn new(config: OpenCodeRuntimeConfig) -> Self {
        Self {
            config,
            phase: OpenCodePhase::Stopped,
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
                if self.phase != OpenCodePhase::Stopped {
                    self.phase = OpenCodePhase::Failed;
                    self.error = Some(format!("OpenCode 进程已退出（{status}）"));
                }
            }
            Ok(None) => {}
            Err(error) => {
                self.child = None;
                self.url = None;
                self.phase = OpenCodePhase::Failed;
                self.error = Some(format!("无法读取 OpenCode 进程状态：{error}"));
            }
        }
    }
}

#[derive(Clone)]
pub struct OpenCodeRuntimeState {
    app_data_dir: PathBuf,
    inner: Arc<Mutex<RuntimeInner>>,
}
impl OpenCodeRuntimeState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config = read_config(&app_data_dir).unwrap_or_default();
        Self {
            app_data_dir,
            inner: Arc::new(Mutex::new(RuntimeInner::new(config))),
        }
    }
    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join("opencode/runtime.json")
    }
}
fn read_config(app_data_dir: &Path) -> Option<OpenCodeRuntimeConfig> {
    serde_json::from_str(&fs::read_to_string(app_data_dir.join("opencode/runtime.json")).ok()?).ok()
}
fn write_config(path: &Path, config: &OpenCodeRuntimeConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 OpenCode 配置目录失败：{error}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化 OpenCode 配置失败：{error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("保存 OpenCode 配置失败：{error}"))
}
fn normalize_config(mut config: OpenCodeRuntimeConfig) -> OpenCodeRuntimeConfig {
    config.external_executable = config
        .external_executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config.workspace_dir = config
        .workspace_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    config
}
fn validate_config(config: &OpenCodeRuntimeConfig) -> Result<(), String> {
    if let Some(workspace) = config.workspace_dir.as_deref() {
        if !Path::new(workspace).is_dir() {
            return Err("所选工作目录不存在或不是文件夹".to_string());
        }
    }
    if config.mode == OpenCodeRuntimeMode::External {
        resolve_executable(config)?;
    }
    Ok(())
}
fn workspace_dir(
    state: &OpenCodeRuntimeState,
    config: &OpenCodeRuntimeConfig,
) -> Result<PathBuf, String> {
    if let Some(path) = config.workspace_dir.as_deref() {
        return Ok(PathBuf::from(path));
    }
    let fallback = state.app_data_dir.join("opencode/workspace");
    fs::create_dir_all(&fallback)
        .map_err(|error| format!("创建默认 OpenCode 工作目录失败：{error}"))?;
    Ok(fallback)
}
async fn snapshot(state: &OpenCodeRuntimeState) -> OpenCodeRuntimeSnapshot {
    let mut inner = state.inner.lock().await;
    inner.refresh_child_status();
    OpenCodeRuntimeSnapshot {
        phase: inner.phase,
        config: inner.config.clone(),
        url: inner.url.clone(),
        error: inner.error.clone(),
        logs: inner.logs.iter().cloned().collect(),
        path_available: path_available(),
        path_executable: find_opencode().map(|path| path.display().to_string()),
        source: OPENCODE_SOURCE.to_string(),
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
    for _ in 0..40 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[tauri::command]
pub async fn opencode_runtime_status(
    state: State<'_, OpenCodeRuntimeState>,
) -> Result<OpenCodeRuntimeSnapshot, String> {
    Ok(snapshot(state.inner()).await)
}
#[tauri::command]
pub async fn opencode_runtime_configure(
    state: State<'_, OpenCodeRuntimeState>,
    config: OpenCodeRuntimeConfig,
) -> Result<OpenCodeRuntimeSnapshot, String> {
    let config = normalize_config(config);
    validate_config(&config)?;
    {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            return Err("请先停止 OpenCode，再切换运行时配置".to_string());
        }
        write_config(&state.config_path(), &config)?;
        inner.config = config;
        inner.phase = OpenCodePhase::Stopped;
        inner.url = None;
        inner.error = None;
    }
    Ok(snapshot(state.inner()).await)
}
#[tauri::command]
pub async fn opencode_runtime_start(
    state: State<'_, OpenCodeRuntimeState>,
) -> Result<OpenCodeRuntimeSnapshot, String> {
    let (stdout, stderr, generation) = {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            drop(inner);
            return Ok(snapshot(state.inner()).await);
        }
        let config = inner.config.clone();
        let workspace = workspace_dir(state.inner(), &config)?;
        let executable = resolve_executable(&config)?;
        validate_secure_version(&executable).await?;
        let port = allocate_loopback_port()?;
        let url = format!("http://127.0.0.1:{port}/");
        inner.phase = OpenCodePhase::Starting;
        inner.error = None;
        inner.logs.clear();
        let mut child = match launch_web(&executable, &workspace, port).spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("启动 OpenCode 失败：{error}");
                inner.phase = OpenCodePhase::Failed;
                inner.error = Some(message.clone());
                return Err(message);
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;
        inner.child = Some(child);
        inner.url = Some(url.clone());
        inner.push_log(format!(
            "[xiaoyan] OpenCode Web={url} workspace={}",
            workspace.display()
        ));
        (stdout, stderr, generation)
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
    if wait_for_loopback({
        let inner = state.inner.lock().await;
        inner
            .url
            .as_deref()
            .and_then(|url| url.trim_end_matches('/').rsplit(':').next())
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
    })
    .await
    {
        let mut inner = state.inner.lock().await;
        inner.refresh_child_status();
        if inner.child.is_some() {
            inner.phase = OpenCodePhase::Running;
            inner.error = None;
        }
    } else {
        let child = {
            let mut inner = state.inner.lock().await;
            inner.phase = OpenCodePhase::Failed;
            inner.url = None;
            inner.error = Some("OpenCode Web 启动超时".to_string());
            inner.child.take()
        };
        if let Some(child) = child {
            let _ = stop_child(child).await;
        }
    }
    append_diagnostic_log("opencode: web runtime start requested");
    Ok(snapshot(state.inner()).await)
}
#[tauri::command]
pub async fn opencode_runtime_stop(
    state: State<'_, OpenCodeRuntimeState>,
) -> Result<OpenCodeRuntimeSnapshot, String> {
    let child = {
        let mut inner = state.inner.lock().await;
        inner.generation = inner.generation.wrapping_add(1);
        inner.phase = OpenCodePhase::Stopped;
        inner.url = None;
        inner.error = None;
        inner.child.take()
    };
    if let Some(child) = child {
        stop_child(child).await?;
    }
    append_diagnostic_log("opencode: web runtime stopped");
    Ok(snapshot(state.inner()).await)
}
#[tauri::command]
pub async fn opencode_runtime_validate_external(executable: String) -> Result<String, String> {
    let executable = executable.trim();
    if executable.is_empty() {
        return Err("请先选择外部 OpenCode 可执行文件".to_string());
    }
    validate_secure_version(Path::new(executable)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_runtime_uses_path_mode() {
        assert_eq!(
            OpenCodeRuntimeConfig::default().mode,
            OpenCodeRuntimeMode::Path
        );
    }
}
