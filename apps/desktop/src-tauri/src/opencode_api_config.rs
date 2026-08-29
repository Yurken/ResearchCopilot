use crate::dsh_api_config::XiaoyanApiProfile;
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) const OPENCODE_PROVIDER: &str = "xiaoyan";
pub(crate) const OPENCODE_OVERLAY_FILE: &str = "xiaoyan.opencode.json";
const OPENCODE_CREDENTIAL_REF: &str = "XIAOYAN_API_KEY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeApiImportResult {
    pub provider: String,
    pub model: String,
    pub data_home: String,
}

pub(crate) fn write_opencode_api_configuration(
    overlay_dir: &Path,
    auth_path: &Path,
    profile: &XiaoyanApiProfile,
) -> Result<OpenCodeApiImportResult, String> {
    if profile.protocol != "openai-completions" {
        return Err("OpenCode 目前只支持把 OpenAI 兼容接口同步为自定义 provider".to_string());
    }

    create_private_directory(overlay_dir)?;
    let overlay = render_overlay(profile)?;
    write_private_file(
        &overlay_dir.join(OPENCODE_OVERLAY_FILE),
        overlay.as_bytes(),
        "OpenCode 模型配置",
    )?;
    merge_auth_file(auth_path, profile)?;

    Ok(OpenCodeApiImportResult {
        provider: OPENCODE_PROVIDER.to_string(),
        model: profile.model.clone(),
        data_home: overlay_dir.display().to_string(),
    })
}

pub(crate) fn opencode_auth_path() -> Result<PathBuf, String> {
    let data = if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        PathBuf::from(xdg)
    } else {
        home_dir()
            .map(|home| home.join(".local/share"))
            .ok_or_else(|| "无法定位 OpenCode 凭据目录".to_string())?
    };
    Ok(data.join("opencode").join("auth.json"))
}

fn render_overlay(profile: &XiaoyanApiProfile) -> Result<String, String> {
    let mut models = Map::new();
    models.insert(
        profile.model.clone(),
        Value::Object(Map::from_iter([(
            "name".to_string(),
            Value::String(profile.model.clone()),
        )])),
    );

    let mut options = Map::new();
    options.insert(
        "baseURL".to_string(),
        Value::String(profile.base_url.clone()),
    );

    let mut provider = Map::new();
    provider.insert(
        "npm".to_string(),
        Value::String("@ai-sdk/openai-compatible".to_string()),
    );
    provider.insert("name".to_string(), Value::String("Xiaoyan".to_string()));
    provider.insert(
        "env".to_string(),
        Value::Array(vec![Value::String(OPENCODE_CREDENTIAL_REF.to_string())]),
    );
    provider.insert("options".to_string(), Value::Object(options));
    provider.insert("models".to_string(), Value::Object(models));

    let mut providers = Map::new();
    providers.insert(OPENCODE_PROVIDER.to_string(), Value::Object(provider));

    let mut root = Map::new();
    root.insert(
        "$schema".to_string(),
        Value::String("https://opencode.ai/config.json".to_string()),
    );
    root.insert(
        "model".to_string(),
        Value::String(format!("{OPENCODE_PROVIDER}/{}", profile.model)),
    );
    root.insert("provider".to_string(), Value::Object(providers));

    serialize_json(Value::Object(root), "OpenCode 模型配置")
}

fn merge_auth_file(path: &Path, profile: &XiaoyanApiProfile) -> Result<(), String> {
    let mut root = read_json_object(path, "OpenCode 凭据")?;
    let mut entry = Map::new();
    entry.insert("type".to_string(), Value::String("api".to_string()));
    entry.insert("key".to_string(), Value::String(profile.api_key.clone()));
    root.insert(OPENCODE_PROVIDER.to_string(), Value::Object(entry));
    let content = serialize_json(Value::Object(root), "OpenCode 凭据")?;
    if let Some(parent) = path.parent() {
        create_private_directory(parent)?;
    }
    write_private_file(path, content.as_bytes(), "OpenCode 凭据")
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn read_json_object(path: &Path, label: &str) -> Result<Map<String, Value>, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(format!("读取{label}失败：{error}")),
    };
    if content.trim().is_empty() {
        return Ok(Map::new());
    }
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|error| format!("{label}不是有效的 JSON：{error}"))?;
    match parsed {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(Map::new()),
        _ => Err(format!("{label}必须是 JSON 对象，无法自动更新")),
    }
}

fn serialize_json(value: Value, label: &str) -> Result<String, String> {
    let content = serde_json::to_string_pretty(&value)
        .map_err(|error| format!("生成{label}失败：{error}"))?;
    Ok(format!("{content}\n"))
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    let existed = path.exists();
    fs::create_dir_all(path).map_err(|error| format!("创建 OpenCode 数据目录失败：{error}"))?;
    #[cfg(unix)]
    if !existed {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 OpenCode 数据目录权限失败：{error}"))?;
    }
    Ok(())
}

fn write_private_file(path: &Path, content: &[u8], label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位{label}目录"))?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("opencode-config");
    let temporary = parent.join(format!(".{filename}.xiaoyan-{}.tmp", Uuid::new_v4()));

    let write_result = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("写入{label}失败：{error}"))?;
        file.write_all(content)
            .map_err(|error| format!("写入{label}失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("写入{label}失败：{error}"))?;

        #[cfg(not(windows))]
        fs::rename(&temporary, path).map_err(|error| format!("保存{label}失败：{error}"))?;

        #[cfg(windows)]
        {
            fs::write(path, content).map_err(|error| format!("保存{label}失败：{error}"))?;
            fs::remove_file(&temporary).map_err(|error| format!("清理临时{label}失败：{error}"))?;
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn test_dir() -> PathBuf {
        env::temp_dir().join(format!("xiaoyan-opencode-api-{}", Uuid::new_v4()))
    }

    fn openai_profile() -> XiaoyanApiProfile {
        XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "sk-secret-should-not-land".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        }
    }

    #[test]
    fn writes_overlay_without_embedding_the_secret() {
        let directory = test_dir();
        let auth_path = test_dir().join("auth.json");

        let result = write_opencode_api_configuration(&directory, &auth_path, &openai_profile())
            .expect("written");
        let overlay =
            fs::read_to_string(directory.join(OPENCODE_OVERLAY_FILE)).expect("read overlay");
        let auth = fs::read_to_string(&auth_path).expect("read auth");

        assert_eq!(result.provider, "xiaoyan");
        assert_eq!(result.model, "research-model");
        assert!(overlay.contains("\"model\": \"xiaoyan/research-model\""));
        assert!(overlay.contains("\"baseURL\": \"https://gateway.example/v1\""));
        assert!(overlay.contains("\"XIAOYAN_API_KEY\""));
        assert!(!overlay.contains("sk-secret-should-not-land"));
        assert!(auth.contains("sk-secret-should-not-land"));
        assert!(auth.contains("\"type\": \"api\""));

        let _ = fs::remove_dir_all(directory);
        let _ = fs::remove_file(auth_path);
    }

    #[test]
    fn merges_auth_without_removing_other_providers() {
        let directory = test_dir();
        let auth_path = test_dir().join("auth.json");
        fs::create_dir_all(auth_path.parent().expect("parent")).expect("create auth dir");
        fs::write(
            &auth_path,
            "{\n  \"openai\": {\n    \"type\": \"api\",\n    \"key\": \"keep-me\"\n  }\n}\n",
        )
        .expect("seed auth");

        write_opencode_api_configuration(&directory, &auth_path, &openai_profile())
            .expect("written");
        let auth = fs::read_to_string(&auth_path).expect("read auth");
        assert!(auth.contains("keep-me"));
        assert!(auth.contains("xiaoyan"));

        let _ = fs::remove_dir_all(directory);
        let _ = fs::remove_file(auth_path);
    }

    #[test]
    fn rejects_anthropic_compatible_endpoints() {
        let directory = test_dir();
        let auth_path = test_dir().join("auth.json");
        let profile = XiaoyanApiProfile {
            protocol: "anthropic-messages",
            base_url: "https://api.anthropic.com".to_string(),
            api_key: "secret".to_string(),
            model: "claude".to_string(),
            models: vec!["claude".to_string()],
        };
        let error = write_opencode_api_configuration(&directory, &auth_path, &profile)
            .expect_err("rejected");
        assert!(error.contains("OpenAI 兼容"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn resolves_auth_path_from_xdg_data_home() {
        let previous = env::var_os("XDG_DATA_HOME");
        let data_home = test_dir();
        env::set_var("XDG_DATA_HOME", &data_home);
        let path = opencode_auth_path().expect("auth path");
        assert_eq!(path, data_home.join("opencode").join("auth.json"));
        match previous {
            Some(value) => env::set_var("XDG_DATA_HOME", value),
            None => env::remove_var("XDG_DATA_HOME"),
        }
        let _ = fs::remove_dir_all(data_home);
    }
}
