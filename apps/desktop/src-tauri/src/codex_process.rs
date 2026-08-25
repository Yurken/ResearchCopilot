use crate::codex::{CodexRuntimeConfig, CodexRuntimeMode};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
};
use tokio::process::{Child, Command};

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
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

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}

fn current_vendor_target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-musl"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-musl"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else {
        "x86_64-pc-windows-msvc"
    }
}

fn current_platform_package() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "codex-darwin-arm64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "codex-darwin-x64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "codex-linux-arm64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "codex-linux-x64"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "codex-win32-arm64"
    } else {
        "codex-win32-x64"
    }
}

fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = home_dir() {
        directories.push(home.join(".local").join("bin"));
        directories.push(home.join(".cargo").join("bin"));
        directories.push(home.join("bin"));
        directories.push(home.join(".npm-global").join("bin"));
    }
    directories.push(PathBuf::from("/opt/homebrew/bin"));
    directories.push(PathBuf::from("/usr/local/bin"));
    directories
}

fn npm_global_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        roots.push(home.join(".npm-global").join("lib").join("node_modules"));
        roots.push(
            home.join("Library")
                .join("pnpm")
                .join("global")
                .join("5")
                .join("node_modules"),
        );
    }
    roots.push(PathBuf::from("/opt/homebrew/lib/node_modules"));
    roots.push(PathBuf::from("/usr/local/lib/node_modules"));
    if let Some(prefix) = std::env::var_os("NPM_CONFIG_PREFIX").map(PathBuf::from) {
        roots.push(prefix.join("lib").join("node_modules"));
    }
    roots
}

pub(crate) fn npm_vendor_candidates(root: &Path) -> Vec<PathBuf> {
    let target = current_vendor_target();
    let name = executable_name();
    let pkg = root.join("@openai").join("codex");
    let nested = pkg
        .join("node_modules")
        .join("@openai")
        .join(current_platform_package());
    vec![
        nested.join("vendor").join(target).join("bin").join(name),
        pkg.join("vendor").join(target).join("bin").join(name),
        pkg.join("vendor").join(target).join("codex").join(name),
        root.join("@openai")
            .join(current_platform_package())
            .join("vendor")
            .join(target)
            .join("bin")
            .join(name),
    ]
}

fn native_binary_near(path: &Path) -> Option<PathBuf> {
    let resolved = path.canonicalize().ok()?;
    if resolved.extension().and_then(|value| value.to_str()) != Some("js") {
        return None;
    }
    let package_root = resolved.parent()?.parent()?;
    let node_modules = package_root.parent()?;
    npm_vendor_candidates(node_modules)
        .into_iter()
        .find(|candidate| is_runnable(candidate))
}

fn find_in_directories(directories: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    let name = executable_name();
    for directory in directories {
        let candidate = directory.join(name);
        if is_runnable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn find_npm_vendor_codex() -> Option<PathBuf> {
    for root in npm_global_roots() {
        for candidate in npm_vendor_candidates(&root) {
            if is_runnable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(unix)]
fn login_shell_codex() -> Option<PathBuf> {
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let shell = if Path::new("/bin/zsh").is_file() {
                "/bin/zsh"
            } else {
                "/bin/bash"
            };
            let output = std::process::Command::new(shell)
                .args(["-lic", "command -v codex"])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                return None;
            }
            let candidate = PathBuf::from(path);
            is_runnable(&candidate).then_some(candidate)
        })
        .clone()
}

#[cfg(not(unix))]
fn login_shell_codex() -> Option<PathBuf> {
    None
}

pub fn find_codex() -> Option<PathBuf> {
    let mut directories = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories.extend(extra_bin_dirs());
    let found = find_in_directories(directories)
        .or_else(login_shell_codex)
        .or_else(find_npm_vendor_codex)?;
    Some(native_binary_near(&found).unwrap_or(found))
}

pub fn path_available() -> bool {
    find_codex().is_some()
}

pub fn resolve_executable(config: &CodexRuntimeConfig) -> Result<PathBuf, String> {
    match config.mode {
        CodexRuntimeMode::Path => find_codex()
            .ok_or_else(|| "未找到官方 Codex Harness，请先安装或改为指定可执行文件".to_string()),
        CodexRuntimeMode::External => {
            let executable = config
                .external_executable
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请先选择外部 Codex 可执行文件".to_string())?;
            let path = Path::new(executable);
            if path.components().count() > 1 && !path.is_file() {
                return Err("外部 Codex 可执行文件不存在".to_string());
            }
            Ok(path.to_path_buf())
        }
    }
}

pub fn allocate_loopback_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|error| format!("无法分配本地端口：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法读取本地端口：{error}"))?
        .port();
    drop(listener);
    Ok(port)
}

pub fn format_exit_error(status: std::process::ExitStatus, was_starting: bool) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if status.signal() == Some(9) && was_starting {
            return "Codex 启动被中断（SIGKILL）。开发模式重载会停止内置进程，请等待应用稳定后重试。"
                .to_string();
        }
    }
    format!("Codex 进程已退出（{status}）")
}

fn apply_common_env(
    command: &mut Command,
    workspace: &Path,
    data_home: &Path,
    api_key: Option<&str>,
) {
    command
        .current_dir(workspace)
        .env("CODEX_HOME", data_home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(api_key) = api_key.filter(|value| !value.is_empty()) {
        command.env("XIAOYAN_API_KEY", api_key);
        command.env("CODEX_API_KEY", api_key);
    }
}

pub(crate) fn app_server_args(
    listen_url: &str,
    xiaoyan_model: Option<&str>,
    xiaoyan_base_url: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "app-server".to_string(),
        "--listen".to_string(),
        listen_url.to_string(),
    ];
    if let (Some(model), Some(base_url)) = (xiaoyan_model, xiaoyan_base_url) {
        args.extend([
            "-c".to_string(),
            format!("model={}", toml_literal(model)),
            "-c".to_string(),
            format!("model_provider={}", toml_literal("xiaoyan")),
            "-c".to_string(),
            format!("model_providers.xiaoyan.name={}", toml_literal("Xiaoyan")),
            "-c".to_string(),
            format!(
                "model_providers.xiaoyan.base_url={}",
                toml_literal(base_url)
            ),
            "-c".to_string(),
            format!(
                "model_providers.xiaoyan.env_key={}",
                toml_literal("XIAOYAN_API_KEY")
            ),
        ]);
    }
    args
}

fn toml_literal(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn launch_app_server(
    executable: &Path,
    workspace: PathBuf,
    data_home: PathBuf,
    listen_url: &str,
    xiaoyan_model: Option<&str>,
    xiaoyan_base_url: Option<&str>,
    api_key: Option<&str>,
) -> Command {
    let mut command = Command::new(executable);
    command.args(app_server_args(listen_url, xiaoyan_model, xiaoyan_base_url));
    apply_common_env(&mut command, &workspace, &data_home, api_key);
    command
}

pub async fn stop_child(mut child: Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("读取 Codex 退出状态失败：{error}"))?
        .is_some()
    {
        return Ok(());
    }
    child
        .kill()
        .await
        .map_err(|error| format!("停止 Codex 失败：{error}"))?;
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
    fn npm_vendor_candidates_cover_current_layout() {
        let candidates = npm_vendor_candidates(Path::new("/opt/homebrew/lib/node_modules"));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("codex") || path.ends_with("codex.exe")));
        assert!(candidates
            .iter()
            .any(|path| path.to_string_lossy().contains("vendor")));
        assert!(candidates
            .iter()
            .any(|path| path.to_string_lossy().contains("@openai/codex")));
        assert!(candidates
            .iter()
            .any(|path| path.to_string_lossy().contains("node_modules/@openai")));
    }

    #[test]
    fn extra_bin_dirs_include_homebrew_or_usr_local() {
        let directories = extra_bin_dirs();
        assert!(directories.iter().any(|path| path.ends_with("bin")));
    }

    #[test]
    fn app_server_args_do_not_pass_profile_flag() {
        let args = app_server_args("ws://127.0.0.1:4500", None, None);
        assert_eq!(args, ["app-server", "--listen", "ws://127.0.0.1:4500"]);
        assert!(!args.iter().any(|value| value == "-p"));

        let with_api = app_server_args(
            "ws://127.0.0.1:4500",
            Some("deepseek-chat"),
            Some("https://api.example/v1"),
        );
        assert!(!with_api.iter().any(|value| value == "-p"));
        assert!(with_api.contains(&"-c".to_string()));
        assert!(with_api
            .iter()
            .any(|value| value.contains("model_provider")));
        assert!(with_api.iter().any(|value| value.contains("deepseek-chat")));
    }
}
