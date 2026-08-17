use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

const CACHE_DIR_ENV: &str = "PAPER_SEARCH_EVAL_CACHE_DIR";
const OFFLINE_ENV: &str = "PAPER_SEARCH_EVAL_OFFLINE";
static CACHE_HITS: AtomicUsize = AtomicUsize::new(0);
static CACHE_MISSES: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Serialize)]
pub(crate) struct CacheStats {
    enabled: bool,
    offline: bool,
    hits: usize,
    misses: usize,
}

fn cache_dir() -> Option<PathBuf> {
    std::env::var(CACHE_DIR_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn cache_file_name(key: &str) -> String {
    format!("{:x}.json", Sha256::digest(key.as_bytes()))
}

fn cache_path(directory: &Path, key: &str) -> PathBuf {
    directory.join(cache_file_name(key))
}

pub(crate) fn load(key: &str) -> Result<Option<Vec<u8>>> {
    let Some(directory) = cache_dir() else {
        return Ok(None);
    };
    let path = cache_path(&directory, key);
    if path.exists() {
        CACHE_HITS.fetch_add(1, Ordering::Relaxed);
        return fs::read(&path)
            .with_context(|| format!("读取论文评测响应缓存失败：{}", path.display()))
            .map(Some);
    }
    CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
    if std::env::var(OFFLINE_ENV).as_deref() == Ok("1") {
        anyhow::bail!("离线论文评测缓存缺失：{}", path.display());
    }
    Ok(None)
}

pub(crate) fn reset_stats() {
    CACHE_HITS.store(0, Ordering::Relaxed);
    CACHE_MISSES.store(0, Ordering::Relaxed);
}

pub(crate) fn stats() -> CacheStats {
    CacheStats {
        enabled: cache_dir().is_some(),
        offline: std::env::var(OFFLINE_ENV).as_deref() == Ok("1"),
        hits: CACHE_HITS.load(Ordering::Relaxed),
        misses: CACHE_MISSES.load(Ordering::Relaxed),
    }
}

pub(crate) fn store(key: &str, payload: &[u8]) -> Result<()> {
    let Some(directory) = cache_dir() else {
        return Ok(());
    };
    fs::create_dir_all(&directory)
        .with_context(|| format!("创建论文评测响应缓存目录失败：{}", directory.display()))?;
    let path = cache_path(&directory, key);
    fs::write(&path, payload)
        .with_context(|| format!("写入论文评测响应缓存失败：{}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::cache_file_name;

    #[test]
    fn cache_keys_are_stable_and_do_not_expose_queries() {
        let first = cache_file_name("search|private research query|:2024-07-01|100");
        let same = cache_file_name("search|private research query|:2024-07-01|100");
        let different = cache_file_name("search|another query|:2024-07-01|100");

        assert_eq!(first, same);
        assert_ne!(first, different);
        assert!(!first.contains("private"));
        assert!(first.ends_with(".json"));
    }
}
