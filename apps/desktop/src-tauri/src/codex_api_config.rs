use crate::dsh_api_config::XiaoyanApiProfile;
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use uuid::Uuid;

const CODEX_PROVIDER: &str = "xiaoyan";
const CODEX_PROFILE_FILE: &str = "xiaoyan.config.toml";
const CODEX_CREDENTIAL_REF: &str = "XIAOYAN_API_KEY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexApiImportResult {
    pub provider: String,
    pub model: String,
    pub data_home: String,
}

pub(crate) fn write_codex_api_configuration(
    data_home: &Path,
    profile: &XiaoyanApiProfile,
) -> Result<CodexApiImportResult, String> {
    if profile.protocol != "openai-completions" {
        return Err("Codex 目前只支持把 OpenAI 兼容接口同步为 model provider".to_string());
    }

    create_private_directory(data_home)?;
    let content = render_profile(profile);
    write_private_file(
        &data_home.join(CODEX_PROFILE_FILE),
        content.as_bytes(),
        "Codex 模型配置",
    )?;

    Ok(CodexApiImportResult {
        provider: CODEX_PROVIDER.to_string(),
        model: profile.model.clone(),
        data_home: data_home.display().to_string(),
    })
}

fn render_profile(profile: &XiaoyanApiProfile) -> String {
    format!(
        "# Managed by Xiaoyan. Recreated when the Xiaoyan API is imported.\n\
model = {model}\n\
model_provider = {provider}\n\
\n\
[model_providers.{provider_id}]\n\
name = \"Xiaoyan\"\n\
base_url = {base_url}\n\
env_key = {env_key}\n",
        model = toml_string(&profile.model),
        provider = toml_string(CODEX_PROVIDER),
        provider_id = CODEX_PROVIDER,
        base_url = toml_string(&profile.base_url),
        env_key = toml_string(CODEX_CREDENTIAL_REF),
    )
}

fn toml_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    let existed = path.exists();
    fs::create_dir_all(path).map_err(|error| format!("创建 Codex 数据目录失败：{error}"))?;
    #[cfg(unix)]
    if !existed {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 Codex 数据目录权限失败：{error}"))?;
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
        .unwrap_or("codex-config");
    let temporary = parent.join(format!(".{filename}.{}.tmp", Uuid::new_v4()));

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
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
        return write_result;
    }

    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("保存{label}失败：{error}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn test_dir() -> std::path::PathBuf {
        env::temp_dir().join(format!("xiaoyan-codex-api-{}", Uuid::new_v4()))
    }

    #[test]
    fn writes_provider_without_embedding_the_secret() {
        let directory = test_dir();
        let profile = XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "sk-secret-should-not-land".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        };

        let result =
            write_codex_api_configuration(&directory, &profile).expect("configuration written");
        let content = fs::read_to_string(directory.join(CODEX_PROFILE_FILE)).expect("read profile");

        assert_eq!(result.provider, "xiaoyan");
        assert_eq!(result.model, "research-model");
        assert!(content.contains("model = \"research-model\""));
        assert!(content.contains("base_url = \"https://gateway.example/v1\""));
        assert!(content.contains("env_key = \"XIAOYAN_API_KEY\""));
        assert!(!content.contains("sk-secret-should-not-land"));
        assert!(directory.join(CODEX_PROFILE_FILE).is_file());

        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn rejects_anthropic_compatible_endpoints() {
        let directory = test_dir();
        let profile = XiaoyanApiProfile {
            protocol: "anthropic-messages",
            base_url: "https://api.anthropic.com".to_string(),
            api_key: "secret".to_string(),
            model: "claude".to_string(),
            models: vec!["claude".to_string()],
        };

        let error = write_codex_api_configuration(&directory, &profile).expect_err("rejected");
        assert!(error.contains("OpenAI 兼容"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn escapes_quotes_in_toml_strings() {
        assert_eq!(toml_string(r#"a"b\c"#), r#""a\"b\\c""#);
    }
}
