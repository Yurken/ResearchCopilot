use crate::dsh::{DshRuntimeConfig, DshRuntimeMode};
use std::{
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

const DSH_SUPERVISOR_SOURCE: &str = include_str!("dsh_supervisor.mjs");

struct BundledDshPaths {
    node: PathBuf,
    entry: PathBuf,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "dsh.exe"
    } else {
        "dsh"
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

#[cfg(unix)]
fn login_shell_dsh() -> Option<PathBuf> {
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let shell = if Path::new("/bin/zsh").is_file() {
                "/bin/zsh"
            } else {
                "/bin/bash"
            };
            let output = std::process::Command::new(shell)
                .args(["-lic", "command -v dsh"])
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
fn login_shell_dsh() -> Option<PathBuf> {
    None
}

pub fn find_dsh() -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    directories.extend(extra_bin_dirs());
    for directory in directories {
        let candidate = directory.join(executable_name());
        if is_runnable(&candidate) {
            return Some(candidate);
        }
    }
    login_shell_dsh()
}

pub fn path_available() -> bool {
    find_dsh().is_some()
}

fn bundled_paths(runtime: &std::path::Path) -> Result<BundledDshPaths, String> {
    let paths = BundledDshPaths {
        node: if cfg!(windows) {
            runtime.join("node.exe")
        } else {
            runtime.join("node")
        },
        entry: runtime.join("lib").join("bin.js"),
    };
    if !paths.node.is_file() || !paths.entry.is_file() {
        return Err("尚未安装 DSH 私有运行时，请先一键安装".to_string());
    }
    Ok(paths)
}

pub fn bundled_available(runtime: &std::path::Path) -> bool {
    bundled_paths(runtime).is_ok()
}

pub fn format_exit_error(status: std::process::ExitStatus, was_starting: bool) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if status.signal() == Some(9) && was_starting {
            return "DSH 启动被中断（SIGKILL）。开发模式重载会停止托管 DSH，请等待应用稳定后重试。"
                .to_string();
        }
    }
    format!("DSH 进程已退出（{status}）")
}

pub fn launch_command(
    managed_runtime: &std::path::Path,
    config: &DshRuntimeConfig,
    workspace: PathBuf,
    data_home: PathBuf,
) -> Result<Command, String> {
    let mut command = match config.mode {
        DshRuntimeMode::Auto => {
            if let Some(executable) = find_dsh() {
                let mut command = Command::new(executable);
                #[cfg(windows)]
                command.creation_flags(CREATE_NO_WINDOW);
                command.stdin(Stdio::null()).kill_on_drop(true);
                command
            } else {
                bundled_command(managed_runtime)?
            }
        }
        DshRuntimeMode::Bundled => bundled_command(managed_runtime)?,
        DshRuntimeMode::External => {
            let mut command = Command::new(
                config
                    .external_executable
                    .as_deref()
                    .expect("validated external executable"),
            );
            #[cfg(windows)]
            command.creation_flags(CREATE_NO_WINDOW);
            command.stdin(Stdio::null()).kill_on_drop(true);
            command
        }
    };

    if config.profile == "web" {
        command.arg("web");
    } else {
        command.args(["--profile", config.profile.as_str()]);
    }
    command
        // `--no-open` 要求 DSH >= 0.1.1：新版 web 子命令默认打开系统浏览器，
        // 小妍在应用内 iframe 展示 Web UI，必须抑制浏览器弹出。
        .args(["--host", "127.0.0.1", "--port", "0", "--no-open"])
        .current_dir(workspace)
        .env("DSH_HOME", data_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn bundled_command(managed_runtime: &Path) -> Result<Command, String> {
    let paths = bundled_paths(managed_runtime)?;
    let mut command = Command::new(paths.node);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .args(["--input-type=module", "--eval", DSH_SUPERVISOR_SOURCE])
        .arg("xiaoyan-dsh-supervisor")
        .arg(paths.entry)
        .stdin(Stdio::piped());
    Ok(command)
}

pub async fn stop_child(mut child: Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("读取 DSH 退出状态失败：{error}"))?
        .is_some()
    {
        return Ok(());
    }

    if child.stdin.take().is_some() {
        match timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(_)) => return Ok(()),
            Ok(Err(error)) => return Err(format!("等待 DSH 退出失败：{error}")),
            Err(_) => {}
        }
    }

    child
        .kill()
        .await
        .map_err(|error| format!("停止 DSH 失败：{error}"))?;
    let _ = child.wait().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn explains_sigkill_during_development_startup() {
        use std::os::unix::process::ExitStatusExt;

        let message = format_exit_error(std::process::ExitStatus::from_raw(9), true);

        assert!(message.contains("开发模式重载"));
        assert!(message.contains("SIGKILL"));
    }

    #[test]
    fn extra_paths_cover_common_install_locations() {
        let paths = extra_bin_dirs();
        assert!(paths.iter().any(|path| path.ends_with(".local/bin")));
        assert!(paths.iter().any(|path| path == Path::new("/usr/local/bin")));
    }
}
