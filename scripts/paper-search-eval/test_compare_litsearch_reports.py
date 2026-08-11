#!/usr/bin/env python3
"""Regression tests for paired LitSearch report comparisons."""

from __future__ import annotations

import unittest

from compare_litsearch_reports import build_comparison, evaluate_gate


def case(
    case_id: str,
    corpus_id: int,
    hit: int,
    api_calls: int,
    duration_ms: int,
    discovered_via: str = "search",
) -> dict[str, object]:
    returned_papers = []
    if hit:
        returned_papers.append(
            {
                "corpus_id": corpus_id,
                "discovered_via": discovered_via,
                "title": f"paper {corpus_id}",
            }
        )
    return {
        "id": case_id,
        "query": f"query {case_id}",
        "gold_corpus_ids": [corpus_id],
        "returned_count": 20,
        "returned_papers": returned_papers,
        "hits_at_5": hit,
        "hits_at_10": hit,
        "hits_at_limit": hit,
        "academic_api_calls": api_calls,
        "llm_calls": 0,
        "estimated_tokens": 0,
        "duration_ms": duration_ms,
        "error": None,
        "partial_failures": [],
    }


def report(cases: list[dict[str, object]], depth: str) -> dict[str, object]:
    return {
        "cases": cases,
        "result_limit": 20,
        "cutoff_date": "2024-07-01",
        "search_depth": depth,
        "response_cache": {"offline": True},
    }


class BuildComparisonTests(unittest.TestCase):
    def test_paired_comparison_reports_gain_cost_and_source(self) -> None:
        baseline = report(
            [
                case("extra", 9, 0, 2, 1),
                case("a", 1, 0, 2, 10),
                case("b", 2, 1, 2, 20),
            ],
            "quick",
        )
        candidate = report(
            [
                case("a", 1, 1, 6, 30, "full_text_snippet"),
                case("b", 2, 1, 6, 40, "search+full_text_snippet"),
            ],
            "balanced",
        )

        comparison = build_comparison(baseline, candidate, True)

        self.assertEqual(comparison["baseline"]["metrics"]["hits_at_limit"], 1)
        self.assertEqual(comparison["candidate"]["metrics"]["hits_at_limit"], 2)
        self.assertEqual(comparison["delta"]["recall_at_limit"], 0.5)
        self.assertEqual(comparison["delta"]["academic_api_calls"], 8)
        self.assertEqual(comparison["efficiency"]["net_gained_gold_count"], 1)
        self.assertEqual(
            comparison["efficiency"]["additional_academic_api_calls_per_net_gained_gold"],
            8.0,
        )
        self.assertFalse(comparison["baseline"]["response_cache_matches_comparison_scope"])
        self.assertTrue(comparison["candidate"]["response_cache_matches_comparison_scope"])
        self.assertEqual(comparison["paired"]["improved_case_ids"], ["a"])
        self.assertEqual(
            comparison["paired"]["gained_gold_discovered_via"],
            {"full_text_snippet": 1},
        )

    def test_case_mismatch_requires_explicit_superset_mode(self) -> None:
        baseline = report([case("a", 1, 0, 2, 10), case("b", 2, 0, 2, 10)], "quick")
        candidate = report([case("a", 1, 1, 6, 20)], "balanced")

        with self.assertRaisesRegex(ValueError, "case ID"):
            build_comparison(baseline, candidate, False)

    def test_result_limit_mismatch_is_rejected(self) -> None:
        baseline = report([case("a", 1, 0, 2, 10)], "quick")
        candidate = report([case("a", 1, 1, 6, 20)], "balanced")
        candidate["result_limit"] = 10

        with self.assertRaisesRegex(ValueError, "result_limit"):
            build_comparison(baseline, candidate, False)

    def test_gold_mismatch_is_rejected(self) -> None:
        baseline = report([case("a", 1, 0, 2, 10)], "quick")
        candidate = report([case("a", 2, 1, 6, 20)], "balanced")

        with self.assertRaisesRegex(ValueError, "gold_corpus_ids"):
            build_comparison(baseline, candidate, False)

    def test_quality_cost_gate_reports_each_check(self) -> None:
        baseline = report([case("a", 1, 0, 2, 10), case("b", 2, 0, 2, 10)], "quick")
        candidate = report(
            [
                case("a", 1, 1, 4, 20, "full_text_snippet"),
                case("b", 2, 0, 4, 20),
            ],
            "balanced",
        )
        comparison = build_comparison(baseline, candidate, False)

        passing = evaluate_gate(
            comparison,
            min_recall_delta=0.5,
            min_net_gained_gold=1,
            max_regressed_cases=0,
            max_calls_per_net_gained_gold=4,
            max_partial_failure_delta=0,
            max_baseline_error_cases=0,
            max_candidate_error_cases=0,
        )
        failing = evaluate_gate(comparison, max_calls_per_net_gained_gold=3)

        self.assertTrue(passing["passed"])
        self.assertEqual(len(passing["checks"]), 7)
        self.assertFalse(failing["passed"])


if __name__ == "__main__":
    unittest.main()
