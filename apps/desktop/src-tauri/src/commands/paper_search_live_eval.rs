use super::paper_search::{execute_paper_search, PaperSearchRequest};
use super::paper_search_response_cache;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Deserialize)]
struct LitSearchCase {
    id: String,
    query_set: String,
    query: String,
    specificity: i64,
    quality: i64,
    corpusids: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GoldMetadataRow {
    original_corpus_id: i64,
    paper_id: Option<String>,
    corpus_id: Option<i64>,
}

struct GoldTarget {
    corpus_ids: HashSet<i64>,
    paper_ids: HashSet<String>,
    currently_resolvable: bool,
}

#[derive(Debug, Serialize)]
struct ReturnedPaper {
    corpus_id: Option<i64>,
    paper_id: String,
    title: String,
    score: i64,
    relevance_band: Option<String>,
    discovered_via: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EvaluationCandidate {
    corpus_id: Option<i64>,
    paper_id: String,
    title: String,
    rank: usize,
    score: i64,
    discovered_via: String,
}

#[derive(Debug, Serialize)]
struct GoldCandidateDiagnostic {
    original_corpus_id: i64,
    canonical_corpus_ids: Vec<i64>,
    paper_ids: Vec<String>,
    currently_resolvable: bool,
    candidate_rank: Option<usize>,
    final_rank: Option<usize>,
    candidate_title: Option<String>,
    final_title: Option<String>,
    candidate_score: Option<i64>,
    final_score: Option<i64>,
    candidate_discovered_via: Option<String>,
    final_discovered_via: Option<String>,
}

#[derive(Debug, Serialize)]
struct LitSearchCaseResult {
    id: String,
    query_set: String,
    query: String,
    specificity: i64,
    quality: i64,
    gold_corpus_ids: Vec<i64>,
    gold_canonical_corpus_ids: Vec<i64>,
    gold_paper_ids: Vec<String>,
    currently_resolvable_gold_count: usize,
    currently_unresolved_gold_count: usize,
    returned_corpus_ids: Vec<i64>,
    returned_papers: Vec<ReturnedPaper>,
    gold_candidate_diagnostics: Vec<GoldCandidateDiagnostic>,
    search_queries: Vec<String>,
    citation_seed_ids: Vec<String>,
    partial_failures: Vec<String>,
    hits_at_5: usize,
    hits_at_10: usize,
    hits_at_limit: usize,
    resolvable_hits_at_5: usize,
    resolvable_hits_at_10: usize,
    resolvable_hits_at_limit: usize,
    returned_count: usize,
    candidate_count: usize,
    candidate_gold_hits: usize,
    resolvable_candidate_gold_hits: usize,
    ranking_loss_count: usize,
    academic_api_calls: u64,
    llm_calls: u64,
    estimated_tokens: u64,
    duration_ms: u64,
    error: Option<String>,
}

fn env_usize(name: &str, fallback: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

fn load_gold_metadata(path: Option<&str>) -> HashMap<i64, GoldMetadataRow> {
    let Some(path) = path else {
        return HashMap::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<GoldMetadataRow>(line).ok())
        .map(|row| (row.original_corpus_id, row))
        .collect()
}

fn gold_targets(corpus_ids: &[i64], metadata: &HashMap<i64, GoldMetadataRow>) -> Vec<GoldTarget> {
    corpus_ids
        .iter()
        .map(|original| {
            let mut target = GoldTarget {
                corpus_ids: HashSet::from([*original]),
                paper_ids: HashSet::new(),
                currently_resolvable: metadata.is_empty(),
            };
            if let Some(row) = metadata.get(original) {
                target.corpus_ids.extend(row.corpus_id);
                target.paper_ids.extend(row.paper_id.clone());
                target.currently_resolvable = row.corpus_id.is_some() || row.paper_id.is_some();
            }
            target
        })
        .collect()
}

fn hit_count(returned: &[ReturnedPaper], gold: &[GoldTarget], limit: usize) -> usize {
    gold.iter()
        .filter(|target| {
            returned.iter().take(limit).any(|paper| {
                paper
                    .corpus_id
                    .is_some_and(|corpus_id| target.corpus_ids.contains(&corpus_id))
                    || target.paper_ids.contains(&paper.paper_id)
            })
        })
        .count()
}

fn resolvable_hit_count(returned: &[ReturnedPaper], gold: &[GoldTarget], limit: usize) -> usize {
    gold.iter()
        .filter(|target| target.currently_resolvable)
        .filter(|target| {
            returned.iter().take(limit).any(|paper| {
                paper
                    .corpus_id
                    .is_some_and(|corpus_id| target.corpus_ids.contains(&corpus_id))
                    || target.paper_ids.contains(&paper.paper_id)
            })
        })
        .count()
}

fn paper_matches_target(corpus_id: Option<i64>, paper_id: &str, target: &GoldTarget) -> bool {
    corpus_id.is_some_and(|value| target.corpus_ids.contains(&value))
        || target.paper_ids.contains(paper_id)
}

fn gold_candidate_diagnostics(
    original_corpus_ids: &[i64],
    gold: &[GoldTarget],
    candidates: &[EvaluationCandidate],
    returned: &[ReturnedPaper],
) -> Vec<GoldCandidateDiagnostic> {
    original_corpus_ids
        .iter()
        .zip(gold)
        .map(|(original_corpus_id, target)| {
            let candidate = candidates
                .iter()
                .find(|paper| paper_matches_target(paper.corpus_id, &paper.paper_id, target));
            let final_paper = returned
                .iter()
                .enumerate()
                .find(|(_, paper)| paper_matches_target(paper.corpus_id, &paper.paper_id, target));
            let mut canonical_corpus_ids = target.corpus_ids.iter().copied().collect::<Vec<_>>();
            canonical_corpus_ids.sort_unstable();
            let mut paper_ids = target.paper_ids.iter().cloned().collect::<Vec<_>>();
            paper_ids.sort();
            GoldCandidateDiagnostic {
                original_corpus_id: *original_corpus_id,
                canonical_corpus_ids,
                paper_ids,
                currently_resolvable: target.currently_resolvable,
                candidate_rank: candidate.map(|paper| paper.rank),
                final_rank: final_paper.map(|(index, _)| index + 1),
                candidate_title: candidate.map(|paper| paper.title.clone()),
                final_title: final_paper.map(|(_, paper)| paper.title.clone()),
                candidate_score: candidate.map(|paper| paper.score),
                final_score: final_paper.map(|(_, paper)| paper.score),
                candidate_discovered_via: candidate.map(|paper| paper.discovered_via.clone()),
                final_discovered_via: final_paper
                    .and_then(|(_, paper)| paper.discovered_via.clone()),
            }
        })
        .collect()
}

fn percentile(mut values: Vec<u64>, percentile: f64) -> u64 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    let index = ((values.len() - 1) as f64 * percentile).ceil() as usize;
    values[index.min(values.len() - 1)]
}

#[tokio::test]
#[ignore = "联网 LitSearch 质量评测；使用 scripts/paper-search-eval/run_litsearch.py 运行"]
async fn live_litsearch_eval() {
    paper_search_response_cache::reset_stats();
    let dataset_path = std::env::var("PAPER_SEARCH_EVAL_DATASET")
        .expect("必须设置 PAPER_SEARCH_EVAL_DATASET 指向准备好的 LitSearch JSONL");
    let output_path = std::env::var("PAPER_SEARCH_EVAL_OUTPUT")
        .unwrap_or_else(|_| "../../../../tmp/paper-search-eval/litsearch-report.json".into());
    let sample_limit = env_usize("PAPER_SEARCH_EVAL_SAMPLES", 5).max(1);
    let sample_offset = env_usize("PAPER_SEARCH_EVAL_OFFSET", 0);
    let selected_case_ids = std::env::var("PAPER_SEARCH_EVAL_CASE_IDS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|case_id| !case_id.is_empty())
                .map(str::to_string)
                .collect::<HashSet<_>>()
        })
        .filter(|case_ids| !case_ids.is_empty());
    let case_manifest_path = std::env::var("PAPER_SEARCH_EVAL_CASE_MANIFEST").ok();
    let result_limit = env_usize("PAPER_SEARCH_EVAL_RESULT_LIMIT", 20).clamp(1, 50);
    let search_depth = std::env::var("PAPER_SEARCH_EVAL_DEPTH").unwrap_or_else(|_| "quick".into());
    let cutoff_date =
        std::env::var("PAPER_SEARCH_EVAL_CUTOFF").unwrap_or_else(|_| "2024-07-01".into());
    let gold_metadata_path = std::env::var("PAPER_SEARCH_EVAL_GOLD_METADATA").ok();
    let gold_metadata = load_gold_metadata(gold_metadata_path.as_deref());
    let llm_settings = std::env::var("PAPER_SEARCH_EVAL_LLM_SETTINGS")
        .ok()
        .and_then(|value| serde_json::from_str::<HashMap<String, String>>(&value).ok())
        .unwrap_or_default();
    let llm_model = [
        "multi_agent_literature_scout_model",
        "copilot_simple_model",
        "openai_chat_model",
        "anthropic_chat_model",
        "openai_compatible_chat_model",
    ]
    .iter()
    .find_map(|key| {
        llm_settings
            .get(*key)
            .filter(|value| !value.trim().is_empty())
    })
    .cloned();

    let dataset = fs::read_to_string(&dataset_path).expect("读取 LitSearch JSONL 失败");
    let parsed_cases = dataset
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<LitSearchCase>(line).expect("解析 LitSearch 行失败"))
        .collect::<Vec<_>>();
    let cases = if let Some(case_ids) = selected_case_ids.as_ref() {
        let selected = parsed_cases
            .into_iter()
            .filter(|case| case_ids.contains(&case.id))
            .collect::<Vec<_>>();
        assert_eq!(
            selected.len(),
            case_ids.len(),
            "样本清单中的部分 LitSearch case id 不存在"
        );
        selected
    } else {
        parsed_cases
            .into_iter()
            .skip(sample_offset)
            .take(sample_limit)
            .collect::<Vec<_>>()
    };
    assert!(!cases.is_empty(), "选定的数据切片为空");

    let mut settings = llm_settings.clone();
    if let Ok(api_key) = std::env::var("SEMANTIC_SCHOLAR_API_KEY") {
        if !api_key.trim().is_empty() {
            settings.insert("semantic_scholar_api_key".into(), api_key);
        }
    }

    let run_started = Instant::now();
    let mut results = Vec::with_capacity(cases.len());
    for case in cases {
        let case_started = Instant::now();
        let response = execute_paper_search(
            &settings,
            PaperSearchRequest {
                topic: case.query.clone(),
                ..PaperSearchRequest::default()
            },
            Some(cutoff_date.clone()),
            Some(result_limit as i32),
            Some("relevance".into()),
            Some(search_depth.clone()),
        )
        .await;

        let gold = gold_targets(&case.corpusids, &gold_metadata);
        let gold_canonical_corpus_ids = case
            .corpusids
            .iter()
            .map(|original| {
                gold_metadata
                    .get(original)
                    .and_then(|row| row.corpus_id)
                    .unwrap_or(*original)
            })
            .collect::<Vec<_>>();
        let gold_paper_ids = gold
            .iter()
            .flat_map(|target| target.paper_ids.iter().cloned())
            .collect::<Vec<_>>();
        let currently_resolvable_gold_count = gold
            .iter()
            .filter(|target| target.currently_resolvable)
            .count();
        let currently_unresolved_gold_count = gold.len() - currently_resolvable_gold_count;
        let result = match response {
            Ok(value) => {
                let papers = value["papers"].as_array().cloned().unwrap_or_default();
                let returned_corpus_ids = papers
                    .iter()
                    .filter_map(|paper| paper["corpus_id"].as_i64())
                    .collect::<Vec<_>>();
                let returned_papers = papers
                    .iter()
                    .map(|paper| ReturnedPaper {
                        corpus_id: paper["corpus_id"].as_i64(),
                        paper_id: paper["arxiv_id"].as_str().unwrap_or_default().to_string(),
                        title: paper["title"].as_str().unwrap_or_default().to_string(),
                        score: paper["score"].as_i64().unwrap_or(0),
                        relevance_band: paper["relevance_band"].as_str().map(str::to_string),
                        discovered_via: paper["discovered_via"].as_str().map(str::to_string),
                    })
                    .collect::<Vec<_>>();
                let evaluation_candidates = value["evaluation_candidates"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|candidate| {
                        serde_json::from_value::<EvaluationCandidate>(candidate.clone()).ok()
                    })
                    .collect::<Vec<_>>();
                let gold_candidate_diagnostics = gold_candidate_diagnostics(
                    &case.corpusids,
                    &gold,
                    &evaluation_candidates,
                    &returned_papers,
                );
                let candidate_gold_hits = gold_candidate_diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.candidate_rank.is_some())
                    .count();
                let resolvable_candidate_gold_hits = gold_candidate_diagnostics
                    .iter()
                    .filter(|diagnostic| {
                        diagnostic.currently_resolvable && diagnostic.candidate_rank.is_some()
                    })
                    .count();
                let ranking_loss_count = gold_candidate_diagnostics
                    .iter()
                    .filter(|diagnostic| {
                        diagnostic.candidate_rank.is_some() && diagnostic.final_rank.is_none()
                    })
                    .count();
                LitSearchCaseResult {
                    id: case.id,
                    query_set: case.query_set,
                    query: case.query,
                    specificity: case.specificity,
                    quality: case.quality,
                    gold_corpus_ids: case.corpusids,
                    gold_canonical_corpus_ids,
                    gold_paper_ids,
                    currently_resolvable_gold_count,
                    currently_unresolved_gold_count,
                    search_queries: value["search_queries"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|query| query.as_str().map(str::to_string))
                        .collect(),
                    citation_seed_ids: value["strategy_trace"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|step| step["stage"].as_str() == Some("citation_expand"))
                        .filter_map(|step| step["query"].as_str().map(str::to_string))
                        .collect(),
                    partial_failures: value["strategy_trace"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|step| step["status"].as_str() == Some("partial"))
                        .filter_map(|step| step["note"].as_str().map(str::to_string))
                        .collect(),
                    hits_at_5: hit_count(&returned_papers, &gold, 5),
                    hits_at_10: hit_count(&returned_papers, &gold, 10),
                    hits_at_limit: hit_count(&returned_papers, &gold, result_limit),
                    resolvable_hits_at_5: resolvable_hit_count(&returned_papers, &gold, 5),
                    resolvable_hits_at_10: resolvable_hit_count(&returned_papers, &gold, 10),
                    resolvable_hits_at_limit: resolvable_hit_count(
                        &returned_papers,
                        &gold,
                        result_limit,
                    ),
                    returned_count: papers.len(),
                    candidate_count: value["candidate_count"].as_u64().unwrap_or(0) as usize,
                    candidate_gold_hits,
                    resolvable_candidate_gold_hits,
                    ranking_loss_count,
                    academic_api_calls: value["metrics"]["academic_api_calls"]
                        .as_u64()
                        .unwrap_or(0),
                    llm_calls: value["metrics"]["llm_calls"].as_u64().unwrap_or(0),
                    estimated_tokens: value["metrics"]["estimated_tokens"].as_u64().unwrap_or(0),
                    duration_ms: value["metrics"]["duration_ms"]
                        .as_u64()
                        .unwrap_or_else(|| case_started.elapsed().as_millis() as u64),
                    returned_corpus_ids,
                    returned_papers,
                    gold_candidate_diagnostics,
                    error: None,
                }
            }
            Err(error) => LitSearchCaseResult {
                id: case.id,
                query_set: case.query_set,
                query: case.query,
                specificity: case.specificity,
                quality: case.quality,
                gold_corpus_ids: case.corpusids.clone(),
                gold_canonical_corpus_ids,
                gold_paper_ids,
                currently_resolvable_gold_count,
                currently_unresolved_gold_count,
                returned_corpus_ids: Vec::new(),
                returned_papers: Vec::new(),
                gold_candidate_diagnostics: gold_candidate_diagnostics(
                    &case.corpusids,
                    &gold,
                    &[],
                    &[],
                ),
                search_queries: Vec::new(),
                citation_seed_ids: Vec::new(),
                partial_failures: Vec::new(),
                hits_at_5: 0,
                hits_at_10: 0,
                hits_at_limit: 0,
                resolvable_hits_at_5: 0,
                resolvable_hits_at_10: 0,
                resolvable_hits_at_limit: 0,
                returned_count: 0,
                candidate_count: 0,
                candidate_gold_hits: 0,
                resolvable_candidate_gold_hits: 0,
                ranking_loss_count: 0,
                academic_api_calls: 0,
                llm_calls: 0,
                estimated_tokens: 0,
                duration_ms: case_started.elapsed().as_millis() as u64,
                error: Some(error),
            },
        };
        eprintln!(
            "[{}/{}] {}: hit@{}={}{}",
            results.len() + 1,
            sample_limit,
            result.id,
            result_limit,
            result.hits_at_limit,
            result
                .error
                .as_ref()
                .map(|error| format!("; error={error}"))
                .unwrap_or_default()
        );
        results.push(result);
    }

    let successful = results
        .iter()
        .filter(|result| result.error.is_none())
        .count();
    let total_gold = results
        .iter()
        .map(|result| result.gold_corpus_ids.len())
        .sum::<usize>();
    let total_returned = results
        .iter()
        .map(|result| result.returned_count)
        .sum::<usize>();
    let currently_resolvable_gold = results
        .iter()
        .map(|result| result.currently_resolvable_gold_count)
        .sum::<usize>();
    let currently_unresolved_gold = results
        .iter()
        .map(|result| result.currently_unresolved_gold_count)
        .sum::<usize>();
    let hits_at_5 = results.iter().map(|result| result.hits_at_5).sum::<usize>();
    let hits_at_10 = results
        .iter()
        .map(|result| result.hits_at_10)
        .sum::<usize>();
    let hits_at_limit = results
        .iter()
        .map(|result| result.hits_at_limit)
        .sum::<usize>();
    let resolvable_hits_at_5 = results
        .iter()
        .map(|result| result.resolvable_hits_at_5)
        .sum::<usize>();
    let resolvable_hits_at_10 = results
        .iter()
        .map(|result| result.resolvable_hits_at_10)
        .sum::<usize>();
    let resolvable_hits_at_limit = results
        .iter()
        .map(|result| result.resolvable_hits_at_limit)
        .sum::<usize>();
    let candidate_gold_hits = results
        .iter()
        .map(|result| result.candidate_gold_hits)
        .sum::<usize>();
    let resolvable_candidate_gold_hits = results
        .iter()
        .map(|result| result.resolvable_candidate_gold_hits)
        .sum::<usize>();
    let ranking_loss_count = results
        .iter()
        .map(|result| result.ranking_loss_count)
        .sum::<usize>();
    let precision = hits_at_limit as f64 / total_returned.max(1) as f64;
    let recall = hits_at_limit as f64 / total_gold.max(1) as f64;
    let f1 = if precision + recall > 0.0 {
        2.0 * precision * recall / (precision + recall)
    } else {
        0.0
    };
    let durations = results
        .iter()
        .map(|result| result.duration_ms)
        .collect::<Vec<_>>();
    let academic_api_calls = results
        .iter()
        .map(|result| result.academic_api_calls)
        .sum::<u64>();
    let llm_calls = results.iter().map(|result| result.llm_calls).sum::<u64>();
    let estimated_tokens = results
        .iter()
        .map(|result| result.estimated_tokens)
        .sum::<u64>();

    let report = json!({
        "suite": "LitSearch",
        "dataset_path": dataset_path,
        "sample_offset": sample_offset,
        "sample_count": results.len(),
        "case_manifest_path": case_manifest_path,
        "successful_count": successful,
        "search_depth": search_depth,
        "result_limit": result_limit,
        "cutoff_date": cutoff_date,
        "gold_metadata_path": gold_metadata_path,
        "gold_metadata_count": gold_metadata.len(),
        "llm_evaluation": {
            "enabled": !llm_settings.is_empty(),
            "model": llm_model,
        },
        "metrics": {
            "precision_at_limit": precision,
            "recall_at_5": hits_at_5 as f64 / total_gold.max(1) as f64,
            "recall_at_10": hits_at_10 as f64 / total_gold.max(1) as f64,
            "recall_at_limit": recall,
            "f1_at_limit": f1,
            "hits_at_limit": hits_at_limit,
            "gold_count": total_gold,
            "currently_resolvable_gold_count": currently_resolvable_gold,
            "currently_unresolved_gold_count": currently_unresolved_gold,
            "resolvable_hits_at_limit": resolvable_hits_at_limit,
            "candidate_gold_hits": candidate_gold_hits,
            "candidate_recall": candidate_gold_hits as f64 / total_gold.max(1) as f64,
            "resolvable_candidate_gold_hits": resolvable_candidate_gold_hits,
            "resolvable_candidate_recall": resolvable_candidate_gold_hits as f64 / currently_resolvable_gold.max(1) as f64,
            "ranking_loss_count": ranking_loss_count,
            "retrieval_miss_count": total_gold.saturating_sub(candidate_gold_hits),
            "recall_resolvable_at_5": resolvable_hits_at_5 as f64 / currently_resolvable_gold.max(1) as f64,
            "recall_resolvable_at_10": resolvable_hits_at_10 as f64 / currently_resolvable_gold.max(1) as f64,
            "recall_resolvable_at_limit": resolvable_hits_at_limit as f64 / currently_resolvable_gold.max(1) as f64,
            "returned_count": total_returned,
            "academic_api_calls": academic_api_calls,
            "llm_calls": llm_calls,
            "estimated_tokens": estimated_tokens,
            "p50_duration_ms": percentile(durations.clone(), 0.50),
            "p95_duration_ms": percentile(durations, 0.95),
            "wall_time_ms": run_started.elapsed().as_millis() as u64
        },
        "response_cache": paper_search_response_cache::stats(),
        "cases": results
    });

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).expect("创建评测报告目录失败");
    }
    fs::write(
        &output_path,
        serde_json::to_string_pretty(&report).expect("序列化评测报告失败"),
    )
    .expect("写入评测报告失败");
    eprintln!("LitSearch report: {output_path}");
    eprintln!(
        "{}",
        serde_json::to_string_pretty(&report["metrics"]).unwrap()
    );
    assert!(
        successful > 0,
        "所有 LitSearch 样例均调用失败；错误详情已写入报告"
    );
}

#[cfg(test)]
mod tests {
    use super::{
        gold_candidate_diagnostics, hit_count, resolvable_hit_count, EvaluationCandidate,
        GoldTarget, ReturnedPaper,
    };
    use std::collections::HashSet;

    #[test]
    fn canonical_paper_id_matches_a_migrated_gold_corpus_id() {
        let returned = vec![ReturnedPaper {
            corpus_id: Some(200),
            paper_id: "stable-paper-id".into(),
            title: "Resolved paper".into(),
            score: 80,
            relevance_band: Some("high".into()),
            discovered_via: Some("search".into()),
        }];
        let gold = vec![GoldTarget {
            corpus_ids: HashSet::from([100]),
            paper_ids: HashSet::from(["stable-paper-id".into()]),
            currently_resolvable: true,
        }];

        assert_eq!(hit_count(&returned, &gold, 1), 1);
        assert_eq!(resolvable_hit_count(&returned, &gold, 1), 1);
    }

    #[test]
    fn unresolved_gold_is_kept_in_official_recall_but_excluded_from_resolvable_recall() {
        let gold = vec![GoldTarget {
            corpus_ids: HashSet::from([100]),
            paper_ids: HashSet::new(),
            currently_resolvable: false,
        }];

        assert_eq!(hit_count(&[], &gold, 20), 0);
        assert_eq!(resolvable_hit_count(&[], &gold, 20), 0);
        assert_eq!(
            gold.iter()
                .filter(|target| target.currently_resolvable)
                .count(),
            0
        );
    }

    #[test]
    fn diagnostics_distinguish_a_ranking_loss_from_a_retrieval_miss() {
        let gold = vec![GoldTarget {
            corpus_ids: HashSet::from([100, 200]),
            paper_ids: HashSet::from(["stable-paper-id".into()]),
            currently_resolvable: true,
        }];
        let candidates = vec![EvaluationCandidate {
            corpus_id: Some(200),
            paper_id: "stable-paper-id".into(),
            title: "Resolved paper".into(),
            rank: 37,
            score: 71,
            discovered_via: "full_text_snippet".into(),
        }];

        let ranking_loss = gold_candidate_diagnostics(&[100], &gold, &candidates, &[]);
        assert_eq!(ranking_loss[0].candidate_rank, Some(37));
        assert_eq!(ranking_loss[0].candidate_score, Some(71));
        assert_eq!(ranking_loss[0].final_rank, None);
        assert_eq!(
            ranking_loss[0].candidate_discovered_via.as_deref(),
            Some("full_text_snippet")
        );

        let retrieval_miss = gold_candidate_diagnostics(&[100], &gold, &[], &[]);
        assert_eq!(retrieval_miss[0].candidate_rank, None);
        assert_eq!(retrieval_miss[0].final_rank, None);
    }
}
