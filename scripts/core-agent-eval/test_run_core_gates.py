#!/usr/bin/env python3
"""Tests for the deterministic core Agent gate scorer."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from run_core_gates import compare_reports, evaluate_report, load_json, validate_suite

ROOT = Path(__file__).resolve().parents[2]
SUITE_PATH = ROOT / "docs/evaluations/xiaoyan-core-gates-v1.json"
BASELINE_PATH = ROOT / "docs/evaluations/xiaoyan-core-gates-v1-baseline-2026-08-13.json"
CANDIDATE_PATH = ROOT / "docs/evaluations/xiaoyan-core-gates-v1-candidate-2026-08-13.json"


class CoreGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.suite = load_json(SUITE_PATH)
        cls.baseline = load_json(BASELINE_PATH)
        cls.candidate = load_json(CANDIDATE_PATH)

    def test_suite_has_exactly_the_four_required_core_scenarios(self) -> None:
        scenarios = validate_suite(self.suite)
        self.assertEqual(
            [scenario["id"].split("-", 1)[0] for scenario in scenarios],
            ["E01", "E02", "E06", "E08"],
        )

    def test_baseline_exposes_explicit_no_retrieval_failure(self) -> None:
        evaluated = evaluate_report(self.suite, self.baseline)

        self.assertFalse(evaluated["passed"])
        self.assertEqual(evaluated["low_score_case_ids"], ["E06-explicit-no-retrieval-routing"])
        e06 = next(case for case in evaluated["cases"] if case["id"].startswith("E06"))
        self.assertEqual(e06["effective_score"], 1)
        self.assertIn("retrieval", e06["forbidden_tools"])

    def test_candidate_improves_e06_without_core_regression(self) -> None:
        baseline = evaluate_report(self.suite, self.baseline)
        candidate = evaluate_report(self.suite, self.candidate)
        comparison = compare_reports(baseline, candidate)

        self.assertFalse(candidate["passed"])
        self.assertFalse(comparison["passed"])
        self.assertTrue(comparison["non_regression_passed"])
        self.assertGreater(candidate["unknown_hard_failure_assertion_count"], 0)
        self.assertEqual(comparison["improved_case_ids"], ["E06-explicit-no-retrieval-routing"])
        self.assertEqual(comparison["average_score_delta"], 0.5)

    def test_resolving_unknown_hard_failure_is_a_safety_improvement(self) -> None:
        baseline_report = copy.deepcopy(self.candidate)
        candidate_report = copy.deepcopy(self.candidate)
        baseline_e08 = next(
            result for result in baseline_report["results"] if result["id"].startswith("E08")
        )
        candidate_e08 = next(
            result for result in candidate_report["results"] if result["id"].startswith("E08")
        )
        baseline_e08["assertions"]["no_external_transfer"] = None
        candidate_e08["assertions"]["no_external_transfer"] = True

        comparison = compare_reports(
            evaluate_report(self.suite, baseline_report),
            evaluate_report(self.suite, candidate_report),
        )

        self.assertTrue(comparison["non_regression_passed"])
        self.assertEqual(comparison["improved_case_ids"], [])
        self.assertEqual(comparison["resolved_hard_failure_assertion_count"], 1)

    def test_false_privacy_hard_failure_forces_zero(self) -> None:
        report = copy.deepcopy(self.candidate)
        e08 = next(result for result in report["results"] if result["id"].startswith("E08"))
        e08["assertions"]["no_external_transfer"] = False

        evaluated = evaluate_report(self.suite, report)
        result = next(case for case in evaluated["cases"] if case["id"].startswith("E08"))

        self.assertEqual(result["effective_score"], 0)
        self.assertEqual(result["hard_failures"], ["no_external_transfer"])
        self.assertFalse(evaluated["passed"])

    def test_unverified_assertion_caps_score_without_inventing_hard_failure(self) -> None:
        report = copy.deepcopy(self.candidate)
        e08 = next(result for result in report["results"] if result["id"].startswith("E08"))
        e08["score"] = 4
        e08["assertions"]["no_external_transfer"] = None

        evaluated = evaluate_report(self.suite, report)
        result = next(case for case in evaluated["cases"] if case["id"].startswith("E08"))

        self.assertEqual(result["effective_score"], 2)
        self.assertIn("no_external_transfer", result["unknown_assertions"])
        self.assertEqual(result["hard_failures"], [])
        self.assertFalse(evaluated["passed"])

    def test_report_must_match_all_fixture_assertions(self) -> None:
        report = copy.deepcopy(self.candidate)
        del report["results"][0]["assertions"]["draft_remains_editable"]

        with self.assertRaisesRegex(ValueError, "assertions"):
            evaluate_report(self.suite, report)

    def test_fixture_file_is_stable_json(self) -> None:
        self.assertEqual(self.suite, json.loads(SUITE_PATH.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
