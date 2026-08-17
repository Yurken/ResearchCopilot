#!/usr/bin/env python3
"""Validate and compare versioned E01/E02/E06/E08 core-gate reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REQUIRED_CASE_FIELDS = {
    "id",
    "version",
    "fixture_type",
    "preconditions",
    "user_input",
    "expected_context",
    "forbidden_context",
    "expected_tools",
    "forbidden_tools",
    "expected_evidence",
    "assertions",
    "privacy_assertions",
    "hard_failure_assertions",
    "scoring_notes",
}
REQUIRED_CORE_PREFIXES = {"E01", "E02", "E06", "E08"}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON 根节点必须是对象：{path}")
    return value


def _unique_strings(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f"{label} 必须是非空字符串组成的数组")
    if len(set(value)) != len(value):
        raise ValueError(f"{label} 包含重复项")
    return value


def validate_suite(suite: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(suite.get("suite_id"), str) or not suite["suite_id"]:
        raise ValueError("评测集缺少 suite_id")
    if not isinstance(suite.get("version"), int) or suite["version"] < 1:
        raise ValueError("评测集 version 必须是正整数")
    if suite.get("fixture_type") != "synthetic":
        raise ValueError("核心门禁只允许提交 synthetic 夹具")

    scenarios = suite.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("评测集缺少 scenarios")

    scenario_ids: list[str] = []
    prefixes: set[str] = set()
    for index, scenario in enumerate(scenarios):
        if not isinstance(scenario, dict):
            raise ValueError(f"scenarios[{index}] 必须是对象")
        missing = sorted(REQUIRED_CASE_FIELDS - scenario.keys())
        if missing:
            raise ValueError(f"scenarios[{index}] 缺少字段：{missing}")
        if scenario.get("fixture_type") != "synthetic":
            raise ValueError(f"场景 {scenario.get('id')} 不是 synthetic 夹具")

        case_id = scenario.get("id")
        if not isinstance(case_id, str) or "-" not in case_id:
            raise ValueError(f"scenarios[{index}] 的 id 无效")
        scenario_ids.append(case_id)
        prefixes.add(case_id.split("-", 1)[0])
        for field in (
            "preconditions",
            "expected_context",
            "forbidden_context",
            "expected_tools",
            "forbidden_tools",
            "expected_evidence",
            "assertions",
            "privacy_assertions",
            "hard_failure_assertions",
        ):
            _unique_strings(scenario[field], f"{case_id}.{field}")
        unknown_hard_failures = set(scenario["hard_failure_assertions"]) - (
            set(scenario["assertions"]) | set(scenario["privacy_assertions"])
        )
        if unknown_hard_failures:
            raise ValueError(f"{case_id} 的 hard_failure_assertions 未在断言中声明：{sorted(unknown_hard_failures)}")

    if len(set(scenario_ids)) != len(scenario_ids):
        raise ValueError("评测集包含重复场景 ID")
    if prefixes != REQUIRED_CORE_PREFIXES:
        raise ValueError(
            f"核心门禁必须且只能覆盖 {sorted(REQUIRED_CORE_PREFIXES)}，当前为 {sorted(prefixes)}"
        )
    return scenarios


def evaluate_report(suite: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    scenarios = validate_suite(suite)
    if report.get("suite_id") != suite["suite_id"]:
        raise ValueError("报告 suite_id 与评测集不一致")
    if report.get("suite_version") != suite["version"]:
        raise ValueError("报告 suite_version 与评测集不一致")
    run = report.get("run")
    if not isinstance(run, dict):
        raise ValueError("报告缺少 run 元数据")
    for field in ("run_id", "date", "candidate", "evaluation_mode", "model_fingerprint"):
        if not isinstance(run.get(field), str) or not run[field]:
            raise ValueError(f"报告 run.{field} 不能为空")

    results = report.get("results")
    if not isinstance(results, list):
        raise ValueError("报告 results 必须是数组")
    by_id = {result.get("id"): result for result in results if isinstance(result, dict)}
    expected_ids = [scenario["id"] for scenario in scenarios]
    if set(by_id) != set(expected_ids) or len(results) != len(expected_ids):
        raise ValueError("报告必须与评测集场景一一对应，且不能包含重复或额外场景")

    evaluated: list[dict[str, Any]] = []
    for scenario in scenarios:
        result = by_id[scenario["id"]]
        score = result.get("score")
        if not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 4:
            raise ValueError(f"{scenario['id']} 的 score 必须是 0—4 整数")
        assertions = result.get("assertions")
        if not isinstance(assertions, dict):
            raise ValueError(f"{scenario['id']} 缺少 assertions 对象")
        expected_assertions = set(scenario["assertions"]) | set(scenario["privacy_assertions"])
        if set(assertions) != expected_assertions or any(
            value is not None and not isinstance(value, bool) for value in assertions.values()
        ):
            raise ValueError(
                f"{scenario['id']} 的 assertions 必须完整对应夹具，值只能是 true、false 或 null（未验证）"
            )

        observed_context = set(_unique_strings(result.get("observed_context"), f"{scenario['id']}.observed_context"))
        observed_tools = set(_unique_strings(result.get("observed_tools"), f"{scenario['id']}.observed_tools"))
        observed_evidence = set(_unique_strings(result.get("observed_evidence"), f"{scenario['id']}.observed_evidence"))
        explicit_hard_failures = _unique_strings(result.get("hard_failures"), f"{scenario['id']}.hard_failures")
        unknown_explicit_hard_failures = set(explicit_hard_failures) - set(
            scenario["hard_failure_assertions"]
        )
        if unknown_explicit_hard_failures:
            raise ValueError(
                f"{scenario['id']} 报告了夹具未声明的 hard_failures：{sorted(unknown_explicit_hard_failures)}"
            )

        missing_context = sorted(set(scenario["expected_context"]) - observed_context)
        forbidden_context = sorted(set(scenario["forbidden_context"]) & observed_context)
        missing_tools = sorted(set(scenario["expected_tools"]) - observed_tools)
        forbidden_tools = sorted(set(scenario["forbidden_tools"]) & observed_tools)
        missing_evidence = sorted(set(scenario["expected_evidence"]) - observed_evidence)
        unknown_assertions = sorted(key for key, passed in assertions.items() if passed is None)
        failed_assertions = sorted(key for key, passed in assertions.items() if passed is False)
        inferred_hard_failures = sorted(
            assertion
            for assertion in scenario["hard_failure_assertions"]
            if assertions[assertion] is False
        )
        hard_failures = sorted(set(explicit_hard_failures) | set(inferred_hard_failures))

        effective_score = score
        if hard_failures:
            effective_score = 0
        elif forbidden_context or forbidden_tools:
            effective_score = min(effective_score, 1)
        elif (
            missing_context
            or missing_tools
            or missing_evidence
            or failed_assertions
            or unknown_assertions
        ):
            effective_score = min(effective_score, 2)

        evaluated.append(
            {
                "id": scenario["id"],
                "reported_score": score,
                "effective_score": effective_score,
                "missing_context": missing_context,
                "forbidden_context": forbidden_context,
                "missing_tools": missing_tools,
                "forbidden_tools": forbidden_tools,
                "missing_evidence": missing_evidence,
                "failed_assertions": failed_assertions,
                "unknown_assertions": unknown_assertions,
                "hard_failures": hard_failures,
            }
        )

    score_total = sum(item["effective_score"] for item in evaluated)
    hard_failure_count = sum(len(item["hard_failures"]) for item in evaluated)
    hard_failure_assertions_by_id = {
        scenario["id"]: set(scenario["hard_failure_assertions"])
        for scenario in scenarios
    }
    unknown_hard_failure_assertion_count = sum(
        len(
            set(item["unknown_assertions"])
            & hard_failure_assertions_by_id[item["id"]]
        )
        for item in evaluated
    )
    low_score_case_ids = [item["id"] for item in evaluated if item["effective_score"] < 2]
    return {
        "suite_id": suite["suite_id"],
        "suite_version": suite["version"],
        "run": run,
        "case_count": len(evaluated),
        "case_ids_sha256": hashlib.sha256("\n".join(expected_ids).encode("utf-8")).hexdigest(),
        "average_score": score_total / len(evaluated),
        "hard_failure_count": hard_failure_count,
        "unknown_hard_failure_assertion_count": unknown_hard_failure_assertion_count,
        "low_score_case_ids": low_score_case_ids,
        "passed": hard_failure_count == 0
        and unknown_hard_failure_assertion_count == 0
        and not low_score_case_ids,
        "cases": evaluated,
    }


def compare_reports(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    if baseline["suite_id"] != candidate["suite_id"] or baseline["suite_version"] != candidate["suite_version"]:
        raise ValueError("基线与候选不属于同一评测集版本")
    baseline_by_id = {case["id"]: case for case in baseline["cases"]}
    candidate_by_id = {case["id"]: case for case in candidate["cases"]}
    if set(baseline_by_id) != set(candidate_by_id):
        raise ValueError("基线与候选场景不一致")

    deltas = []
    for case_id in baseline_by_id:
        baseline_score = baseline_by_id[case_id]["effective_score"]
        candidate_score = candidate_by_id[case_id]["effective_score"]
        deltas.append(
            {
                "id": case_id,
                "baseline_score": baseline_score,
                "candidate_score": candidate_score,
                "delta": candidate_score - baseline_score,
            }
        )
    regressed_over_one = [item["id"] for item in deltas if item["delta"] < -1]
    improved = [item["id"] for item in deltas if item["delta"] > 0]
    resolved_hard_failure_assertion_count = max(
        0,
        baseline["unknown_hard_failure_assertion_count"]
        - candidate["unknown_hard_failure_assertion_count"],
    )
    quality_or_safety_improves = bool(improved) or resolved_hard_failure_assertion_count > 0
    non_regression_checks = {
        "candidate_has_no_hard_failures": candidate["hard_failure_count"] == 0,
        "candidate_has_no_low_score_cases": not candidate["low_score_case_ids"],
        "average_score_does_not_regress": candidate["average_score"] >= baseline["average_score"],
        "no_core_case_regresses_over_one_point": not regressed_over_one,
        "quality_or_safety_evidence_improves": quality_or_safety_improves,
    }
    completeness_checks = {
        "candidate_has_no_unknown_hard_failure_assertions": candidate[
            "unknown_hard_failure_assertion_count"
        ]
        == 0,
    }
    checks = {**non_regression_checks, **completeness_checks}
    return {
        "suite_id": baseline["suite_id"],
        "suite_version": baseline["suite_version"],
        "baseline_run_id": baseline["run"]["run_id"],
        "candidate_run_id": candidate["run"]["run_id"],
        "baseline_average_score": baseline["average_score"],
        "candidate_average_score": candidate["average_score"],
        "average_score_delta": candidate["average_score"] - baseline["average_score"],
        "resolved_hard_failure_assertion_count": resolved_hard_failure_assertion_count,
        "improved_case_ids": improved,
        "regressed_over_one_case_ids": regressed_over_one,
        "checks": checks,
        "non_regression_passed": all(non_regression_checks.values()),
        "passed": all(checks.values()),
        "case_deltas": deltas,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--suite",
        type=Path,
        default=Path("docs/evaluations/xiaoyan-core-gates-v1.json"),
    )
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        suite = load_json(args.suite)
        candidate = evaluate_report(suite, load_json(args.report))
        output: dict[str, Any] = {"candidate": candidate}
        if args.baseline:
            baseline = evaluate_report(suite, load_json(args.baseline))
            output["baseline"] = baseline
            output["comparison"] = compare_reports(baseline, candidate)
            passed = output["comparison"]["passed"]
        else:
            passed = candidate["passed"]
        output["passed"] = passed
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"核心门禁输入无效：{error}", file=sys.stderr)
        return 2

    rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if passed else 3


if __name__ == "__main__":
    raise SystemExit(main())
