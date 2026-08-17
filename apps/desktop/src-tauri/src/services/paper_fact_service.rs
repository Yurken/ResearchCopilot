use regex::Regex;
use serde::Serialize;
use sqlx::Row;

const UNKNOWN_VALUE: &str = "论文未报告";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaperFactKind {
    Epochs,
    LearningRate,
}

impl PaperFactKind {
    fn label(self) -> &'static str {
        match self {
            Self::Epochs => "训练轮数",
            Self::LearningRate => "学习率",
        }
    }

    fn requested_by(self, question: &str) -> bool {
        let lower = question.to_lowercase();
        match self {
            Self::Epochs => ["epoch", "训练轮数", "训练周期", "训练了多少轮"]
                .iter()
                .any(|term| lower.contains(term)),
            Self::LearningRate => ["learning rate", "learning-rate", "学习率"]
                .iter()
                .any(|term| lower.contains(term)),
        }
    }

    fn extract_value(self, text: &str) -> Option<(String, usize)> {
        let patterns = match self {
            Self::Epochs => [
                r"(?i)\b(?:we\s+)?train(?:ed|ing)?\s+(?:(?:the|our)\s+)?(?:[a-z][a-z0-9_-]*\s+){0,4}?for\s+(\d{1,5})\s*(?:full\s+)?epochs?\b",
                r"(?:训练|共训练|进行了训练)[^。；;\n]{0,24}?(\d{1,5})\s*(?:个)?\s*(?:epoch|轮|周期)",
            ],
            Self::LearningRate => [
                r"(?i)\b(?:initial\s+)?learning[\s-]*rate\b\s*(?:(?:was|is)\s+)?(?:set\s+to\s+|of\s+|at\s+|[:=]\s*)?((?:\d+(?:\.\d+)?|\.\d+)(?:\s*[eE][+-]?\d+)?)",
                r"学习率\s*(?:为|是|设为|设置为|采用|[:=])\s*((?:\d+(?:\.\d+)?|\.\d+)(?:\s*[eE][+-]?\d+)?)",
            ],
        };

        patterns.into_iter().find_map(|pattern| {
            let capture = Regex::new(pattern).ok()?.captures(text)?;
            if self == Self::LearningRate
                && capture.get(0).is_some_and(|matched| {
                    let span = matched.as_str().to_lowercase();
                    [
                        "not reported",
                        "not specified",
                        "not provided",
                        "without",
                        "未报告",
                        "未说明",
                        "未给出",
                        "未知",
                    ]
                    .iter()
                    .any(|negative| span.contains(negative))
                })
            {
                return None;
            }
            capture
                .get(1)
                .map(|value| (value.as_str().replace(' ', ""), value.start()))
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PaperFact {
    kind: PaperFactKind,
    value: Option<String>,
    section_locator: Option<String>,
}

impl PaperFact {
    fn rendered_value(&self) -> String {
        match (self.kind, self.value.as_deref()) {
            (PaperFactKind::Epochs, Some(value)) => format!("{value} 个 epoch"),
            (_, Some(value)) => value.to_string(),
            (_, None) => UNKNOWN_VALUE.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperFactAnswer {
    pub markdown: String,
    pub section_locators: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PaperFactSource {
    pub content: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

const VERIFIED_FACT_MARKER: &str = "<!-- xiaoyan:verified-paper-fact -->";

/// 对窄范围的论文实验参数问题做确定性回答，避免模型把未报告参数补成常见默认值。
/// 只有当问题完全由当前支持的参数构成时才返回结果；其他问题继续走 paper_analyst。
pub fn answer_supported_paper_fact_question(
    question: &str,
    full_text: &str,
) -> Option<PaperFactAnswer> {
    if full_text.trim().is_empty() {
        return None;
    }

    let supported = [PaperFactKind::Epochs, PaperFactKind::LearningRate];
    let requested = supported
        .into_iter()
        .filter(|kind| kind.requested_by(question))
        .collect::<Vec<_>>();
    if requested.is_empty() || contains_unsupported_parameter_request(question) {
        return None;
    }

    let facts = requested
        .into_iter()
        .map(|kind| extract_fact(kind, full_text))
        .collect::<Vec<_>>();
    let mut lines = Vec::new();
    let mut section_locators = Vec::new();

    for fact in &facts {
        if let Some(locator) = &fact.section_locator {
            section_locators.push(locator.clone());
            lines.push(format!(
                "- **{}**：{}。依据：论文「{}」章节中的参数描述。",
                fact.kind.label(),
                fact.rendered_value(),
                locator
            ));
        } else {
            lines.push(format!(
                "- **{}**：{}。已检查全文中该参数的中英文名称，未找到可核验数值。",
                fact.kind.label(),
                fact.rendered_value()
            ));
        }
    }

    lines.push("\n证据边界：仅根据当前本地论文全文；未报告项不作推测。".to_string());
    Some(PaperFactAnswer {
        markdown: lines.join("\n"),
        section_locators,
    })
}

pub fn is_supported_paper_fact_question(question: &str) -> bool {
    let supported = [PaperFactKind::Epochs, PaperFactKind::LearningRate];
    supported.iter().any(|kind| kind.requested_by(question))
        && !contains_unsupported_parameter_request(question)
}

pub fn verified_worker_output(answer: &PaperFactAnswer) -> String {
    format!("{VERIFIED_FACT_MARKER}\n{}", answer.markdown)
}

pub fn verified_answer_from_worker_output(output: &str) -> Option<String> {
    output
        .strip_prefix(VERIFIED_FACT_MARKER)
        .map(|answer| answer.trim_start().to_string())
}

pub async fn load_paper_fact_source(
    db: &sqlx::SqlitePool,
    paper_id: &str,
    question: &str,
) -> Option<PaperFactSource> {
    let row = sqlx::query("SELECT title, full_text, file_path FROM papers WHERE id = ?")
        .bind(paper_id)
        .fetch_optional(db)
        .await
        .ok()??;
    let title = row.get::<String, _>("title");
    let full_text = row.get::<Option<String>, _>("full_text")?;
    let file_path = row
        .get::<Option<String>, _>("file_path")
        .filter(|value| !value.trim().is_empty());
    let answer = answer_supported_paper_fact_question(question, &full_text)?;
    let locator = if answer.section_locators.is_empty() {
        "全文参数检查".to_string()
    } else {
        answer.section_locators.join("、")
    };

    Some(PaperFactSource {
        content: format!("本地论文资产 {paper_id}；证据定位：{locator}。未报告项不作推测。"),
        source: format!("{title} · {locator}"),
        url: file_path,
    })
}

fn extract_fact(kind: PaperFactKind, full_text: &str) -> PaperFact {
    let extracted = kind.extract_value(full_text);
    let section_locator = extracted
        .as_ref()
        .and_then(|(_, offset)| locate_section_for_offset(full_text, *offset));
    PaperFact {
        kind,
        value: extracted.map(|(value, _)| value),
        section_locator,
    }
}

fn locate_section_for_offset(full_text: &str, match_offset: usize) -> Option<String> {
    let mut current_heading: Option<String> = None;
    for line in full_text.get(..match_offset)?.lines() {
        let trimmed = line.trim();
        if is_section_heading(trimmed) {
            current_heading = Some(trimmed.to_string());
        }
    }
    current_heading.or_else(|| Some("正文参数段落".to_string()))
}

fn is_section_heading(line: &str) -> bool {
    if line.is_empty() || line.chars().count() > 80 {
        return false;
    }
    let lower = line.to_lowercase();
    let plain =
        lower.trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch.is_whitespace());
    [
        "method",
        "methods",
        "methodology",
        "experiment",
        "experiments",
        "experimental setup",
        "experimental settings",
        "training setup",
        "training details",
        "implementation details",
        "方法",
        "实验",
        "实验设置",
        "训练设置",
        "实现细节",
    ]
    .iter()
    .any(|heading| plain == *heading)
}

fn contains_unsupported_parameter_request(question: &str) -> bool {
    let lower = question.to_lowercase();
    [
        "batch size",
        "batch-size",
        "批大小",
        "批次大小",
        "optimizer",
        "优化器",
        "weight decay",
        "权重衰减",
        "dropout",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

#[cfg(test)]
mod tests {
    use super::{
        answer_supported_paper_fact_question, load_paper_fact_source,
        verified_answer_from_worker_output, verified_worker_output, UNKNOWN_VALUE,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    const SYNTHETIC_PAPER: &str = "Abstract\nSynthetic fixture only.\n\n3 Methods\nModel details.\n\n4 Experiments\n4.1 Training Setup\nWe trained the model for 12 epochs with early stopping.\nNo other optimization hyperparameters are specified.\n\n5 Results\nSynthetic results.";

    #[test]
    fn reports_supported_value_and_marks_missing_parameter_unknown() {
        let answer = answer_supported_paper_fact_question(
            "这篇论文训练了多少个 epoch？学习率是多少？请给出依据。",
            SYNTHETIC_PAPER,
        )
        .expect("supported fact question");

        assert!(answer.markdown.contains("12 个 epoch"));
        assert!(answer
            .markdown
            .contains(&format!("学习率**：{UNKNOWN_VALUE}")));
        assert!(answer.markdown.contains("4.1 Training Setup"));
        assert_eq!(answer.section_locators, vec!["4.1 Training Setup"]);
        assert!(!answer.markdown.contains("Synthetic fixture only"));
    }

    #[test]
    fn supports_chinese_parameter_expression_and_locator() {
        let answer = answer_supported_paper_fact_question(
            "训练轮数和学习率分别是多少？",
            "3 实验设置\n模型共训练 8 个 epoch，学习率设为 2e-4。",
        )
        .expect("supported Chinese fact question");

        assert!(answer.markdown.contains("8 个 epoch"));
        assert!(answer.markdown.contains("2e-4"));
        assert!(answer.markdown.contains("3 实验设置"));
    }

    #[test]
    fn does_not_intercept_broader_or_unsupported_questions() {
        assert!(answer_supported_paper_fact_question("请总结这篇论文", SYNTHETIC_PAPER).is_none());
        assert!(answer_supported_paper_fact_question(
            "epoch、学习率和 batch size 是多少？",
            SYNTHETIC_PAPER,
        )
        .is_none());
        assert!(answer_supported_paper_fact_question("epoch 是多少？", "").is_none());
    }

    #[test]
    fn avoids_false_positive_from_citations_and_years() {
        let answer = answer_supported_paper_fact_question(
            "训练了多少 epoch？",
            "3 Methods\nPrior work from 2024 is discussed, but no training schedule is reported.",
        )
        .expect("supported question with missing value");

        assert!(answer.markdown.contains(UNKNOWN_VALUE));
        assert!(!answer.markdown.contains("2024 个 epoch"));
    }

    #[test]
    fn does_not_treat_table_number_after_missing_learning_rate_as_value() {
        let answer = answer_supported_paper_fact_question(
            "学习率是多少？",
            "4 Training Setup\nThe learning rate is not reported; see Table 3 for outcomes.",
        )
        .expect("supported question with explicitly missing value");

        assert!(answer.markdown.contains(UNKNOWN_VALUE));
        assert!(!answer.markdown.contains("学习率**：3"));
    }

    #[test]
    fn does_not_treat_schedule_epoch_as_learning_rate() {
        let answer = answer_supported_paper_fact_question(
            "学习率是多少？",
            "4 Training Setup\nThe learning rate schedule decays after 10 epochs.",
        )
        .expect("supported question without an explicit learning rate value");

        assert!(answer.markdown.contains(UNKNOWN_VALUE));
        assert!(!answer.markdown.contains("学习率**：10"));
    }

    #[test]
    fn does_not_treat_schedule_milestone_as_total_training_epochs() {
        let answer = answer_supported_paper_fact_question(
            "训练了多少 epoch？",
            "4 Training Setup\nThe learning rate schedule decays after 10 epochs.",
        )
        .expect("supported question without total training epochs");

        assert!(answer.markdown.contains(UNKNOWN_VALUE));
        assert!(!answer.markdown.contains("10 个 epoch"));
    }

    #[test]
    fn locator_follows_the_matched_fact_not_an_earlier_equal_number() {
        let answer = answer_supported_paper_fact_question(
            "训练了多少 epoch？",
            "Abstract\nWe evaluate 12 datasets.\n\n4 Training Setup\nWe trained the model for 12 epochs.",
        )
        .expect("supported fact question");

        assert_eq!(answer.section_locators, vec!["4 Training Setup"]);
    }

    #[test]
    fn verified_worker_contract_round_trips_without_exposing_marker() {
        let answer = answer_supported_paper_fact_question("epoch 是多少？", SYNTHETIC_PAPER)
            .expect("supported fact question");
        let worker_output = verified_worker_output(&answer);

        assert_eq!(
            verified_answer_from_worker_output(&worker_output),
            Some(answer.markdown)
        );
        assert!(verified_answer_from_worker_output("普通模型回答").is_none());
    }

    #[tokio::test]
    async fn source_contract_uses_asset_id_and_locator_without_raw_text() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory db");
        sqlx::query(
            "CREATE TABLE papers (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                full_text TEXT,
                file_path TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("create table");
        sqlx::query("INSERT INTO papers (id, title, full_text) VALUES (?, ?, ?)")
            .bind("synthetic-paper-e02")
            .bind("Synthetic Training Fixture")
            .bind(SYNTHETIC_PAPER)
            .execute(&pool)
            .await
            .expect("insert fixture");

        let source = load_paper_fact_source(&pool, "synthetic-paper-e02", "epoch 和学习率是多少？")
            .await
            .expect("fact source");

        assert!(source.content.contains("synthetic-paper-e02"));
        assert!(source.content.contains("4.1 Training Setup"));
        assert!(source.source.contains("Synthetic Training Fixture"));
        assert!(!source.content.contains("Synthetic fixture only"));
        assert!(source.url.is_none());
    }
}
