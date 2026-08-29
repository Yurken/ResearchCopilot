use crate::dsh_api_config::XiaoyanApiProfile;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use uuid::Uuid;

const PI_PROVIDER: &str = "xiaoyan";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiWebApiImportResult {
    pub provider: String,
    pub protocol: String,
    pub model: String,
    pub data_home: String,
}

pub(crate) fn write_pi_web_api_configuration(
    data_home: &Path,
    profile: &XiaoyanApiProfile,
) -> Result<PiWebApiImportResult, String> {
    if profile.protocol != "openai-completions" && profile.protocol != "anthropic-messages" {
        return Err("Pi 目前只支持 OpenAI 或 Anthropic 兼容接口".to_string());
    }

    create_private_directory(data_home)?;
    merge_models_file(&data_home.join("models.json"), profile)?;
    merge_settings_file(&data_home.join("settings.json"), profile)?;
    merge_auth_file(&data_home.join("auth.json"), profile)?;

    Ok(PiWebApiImportResult {
        provider: PI_PROVIDER.to_string(),
        protocol: profile.protocol.to_string(),
        model: profile.model.clone(),
        data_home: data_home.display().to_string(),
    })
}

fn merge_models_file(path: &Path, profile: &XiaoyanApiProfile) -> Result<(), String> {
    let mut root = read_json_object(path, "Pi 模型配置")?;
    let mut providers = match root.remove("providers") {
        Some(Value::Object(map)) => map,
        Some(Value::Null) | None => Map::new(),
        Some(_) => return Err("Pi 模型配置的 providers 必须是 JSON 对象，无法自动更新".to_string()),
    };
    providers.insert(PI_PROVIDER.to_string(), render_provider(profile));
    root.insert("providers".to_string(), Value::Object(providers));
    write_json(path, Value::Object(root), "Pi 模型配置")
}

fn merge_settings_file(path: &Path, profile: &XiaoyanApiProfile) -> Result<(), String> {
    let mut root = read_json_object(path, "Pi 设置")?;
    root.insert(
        "defaultProvider".to_string(),
        Value::String(PI_PROVIDER.to_string()),
    );
    root.insert(
        "defaultModel".to_string(),
        Value::String(profile.model.clone()),
    );
    write_json(path, Value::Object(root), "Pi 设置")
}

fn merge_auth_file(path: &Path, profile: &XiaoyanApiProfile) -> Result<(), String> {
    let mut root = read_json_object(path, "Pi 凭据")?;
    root.insert(
        PI_PROVIDER.to_string(),
        json!({
            "type": "api_key",
            "key": profile.api_key,
        }),
    );
    write_json(path, Value::Object(root), "Pi 凭据")
}

fn render_provider(profile: &XiaoyanApiProfile) -> Value {
    json!({
        "name": "Xiaoyan",
        "baseUrl": profile.base_url,
        "api": profile.protocol,
        "models": [{
            "id": profile.model,
            "name": profile.model,
            "input": ["text"],
            "cost": {
                "input": 0,
                "output": 0,
                "cacheRead": 0,
                "cacheWrite": 0
            },
            "contextWindow": 128000,
            "maxTokens": 8192
        }]
    })
}

fn write_json(path: &Path, value: Value, label: &str) -> Result<(), String> {
    let content = serialize_json(value, label)?;
    write_private_file(path, content.as_bytes(), label)
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
    fs::create_dir_all(path).map_err(|error| format!("创建 Pi 数据目录失败：{error}"))?;
    #[cfg(unix)]
    if !existed {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 Pi 数据目录权限失败：{error}"))?;
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
        .unwrap_or("pi-config");
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

    fn test_dir() -> std::path::PathBuf {
        env::temp_dir().join(format!("xiaoyan-pi-api-{}", Uuid::new_v4()))
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
    fn writes_provider_and_keeps_the_secret_out_of_models_json() {
        let directory = test_dir();
        let result =
            write_pi_web_api_configuration(&directory, &openai_profile()).expect("written");
        let models = fs::read_to_string(directory.join("models.json")).expect("read models");
        let auth = fs::read_to_string(directory.join("auth.json")).expect("read auth");
        let settings = fs::read_to_string(directory.join("settings.json")).expect("read settings");

        assert_eq!(result.provider, "xiaoyan");
        assert_eq!(result.model, "research-model");
        assert!(models.contains("\"baseUrl\": \"https://gateway.example/v1\""));
        assert!(models.contains("openai-completions"));
        assert!(!models.contains("sk-secret-should-not-land"));
        assert!(auth.contains("sk-secret-should-not-land"));
        assert!(auth.contains("\"type\": \"api_key\""));
        assert!(settings.contains("\"defaultProvider\": \"xiaoyan\""));
        assert!(settings.contains("\"defaultModel\": \"research-model\""));

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn merges_without_removing_other_providers() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("create dir");
        fs::write(
            directory.join("models.json"),
            "{\n  \"providers\": {\n    \"ollama\": {\n      \"baseUrl\": \"http://localhost:11434/v1\"\n    }\n  }\n}\n",
        )
        .expect("seed models");
        fs::write(
            directory.join("auth.json"),
            "{\n  \"openai\": {\n    \"type\": \"api_key\",\n    \"key\": \"keep-me\"\n  }\n}\n",
        )
        .expect("seed auth");
        fs::write(
            directory.join("settings.json"),
            "{\n  \"theme\": \"dark\"\n}\n",
        )
        .expect("seed settings");

        write_pi_web_api_configuration(&directory, &openai_profile()).expect("written");
        let models = fs::read_to_string(directory.join("models.json")).expect("read models");
        let auth = fs::read_to_string(directory.join("auth.json")).expect("read auth");
        let settings = fs::read_to_string(directory.join("settings.json")).expect("read settings");
        assert!(models.contains("ollama"));
        assert!(models.contains("xiaoyan"));
        assert!(auth.contains("keep-me"));
        assert!(settings.contains("\"theme\": \"dark\""));

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn writes_anthropic_compatible_provider() {
        let directory = test_dir();
        let profile = XiaoyanApiProfile {
            protocol: "anthropic-messages",
            base_url: "https://api.anthropic.com".to_string(),
            api_key: "secret".to_string(),
            model: "claude".to_string(),
            models: vec!["claude".to_string()],
        };
        write_pi_web_api_configuration(&directory, &profile).expect("written");
        let models = fs::read_to_string(directory.join("models.json")).expect("read models");
        assert!(models.contains("anthropic-messages"));
        assert!(models.contains("https://api.anthropic.com"));
        let _ = fs::remove_dir_all(directory);
    }
}
