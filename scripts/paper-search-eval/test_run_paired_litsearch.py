#!/usr/bin/env python3
"""Regression tests for the matched LitSearch experiment runner."""

from __future__ import annotations

import unittest
from pathlib import Path

from run_paired_litsearch import PairRunConfig, build_commands, output_paths


def option_value(command: list[str], option: str) -> str:
    return command[command.index(option) + 1]


class PairRunnerTests(unittest.TestCase):
    def config(self, gate_enabled: bool = True) -> PairRunConfig:
        return PairRunConfig(
            dataset=Path("dataset.jsonl"),
            case_manifest=Path("manifest.json"),
            samples=12,
            offset=24,
            candidate_depth="balanced",
            result_limit=20,
            cutoff="2024-07-01",
            cache_dir=Path("cache"),
            gold_metadata=Path("gold.jsonl"),
            output_dir=Path("reports"),
            run_name="holdout-batch-3",
            offline=True,
            gate_enabled=gate_enabled,
        )

    def test_baseline_and_candidate_share_the_exact_slice(self) -> None:
        config = self.config()
        commands = build_commands(config)

        for option in (
            "--dataset",
            "--case-manifest",
            "--samples",
            "--offset",
            "--result-limit",
            "--cutoff",
            "--cache-dir",
            "--gold-metadata",
        ):
            self.assertEqual(
                option_value(commands["baseline"], option),
                option_value(commands["candidate"], option),
            )
        self.assertEqual(option_value(commands["baseline"], "--depth"), "quick")
        self.assertEqual(option_value(commands["candidate"], "--depth"), "balanced")
        self.assertIn("--offline", commands["baseline"])
        self.assertIn("--offline", commands["candidate"])

    def test_default_gate_is_forwarded_to_the_comparator(self) -> None:
        commands = build_commands(self.config())
        comparison = commands["comparison"]

        self.assertEqual(option_value(comparison, "--min-recall-delta"), "0.1")
        self.assertEqual(option_value(comparison, "--max-regressed-cases"), "0")
        self.assertEqual(option_value(comparison, "--max-calls-per-net-gained-gold"), "6.0")
        self.assertIn("--fail-on-gate", comparison)

    def test_no_gate_omits_all_gate_arguments(self) -> None:
        comparison = build_commands(self.config(gate_enabled=False))["comparison"]

        self.assertNotIn("--min-recall-delta", comparison)
        self.assertNotIn("--fail-on-gate", comparison)

    def test_output_names_are_stable_and_depth_specific(self) -> None:
        paths = output_paths(self.config())

        self.assertEqual(paths["baseline"], Path("reports/holdout-batch-3-quick.json"))
        self.assertEqual(paths["candidate"], Path("reports/holdout-batch-3-balanced.json"))
        self.assertEqual(paths["comparison"], Path("reports/holdout-batch-3-paired.json"))


if __name__ == "__main__":
    unittest.main()
