use crate::dsh::{DshRuntimeConfig, DshRuntimeMode};
use std::{path::PathBuf, process::Stdio};
use tauri::{AppHandle, Manager};
use tokio::{
    process::{Child, Command},
    time::{timeout, Duration},
};

const DSH_SUPERVISOR_SOURCE: &str = include_str!("dsh_supervisor.mjs");

struct BundledDshPaths {
    node: PathBuf,
    entry: PathBuf,
}

fn bundled_paths(app: &AppHandle) -> Result<BundledDshPaths, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{error}"))?
        .join("resources")
        .join("dsh");
    let runtime = root.join("runtime");
    let paths = BundledDshPaths {
        node: if cfg!(windows) {
            runtime.join("node.exe")
        } else {
            runtime.join("node")
        },
        entry: runtime.join("lib").join("bin.js"),
    };
    if !paths.node.is_file() || !paths.entry.is_file() {
        return Err(
            "当前安装包未包含完整的 DSH 运行时，请重新构建内置运行时或切换到外部 DSH".to_string(),
        );
    }
    Ok(paths)
}

pub fn bundled_available(app: &AppHandle) -> bool {
    bundled_paths(app).is_ok()
}

pub fn format_exit_error(status: std::process::ExitStatus, was_starting: bool) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if status.signal() == Some(9) && was_starting {
            return "DSH 启动被中断（SIGKILL）。开发模式重载会停止内置 DSH，请等待应用稳定后重试。"
                .to_string();
        }
    }
    format!("DSH 进程已退出（{status}）")
}

pub fn launch_command(
    app: &AppHandle,
    config: &DshRuntimeConfig,
    workspace: PathBuf,
    data_home: PathBuf,
) -> Result<Command, String> {
    let mut command = match config.mode {
        DshRuntimeMode::Bundled => {
            let paths = bundled_paths(app)?;
            let mut command = Command::new(paths.node);
            command
                .args(["--input-type=module", "--eval", DSH_SUPERVISOR_SOURCE])
                .arg("xiaoyan-dsh-supervisor")
                .arg(paths.entry)
                .stdin(Stdio::piped());
            command
        }
        DshRuntimeMode::External => {
            let mut command = Command::new(
                config
                    .external_executable
                    .as_deref()
                    .expect("validated external executable"),
            );
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
        .args(["--host", "127.0.0.1", "--port", "0"])
        .current_dir(workspace)
        .env("DSH_HOME", data_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
}
