use crate::opencode::{OpenCodeRuntimeConfig, OpenCodeRuntimeMode};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};

const MINIMUM_SAFE_VERSION: (u64, u64, u64) = (1, 1, 10);

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
fn executable_name() -> &'static str {
    if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
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
            home.join(".opencode/bin"),
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join("bin"),
        ]);
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    directories
}
fn find_in_directories(directories: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    for directory in directories {
        let candidate = directory.join(executable_name());
        if is_runnable(&candidate) {
            return Some(candidate);
        }
    }
    None
}
#[cfg(unix)]
fn login_shell_opencode() -> Option<PathBuf> {
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let shell = if Path::new("/bin/zsh").is_file() {
                "/bin/zsh"
            } else {
                "/bin/bash"
            };
            let output = std::process::Command::new(shell)
                .args(["-lic", "command -v opencode"])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let candidate =
                PathBuf::from(String::from_utf8_lossy(&output.stdout).trim().to_string());
            is_runnable(&candidate).then_some(candidate)
        })
        .clone()
}
#[cfg(not(unix))]
fn login_shell_opencode() -> Option<PathBuf> {
    None
}

pub fn find_opencode() -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    directories.extend(extra_bin_dirs());
    find_in_directories(directories).or_else(login_shell_opencode)
}
pub fn path_available() -> bool {
    find_opencode().is_some()
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let token = value
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find(|token| token.matches('.').count() >= 2)?;
    let mut parts = token.split('.').filter_map(|part| part.parse::<u64>().ok());
    Some((parts.next()?, parts.next()?, parts.next()?))
}

pub async fn validate_secure_version(executable: &Path) -> Result<String, String> {
    let output = timeout(
        Duration::from_secs(8),
        Command::new(executable).arg("--version").output(),
    )
    .await
    .map_err(|_| "OpenCode 版本检查超时".to_string())?
    .map_err(|error| format!("无法执行 OpenCode：{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("OpenCode 版本检查失败（{}）", output.status)
        } else {
            stderr
        });
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed =
        parse_version(&version).ok_or_else(|| "OpenCode 未返回可识别的版本号".to_string())?;
    if parsed < MINIMUM_SAFE_VERSION {
        return Err(
            "OpenCode Web 版本低于 1.1.10，存在已公开的本地代码执行风险，请升级后再使用"
                .to_string(),
        );
    }
    Ok(version)
}
pub fn resolve_executable(config: &OpenCodeRuntimeConfig) -> Result<PathBuf, String> {
    match config.mode {
        OpenCodeRuntimeMode::Path => find_opencode()
            .ok_or_else(|| "未找到 OpenCode，请先安装或改为指定可执行文件".to_string()),
        OpenCodeRuntimeMode::External => {
            let executable = config
                .external_executable
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请先选择自定义 OpenCode 可执行文件".to_string())?;
            let path = Path::new(executable);
            if path.components().count() > 1 && !path.is_file() {
                return Err("自定义 OpenCode 可执行文件不存在".to_string());
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
pub fn launch_web(executable: &Path, workspace: &Path, port: u16) -> Command {
    let mut command = Command::new(executable);
    command
        .args([
            "web",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(workspace)
        .env(
            "BROWSER",
            if cfg!(windows) {
                "none"
            } else {
                "/usr/bin/true"
            },
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}
pub async fn stop_child(mut child: Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("读取 OpenCode 退出状态失败：{error}"))?
        .is_some()
    {
        return Ok(());
    }
    child
        .kill()
        .await
        .map_err(|error| format!("停止 OpenCode 失败：{error}"))?;
    let _ = child.wait().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extra_paths_cover_common_install_locations() {
        assert!(extra_bin_dirs()
            .iter()
            .any(|path| path.to_string_lossy().contains("opencode")));
    }

    #[test]
    fn parses_and_compares_opencode_versions() {
        assert_eq!(parse_version("1.18.4"), Some((1, 18, 4)));
        assert_eq!(parse_version("opencode 1.1.10"), Some((1, 1, 10)));
        assert!(parse_version("unknown").is_none());
    }
}
