use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::State;
use tokio::{process::Command, sync::Mutex};

const NODE_VERSION: &str = "22.19.0";
const NODE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedRuntimeProvider {
    Codex,
    Dsh,
    Opencode,
    PiWeb,
}

impl ManagedRuntimeProvider {
    fn key(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Dsh => "dsh",
            Self::Opencode => "opencode",
            Self::PiWeb => "pi-web",
        }
    }

    fn manifest_json(self) -> &'static str {
        match self {
            Self::Codex => include_str!("../resources/codex/manifest.json"),
            Self::Dsh => include_str!("../resources/dsh/manifest.json"),
            Self::Opencode => include_str!("../resources/opencode/manifest.json"),
            Self::PiWeb => include_str!("../resources/pi-web/manifest.json"),
        }
    }

    fn manifest(self) -> Result<ProviderManifest, String> {
        serde_json::from_str(self.manifest_json())
            .map_err(|error| format!("解析 {} 托管运行时清单失败：{error}", self.key()))
    }
}

#[derive(Debug, Deserialize)]
struct ProviderManifest {
    version: String,
    #[allow(dead_code)]
    #[serde(default)]
    commit: String,
    install: InstallConfig,
}

#[derive(Debug, Deserialize)]
struct InstallConfig {
    #[serde(rename = "method")]
    _method: InstallMethod,
    #[serde(default)]
    package: Option<String>,
    #[serde(default, rename = "nodeVersion")]
    node_version: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum InstallMethod {
    Shell,
    Npm,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeInstall {
    provider: &'static str,
    version: String,
    installed_path: String,
}

#[derive(Clone)]
pub struct RuntimeInstallerState {
    app_data_dir: PathBuf,
    active: Arc<Mutex<HashSet<ManagedRuntimeProvider>>>,
}

impl RuntimeInstallerState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            active: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

pub fn managed_runtime_dir(app_data_dir: &Path, provider: ManagedRuntimeProvider) -> PathBuf {
    app_data_dir
        .join("managed-runtimes")
        .join(provider.key())
        .join("runtime")
}

fn node_platform_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("windows", "x86_64") => Ok("win-x64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        (os, arch) => Err(format!("当前平台暂不支持托管运行时：{os}/{arch}")),
    }
}

fn validate_managed_dir(runtime_dir: &Path, app_data_dir: &Path) -> Result<(), String> {
    let expected = app_data_dir
        .canonicalize()
        .unwrap_or_else(|_| app_data_dir.to_path_buf())
        .join("managed-runtimes");
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "运行时目录无效".to_string())?;
    let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    if !canonical_parent.starts_with(&expected) {
        return Err("运行时目录不在应用数据目录下".to_string());
    }
    if parent.file_name() != Some(OsStr::new("runtime")) {
        return Err("运行时目录结构无效".to_string());
    }
    Ok(())
}

fn required_files(provider: ManagedRuntimeProvider, runtime: &Path) -> Vec<PathBuf> {
    match provider {
        ManagedRuntimeProvider::Codex => {
            vec![runtime
                .join("bin")
                .join(if cfg!(windows) { "codex.exe" } else { "codex" })]
        }
        ManagedRuntimeProvider::Opencode => vec![{
            let bin_dir = runtime.join("bin");
            if cfg!(windows) {
                if bin_dir.join("opencode.exe").exists() {
                    bin_dir.join("opencode.exe")
                } else {
                    bin_dir.join("opencode")
                }
            } else {
                bin_dir.join("opencode")
            }
        }],
        ManagedRuntimeProvider::PiWeb => vec![
            runtime.join(if cfg!(windows) { "node.exe" } else { "node" }),
            runtime.join("bin").join("pi-web.js"),
        ],
        ManagedRuntimeProvider::Dsh => vec![
            runtime.join(if cfg!(windows) { "node.exe" } else { "node" }),
            runtime.join("lib").join("bin.js"),
        ],
    }
}

fn ensure_required_files(provider: ManagedRuntimeProvider, runtime: &Path) -> Result<(), String> {
    if let Some(missing) = required_files(provider, runtime)
        .into_iter()
        .find(|path| {
            fs::symlink_metadata(path)
                .map(|metadata| !metadata.file_type().is_file())
                .unwrap_or(true)
        })
    {
        return Err(format!(
            "运行时安装不完整，缺少 {}",
            missing.display()
        ));
    }
    if provider == ManagedRuntimeProvider::Codex || provider == ManagedRuntimeProvider::Opencode {
        for executable in required_files(provider, runtime) {
            ensure_executable(&executable)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path)
        .map_err(|error| format!("读取运行时文件权限失败：{error}"))?
        .permissions()
        .mode();
    if mode & 0o111 == 0 {
        return Err(format!("运行时入口不可执行：{}", path.display()));
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("读取文件权限失败：{error}"))?
        .permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("设置可执行权限失败：{error}"))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn copy_file(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建目录失败 {}：{error}", parent.display()))?;
    }
    fs::copy(src, dst).map_err(|error| {
        format!(
            "复制文件 {} -> {} 失败：{error}",
            src.display(),
            dst.display()
        )
    })?;
    Ok(())
}

fn user_home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法确定用户主目录".to_string())
}

async fn run_command(
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
    let output = command
        .output()
        .await
        .map_err(|error| format!("运行安装命令失败（{program}）：{error}"))?;
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

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(NODE_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
}

async fn download_node(runtime_dir: &Path, version: &str) -> Result<(), String> {
    let platform = node_platform_name()?;
    let client = http_client()?;

    if cfg!(windows) {
        let url = format!(
            "https://nodejs.org/dist/v{version}/node-v{version}-{platform}.zip"
        );
        let bytes = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .bytes()
            .await
            .map_err(|error| format!("读取 Node 响应失败：{error}"))?;
        extract_node_from_zip(&bytes, runtime_dir)?;
    } else if platform.starts_with("darwin") {
        let url = format!(
            "https://nodejs.org/dist/v{version}/node-v{version}-{platform}.tar.gz"
        );
        let bytes = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .bytes()
            .await
            .map_err(|error| format!("读取 Node 响应失败：{error}"))?;
        extract_node_from_tar_gz(&bytes, runtime_dir)?;
    } else {
        let url = format!(
            "https://nodejs.org/dist/v{version}/node-v{version}-{platform}.tar.xz"
        );
        let bytes = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("下载 Node 失败：{error}"))?
            .bytes()
            .await
            .map_err(|error| format!("读取 Node 响应失败：{error}"))?;
        extract_node_from_tar_xz(&bytes, runtime_dir)?;
    }
    Ok(())
}

fn extract_node_from_tar<R: Read>(
    archive: &mut tar::Archive<R>,
    runtime_dir: &Path,
) -> Result<(), String> {
    let node_name = OsStr::new(if cfg!(windows) { "node.exe" } else { "node" });
    for entry in archive.entries().map_err(|error| format!("读取 tar 归档失败：{error}"))? {
        let mut entry = entry.map_err(|error| format!("读取 tar 条目失败：{error}"))?;
        let path = entry.path().map_err(|error| format!("读取 tar 路径失败：{error}"))?;
        let components: Vec<_> = path.components().collect();
        if components.len() == 3
            && matches!(components[1], Component::Normal(os_str) if os_str == OsStr::new("bin"))
            && path.file_name() == Some(node_name)
        {
            let dest = runtime_dir.join(node_name);
            entry.unpack(&dest).map_err(|error| {
                format!("解压 Node 二进制文件到 {} 失败：{error}", dest.display())
            })?;
            set_executable(&dest)?;
            return Ok(());
        }
    }
    Err("Node 压缩包中未找到 node 二进制文件".to_string())
}

fn extract_node_from_tar_gz(bytes: &[u8], runtime_dir: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    extract_node_from_tar(&mut archive, runtime_dir)
}

fn extract_node_from_tar_xz(bytes: &[u8], runtime_dir: &Path) -> Result<(), String> {
    let decoder = xz2::read::XzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    extract_node_from_tar(&mut archive, runtime_dir)
}

fn extract_node_from_zip(bytes: &[u8], runtime_dir: &Path) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|error| format!("打开 Node zip 归档失败：{error}"))?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|error| format!("读取 zip 条目失败：{error}"))?;
        let name = file.name().replace('\\', "/");
        let parts: Vec<_> = name.split('/').collect();
        if parts.len() == 2 && parts[1] == "node.exe" {
            let dest = runtime_dir.join("node.exe");
            let mut out = fs::File::create(&dest)
                .map_err(|error| format!("创建 Node 可执行文件失败：{error}"))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|error| format!("写入 Node 可执行文件失败：{error}"))?;
            return Ok(());
        }
    }
    Err("Node zip 归档中未找到 node.exe".to_string())
}

async fn run_npm_install(runtime_dir: &Path, package: &str, version: &str) -> Result<(), String> {
    let spec = format!("{package}@{version}");
    let prefix = runtime_dir.display().to_string();
    if cfg!(windows) {
        // On Windows npm is a .cmd file; run it through cmd.exe /c so the
        // extension is resolved reliably and quoted args are handled.
        run_command(
            "cmd.exe",
            &["/c", "npm", "install", "--prefix", &prefix, &spec],
            &[],
            None,
        )
        .await
    } else {
        run_command("npm", &["install", "--prefix", &prefix, &spec], &[], None).await
    }
}

async fn install_codex(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let version = strip_rust_prefix(&manifest.version);
    let bin_dir = runtime_dir.join("bin");
    fs::create_dir_all(&bin_dir)
        .map_err(|error| format!("创建 Codex bin 目录失败：{error}"))?;
    let managed_dir = runtime_dir
        .parent()
        .ok_or_else(|| "运行时目录结构无效".to_string())?;

    let envs = [
        ("CODEX_INSTALL_DIR", bin_dir.display().to_string()),
        ("CODEX_HOME", managed_dir.display().to_string()),
        ("CODEX_RELEASE", version.to_string()),
    ];

    if cfg!(windows) {
        run_command(
            "cmd.exe",
            &[
                "/c",
                r#"powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex""#,
            ],
            &envs,
            None,
        )
        .await
    } else {
        run_command(
            "sh",
            &[
                "-c",
                "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
            ],
            &envs,
            None,
        )
        .await
    }
}

async fn install_opencode(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let bin_dir = runtime_dir.join("bin");
    fs::create_dir_all(&bin_dir)
        .map_err(|error| format!("创建 OpenCode bin 目录失败：{error}"))?;

    if cfg!(windows) {
        let package = manifest
            .install
            .package
            .as_deref()
            .unwrap_or("opencode-ai");
        run_npm_install(runtime_dir, package, &manifest.version).await?;
        copy_opencode_from_npm(runtime_dir, &bin_dir)?;
    } else {
        run_command(
            "bash",
            &[
                "-c",
                "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path",
            ],
            &[],
            None,
        )
        .await?;
        let source = user_home_dir()?
            .join(".opencode")
            .join("bin")
            .join("opencode");
        if !source.is_file() {
            return Err(format!(
                "OpenCode 安装脚本未在预期位置生成可执行文件：{}",
                source.display()
            ));
        }
        copy_file(&source, &bin_dir.join("opencode"))?;
        set_executable(&bin_dir.join("opencode"))?;
    }
    Ok(())
}

fn copy_opencode_from_npm(runtime_dir: &Path, bin_dir: &Path) -> Result<(), String> {
    // Prefer the actual native binary shipped inside the package, falling back
    // to the npm `.bin` shims if the postinstall script did not download it.
    let package_bin = runtime_dir
        .join("node_modules")
        .join("opencode-ai")
        .join("bin")
        .join("opencode.exe");
    if package_bin.is_file() && package_bin.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        copy_file(&package_bin, &bin_dir.join("opencode.exe"))?;
        return Ok(());
    }

    let npm_bin = runtime_dir.join("node_modules").join(".bin");
    let candidates: Vec<PathBuf> = ["opencode.exe", "opencode", "opencode.cmd"]
        .iter()
        .map(|name| npm_bin.join(name))
        .filter(|path| path.is_file())
        .collect();

    if candidates.is_empty() {
        return Err(format!(
            "npm 安装后未在 {} 找到 OpenCode 可执行文件",
            npm_bin.display()
        ));
    }

    for source in &candidates {
        let name = source.file_name().unwrap_or_else(|| OsStr::new("opencode"));
        copy_file(source, &bin_dir.join(name))?;
    }

    let primary = bin_dir.join("opencode.exe");
    if !primary.is_file() {
        let fallback = bin_dir.join("opencode");
        if fallback.is_file() {
            set_executable(&fallback)?;
        }
    }
    Ok(())
}

async fn install_pi_web(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let node_version = manifest
        .install
        .node_version
        .as_deref()
        .unwrap_or(NODE_VERSION);
    download_node(runtime_dir, node_version).await?;

    let package = manifest
        .install
        .package
        .as_deref()
        .unwrap_or("@agegr/pi-web");
    run_npm_install(runtime_dir, package, &manifest.version).await?;

    let source = runtime_dir
        .join("node_modules")
        .join("@agegr")
        .join("pi-web")
        .join("bin")
        .join("pi-web.js");
    if !source.is_file() {
        return Err(format!(
            "Pi Web 安装后未找到入口文件：{}",
            source.display()
        ));
    }
    copy_file(&source, &runtime_dir.join("bin").join("pi-web.js"))?;
    Ok(())
}

async fn install_dsh(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let node_version = manifest
        .install
        .node_version
        .as_deref()
        .unwrap_or(NODE_VERSION);
    download_node(runtime_dir, node_version).await?;

    let package = manifest
        .install
        .package
        .as_deref()
        .unwrap_or("@deepseek-ai/dsh");
    run_npm_install(runtime_dir, package, &manifest.version).await?;

    let entry = resolve_dsh_entry(runtime_dir)?;
    if !entry.is_file() {
        return Err(format!(
            "DSH 安装后未找到入口文件：{}",
            entry.display()
        ));
    }
    copy_file(&entry, &runtime_dir.join("lib").join("bin.js"))?;
    Ok(())
}

fn resolve_dsh_entry(runtime_dir: &Path) -> Result<PathBuf, String> {
    let package_json = runtime_dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("package.json");
    let content = fs::read_to_string(&package_json)
        .map_err(|error| format!("读取 DSH package.json 失败：{error}"))?;
    let package: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("解析 DSH package.json 失败：{error}"))?;
    let bin = package
        .get("bin")
        .ok_or_else(|| "DSH package.json 缺少 bin 字段".to_string())?;
    let entry = match bin {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Object(map) => map
            .get("dsh")
            .and_then(|value| value.as_str())
            .or_else(|| map.values().next().and_then(|value| value.as_str()))
            .ok_or_else(|| "DSH package.json bin 字段为空".to_string())?
            .to_string(),
        _ => return Err("DSH package.json bin 字段格式无效".to_string()),
    };
    Ok(runtime_dir
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join(entry))
}

fn strip_rust_prefix(version: &str) -> &str {
    version.strip_prefix("rust-").unwrap_or(version)
}

fn prepare_runtime_dir(runtime_dir: &Path) -> Result<PathBuf, String> {
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "运行时目录结构无效".to_string())?;
    let backup = parent.join(".previous-runtime");
    let _ = fs::remove_dir_all(&backup);
    if runtime_dir.exists() {
        fs::rename(runtime_dir, &backup)
            .map_err(|error| format!("备份现有运行时失败：{error}"))?;
    }
    fs::create_dir_all(runtime_dir)
        .map_err(|error| format!("创建运行时目录失败：{error}"))?;
    Ok(backup)
}

fn finish_runtime_dir(runtime_dir: &Path, backup: &Path, success: bool) -> Result<(), String> {
    if success {
        let _ = fs::remove_dir_all(backup);
        Ok(())
    } else {
        let _ = fs::remove_dir_all(runtime_dir);
        if backup.exists() {
            fs::rename(backup, runtime_dir)
                .map_err(|error| format!("恢复运行时备份失败：{error}"))?;
        }
        Ok(())
    }
}

async fn install_runtime(
    state: &RuntimeInstallerState,
    provider: ManagedRuntimeProvider,
) -> Result<ManagedRuntimeInstall, String> {
    let manifest = provider.manifest()?;
    let runtime_dir = managed_runtime_dir(&state.app_data_dir, provider);
    validate_managed_dir(&runtime_dir, &state.app_data_dir)?;

    let backup = prepare_runtime_dir(&runtime_dir)?;
    let install_result = match provider {
        ManagedRuntimeProvider::Codex => install_codex(&runtime_dir, &manifest).await,
        ManagedRuntimeProvider::Opencode => install_opencode(&runtime_dir, &manifest).await,
        ManagedRuntimeProvider::PiWeb => install_pi_web(&runtime_dir, &manifest).await,
        ManagedRuntimeProvider::Dsh => install_dsh(&runtime_dir, &manifest).await,
    };

    let success = install_result.is_ok();
    let verify_result = if success {
        ensure_required_files(provider, &runtime_dir)
    } else {
        Ok(())
    };

    let combined = install_result.and(verify_result);
    finish_runtime_dir(&runtime_dir, &backup, combined.is_ok())?;
    combined?;

    Ok(ManagedRuntimeInstall {
        provider: provider.key(),
        version: manifest.version,
        installed_path: runtime_dir.display().to_string(),
    })
}

#[tauri::command]
pub async fn runtime_download_managed(
    state: State<'_, RuntimeInstallerState>,
    provider: ManagedRuntimeProvider,
) -> Result<ManagedRuntimeInstall, String> {
    {
        let mut active = state.active.lock().await;
        if !active.insert(provider) {
            return Err("该运行时正在安装，请稍候".to_string());
        }
    }
    let result = install_runtime(state.inner(), provider).await;
    state.active.lock().await.remove(&provider);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_paths_are_outside_packaged_resources() {
        let root = Path::new("/tmp/xiaoyan-data");
        assert_eq!(
            managed_runtime_dir(root, ManagedRuntimeProvider::PiWeb),
            root.join("managed-runtimes/pi-web/runtime")
        );
    }

    #[test]
    fn strip_rust_prefix_from_codex_version() {
        assert_eq!(strip_rust_prefix("rust-v0.150.1"), "v0.150.1");
        assert_eq!(strip_rust_prefix("0.150.1"), "0.150.1");
    }

    #[test]
    fn node_platform_name_matches_current_platform() {
        let name = node_platform_name();
        assert!(name.is_ok());
        let name = name.unwrap();
        if cfg!(target_os = "macos") {
            assert!(name.starts_with("darwin"));
        } else if cfg!(target_os = "windows") {
            assert_eq!(name, "win-x64");
        } else if cfg!(target_os = "linux") {
            assert_eq!(name, "linux-x64");
        }
    }

    #[test]
    fn codex_manifest_parses() {
        let manifest = ManagedRuntimeProvider::Codex.manifest().expect("parse codex manifest");
        assert_eq!(manifest.install._method, InstallMethod::Shell);
        assert_eq!(strip_rust_prefix(&manifest.version), manifest.version.trim_start_matches("rust-"));
    }

    #[test]
    fn npm_provider_manifests_include_node_version() {
        for provider in [
            ManagedRuntimeProvider::Dsh,
            ManagedRuntimeProvider::PiWeb,
        ] {
            let manifest = provider.manifest().expect("parse manifest");
            assert!(
                matches!(manifest.install._method, InstallMethod::Npm),
                "{} should use npm install",
                provider.key()
            );
            assert!(
                manifest.install.package.is_some(),
                "{} should specify npm package",
                provider.key()
            );
            assert!(
                manifest.install.node_version.is_some(),
                "{} should specify node version",
                provider.key()
            );
        }
    }

    #[test]
    fn required_files_match_expected_layouts() {
        let root = Path::new("/tmp/xiaoyan-runtime");
        assert_eq!(
            required_files(ManagedRuntimeProvider::Codex, root),
            vec![root.join("bin").join(if cfg!(windows) { "codex.exe" } else { "codex" })]
        );
        assert_eq!(
            required_files(ManagedRuntimeProvider::PiWeb, root),
            vec![
                root.join(if cfg!(windows) { "node.exe" } else { "node" }),
                root.join("bin").join("pi-web.js"),
            ]
        );
        assert_eq!(
            required_files(ManagedRuntimeProvider::Dsh, root),
            vec![
                root.join(if cfg!(windows) { "node.exe" } else { "node" }),
                root.join("lib").join("bin.js"),
            ]
        );
    }
}
