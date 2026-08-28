use crate::pi_web::{PiWebRuntimeConfig, PiWebRuntimeMode};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
};
use tokio::{
    process::{Child, Command},
    time::{timeout, Duration},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn executable_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["pi-web.exe", "pi-web.cmd", "pi-web.bat", "pi-web"]
    } else {
        &["pi-web"]
    }
}

fn is_runnable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = home_dir() {
        directories.extend([
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join("Library/pnpm"),
            home.join("bin"),
        ]);
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    directories
}

fn find_in_directories(directories: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    for directory in directories {
        for name in executable_names() {
            let candidate = directory.join(name);
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(unix)]
fn login_shell_pi_web() -> Option<PathBuf> {
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let shell = if Path::new("/bin/zsh").is_file() {
                "/bin/zsh"
            } else {
                "/bin/bash"
            };
            let output = std::process::Command::new(shell)
                .args(["-lic", "command -v pi-web"])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let candidate = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            is_runnable(&candidate).then_some(candidate)
        })
        .clone()
}

#[cfg(not(unix))]
fn login_shell_pi_web() -> Option<PathBuf> {
    None
}

pub fn find_pi_web() -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    directories.extend(extra_bin_dirs());
    find_in_directories(directories).or_else(login_shell_pi_web)
}

pub fn path_available() -> bool {
    find_pi_web().is_some()
}

/// 一次 Pi 启动的程序与前置参数：已安装/自定义模式直接执行 pi-web 入口；
/// 内置模式执行小妍自带的 node 并以 resources 内的 pi-web.js 作为前置参数。
#[derive(Debug, Clone)]
pub struct PiWebLaunchSpec {
    pub program: PathBuf,
    pub prefix_args: Vec<PathBuf>,
}

impl PiWebLaunchSpec {
    pub fn direct(executable: PathBuf) -> Self {
        Self {
            program: executable,
            prefix_args: Vec::new(),
        }
    }
}

pub fn resolve_executable(config: &PiWebRuntimeConfig) -> Result<PathBuf, String> {
    match config.mode {
        // Bundled 正常应经 PiWebRuntimeState::resolve_launch 解析
        //（内置优先、缺失回退）；此处是绕过 state 直接调用时的兜底。
        PiWebRuntimeMode::Bundled | PiWebRuntimeMode::Path => find_pi_web().ok_or_else(|| {
            "未找到 Pi，请先执行 npm install -g @agegr/pi-web，或指定可执行文件".to_string()
        }),
        PiWebRuntimeMode::External => {
            let executable = config
                .external_executable
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请先选择自定义 Pi 可执行文件".to_string())?;
            let path = Path::new(executable);
            if path.components().count() > 1 && !path.is_file() {
                return Err("自定义 Pi 可执行文件不存在".to_string());
            }
            Ok(path.to_path_buf())
        }
    }
}

pub fn allocate_loopback_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|error| format!("无法分配本地端口：{error}"))?;
    Ok(listener
        .local_addr()
        .map_err(|error| format!("无法读取本地端口：{error}"))?
        .port())
}

#[cfg(windows)]
fn command_for(executable: &Path) -> Command {
    let extension = executable
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat") {
        let mut command =
            Command::new(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()));
        command.creation_flags(CREATE_NO_WINDOW);
        command.args(["/d", "/s", "/c"]).arg(executable);
        command
    } else {
        let mut command = Command::new(executable);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
}

#[cfg(not(windows))]
fn command_for(executable: &Path) -> Command {
    Command::new(executable)
}

pub fn launch_web(
    spec: &PiWebLaunchSpec,
    workspace: &Path,
    agent_dir: Option<&Path>,
    port: u16,
) -> Command {
    let mut command = command_for(&spec.program);
    command
        .args(&spec.prefix_args)
        .args([
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--no-open",
        ])
        .current_dir(workspace)
        .env("PI_WEB_HOSTNAME", "127.0.0.1")
        .env("PI_WEB_NO_OPEN", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(agent_dir) = agent_dir {
        command.env("PI_CODING_AGENT_DIR", agent_dir);
    }
    command
}

pub async fn stop_child(mut child: Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("读取 Pi 退出状态失败：{error}"))?
        .is_some()
    {
        return Ok(());
    }
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let result = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;
        if result
            .map(|output| output.status.success())
            .unwrap_or(false)
        {
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
            return Ok(());
        }
    }
    child
        .kill()
        .await
        .map_err(|error| format!("停止 Pi 失败：{error}"))?;
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extra_paths_cover_npm_and_local_installs() {
        let paths = extra_bin_dirs();
        assert!(paths
            .iter()
            .any(|path| path.ends_with("bin") || path.ends_with("npm")));
    }

    #[test]
    fn executable_names_include_pi_web() {
        assert!(executable_names()
            .iter()
            .any(|name| name.starts_with("pi-web")));
    }
}
