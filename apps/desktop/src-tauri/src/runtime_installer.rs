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
use tokio::sync::Mutex;

mod command;

use command::{resolve_npm, run_command, run_npm_install};

const NODE_VERSION: &str = "22.19.0";
// 官方源不可达时依次回退到 npmmirror 镜像；也可通过环境变量指定自定义镜像（优先尝试）。
const NODE_DIST_MIRROR_ENV: &str = "XIAOYAN_NODE_DIST_MIRROR";
const NODE_DIST_BASE_URLS: &[&str] = &[
    "https://nodejs.org/dist",
    "https://npmmirror.com/mirrors/node",
];
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
    if runtime_dir.file_name() != Some(OsStr::new("runtime")) {
        return Err("运行时目录结构无效".to_string());
    }
    let provider_dir = runtime_dir
        .parent()
        .ok_or_else(|| "运行时目录无效".to_string())?;
    // canonicalize 只对已存在的目录生效；两侧要么都规范化、要么都不规范
    // 化，避免 /var 与 /private/var 这类前缀不一致导致的误判。
    let canonical_provider = provider_dir.canonicalize().ok();
    let expected = match &canonical_provider {
        Some(_) => app_data_dir
            .canonicalize()
            .unwrap_or_else(|_| app_data_dir.to_path_buf())
            .join("managed-runtimes"),
        None => app_data_dir.to_path_buf().join("managed-runtimes"),
    };
    let actual = canonical_provider.unwrap_or_else(|| provider_dir.to_path_buf());
    if !actual.starts_with(&expected) {
        return Err("运行时目录不在应用数据目录下".to_string());
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
        ManagedRuntimeProvider::Opencode => vec![runtime.join("bin").join(if cfg!(windows) {
            "opencode.exe"
        } else {
            "opencode"
        })],
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
    // 用 fs::metadata 跟随符号链接/junction：codex 官方安装脚本在 Unix 上
    // 会把 bin/codex 装成指向 CODEX_HOME 的符号链接，Windows 上则把整个
    // bin 目录变成 junction，二者都是合法产物；悬空链接会因 metadata 报错
    // 而被判定为缺失。
    if let Some(missing) = required_files(provider, runtime)
        .into_iter()
        .find(|path| fs::metadata(path).map(|m| !m.is_file()).unwrap_or(true))
    {
        return Err(format!("运行时安装不完整，缺少 {}", missing.display()));
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
    fs::set_permissions(path, permissions).map_err(|error| format!("设置可执行权限失败：{error}"))
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

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| format!("创建目录失败 {}：{error}", dst.display()))?;
    for entry in
        fs::read_dir(src).map_err(|error| format!("读取目录失败 {}：{error}", src.display()))?
    {
        let entry =
            entry.map_err(|error| format!("读取目录条目失败 {}：{error}", src.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}：{error}", entry.path().display()))?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if file_type.is_symlink() {
            return Err(format!(
                "npm 包内含符号链接，暂不支持部署：{}",
                entry.path().display()
            ));
        } else {
            copy_file(&entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 把 npm 包的内容（不含 node_modules）部署到 runtime 根目录。
///
/// 入口脚本（dsh 的 lib/bin.js、pi-web 的 bin/pi-web.js）都按自身位置解析
/// 相对路径：dsh 动态 import 同目录的 chunk 并读取 ../package.json，
/// pi-web 通过 __dirname/.. 定位 .next 与依赖。因此必须保持包内相对布局
/// 整体落地，而不能只复制入口单文件；包的运行时依赖已由 npm 提升到
/// runtime/node_modules，向上查找即可命中。
fn deploy_npm_package(package_dir: &Path, runtime_dir: &Path) -> Result<(), String> {
    if !package_dir.is_dir() {
        return Err(format!("npm 安装后未找到包目录：{}", package_dir.display()));
    }
    for entry in fs::read_dir(package_dir)
        .map_err(|error| format!("读取包目录失败 {}：{error}", package_dir.display()))?
    {
        let entry = entry
            .map_err(|error| format!("读取包目录条目失败 {}：{error}", package_dir.display()))?;
        if entry.file_name() == OsStr::new("node_modules") {
            continue;
        }
        let target = runtime_dir.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}：{error}", entry.path().display()))?
            .is_dir()
        {
            copy_dir(&entry.path(), &target)?;
        } else {
            copy_file(&entry.path(), &target)?;
        }
    }
    Ok(())
}

/// npm 包安装后在 --prefix 目录中的落点（支持 @scope/name 形式）。
fn npm_package_dir(runtime_dir: &Path, package: &str) -> PathBuf {
    let mut dir = runtime_dir.join("node_modules");
    for part in package.split('/') {
        dir = dir.join(part);
    }
    dir
}

fn user_home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法确定用户主目录".to_string())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(NODE_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
}

fn node_dist_base_urls() -> Vec<String> {
    let mut urls = Vec::new();
    if let Ok(mirror) = std::env::var(NODE_DIST_MIRROR_ENV) {
        let mirror = mirror.trim().trim_end_matches('/');
        if !mirror.is_empty() {
            urls.push(mirror.to_string());
        }
    }
    urls.extend(NODE_DIST_BASE_URLS.iter().map(|url| url.to_string()));
    urls
}

async fn download_node_archive(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    Ok(client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载 Node 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载 Node 失败：{error}"))?
        .bytes()
        .await
        .map_err(|error| format!("读取 Node 响应失败：{error}"))?
        .to_vec())
}

async fn download_node(runtime_dir: &Path, version: &str) -> Result<(), String> {
    let platform = node_platform_name()?;
    let client = http_client()?;
    let extension = if cfg!(windows) {
        "zip"
    } else if platform.starts_with("darwin") {
        "tar.gz"
    } else {
        "tar.xz"
    };
    let archive_name = format!("node-v{version}-{platform}.{extension}");

    let mut errors = Vec::new();
    for base_url in node_dist_base_urls() {
        let url = format!("{base_url}/v{version}/{archive_name}");
        match download_node_archive(&client, &url).await {
            Ok(bytes) => {
                return match extension {
                    "zip" => extract_node_from_zip(&bytes, runtime_dir),
                    "tar.gz" => extract_node_from_tar_gz(&bytes, runtime_dir),
                    _ => extract_node_from_tar_xz(&bytes, runtime_dir),
                };
            }
            Err(error) => errors.push(format!("{url}：{error}")),
        }
    }
    Err(format!(
        "下载 Node 失败（官方源与镜像均不可达）：\n{}",
        errors.join("\n")
    ))
}

fn extract_node_from_tar<R: Read>(
    archive: &mut tar::Archive<R>,
    runtime_dir: &Path,
) -> Result<(), String> {
    let node_name = OsStr::new(if cfg!(windows) { "node.exe" } else { "node" });
    for entry in archive
        .entries()
        .map_err(|error| format!("读取 tar 归档失败：{error}"))?
    {
        let mut entry = entry.map_err(|error| format!("读取 tar 条目失败：{error}"))?;
        let path = entry
            .path()
            .map_err(|error| format!("读取 tar 路径失败：{error}"))?;
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
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|error| format!("打开 Node zip 归档失败：{error}"))?;
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

async fn install_codex(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let version = strip_rust_prefix(&manifest.version);
    #[cfg(windows)]
    {
        install_codex_windows(runtime_dir, version).await
    }
    #[cfg(not(windows))]
    {
        install_codex_unix(runtime_dir, version).await
    }
}

/// Windows 走官方 npm 平台包而非 install.ps1：ps1 会无条件把私有 bin 目录
/// 写入注册表 User PATH（读取的是注册表而非进程环境，无法通过环境变量规避），
/// 与"不修改用户 PATH"的承诺冲突。npm 平台包（@openai/codex@<version>-win32-x64）
/// 内含与 standalone 发布完全相同的 vendor 布局，部署后等价。
#[cfg(windows)]
async fn install_codex_windows(runtime_dir: &Path, version: &str) -> Result<(), String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => return Err(format!("当前架构暂不支持托管 Codex：{other}")),
    };
    if !is_safe_version_token(version) {
        return Err(format!("Codex 清单版本号无效：{version}"));
    }
    let npm = resolve_npm().await?;
    run_npm_install(
        &npm,
        runtime_dir,
        "@openai/codex",
        &format!("{version}-win32-{arch}"),
    )
    .await?;

    // vendor/<target>/ 下是 standalone 布局（bin/codex.exe、codex-path/rg.exe、
    // codex-resources/…），整体部署到 runtime 根目录。
    let vendor_dir = runtime_dir
        .join("node_modules")
        .join("@openai/codex")
        .join("vendor");
    let target_dir = single_child_dir(&vendor_dir)
        .ok_or_else(|| format!("Codex npm 包 vendor 目录结构异常：{}", vendor_dir.display()))?;
    deploy_npm_package(&target_dir, runtime_dir)
}

/// 返回目录中唯一的子目录（vendor 下应只有一个 target 三元组目录）。
#[cfg(windows)]
fn single_child_dir(dir: &Path) -> Option<PathBuf> {
    let mut dirs = fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false));
    let first = dirs.next()?;
    if dirs.next().is_some() {
        return None;
    }
    Some(first.path())
}

#[cfg(not(windows))]
async fn install_codex_unix(runtime_dir: &Path, version: &str) -> Result<(), String> {
    let bin_dir = runtime_dir.join("bin");
    // CODEX_HOME 指向 provider 根目录（runtime 的上一级）：
    // - 官方脚本把实际二进制下载到 $CODEX_HOME/packages/standalone，再把
    //   bin/codex 装成指向那里的符号链接；
    // - 该目录在 runtime 轮换（重装/回滚）之外持久存在，链接不会悬空，
    //   重装时还能复用已下载的 release 缓存。
    // bin 目录交给官方脚本创建。
    let managed_dir = runtime_dir
        .parent()
        .ok_or_else(|| "运行时目录结构无效".to_string())?;

    // 官方脚本的 add_to_path 在 PATH 已包含 BIN_DIR 时跳过写入 shell
    // profile；把私有 bin 前置到子进程 PATH 来兑现"不修改用户 PATH"的承诺。
    // 注意这只是绕过钩子，子进程里 codex 的调用方不依赖 PATH。
    let child_path = {
        let mut paths = vec![bin_dir.clone()];
        if let Some(existing) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        std::env::join_paths(paths)
            .map_err(|error| format!("构造子进程 PATH 失败：{error}"))?
            .to_string_lossy()
            .into_owned()
    };

    let envs = [
        ("CODEX_INSTALL_DIR", bin_dir.display().to_string()),
        ("CODEX_HOME", managed_dir.display().to_string()),
        ("CODEX_RELEASE", version.to_string()),
        // 官方脚本在检测到冲突安装（如 npm 全局装过 codex）时会交互式询问，
        // GUI 管道 stdio 下会一直挂到超时；显式声明非交互，冲突时仅告警。
        ("CODEX_NON_INTERACTIVE", "1".to_string()),
        ("PATH", child_path),
    ];

    run_command(
        "sh",
        &["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
        &envs,
        None,
    )
    .await
}

/// OpenCode 官方 npm 包通过 optionalDependencies 分发平台二进制
/// （opencode-windows-x64 等），bin/opencode 只是需要 node 的转发脚本。
/// 直接部署原生二进制，避免运行时依赖系统 node。
fn opencode_platform_package() -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => return Err(format!("当前架构暂不支持托管 OpenCode：{other}")),
    };
    let platform = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        "linux" => "linux",
        other => return Err(format!("当前平台暂不支持托管 OpenCode：{other}")),
    };
    Ok(format!("opencode-{platform}-{arch}"))
}

fn copy_opencode_native_binary(runtime_dir: &Path) -> Result<(), String> {
    let package_name = opencode_platform_package()?;
    let binary_name = if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    };
    let source = runtime_dir
        .join("node_modules")
        .join(&package_name)
        .join("bin")
        .join(binary_name);
    if !source.is_file() {
        return Err(format!(
            "npm 安装后未找到 OpenCode 原生二进制（可选依赖 {package_name} 未安装）：{}",
            source.display()
        ));
    }
    let destination = runtime_dir.join("bin").join(binary_name);
    copy_file(&source, &destination)?;
    set_executable(&destination)?;
    Ok(())
}

async fn install_opencode(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    if cfg!(windows) {
        let npm = resolve_npm().await?;
        let package = manifest.install.package.as_deref().unwrap_or("opencode-ai");
        run_npm_install(&npm, runtime_dir, package, &manifest.version).await?;
        copy_opencode_native_binary(runtime_dir)?;
    } else {
        // 通过 --version 固定到清单版本；官方脚本默认装 latest，会导致
        // 实际版本与 manifest.version 漂移。
        let version = &manifest.version;
        if !is_safe_version_token(version) {
            return Err(format!("OpenCode 清单版本号无效：{version}"));
        }
        let script = format!(
            "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path --version {version}"
        );
        run_command("bash", &["-c", &script], &[], None).await?;
        let source = user_home_dir()?
            .join(".opencode")
            .join("bin")
            .join("opencode");
        if !source.is_file() {
            return Err(format!(
                "OpenCode 安装脚本未在预期位置生成可执行文件：{}\n若 PATH 中已存在相同版本的 opencode，官方脚本会跳过安装，请先移除或重命名后重试",
                source.display()
            ));
        }
        let destination = runtime_dir.join("bin").join("opencode");
        copy_file(&source, &destination)?;
        set_executable(&destination)?;
    }
    Ok(())
}

/// 版本号只允许出现在 shell 命令与 npm spec 中安全的字符。
fn is_safe_version_token(version: &str) -> bool {
    !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

async fn install_pi_web(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let node_version = manifest
        .install
        .node_version
        .as_deref()
        .unwrap_or(NODE_VERSION);
    download_node(runtime_dir, node_version).await?;

    let npm = resolve_npm().await?;
    let package = manifest
        .install
        .package
        .as_deref()
        .unwrap_or("@agegr/pi-web");
    run_npm_install(&npm, runtime_dir, package, &manifest.version).await?;

    let package_dir = npm_package_dir(runtime_dir, package);
    if !package_dir.join("bin").join("pi-web.js").is_file() {
        return Err(format!(
            "Pi Web 安装后未找到入口文件：{}",
            package_dir.join("bin").join("pi-web.js").display()
        ));
    }
    deploy_npm_package(&package_dir, runtime_dir)
}

async fn install_dsh(runtime_dir: &Path, manifest: &ProviderManifest) -> Result<(), String> {
    let node_version = manifest
        .install
        .node_version
        .as_deref()
        .unwrap_or(NODE_VERSION);
    download_node(runtime_dir, node_version).await?;

    let npm = resolve_npm().await?;
    let package = manifest
        .install
        .package
        .as_deref()
        .unwrap_or("@deepseek-ai/dsh");
    run_npm_install(&npm, runtime_dir, package, &manifest.version).await?;

    let package_dir = npm_package_dir(runtime_dir, package);
    if !package_dir.join("lib").join("bin.js").is_file() {
        return Err(format!(
            "DSH 安装后未找到入口文件：{}",
            package_dir.join("lib").join("bin.js").display()
        ));
    }
    deploy_npm_package(&package_dir, runtime_dir)
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
        fs::rename(runtime_dir, &backup).map_err(|error| format!("备份现有运行时失败：{error}"))?;
    }
    fs::create_dir_all(runtime_dir).map_err(|error| format!("创建运行时目录失败：{error}"))?;
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
    // 恢复备份失败时不能吞掉原始安装错误，两者都要报告给用户。
    let final_result = match finish_runtime_dir(&runtime_dir, &backup, combined.is_ok()) {
        Ok(()) => combined,
        Err(restore_error) => match combined {
            Ok(()) => Err(restore_error),
            Err(install_error) => Err(format!(
                "{install_error}\n（恢复原运行时也失败：{restore_error}）"
            )),
        },
    };
    final_result?;

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
#[path = "runtime_installer_tests.rs"]
mod tests;
