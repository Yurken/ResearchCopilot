use super::*;
use flate2::{write::GzEncoder, Compression};

fn test_directory() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("xiaoyan-runtime-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("create test directory");
    dir
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
fn validate_managed_dir_accepts_provider_runtime_layout() {
    let root = test_directory();
    let runtime_dir = root.join("managed-runtimes").join("codex").join("runtime");
    fs::create_dir_all(&runtime_dir).expect("create runtime dir");
    assert!(validate_managed_dir(&runtime_dir, &root).is_ok());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn validate_managed_dir_rejects_unexpected_layout() {
    let root = test_directory();
    // 末段不是 runtime
    let wrong_tail = root.join("managed-runtimes").join("codex").join("dist");
    fs::create_dir_all(&wrong_tail).expect("create dir");
    assert!(validate_managed_dir(&wrong_tail, &root).is_err());
    // 不在应用数据目录下
    let outside = root.join("other").join("runtime");
    fs::create_dir_all(&outside).expect("create dir");
    assert!(validate_managed_dir(&outside, &root).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn validate_managed_dir_accepts_not_yet_created_runtime() {
    // 安装前 runtime 目录可能尚不存在，此时用未规范化路径比较。
    let root = test_directory();
    let runtime_dir = root.join("managed-runtimes").join("dsh").join("runtime");
    assert!(validate_managed_dir(&runtime_dir, &root).is_ok());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn deploy_npm_package_preserves_relative_layout() {
    let root = test_directory();
    let package_dir = root.join("pkg");
    let runtime_dir = root.join("runtime");
    for path in [
        "bin/pi-web.js",
        "bin/pi-web-options.js",
        ".next/server.js",
        "package.json",
    ] {
        let file = package_dir.join(path);
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, path).expect("write file");
    }
    fs::create_dir_all(package_dir.join("node_modules/next")).expect("create node_modules");
    fs::write(package_dir.join("node_modules/next/index.js"), "").expect("write dep");

    deploy_npm_package(&package_dir, &runtime_dir).expect("deploy package");

    assert!(runtime_dir.join("bin/pi-web.js").is_file());
    assert!(runtime_dir.join("bin/pi-web-options.js").is_file());
    assert!(runtime_dir.join(".next/server.js").is_file());
    assert!(runtime_dir.join("package.json").is_file());
    // 包内 node_modules 不复制：运行时依赖已由 npm 提升到 runtime/node_modules。
    assert!(!runtime_dir.join("node_modules/next").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn deploy_npm_package_errors_when_package_missing() {
    let root = test_directory();
    let result = deploy_npm_package(&root.join("absent"), &root.join("runtime"));
    assert!(result.is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn npm_package_dir_handles_scoped_names() {
    let runtime = Path::new("/tmp/runtime");
    assert_eq!(
        npm_package_dir(runtime, "@deepseek-ai/dsh"),
        runtime.join("node_modules/@deepseek-ai/dsh")
    );
    assert_eq!(
        npm_package_dir(runtime, "opencode-ai"),
        runtime.join("node_modules/opencode-ai")
    );
}

#[test]
fn extract_node_from_tar_gz_pulls_the_node_binary() {
    let root = test_directory();
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let archive_path = format!("node-v22.19.0-test/bin/{node_name}");
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut archive = tar::Builder::new(&mut encoder);
        let content = b"node-binary";
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        archive
            .append_data(&mut header, archive_path, &content[..])
            .expect("append node entry");
        let mut filler = tar::Header::new_gnu();
        filler.set_size(0);
        filler.set_mode(0o644);
        filler.set_cksum();
        archive
            .append_data(&mut filler, "node-v22.19.0-darwin-arm64/README.md", &[][..])
            .expect("append filler entry");
        archive.into_inner().expect("finish tar");
    }
    let bytes = encoder.finish().expect("finish gzip");
    let runtime_dir = root.join("runtime");
    fs::create_dir_all(&runtime_dir).expect("create runtime");

    extract_node_from_tar_gz(&bytes, &runtime_dir).expect("extract node");

    assert_eq!(
        fs::read(runtime_dir.join(node_name)).expect("read node"),
        b"node-binary"
    );
    assert!(!runtime_dir.join("README.md").exists());
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn ensure_required_files_follows_official_installer_symlinks() {
    let root = test_directory();
    let runtime_dir = root.join("runtime");
    let target = root.join("packages/standalone/codex");
    fs::create_dir_all(target.parent().expect("target parent")).expect("create target dir");
    fs::write(&target, "codex-binary").expect("write binary");
    set_executable(&target).expect("make binary executable");
    fs::create_dir_all(runtime_dir.join("bin")).expect("create bin dir");
    std::os::unix::fs::symlink(&target, runtime_dir.join("bin/codex")).expect("create symlink");

    assert!(ensure_required_files(ManagedRuntimeProvider::Codex, &runtime_dir).is_ok());

    // 悬空链接必须被判定为缺失。
    fs::remove_file(&target).expect("remove target");
    assert!(ensure_required_files(ManagedRuntimeProvider::Codex, &runtime_dir).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn ensure_required_files_reports_missing_entries() {
    let root = test_directory();
    let runtime_dir = root.join("runtime");
    fs::create_dir_all(&runtime_dir).expect("create runtime");
    let result = ensure_required_files(ManagedRuntimeProvider::PiWeb, &runtime_dir);
    assert!(result.is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn is_safe_version_token_rejects_shell_metacharacters() {
    assert!(is_safe_version_token("1.18.23"));
    assert!(is_safe_version_token("0.1.1-rc.2"));
    assert!(!is_safe_version_token(""));
    assert!(!is_safe_version_token("1.0; rm -rf /"));
    assert!(!is_safe_version_token("$(id)"));
}

#[test]
fn opencode_platform_package_matches_current_platform() {
    let package = opencode_platform_package().expect("resolve platform package");
    let (platform, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    assert!(package.starts_with("opencode-"));
    if platform == "macos" {
        assert!(package.starts_with("opencode-darwin-"));
    } else if platform == "windows" {
        assert!(package.starts_with("opencode-windows-"));
    } else if platform == "linux" {
        assert!(package.starts_with("opencode-linux-"));
    }
    assert!(package.ends_with(
        arch.replace("x86_64", "x64")
            .replace("aarch64", "arm64")
            .as_str()
    ));
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
    let manifest = ManagedRuntimeProvider::Codex
        .manifest()
        .expect("parse codex manifest");
    assert_eq!(manifest.install._method, InstallMethod::Shell);
    assert_eq!(
        strip_rust_prefix(&manifest.version),
        manifest.version.trim_start_matches("rust-")
    );
}

#[test]
fn npm_provider_manifests_include_node_version() {
    for provider in [ManagedRuntimeProvider::Dsh, ManagedRuntimeProvider::PiWeb] {
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
        vec![root
            .join("bin")
            .join(if cfg!(windows) { "codex.exe" } else { "codex" })]
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
