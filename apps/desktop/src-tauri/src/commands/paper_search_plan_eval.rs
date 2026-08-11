use super::paper_search_plan::build_fallback_search_queries;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct LitSearchCase {
    id: String,
    query: String,
}

#[derive(Debug, Deserialize)]
struct CaseManifest {
    case_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PlanExample {
    id: String,
    original_query: String,
    original_tokens: usize,
    primary_tokens: usize,
    queries: Vec<String>,
}

#[derive(Debug, Serialize)]
struct TokenFrequency {
    token: String,
    count: usize,
}

fn token_count(value: &str) -> usize {
    value
        .split(|character: char| !character.is_alphanumeric() && character != '-')
        .filter(|token| !token.trim().is_empty())
        .count()
}

fn percentile(mut values: Vec<usize>, percentile: f64) -> usize {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    let index = ((values.len() - 1) as f64 * percentile).ceil() as usize;
    values[index.min(values.len() - 1)]
}

fn select_manifest_cases(
    cases: Vec<LitSearchCase>,
    manifest: Option<CaseManifest>,
) -> Result<Vec<LitSearchCase>, String> {
    let Some(manifest) = manifest else {
        return Ok(cases);
    };
    let mut cases_by_id = cases
        .into_iter()
        .map(|case| (case.id.clone(), case))
        .collect::<HashMap<_, _>>();
    let unique_ids = manifest.case_ids.iter().collect::<HashSet<_>>();
    if unique_ids.len() != manifest.case_ids.len() {
        return Err("样本清单包含重复 case ID".into());
    }
    manifest
        .case_ids
        .into_iter()
        .map(|case_id| {
            cases_by_id
                .remove(&case_id)
                .ok_or_else(|| format!("样本清单包含数据集中不存在的 case ID：{case_id}"))
        })
        .collect()
}

#[test]
#[ignore = "离线 LitSearch 查询规划评测；使用 scripts/paper-search-eval/run_plan_eval.py 运行"]
fn offline_litsearch_plan_eval() {
    let dataset_path = std::env::var("PAPER_SEARCH_PLAN_EVAL_DATASET")
        .expect("必须设置 PAPER_SEARCH_PLAN_EVAL_DATASET");
    let output_path = std::env::var("PAPER_SEARCH_PLAN_EVAL_OUTPUT")
        .unwrap_or_else(|_| "../../../../tmp/paper-search-eval/litsearch-plan-report.json".into());
    let case_manifest_path = std::env::var("PAPER_SEARCH_PLAN_EVAL_CASE_MANIFEST").ok();
    let dataset = fs::read_to_string(&dataset_path).expect("读取 LitSearch JSONL 失败");
    let cases = dataset
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<LitSearchCase>(line).expect("解析 LitSearch 行失败"))
        .collect::<Vec<_>>();
    let manifest = case_manifest_path.as_deref().map(|path| {
        serde_json::from_str::<CaseManifest>(&fs::read_to_string(path).expect("读取样本清单失败"))
            .expect("解析样本清单失败")
    });
    let cases = select_manifest_cases(cases, manifest).expect("按样本清单筛选 LitSearch 失败");
    assert!(!cases.is_empty(), "LitSearch 数据集为空");

    let mut original_token_counts = Vec::with_capacity(cases.len());
    let mut primary_token_counts = Vec::with_capacity(cases.len());
    let mut total_query_count = 0usize;
    let mut empty_plan_count = 0usize;
    let mut duplicate_query_plan_count = 0usize;
    let mut long_query_count = 0usize;
    let mut compressed_long_query_count = 0usize;
    let mut sample_plans = Vec::new();
    let mut review_examples = Vec::new();
    let mut primary_first_tokens = HashMap::<String, usize>::new();

    for case in cases {
        let queries = build_fallback_search_queries(&case.query, &[]);
        let original_tokens = token_count(&case.query);
        let primary_tokens = queries.first().map(|query| token_count(query)).unwrap_or(0);
        let unique_query_count = queries.iter().collect::<HashSet<_>>().len();

        original_token_counts.push(original_tokens);
        primary_token_counts.push(primary_tokens);
        total_query_count += queries.len();
        empty_plan_count += usize::from(queries.is_empty());
        duplicate_query_plan_count += usize::from(unique_query_count != queries.len());
        if let Some(token) = queries
            .first()
            .and_then(|query| query.split_whitespace().next())
        {
            *primary_first_tokens
                .entry(token.to_lowercase())
                .or_default() += 1;
        }
        if original_tokens > 8 {
            long_query_count += 1;
            compressed_long_query_count += usize::from(primary_tokens < original_tokens);
        }

        if sample_plans.len() < 20 {
            sample_plans.push(PlanExample {
                id: case.id.clone(),
                original_query: case.query.clone(),
                original_tokens,
                primary_tokens,
                queries: queries.clone(),
            });
        }
        if review_examples.len() < 20
            && (primary_tokens > 8 || primary_tokens >= original_tokens || queries.is_empty())
        {
            review_examples.push(PlanExample {
                id: case.id,
                original_query: case.query,
                original_tokens,
                primary_tokens,
                queries,
            });
        }
    }

    let sample_count = original_token_counts.len();
    let mut primary_first_token_frequency = primary_first_tokens
        .into_iter()
        .map(|(token, count)| TokenFrequency { token, count })
        .collect::<Vec<_>>();
    primary_first_token_frequency.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.token.cmp(&right.token))
    });
    primary_first_token_frequency.truncate(30);

    let report = json!({
        "suite": "LitSearch offline query planning",
        "dataset_path": dataset_path,
        "case_manifest_path": case_manifest_path,
        "sample_count": sample_count,
        "metrics": {
            "empty_plan_count": empty_plan_count,
            "duplicate_query_plan_count": duplicate_query_plan_count,
            "average_query_count": total_query_count as f64 / sample_count as f64,
            "average_original_tokens": original_token_counts.iter().sum::<usize>() as f64 / sample_count as f64,
            "average_primary_tokens": primary_token_counts.iter().sum::<usize>() as f64 / sample_count as f64,
            "p95_primary_tokens": percentile(primary_token_counts.clone(), 0.95),
            "max_primary_tokens": primary_token_counts.iter().copied().max().unwrap_or(0),
            "long_query_count": long_query_count,
            "compressed_long_query_count": compressed_long_query_count,
            "long_query_compression_rate": compressed_long_query_count as f64 / long_query_count.max(1) as f64
        },
        "primary_first_token_frequency": primary_first_token_frequency,
        "sample_plans": sample_plans,
        "review_examples": review_examples
    });

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).expect("创建查询规划评测报告目录失败");
    }
    fs::write(
        &output_path,
        serde_json::to_string_pretty(&report).expect("序列化查询规划评测报告失败"),
    )
    .expect("写入查询规划评测报告失败");
    eprintln!("LitSearch plan report: {output_path}");
    eprintln!(
        "{}",
        serde_json::to_string_pretty(&report["metrics"]).unwrap()
    );

    assert_eq!(empty_plan_count, 0, "查询规划器不得产生空计划");
    assert_eq!(
        duplicate_query_plan_count, 0,
        "查询计划内不得包含重复检索式"
    );
}

#[cfg(test)]
mod tests {
    use super::{select_manifest_cases, CaseManifest, LitSearchCase};

    fn case(id: &str) -> LitSearchCase {
        LitSearchCase {
            id: id.into(),
            query: format!("query for {id}"),
        }
    }

    #[test]
    fn manifest_selection_preserves_manifest_order() {
        let selected = select_manifest_cases(
            vec![case("a"), case("b"), case("c")],
            Some(CaseManifest {
                case_ids: vec!["c".into(), "a".into()],
            }),
        )
        .expect("manifest should be valid");

        assert_eq!(
            selected.into_iter().map(|case| case.id).collect::<Vec<_>>(),
            vec!["c", "a"]
        );
    }

    #[test]
    fn manifest_selection_rejects_duplicate_or_unknown_ids() {
        let duplicate = select_manifest_cases(
            vec![case("a")],
            Some(CaseManifest {
                case_ids: vec!["a".into(), "a".into()],
            }),
        );
        assert!(duplicate.unwrap_err().contains("重复"));

        let unknown = select_manifest_cases(
            vec![case("a")],
            Some(CaseManifest {
                case_ids: vec!["missing".into()],
            }),
        );
        assert!(unknown.unwrap_err().contains("不存在"));
    }
}
