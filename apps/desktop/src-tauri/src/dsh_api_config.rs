use crate::llm::LlmClient;
use serde::Serialize;
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const DSH_ROUTE: &str = "xiaoyan";
const DSH_CREDENTIAL_REF: &str = "XIAOYAN_API_KEY";
/// 对齐 DSH >= 0.1.1 credentials-local 的 DOCUMENT_VERSION：新版解析器只接受
/// version/refs/records 三个顶层键，引用必须写在 refs 下
/// （vendor/deepseek-harness/packages/credentials/credentials-local/src/index.ts）。
const DSH_CREDENTIALS_DOCUMENT_VERSION: u64 = 1;

#[derive(Clone)]
pub(crate) struct XiaoyanApiProfile {
    pub(crate) protocol: &'static str,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshApiImportResult {
    pub route: String,
    pub protocol: String,
    pub model: String,
    pub data_home: String,
}

pub(crate) fn resolve_xiaoyan_api(
    settings: &HashMap<String, String>,
) -> Result<XiaoyanApiProfile, String> {
    let (mut client, scoped) = LlmClient::scoped_client_from_settings(
        settings,
        &["copilot_simple_base_url"],
        &["copilot_simple_api_key"],
        &["copilot_simple_model"],
    )
    .map_err(|_| "请先在小妍设置中完成主模型 API 配置".to_string())?;

    if !scoped {
        let role_model = settings
            .get("copilot_simple_model")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());
        if let Some(role_model) = role_model {
            match &mut client {
                LlmClient::OpenAI { chat_model, .. } | LlmClient::Anthropic { chat_model, .. } => {
                    *chat_model = role_model.to_string();
                }
            }
        }
    }

    let (protocol, base_url, api_key, model) = match client {
        LlmClient::OpenAI {
            base_url,
            api_key,
            chat_model,
            ..
        } => ("openai-completions", base_url, api_key, chat_model),
        LlmClient::Anthropic {
            base_url,
            api_key,
            chat_model,
        } => (
            "anthropic-messages",
            normalize_anthropic_base_url(&base_url),
            api_key,
            chat_model,
        ),
    };

    if base_url.trim().is_empty() {
        return Err("小妍主模型缺少 API 地址，请先在设置中补充".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("小妍主模型缺少 API Key，请先在设置中补充".to_string());
    }
    if model.trim().is_empty() {
        return Err("小妍主模型缺少模型名称，请先在设置中补充".to_string());
    }

    Ok(XiaoyanApiProfile {
        protocol,
        base_url: base_url.trim().trim_end_matches('/').to_string(),
        api_key: api_key.trim().to_string(),
        model: model.trim().to_string(),
        models: vec![model.trim().to_string()],
    })
}

fn normalize_anthropic_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    trimmed
        .strip_suffix("/v1")
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string()
}

/// 查询远端可用的模型列表。失败时回退到当前默认模型，避免阻塞 DSH 配置写入。
pub(crate) async fn fetch_available_models(profile: &XiaoyanApiProfile) -> Vec<String> {
    let url = match profile.protocol {
        "openai-completions" => format!("{}/models", profile.base_url),
        "anthropic-messages" => format!("{}/v1/models", profile.base_url),
        _ => return vec![profile.model.clone()],
    };

    let client = reqwest::Client::new();
    let request = match profile.protocol {
        "openai-completions" => client.get(&url).bearer_auth(&profile.api_key),
        "anthropic-messages" => client
            .get(&url)
            .header("x-api-key", &profile.api_key)
            .header("anthropic-version", "2023-06-01"),
        _ => return vec![profile.model.clone()],
    };

    match request.send().await {
        Ok(response) if response.status().is_success() => {
            match response.json::<JsonValue>().await {
                Ok(json) => {
                    let mut ids: Vec<String> = json
                        .get("data")
                        .and_then(JsonValue::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| {
                                    item.get("id").and_then(JsonValue::as_str).map(String::from)
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    if ids.is_empty() {
                        ids.push(profile.model.clone());
                    } else {
                        // 保持当前默认模型在首位，DSH 默认选中它
                        ids.retain(|id| id != &profile.model);
                        ids.insert(0, profile.model.clone());
                    }
                    return ids;
                }
                Err(error) => {
                    crate::append_diagnostic_log(&format!(
                        "[dsh_api_config] parse models response failed: {error}"
                    ));
                }
            }
        }
        Ok(response) => {
            crate::append_diagnostic_log(&format!(
                "[dsh_api_config] fetch models returned {} for {}",
                response.status(),
                url
            ));
        }
        Err(error) => {
            crate::append_diagnostic_log(&format!(
                "[dsh_api_config] fetch models failed: {error}"
            ));
        }
    }

    vec![profile.model.clone()]
}

pub(crate) fn write_dsh_api_configuration(
    data_home: &Path,
    profile: &XiaoyanApiProfile,
) -> Result<DshApiImportResult, String> {
    create_private_directory(data_home)?;

    let credentials_path = data_home.join(".credentials.yaml");
    let settings_path = data_home.join("settings.yaml");
    let credentials = render_credentials(&credentials_path, profile)?;
    let settings = render_settings(&settings_path, profile)?;

    // Write the secret first. If the second write fails, DSH only sees an
    // unused credential rather than a route that is guaranteed to fail auth.
    write_private_file(&credentials_path, credentials.as_bytes(), "DSH 凭据")?;
    write_private_file(&settings_path, settings.as_bytes(), "DSH 模型配置")?;

    Ok(DshApiImportResult {
        route: DSH_ROUTE.to_string(),
        protocol: profile.protocol.to_string(),
        model: profile.model.clone(),
        data_home: data_home.display().to_string(),
    })
}

fn render_credentials(path: &Path, profile: &XiaoyanApiProfile) -> Result<String, String> {
    let mut root = read_yaml_mapping(path, "DSH 凭据")?;
    let version_key = Value::String("version".to_string());
    let refs_key = Value::String("refs".to_string());
    // 已是 versioned 布局：version/records 等既有内容原样保留，只在 refs 内合并。
    // 旧 flat 布局（DSH < 0.1.1 写出、尚未被 DSH 启动迁移）：顶层键即引用，
    // 全部搬入 refs，避免新版解析器抛 unknown top-level key。
    let mut refs = if root.contains_key(&version_key) {
        mapping_value(root.remove(&refs_key), "DSH 凭据的 refs")?
    } else {
        std::mem::take(&mut root)
    };
    refs.insert(
        Value::String(DSH_CREDENTIAL_REF.to_string()),
        Value::String(profile.api_key.clone()),
    );
    root.insert(
        version_key,
        Value::Number(DSH_CREDENTIALS_DOCUMENT_VERSION.into()),
    );
    root.insert(refs_key, Value::Mapping(refs));
    serialize_yaml(root, "DSH 凭据")
}

fn render_settings(path: &Path, profile: &XiaoyanApiProfile) -> Result<String, String> {
    let mut root = read_yaml_mapping(path, "DSH 模型配置")?;

    let models: Vec<Value> = profile
        .models
        .iter()
        .map(|id| {
            let mut model = Mapping::new();
            model.insert(Value::String("id".to_string()), Value::String(id.clone()));
            model.insert(Value::String("name".to_string()), Value::String(id.clone()));
            Value::Mapping(model)
        })
        .collect();

    let mut route = Mapping::new();
    route.insert(
        Value::String("displayName".to_string()),
        Value::String("小妍 API".to_string()),
    );
    route.insert(
        Value::String("apiKeyEnv".to_string()),
        Value::String(DSH_CREDENTIAL_REF.to_string()),
    );
    route.insert(
        Value::String("api".to_string()),
        Value::String(profile.protocol.to_string()),
    );
    route.insert(
        Value::String("baseURL".to_string()),
        Value::String(profile.base_url.clone()),
    );
    route.insert(
        Value::String("models".to_string()),
        Value::Sequence(models),
    );

    let section_key = Value::String("llm-pi-ai".to_string());
    let mut section = mapping_value(root.remove(&section_key), "DSH 模型配置的 llm-pi-ai")?;
    let providers_key = Value::String("providers".to_string());
    let mut providers = mapping_value(section.remove(&providers_key), "DSH 模型配置的 providers")?;
    providers.insert(Value::String(DSH_ROUTE.to_string()), Value::Mapping(route));
    section.insert(providers_key, Value::Mapping(providers));
    root.insert(section_key, Value::Mapping(section));

    serialize_yaml(root, "DSH 模型配置")
}

fn read_yaml_mapping(path: &Path, label: &str) -> Result<Mapping, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Mapping::new()),
        Err(error) => return Err(format!("读取{label}失败：{error}")),
    };
    if content.trim().is_empty() {
        return Ok(Mapping::new());
    }
    let parsed: Value = serde_yaml::from_str(&content)
        .map_err(|error| format!("{label}不是有效的 YAML：{error}"))?;
    mapping_value(Some(parsed), label)
}

fn mapping_value(value: Option<Value>, label: &str) -> Result<Mapping, String> {
    match value {
        None | Some(Value::Null) => Ok(Mapping::new()),
        Some(Value::Mapping(mapping)) => Ok(mapping),
        Some(_) => Err(format!("{label}必须是 YAML 对象，无法自动更新")),
    }
}

fn serialize_yaml(mapping: Mapping, label: &str) -> Result<String, String> {
    serde_yaml::to_string(&Value::Mapping(mapping))
        .map_err(|error| format!("生成{label}失败：{error}"))
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    let existed = path.exists();
    fs::create_dir_all(path).map_err(|error| format!("创建 DSH 数据目录失败：{error}"))?;
    #[cfg(unix)]
    if !existed {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("设置 DSH 数据目录权限失败：{error}"))?;
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
        .unwrap_or("dsh-config");
    let temporary = temporary_path(parent, filename);

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
            .map_err(|error| format!("创建临时{label}失败：{error}"))?;
        file.write_all(content)
            .map_err(|error| format!("写入{label}失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步{label}失败：{error}"))?;

        #[cfg(not(windows))]
        fs::rename(&temporary, path).map_err(|error| format!("替换{label}失败：{error}"))?;

        #[cfg(windows)]
        {
            // Windows does not replace an existing destination with rename.
            // The private temporary file still prevents partially written YAML.
            fs::write(path, content).map_err(|error| format!("替换{label}失败：{error}"))?;
            fs::remove_file(&temporary).map_err(|error| format!("清理临时{label}失败：{error}"))?;
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn temporary_path(parent: &Path, filename: &str) -> PathBuf {
    parent.join(format!(".{filename}.xiaoyan-{}.tmp", Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("xiaoyan-dsh-api-{}", Uuid::new_v4()))
    }

    #[test]
    fn resolves_dedicated_xiaoyan_openai_compatible_scope() {
        let settings = HashMap::from([
            (
                "copilot_simple_base_url".to_string(),
                "https://gateway.example/v1".to_string(),
            ),
            (
                "copilot_simple_api_key".to_string(),
                "test-secret".to_string(),
            ),
            (
                "copilot_simple_model".to_string(),
                "research-model".to_string(),
            ),
        ]);

        let profile = resolve_xiaoyan_api(&settings).expect("profile should resolve");
        assert_eq!(profile.protocol, "openai-completions");
        assert_eq!(profile.base_url, "https://gateway.example/v1");
        assert_eq!(profile.model, "research-model");
    }

    #[test]
    fn strips_anthropic_v1_suffix_for_the_sdk_base_url() {
        assert_eq!(
            normalize_anthropic_base_url("https://api.anthropic.com/v1/"),
            "https://api.anthropic.com"
        );
        assert_eq!(
            normalize_anthropic_base_url("https://api.kimi.com/coding"),
            "https://api.kimi.com/coding"
        );
    }

    #[test]
    fn keeps_the_xiaoyan_role_model_when_it_reuses_the_global_api() {
        let settings = HashMap::from([
            ("llm_provider".to_string(), "openai".to_string()),
            ("openai_api_key".to_string(), "test-secret".to_string()),
            (
                "openai_base_url".to_string(),
                "https://api.openai.com/v1".to_string(),
            ),
            ("openai_chat_model".to_string(), "global-model".to_string()),
            (
                "copilot_simple_model".to_string(),
                "xiaoyan-role-model".to_string(),
            ),
        ]);

        let profile = resolve_xiaoyan_api(&settings).expect("profile should resolve");
        assert_eq!(profile.model, "xiaoyan-role-model");
    }

    #[test]
    fn merges_xiaoyan_route_without_removing_existing_dsh_configuration() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("test directory");
        fs::write(
            directory.join("settings.yaml"),
            "theme:\n  mode: dark\nllm-pi-ai:\n  providers:\n    existing:\n      api: openai-completions\n",
        )
        .expect("seed settings");
        fs::write(
            directory.join(".credentials.yaml"),
            "OTHER_API_KEY: keep-me\n",
        )
        .expect("seed credentials");
        let profile = XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "test-secret".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        };

        let result = write_dsh_api_configuration(&directory, &profile)
            .expect("configuration should be written");
        let settings: Value = serde_yaml::from_str(
            &fs::read_to_string(directory.join("settings.yaml")).expect("read settings"),
        )
        .expect("parse settings");
        let credentials: Value = serde_yaml::from_str(
            &fs::read_to_string(directory.join(".credentials.yaml")).expect("read credentials"),
        )
        .expect("parse credentials");

        assert_eq!(result.route, "xiaoyan");
        assert_eq!(result.model, "research-model");
        assert_eq!(settings["theme"]["mode"].as_str(), Some("dark"));
        assert_eq!(
            settings["llm-pi-ai"]["providers"]["existing"]["api"].as_str(),
            Some("openai-completions")
        );
        assert_eq!(
            settings["llm-pi-ai"]["providers"]["xiaoyan"]["models"][0]["id"].as_str(),
            Some("research-model")
        );
        assert_eq!(credentials["version"].as_u64(), Some(1));
        assert_eq!(
            credentials["refs"]["OTHER_API_KEY"].as_str(),
            Some("keep-me")
        );
        assert_eq!(
            credentials["refs"][DSH_CREDENTIAL_REF].as_str(),
            Some("test-secret")
        );
        assert!(credentials.get("OTHER_API_KEY").is_none());
        assert!(credentials.get(DSH_CREDENTIAL_REF).is_none());

        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn writes_versioned_credentials_layout_for_a_fresh_data_home() {
        let directory = test_dir();
        let profile = XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "test-secret".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        };

        write_dsh_api_configuration(&directory, &profile)
            .expect("configuration should be written");
        let credentials: Value = serde_yaml::from_str(
            &fs::read_to_string(directory.join(".credentials.yaml")).expect("read credentials"),
        )
        .expect("parse credentials");

        assert_eq!(
            credentials["version"].as_u64(),
            Some(DSH_CREDENTIALS_DOCUMENT_VERSION)
        );
        assert_eq!(
            credentials["refs"][DSH_CREDENTIAL_REF].as_str(),
            Some("test-secret")
        );
        assert!(credentials.get(DSH_CREDENTIAL_REF).is_none());

        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn migrates_flat_legacy_credentials_into_the_refs_section() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("test directory");
        fs::write(
            directory.join(".credentials.yaml"),
            "OTHER_API_KEY: keep-me\nTHIRD_PARTY_TOKEN: keep-too\n",
        )
        .expect("seed flat credentials");
        let profile = XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "test-secret".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        };

        write_dsh_api_configuration(&directory, &profile)
            .expect("configuration should be written");
        let credentials: Value = serde_yaml::from_str(
            &fs::read_to_string(directory.join(".credentials.yaml")).expect("read credentials"),
        )
        .expect("parse credentials");

        assert_eq!(credentials["version"].as_u64(), Some(1));
        assert_eq!(
            credentials["refs"]["OTHER_API_KEY"].as_str(),
            Some("keep-me")
        );
        assert_eq!(
            credentials["refs"]["THIRD_PARTY_TOKEN"].as_str(),
            Some("keep-too")
        );
        assert_eq!(
            credentials["refs"][DSH_CREDENTIAL_REF].as_str(),
            Some("test-secret")
        );
        assert!(credentials.get("OTHER_API_KEY").is_none());
        assert!(credentials.get("THIRD_PARTY_TOKEN").is_none());

        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn merges_refs_and_preserves_records_in_a_versioned_credentials_file() {
        let directory = test_dir();
        fs::create_dir_all(&directory).expect("test directory");
        fs::write(
            directory.join(".credentials.yaml"),
            "version: 1\nrefs:\n  OTHER_API_KEY: keep-me\nrecords:\n  other-provider/default:\n    kind: grant\n    payload:\n      token: opaque\n",
        )
        .expect("seed versioned credentials");
        let profile = XiaoyanApiProfile {
            protocol: "openai-completions",
            base_url: "https://gateway.example/v1".to_string(),
            api_key: "test-secret".to_string(),
            model: "research-model".to_string(),
            models: vec!["research-model".to_string()],
        };

        write_dsh_api_configuration(&directory, &profile)
            .expect("configuration should be written");
        let credentials: Value = serde_yaml::from_str(
            &fs::read_to_string(directory.join(".credentials.yaml")).expect("read credentials"),
        )
        .expect("parse credentials");

        assert_eq!(credentials["version"].as_u64(), Some(1));
        assert_eq!(
            credentials["refs"]["OTHER_API_KEY"].as_str(),
            Some("keep-me")
        );
        assert_eq!(
            credentials["refs"][DSH_CREDENTIAL_REF].as_str(),
            Some("test-secret")
        );
        assert_eq!(
            credentials["records"]["other-provider/default"]["kind"].as_str(),
            Some("grant")
        );
        assert_eq!(
            credentials["records"]["other-provider/default"]["payload"]["token"].as_str(),
            Some("opaque")
        );

        fs::remove_dir_all(directory).expect("clean test directory");
    }
}
