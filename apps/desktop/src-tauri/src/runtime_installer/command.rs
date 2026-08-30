use std::{path::Path, process::Stdio, time::Duration};
use tokio::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// DSH 首次安装包含大量依赖；网络较慢的 Windows 环境中实测可能超过 20 分钟。
const INSTALL_COMMAND_TIMEOUT: Duration = Duration::from_secs(30 * 60);

fn configure_background_command(command: &mut Command) {
    // 安装命令不得等待 GUI 进程不存在的交互输入；超时或 future 被丢弃时
    // 同步终止子进程，避免一直占住 provider 的并发锁。
    command.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

pub(super) async fn run_command(
    program: &str,
    args: &[&str],
    envs: &[(&str, String)],
    current_dir: Option<&Path>,
) -> Result<(), String> {
    let mut command = Command::new(program);
    command.args(args);
    for (key, value) in envs {
        command.env(key, value);
    }
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }
    configure_background_command(&mut command);

    let output = tokio::time::timeout(INSTALL_COMMAND_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            format!(
                "安装命令超时（{program}，超过 {} 分钟）",
                INSTALL_COMMAND_TIMEOUT.as_secs() / 60
            )
        })?
        .map_err(|error| {
            format!(
                "运行安装命令失败（{program}）：{error}\n请确认已安装 {program} 且在 PATH 中可用"
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "安装命令退出失败（{}）：{}\nstdout：{}",
            output.status, stderr, stdout
        ));
    }
    Ok(())
}

pub(super) async fn run_npm_install(
    npm: &str,
    runtime_dir: &Path,
    package: &str,
    version: &str,
) -> Result<(), String> {
    let spec = format!("{package}@{version}");
    let prefix = runtime_dir.display().to_string();
    if cfg!(windows) {
        // Windows 上 npm 是 .cmd 文件，通过 cmd.exe 解析扩展名；/d 禁止加载
        // AutoRun，避免用户级 cmd 初始化脚本干扰无人值守安装。
        run_command(
            "cmd.exe",
            &[
                "/d",
                "/c",
                npm,
                "install",
                "--no-audit",
                "--no-fund",
                "--prefix",
                &prefix,
                &spec,
            ],
            &[],
            None,
        )
        .await
    } else {
        run_command(
            npm,
            &[
                "install",
                "--no-audit",
                "--no-fund",
                "--prefix",
                &prefix,
                &spec,
            ],
            &[],
            None,
        )
        .await
    }
}

async fn probe_program(program: &str, args: &[&str]) -> bool {
    let mut command = Command::new(program);
    command.args(args);
    configure_background_command(&mut command);
    command
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 解析可用的 npm。桌面 GUI 进程不继承登录 shell 的 PATH，直接 spawn
/// 失败时回退到登录 shell 中查找（与 pi_web_process 的本机发现策略一致）。
pub(super) async fn resolve_npm() -> Result<String, String> {
    const HINT: &str =
        "未找到 npm：托管运行时安装需要 npm，请先安装 Node.js（https://nodejs.org）后重试";
    if cfg!(windows) {
        if probe_program("cmd.exe", &["/d", "/c", "npm", "--version"]).await {
            return Ok("npm".to_string());
        }
        return Err(HINT.to_string());
    }
    if probe_program("npm", &["--version"]).await {
        return Ok("npm".to_string());
    }
    #[cfg(unix)]
    {
        if let Some(path) = login_shell_lookup("npm") {
            if probe_program(&path, &["--version"]).await {
                return Ok(path);
            }
        }
    }
    Err(HINT.to_string())
}

#[cfg(unix)]
fn login_shell_lookup(program: &str) -> Option<String> {
    let shell = if Path::new("/bin/zsh").is_file() {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };
    let output = std::process::Command::new(shell)
        .args(["-lic", &format!("command -v {program}")])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    // 登录 shell 可能输出 MOTD 等杂音，取最后一行非空输出。
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .last()
        .filter(|line| Path::new(line).is_file())
}
