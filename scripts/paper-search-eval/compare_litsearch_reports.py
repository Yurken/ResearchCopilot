#!/usr/bin/env python3
"""Compare two LitSearch reports on the same cases with paired deltas."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def load_report(path: Path) -> dict[str, Any]:
    report = json.loads(path.read_text(encoding="utf-8"))
    cases = report.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"报告没有有效 cases：{path}")
    case_ids = [case.get("id") for case in cases]
    if not all(isinstance(case_id, str) and case_id for case_id in case_ids):
        raise ValueError(f"报告包含无效 case ID：{path}")
    if len(set(case_ids)) != len(case_ids):
        raise ValueError(f"报告包含重复 case ID：{path}")
    return report


def percentile(values: list[int], quantile: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = math.ceil((len(ordered) - 1) * quantile)
    return ordered[min(index, len(ordered) - 1)]


def divide(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def aggregate(cases: list[dict[str, Any]]) -> dict[str, Any]:
    gold_count = sum(len(case.get("gold_corpus_ids", [])) for case in cases)
    returned_count = sum(int(case.get("returned_count", 0)) for case in cases)
    hits_at_5 = sum(int(case.get("hits_at_5", 0)) for case in cases)
    hits_at_10 = sum(int(case.get("hits_at_10", 0)) for case in cases)
    hits_at_limit = sum(int(case.get("hits_at_limit", 0)) for case in cases)
    precision = divide(hits_at_limit, returned_count)
    recall = divide(hits_at_limit, gold_count)
    return {
        "sample_count": len(cases),
        "gold_count": gold_count,
        "returned_count": returned_count,
        "hits_at_5": hits_at_5,
        "hits_at_10": hits_at_10,
        "hits_at_limit": hits_at_limit,
        "recall_at_5": divide(hits_at_5, gold_count),
        "recall_at_10": divide(hits_at_10, gold_count),
        "recall_at_limit": recall,
        "precision_at_limit": precision,
        "f1_at_limit": divide(2 * precision * recall, precision + recall),
        "academic_api_calls": sum(int(case.get("academic_api_calls", 0)) for case in cases),
        "llm_calls": sum(int(case.get("llm_calls", 0)) for case in cases),
        "estimated_tokens": sum(int(case.get("estimated_tokens", 0)) for case in cases),
        "p50_duration_ms": percentile([int(case.get("duration_ms", 0)) for case in cases], 0.5),
        "p95_duration_ms": percentile([int(case.get("duration_ms", 0)) for case in cases], 0.95),
        "error_case_count": sum(case.get("error") is not None for case in cases),
        "partial_failure_case_count": sum(bool(case.get("partial_failures")) for case in cases),
    }


def metric_deltas(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    comparable = [
        "hits_at_5",
        "hits_at_10",
        "hits_at_limit",
        "recall_at_5",
        "recall_at_10",
        "recall_at_limit",
        "precision_at_limit",
        "f1_at_limit",
        "academic_api_calls",
        "llm_calls",
        "estimated_tokens",
        "p50_duration_ms",
        "p95_duration_ms",
        "error_case_count",
        "partial_failure_case_count",
    ]
    return {key: candidate[key] - baseline[key] for key in comparable}


def gold_returned_papers(case: dict[str, Any]) -> dict[int, dict[str, Any]]:
    gold_ids = set(case.get("gold_corpus_ids", []))
    return {
        paper["corpus_id"]: paper
        for paper in case.get("returned_papers", [])
        if paper.get("corpus_id") in gold_ids
    }


def compare_cases(
    baseline_cases: list[dict[str, Any]], candidate_cases: list[dict[str, Any]]
) -> dict[str, Any]:
    baseline_by_id = {case["id"]: case for case in baseline_cases}
    improved_cases: list[str] = []
    regressed_cases: list[str] = []
    gained_gold_count = 0
    lost_gold_count = 0
    gained_sources: Counter[str] = Counter()
    case_deltas = []

    for candidate in candidate_cases:
        baseline = baseline_by_id[candidate["id"]]
        if set(baseline.get("gold_corpus_ids", [])) != set(candidate.get("gold_corpus_ids", [])):
            raise ValueError(f"case {candidate['id']} 的 gold_corpus_ids 在两份报告中不一致")
        if baseline.get("query") != candidate.get("query"):
            raise ValueError(f"case {candidate['id']} 的 query 在两份报告中不一致")
        baseline_hits = int(baseline.get("hits_at_limit", 0))
        candidate_hits = int(candidate.get("hits_at_limit", 0))
        hit_delta = candidate_hits - baseline_hits
        if hit_delta > 0:
            improved_cases.append(candidate["id"])
            gained_gold_count += hit_delta
        elif hit_delta < 0:
            regressed_cases.append(candidate["id"])
            lost_gold_count -= hit_delta

        baseline_gold = gold_returned_papers(baseline)
        candidate_gold = gold_returned_papers(candidate)
        for corpus_id in candidate_gold.keys() - baseline_gold.keys():
            source = str(candidate_gold[corpus_id].get("discovered_via") or "unknown")
            gained_sources[source] += 1

        case_deltas.append(
            {
                "id": candidate["id"],
                "gold_count": len(candidate.get("gold_corpus_ids", [])),
                "baseline_hits_at_limit": baseline_hits,
                "candidate_hits_at_limit": candidate_hits,
                "hit_delta": hit_delta,
                "academic_api_call_delta": int(candidate.get("academic_api_calls", 0))
                - int(baseline.get("academic_api_calls", 0)),
                "duration_ms_delta": int(candidate.get("duration_ms", 0))
                - int(baseline.get("duration_ms", 0)),
            }
        )

    return {
        "improved_case_count": len(improved_cases),
        "regressed_case_count": len(regressed_cases),
        "unchanged_case_count": len(candidate_cases) - len(improved_cases) - len(regressed_cases),
        "gained_gold_count": gained_gold_count,
        "lost_gold_count": lost_gold_count,
        "improved_case_ids": improved_cases,
        "regressed_case_ids": regressed_cases,
        "gained_gold_discovered_via": dict(sorted(gained_sources.items())),
        "case_deltas": case_deltas,
    }


def build_comparison(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    allow_baseline_superset: bool,
) -> dict[str, Any]:
    baseline_cases = baseline["cases"]
    candidate_cases = candidate["cases"]
    baseline_source_case_count = len(baseline_cases)
    candidate_source_case_count = len(candidate_cases)
    baseline_ids = [case["id"] for case in baseline_cases]
    candidate_ids = [case["id"] for case in candidate_cases]
    if allow_baseline_superset:
        missing = sorted(set(candidate_ids) - set(baseline_ids))
        if missing:
            raise ValueError(f"基线报告缺少 {len(missing)} 个候选 case：{missing[:3]}")
        baseline_by_id = {case["id"]: case for case in baseline_cases}
        baseline_cases = [baseline_by_id[case_id] for case_id in candidate_ids]
    elif baseline_ids != candidate_ids:
        raise ValueError("两份报告的 case ID 或顺序不同；若基线是超集请显式使用 --allow-baseline-superset")

    if baseline.get("result_limit") != candidate.get("result_limit"):
        raise ValueError("两份报告的 result_limit 不一致")
    if baseline.get("cutoff_date") != candidate.get("cutoff_date"):
        raise ValueError("两份报告的 cutoff_date 不一致")

    baseline_metrics = aggregate(baseline_cases)
    candidate_metrics = aggregate(candidate_cases)
    paired = compare_cases(baseline_cases, candidate_cases)
    delta = metric_deltas(baseline_metrics, candidate_metrics)
    net_gained_gold = paired["gained_gold_count"] - paired["lost_gold_count"]
    additional_api_calls = delta["academic_api_calls"]
    return {
        "suite": "LitSearch paired report comparison",
        "case_count": len(candidate_cases),
        "case_ids_sha256": hashlib.sha256("\n".join(candidate_ids).encode("utf-8")).hexdigest(),
        "result_limit": candidate.get("result_limit"),
        "cutoff_date": candidate.get("cutoff_date"),
        "baseline": {
            "search_depth": baseline.get("search_depth"),
            "source_report_case_count": baseline_source_case_count,
            "source_response_cache": baseline.get("response_cache"),
            "response_cache_matches_comparison_scope": baseline_source_case_count
            == len(candidate_cases),
            "metrics": baseline_metrics,
        },
        "candidate": {
            "search_depth": candidate.get("search_depth"),
            "source_report_case_count": candidate_source_case_count,
            "source_response_cache": candidate.get("response_cache"),
            "response_cache_matches_comparison_scope": candidate_source_case_count
            == len(candidate_cases),
            "metrics": candidate_metrics,
        },
        "delta": delta,
        "efficiency": {
            "net_gained_gold_count": net_gained_gold,
            "additional_academic_api_calls_per_case": divide(
                additional_api_calls, len(candidate_cases)
            ),
            "additional_academic_api_calls_per_net_gained_gold": (
                divide(additional_api_calls, net_gained_gold)
                if net_gained_gold > 0
                else None
            ),
            "recall_at_limit_gain_per_100_additional_api_calls": (
                divide(delta["recall_at_limit"] * 100, additional_api_calls)
                if additional_api_calls > 0
                else None
            ),
        },
        "paired": paired,
    }


def evaluate_gate(
    comparison: dict[str, Any],
    *,
    min_recall_delta: float | None = None,
    min_net_gained_gold: int | None = None,
    max_regressed_cases: int | None = None,
    max_calls_per_net_gained_gold: float | None = None,
    max_partial_failure_delta: int | None = None,
    max_p95_duration_delta_ms: int | None = None,
    max_baseline_error_cases: int | None = None,
    max_baseline_partial_failure_cases: int | None = None,
    max_candidate_error_cases: int | None = None,
    max_candidate_partial_failure_cases: int | None = None,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add_check(name: str, value: int | float | None, operator: str, threshold: int | float) -> None:
        if value is None:
            passed = False
        elif operator == ">=":
            passed = value >= threshold
        else:
            passed = value <= threshold
        checks.append(
            {
                "name": name,
                "value": value,
                "operator": operator,
                "threshold": threshold,
                "passed": passed,
            }
        )

    if min_recall_delta is not None:
        add_check("recall_at_limit_delta", comparison["delta"]["recall_at_limit"], ">=", min_recall_delta)
    if min_net_gained_gold is not None:
        add_check(
            "net_gained_gold_count",
            comparison["efficiency"]["net_gained_gold_count"],
            ">=",
            min_net_gained_gold,
        )
    if max_regressed_cases is not None:
        add_check(
            "regressed_case_count",
            comparison["paired"]["regressed_case_count"],
            "<=",
            max_regressed_cases,
        )
    if max_calls_per_net_gained_gold is not None:
        additional_calls = comparison["delta"]["academic_api_calls"]
        calls_per_gain = comparison["efficiency"][
            "additional_academic_api_calls_per_net_gained_gold"
        ]
        if additional_calls <= 0:
            calls_per_gain = 0.0
        add_check(
            "additional_academic_api_calls_per_net_gained_gold",
            calls_per_gain,
            "<=",
            max_calls_per_net_gained_gold,
        )
    if max_partial_failure_delta is not None:
        add_check(
            "partial_failure_case_count_delta",
            comparison["delta"]["partial_failure_case_count"],
            "<=",
            max_partial_failure_delta,
        )
    if max_p95_duration_delta_ms is not None:
        add_check(
            "p95_duration_ms_delta",
            comparison["delta"]["p95_duration_ms"],
            "<=",
            max_p95_duration_delta_ms,
        )
    if max_baseline_error_cases is not None:
        add_check(
            "baseline_error_case_count",
            comparison["baseline"]["metrics"]["error_case_count"],
            "<=",
            max_baseline_error_cases,
        )
    if max_baseline_partial_failure_cases is not None:
        add_check(
            "baseline_partial_failure_case_count",
            comparison["baseline"]["metrics"]["partial_failure_case_count"],
            "<=",
            max_baseline_partial_failure_cases,
        )
    if max_candidate_error_cases is not None:
        add_check(
            "candidate_error_case_count",
            comparison["candidate"]["metrics"]["error_case_count"],
            "<=",
            max_candidate_error_cases,
        )
    if max_candidate_partial_failure_cases is not None:
        add_check(
            "candidate_partial_failure_case_count",
            comparison["candidate"]["metrics"]["partial_failure_case_count"],
            "<=",
            max_candidate_partial_failure_cases,
        )
    return {
        "configured": bool(checks),
        "passed": all(check["passed"] for check in checks) if checks else None,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--allow-baseline-superset",
        action="store_true",
        help="以候选报告 case 顺序为准，从基线超集中选择同一批 case",
    )
    parser.add_argument("--min-recall-delta", type=float)
    parser.add_argument("--min-net-gained-gold", type=int)
    parser.add_argument("--max-regressed-cases", type=int)
    parser.add_argument("--max-calls-per-net-gained-gold", type=float)
    parser.add_argument("--max-partial-failure-delta", type=int)
    parser.add_argument("--max-p95-duration-delta-ms", type=int)
    parser.add_argument("--max-baseline-error-cases", type=int)
    parser.add_argument("--max-baseline-partial-failure-cases", type=int)
    parser.add_argument("--max-candidate-error-cases", type=int)
    parser.add_argument("--max-candidate-partial-failure-cases", type=int)
    parser.add_argument(
        "--fail-on-gate",
        action="store_true",
        help="任一已配置门禁失败时，在写出报告后以退出码 3 结束",
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    try:
        baseline = load_report(args.baseline)
        candidate = load_report(args.candidate)
        comparison = build_comparison(baseline, candidate, args.allow_baseline_superset)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))

    comparison["gate"] = evaluate_gate(
        comparison,
        min_recall_delta=args.min_recall_delta,
        min_net_gained_gold=args.min_net_gained_gold,
        max_regressed_cases=args.max_regressed_cases,
        max_calls_per_net_gained_gold=args.max_calls_per_net_gained_gold,
        max_partial_failure_delta=args.max_partial_failure_delta,
        max_p95_duration_delta_ms=args.max_p95_duration_delta_ms,
        max_baseline_error_cases=args.max_baseline_error_cases,
        max_baseline_partial_failure_cases=args.max_baseline_partial_failure_cases,
        max_candidate_error_cases=args.max_candidate_error_cases,
        max_candidate_partial_failure_cases=args.max_candidate_partial_failure_cases,
    )
    if args.fail_on_gate and not comparison["gate"]["configured"]:
        parser.error("--fail-on-gate 至少需要配置一个门禁阈值")

    comparison["baseline_path"] = str(args.baseline)
    comparison["candidate_path"] = str(args.candidate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"LitSearch comparison: {args.output.resolve()}")
    print(
        json.dumps(
            {
                "delta": comparison["delta"],
                "efficiency": comparison["efficiency"],
                "gate": comparison["gate"],
                "paired": comparison["paired"],
            },
            indent=2,
        )
    )
    if args.fail_on_gate and not comparison["gate"]["passed"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
