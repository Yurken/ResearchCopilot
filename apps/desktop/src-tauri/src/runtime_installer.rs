use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::State;
use tokio::{io::AsyncWriteExt, sync::Mutex};

const DEFAULT_MANIFEST_URL: &str =
    "https://pub-9c3110eb71b241e5a88d8aa3388af9a2.r2.dev/runtimes/latest.json";

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
}

#[derive(Debug, Deserialize)]
struct RuntimeManifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    targets: HashMap<String, RuntimeTarget>,
}

#[derive(Debug, Deserialize)]
struct RuntimeTarget {
    providers: HashMap<String, RuntimeArtifact>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeArtifact {
    version: String,
    url: String,
    sha256: String,
    size: u64,
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

fn runtime_target() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("darwin-aarch64"),
        ("windows", "x86_64") => Ok("windows-x86_64"),
        ("linux", "x86_64") => Ok("linux-x86_64"),
        (os, arch) => Err(format!("当前平台暂不支持托管运行时：{os}/{arch}")),
    }
}

fn manifest_url() -> String {
    std::env::var("XIAOYAN_RUNTIME_MANIFEST_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MANIFEST_URL.to_string())
}

fn validate_download_url(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|error| format!("运行时下载地址无效：{error}"))?;
    let secure = parsed.scheme() == "https";
    let local_test = parsed.scheme() == "http" && parsed.host_str() == Some("127.0.0.1");
    if !secure && !local_test {
        return Err("运行时下载地址必须使用 HTTPS".to_string());
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

fn executable_files(provider: ManagedRuntimeProvider, runtime: &Path) -> Vec<PathBuf> {
    match provider {
        ManagedRuntimeProvider::Codex => required_files(provider, runtime),
        ManagedRuntimeProvider::Opencode => required_files(provider, runtime),
        ManagedRuntimeProvider::PiWeb | ManagedRuntimeProvider::Dsh => {
            vec![runtime.join(if cfg!(windows) { "node.exe" } else { "node" })]
        }
    }
}

fn reject_symbolic_links(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|error| format!("检查运行时目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("检查运行时文件失败：{error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("检查运行时文件类型失败：{error}"))?;
        if file_type.is_symlink() {
            return Err(format!(
                "运行时压缩包包含不允许的符号链接：{}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            reject_symbolic_links(&path)?;
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

fn install_archive(
    archive_path: &Path,
    provider_root: &Path,
    provider: ManagedRuntimeProvider,
) -> Result<PathBuf, String> {
    let staging = provider_root.join(".installing");
    let backup = provider_root.join(".previous");
    let destination = provider_root.join("runtime");
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&backup);
    fs::create_dir_all(&staging).map_err(|error| format!("创建运行时安装目录失败：{error}"))?;

    let archive =
        fs::File::open(archive_path).map_err(|error| format!("读取运行时压缩包失败：{error}"))?;
    let mut archive = tar::Archive::new(GzDecoder::new(archive));
    archive
        .unpack(&staging)
        .map_err(|error| format!("解压运行时失败：{error}"))?;
    let staged_runtime = staging.join("runtime");
    reject_symbolic_links(&staged_runtime)?;
    if let Some(missing) = required_files(provider, &staged_runtime)
        .into_iter()
        .find(|path| {
            fs::symlink_metadata(path)
                .map(|metadata| !metadata.file_type().is_file())
                .unwrap_or(true)
        })
    {
        return Err(format!("运行时压缩包不完整，缺少 {}", missing.display()));
    }
    for executable in executable_files(provider, &staged_runtime) {
        ensure_executable(&executable)?;
    }

    if destination.exists() {
        fs::rename(&destination, &backup)
            .map_err(|error| format!("备份现有运行时失败：{error}"))?;
    }
    if let Err(error) = fs::rename(&staged_runtime, &destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(format!("安装运行时失败：{error}"));
    }
    let _ = fs::remove_dir_all(&backup);
    let _ = fs::remove_dir_all(&staging);
    Ok(destination)
}

async fn download_runtime(
    state: &RuntimeInstallerState,
    provider: ManagedRuntimeProvider,
) -> Result<ManagedRuntimeInstall, String> {
    let manifest_url = manifest_url();
    validate_download_url(&manifest_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30 * 60))
        .build()
        .map_err(|error| format!("创建运行时下载客户端失败：{error}"))?;
    let manifest = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|error| format!("获取运行时清单失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("获取运行时清单失败：{error}"))?
        .json::<RuntimeManifest>()
        .await
        .map_err(|error| format!("解析运行时清单失败：{error}"))?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持的运行时清单版本：{}",
            manifest.schema_version
        ));
    }
    let target = runtime_target()?;
    let artifact = manifest
        .targets
        .get(target)
        .and_then(|entry| entry.providers.get(provider.key()))
        .ok_or_else(|| format!("运行时清单没有提供 {target} / {}", provider.key()))?;
    validate_download_url(&artifact.url)?;
    if artifact.sha256.len() != 64
        || !artifact
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("运行时清单中的 SHA-256 无效".to_string());
    }

    let provider_root = state
        .app_data_dir
        .join("managed-runtimes")
        .join(provider.key());
    fs::create_dir_all(&provider_root).map_err(|error| format!("创建运行时目录失败：{error}"))?;
    let partial = provider_root.join("runtime.download");
    let _ = fs::remove_file(&partial);
    let response = client
        .get(&artifact.url)
        .send()
        .await
        .map_err(|error| format!("下载运行时失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载运行时失败：{error}"))?;
    if let Some(content_length) = response.content_length() {
        if content_length != artifact.size {
            return Err(format!(
                "运行时下载大小不匹配：预期 {}，服务器返回 {content_length}",
                artifact.size
            ));
        }
    }
    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|error| format!("创建运行时下载文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                drop(file);
                let _ = tokio::fs::remove_file(&partial).await;
                return Err(format!("下载运行时失败：{error}"));
            }
        };
        downloaded += chunk.len() as u64;
        if downloaded > artifact.size {
            drop(file);
            let _ = tokio::fs::remove_file(&partial).await;
            return Err("运行时下载内容超过清单声明的大小".to_string());
        }
        hasher.update(&chunk);
        if let Err(error) = file.write_all(&chunk).await {
            drop(file);
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(format!("写入运行时下载文件失败：{error}"));
        }
    }
    if let Err(error) = file.flush().await {
        drop(file);
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(format!("保存运行时下载文件失败：{error}"));
    }
    drop(file);
    if downloaded != artifact.size {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "运行时下载大小不匹配：预期 {}，实际 {downloaded}",
            artifact.size
        ));
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if !actual_sha256.eq_ignore_ascii_case(&artifact.sha256) {
        let _ = fs::remove_file(&partial);
        return Err("运行时下载校验失败，请重试".to_string());
    }

    let archive = partial.clone();
    let install_root = provider_root.clone();
    let install_result =
        tokio::task::spawn_blocking(move || install_archive(&archive, &install_root, provider))
            .await
            .map_err(|error| format!("运行时安装任务失败：{error}"));
    let _ = fs::remove_file(&partial);
    let installed = install_result??;
    Ok(ManagedRuntimeInstall {
        provider: provider.key(),
        version: artifact.version.clone(),
        installed_path: installed.display().to_string(),
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
            return Err("该运行时正在下载，请稍候".to_string());
        }
    }
    let result = download_runtime(state.inner(), provider).await;
    state.active.lock().await.remove(&provider);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};

    fn test_directory() -> PathBuf {
        std::env::temp_dir().join(format!("xiaoyan-runtime-test-{}", uuid::Uuid::new_v4()))
    }

    fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("create archive");
        let encoder = GzEncoder::new(file, Compression::fast());
        let mut archive = tar::Builder::new(encoder);
        for (entry, content) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            archive
                .append_data(&mut header, entry, *content)
                .expect("append archive entry");
        }
        archive
            .into_inner()
            .expect("finish tar")
            .finish()
            .expect("finish gzip");
    }

    #[test]
    fn managed_paths_are_outside_packaged_resources() {
        let root = Path::new("/tmp/xiaoyan-data");
        assert_eq!(
            managed_runtime_dir(root, ManagedRuntimeProvider::PiWeb),
            root.join("managed-runtimes/pi-web/runtime")
        );
    }

    #[test]
    fn rejects_insecure_runtime_urls() {
        assert!(validate_download_url("http://example.com/runtime.tar.gz").is_err());
        assert!(validate_download_url("https://example.com/runtime.tar.gz").is_ok());
        assert!(validate_download_url("http://127.0.0.1:8000/runtime.tar.gz").is_ok());
        assert!(validate_download_url("ftp://127.0.0.1/runtime.tar.gz").is_err());
    }

    #[test]
    fn installs_a_valid_archive_into_the_provider_directory() {
        let root = test_directory();
        fs::create_dir_all(&root).expect("create test root");
        let archive = root.join("codex.tar.gz");
        let executable = if cfg!(windows) {
            "runtime/bin/codex.exe"
        } else {
            "runtime/bin/codex"
        };
        write_archive(&archive, &[(executable, b"codex")]);

        let installed = install_archive(&archive, &root, ManagedRuntimeProvider::Codex)
            .expect("install runtime");

        assert_eq!(installed, root.join("runtime"));
        assert_eq!(
            fs::read(root.join(executable)).expect("read installed file"),
            b"codex"
        );
        assert!(!root.join(".installing").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_an_incomplete_archive_without_replacing_the_current_runtime() {
        let root = test_directory();
        let current = root.join("runtime/keep.txt");
        fs::create_dir_all(current.parent().expect("runtime parent")).expect("create runtime");
        fs::write(&current, "current").expect("write current runtime");
        let archive = root.join("incomplete.tar.gz");
        write_archive(&archive, &[("runtime/README.txt", b"missing executable")]);

        let result = install_archive(&archive, &root, ManagedRuntimeProvider::Codex);

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&current).expect("current runtime preserved"),
            "current"
        );
        let _ = fs::remove_dir_all(root);
    }
}
