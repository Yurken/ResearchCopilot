#!/usr/bin/env python3
"""Regression tests for deterministic LitSearch stratified manifests."""

from __future__ import annotations

import unittest

from select_stratified_sample import build_manifest


def row(case_id: str, query_set: str, specificity: int, quality: int) -> dict[str, object]:
    return {
        "id": case_id,
        "query_set": query_set,
        "specificity": specificity,
        "quality": quality,
    }


class BuildManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = [
            row("case-1", "inline", 0, 1),
            row("case-2", "inline", 0, 1),
            row("case-3", "manual", 1, 2),
            row("case-4", "manual", 1, 2),
        ]
        self.payload = b"fixture"

    def test_default_manifest_keeps_the_existing_contract(self) -> None:
        manifest = build_manifest(self.rows, self.payload, 2, 7)

        self.assertEqual(manifest["selection"], "stratified_without_replacement")
        self.assertNotIn("excluded_case_count", manifest)
        self.assertEqual(len(manifest["case_ids"]), 2)

    def test_excluded_cases_never_enter_the_holdout(self) -> None:
        manifest = build_manifest(
            self.rows,
            self.payload,
            1,
            7,
            {"case-1", "case-2"},
        )

        self.assertEqual(
            manifest["selection"], "stratified_without_replacement_after_exclusion"
        )
        self.assertEqual(manifest["excluded_case_count"], 2)
        self.assertEqual(manifest["case_ids"], ["case-4"])
        self.assertEqual(
            manifest["empty_strata_after_exclusion"],
            [
                {
                    "query_set": "inline",
                    "specificity": 0,
                    "quality": 1,
                    "original_population_count": 2,
                    "excluded_count": 2,
                }
            ],
        )

    def test_unknown_excluded_case_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "数据集中不存在"):
            build_manifest(self.rows, self.payload, 2, 7, {"missing-case"})


if __name__ == "__main__":
    unittest.main()
