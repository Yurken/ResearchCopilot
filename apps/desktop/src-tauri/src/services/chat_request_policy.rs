use crate::llm::LlmClient;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::net::IpAddr;

const LOCAL_ONLY_ERROR: &str = "你要求本次请求不要联网，但当前小妍使用的是远程模型端点。为避免内容外发，请先配置 localhost、127.0.0.1 或 [::1] 上的本地模型后重试；也可以移除本次请求中的离线限制。";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatRequestPolicy {
    local_only: bool,
    suppress_long_term_memory: bool,
    explicitly_requests_persistent_asset: bool,
}

impl ChatRequestPolicy {
    pub fn from_message(message: &str) -> Self {
        Self {
            local_only: requests_local_only_processing(message),
            suppress_long_term_memory: requests_no_long_term_memory(message),
            explicitly_requests_persistent_asset: requests_persistent_asset(message),
        }
    }

    pub fn allows_network(&self) -> bool {
        !self.local_only
    }

    pub fn allows_embedding(&self) -> bool {
        // Embedding 可以配置独立端点。离线请求统一跳过，避免主模型为本地时仍将
        // 查询文本发送给远程 embedding 服务。
        !self.local_only
    }

    pub fn allows_external_tools(&self) -> bool {
        !self.local_only
    }

    pub fn allows_long_term_memory(&self, globally_enabled: bool) -> bool {
        globally_enabled && !self.suppress_long_term_memory
    }

    pub fn allows_persistent_tools(&self) -> bool {
        !self.suppress_long_term_memory || self.explicitly_requests_persistent_asset
    }

    pub fn apply_to_settings(&self, settings: &mut HashMap<String, String>) {
        if self.suppress_long_term_memory {
            settings.insert(
                "xiaoyan_long_term_memory_enabled".to_string(),
                "false".to_string(),
            );
        }
        if self.local_only {
            settings.insert("web_search_enabled".to_string(), "false".to_string());
        }
    }

    pub fn ensure_client_allowed(&self, client: &LlmClient) -> Result<()> {
        if self.local_only && !is_loopback_url(client.base_url()) {
            return Err(anyhow!(LOCAL_ONLY_ERROR));
        }
        Ok(())
    }
}

fn requests_local_only_processing(message: &str) -> bool {
    [
        "不要联网",
        "无需联网",
        "不需要联网",
        "禁止联网",
        "不许联网",
        "只在本地处理",
        "仅在本地处理",
        "只在本机处理",
        "仅在本机处理",
        "离线处理",
        "offline only",
        "do not use the network",
        "don't use the network",
    ]
    .iter()
    .any(|constraint| message.to_lowercase().contains(constraint))
}

fn requests_no_long_term_memory(message: &str) -> bool {
    let normalized = message.to_lowercase();
    let explicit_phrase = [
        "不要写入长期记忆",
        "不要把它写入长期记忆",
        "不要把这写入长期记忆",
        "不要保存到长期记忆",
        "不保存到长期记忆",
        "不要加入长期记忆",
        "不要记住这",
        "不要记住它",
        "无需记忆",
        "不要长期记忆",
        "do not remember this",
        "don't remember this",
    ]
    .iter()
    .any(|constraint| normalized.contains(constraint));
    let negative_instruction = ["不要", "不许", "禁止", "无需", "不需要"]
        .iter()
        .any(|constraint| normalized.contains(constraint));
    let memory_write = ["写入长期记忆", "保存到长期记忆", "加入长期记忆"]
        .iter()
        .any(|action| normalized.contains(action));

    explicit_phrase || (negative_instruction && memory_write)
}

fn requests_persistent_asset(message: &str) -> bool {
    [
        "创建笔记",
        "新建笔记",
        "保存为笔记",
        "记到笔记",
        "创建实验",
        "新建实验",
        "保存为实验",
        "记录为实验",
        "create a note",
        "save as a note",
        "create an experiment",
    ]
    .iter()
    .any(|instruction| message.to_lowercase().contains(instruction))
}

fn is_loopback_url(raw_url: &str) -> bool {
    let normalized = raw_url.trim().to_ascii_lowercase();
    let without_scheme = normalized
        .strip_prefix("http://")
        .or_else(|| normalized.strip_prefix("https://"))
        .unwrap_or(&normalized);
    let authority = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default();
    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        bracketed.split(']').next().unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or_default()
    };

    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::{is_loopback_url, ChatRequestPolicy};
    use crate::llm::LlmClient;

    fn client(base_url: &str) -> LlmClient {
        LlmClient::OpenAI {
            base_url: base_url.to_string(),
            api_key: String::new(),
            chat_model: "local-model".to_string(),
            embed_model: "local-embedding".to_string(),
        }
    }

    #[test]
    fn recognizes_only_loopback_model_endpoints_as_local() {
        for url in [
            "http://localhost:11434/v1",
            "http://model.localhost:8000/v1",
            "http://127.0.0.1:1234/v1",
            "http://127.42.0.8/v1",
            "http://[::1]:8080/v1",
        ] {
            assert!(is_loopback_url(url), "expected loopback: {url}");
        }
        for url in [
            "https://api.openai.com/v1",
            "http://192.168.1.8:11434/v1",
            "http://10.0.0.2:8000/v1",
            "http://localhost.example.com/v1",
        ] {
            assert!(!is_loopback_url(url), "expected non-loopback: {url}");
        }
    }

    #[test]
    fn offline_request_rejects_remote_model_before_use() {
        let policy = ChatRequestPolicy::from_message("不要联网，只在本机处理这段材料");

        assert!(!policy.allows_network());
        assert!(!policy.allows_embedding());
        assert!(policy
            .ensure_client_allowed(&client("https://api.openai.com/v1"))
            .is_err());
        assert!(policy
            .ensure_client_allowed(&client("http://127.0.0.1:11434/v1"))
            .is_ok());
    }

    #[test]
    fn per_request_memory_boundary_overrides_global_setting() {
        let policy =
            ChatRequestPolicy::from_message("请解释这段合成文本，但不要把它写入长期记忆。");

        assert!(!policy.allows_long_term_memory(true));
        assert!(!policy.allows_long_term_memory(false));
        assert!(policy.allows_network());
    }

    #[test]
    fn ordinary_request_preserves_network_and_memory_behavior() {
        let policy = ChatRequestPolicy::from_message("解释这篇论文的方法");

        assert!(policy.allows_network());
        assert!(policy.allows_embedding());
        assert!(policy.allows_external_tools());
        assert!(policy.allows_long_term_memory(true));
    }

    #[test]
    fn policy_applies_request_boundaries_to_nested_operations() {
        let mut settings = std::collections::HashMap::from([
            (
                "xiaoyan_long_term_memory_enabled".to_string(),
                "true".to_string(),
            ),
            ("web_search_enabled".to_string(), "true".to_string()),
        ]);
        let policy =
            ChatRequestPolicy::from_message("不要联网，也不要把这段合成文本写入长期记忆。");

        policy.apply_to_settings(&mut settings);

        assert_eq!(
            settings.get("xiaoyan_long_term_memory_enabled"),
            Some(&"false".to_string())
        );
        assert_eq!(
            settings.get("web_search_enabled"),
            Some(&"false".to_string())
        );
        assert!(!policy.allows_persistent_tools());
    }

    #[test]
    fn explicit_product_asset_is_distinct_from_long_term_memory() {
        let policy =
            ChatRequestPolicy::from_message("请把结果保存为笔记，但不要把这次对话写入长期记忆。");

        assert!(!policy.allows_long_term_memory(true));
        assert!(policy.allows_persistent_tools());
    }
}
