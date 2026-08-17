//! 跨平台系统钥匙串封装：保存 WebDAV 同步凭据。
//!
//! 凭据以一个 JSON 串整体存入操作系统安全存储
//! （macOS Keychain / Windows Credential Manager / Linux Secret Service），
//! 从而支持全自动后台同步而无需每次手输密码。
//!
//! 注意：WebDAV 密码同时用作同步状态文件的加密口令——同一 WebDAV 账号下
//! 的所有设备天然共享同一口令，无需用户额外设置，这也意味着换密码后旧的
//! 加密快照需要重新生成（属正常预期）。

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "com.xiaoyan.desktop.sync";
const ACCOUNT: &str = "webdav-credentials";

// macOS 会在读取钥匙串项目时弹出授权对话框。同步状态查询、启动同步、
// 前台同步可能在短时间内重复读取同一凭据，因此在当前进程内缓存一次读取结果。
// 凭据仍以钥匙串为持久化来源；保存新配置时会同步更新缓存。
static CREDENTIALS_CACHE: OnceLock<Mutex<Option<Option<SyncCredentials>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCredentials {
    pub url: String,
    pub username: String,
    pub password: String,
    /// 停用时保留凭据；重新启用前不参与任何自动同步。
    #[serde(default = "default_sync_enabled")]
    pub enabled: bool,
}

fn default_sync_enabled() -> bool {
    true
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("访问系统钥匙串失败: {e}"))
}

pub fn save(creds: &SyncCredentials) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("写入钥匙串失败: {e}"))?;
    *cache()
        .lock()
        .map_err(|e| format!("凭据缓存锁定失败: {e}"))? = Some(Some(creds.clone()));
    Ok(())
}

pub fn load() -> Result<Option<SyncCredentials>, String> {
    let mut cache = cache()
        .lock()
        .map_err(|e| format!("凭据缓存锁定失败: {e}"))?;
    if let Some(cached) = cache.as_ref() {
        return Ok(cached.clone());
    }

    match entry()?.get_password() {
        Ok(json) => {
            let creds: SyncCredentials =
                serde_json::from_str(&json).map_err(|e| format!("钥匙串凭据格式错误: {e}"))?;
            *cache = Some(Some(creds.clone()));
            Ok(Some(creds))
        }
        Err(keyring::Error::NoEntry) => {
            *cache = Some(None);
            Ok(None)
        }
        Err(e) => Err(format!("读取钥匙串失败: {e}")),
    }
}

fn cache() -> &'static Mutex<Option<Option<SyncCredentials>>> {
    CREDENTIALS_CACHE.get_or_init(|| Mutex::new(None))
}
