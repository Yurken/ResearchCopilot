#!/usr/bin/env python3
"""Run matched LitSearch baseline/candidate evaluations and enforce a quality-cost gate."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[1]


@dataclass(frozen=True)
class PairRunConfig:
    dataset: Path
    case_manifest: Path
    samples: int
    offset: int
    candidate_depth: str
    result_limit: int
    cutoff: str
    cache_dir: Path
    gold_metadata: Path
    output_dir: Path
    run_name: str
    offline: bool = False
    no_cache: bool = False
    no_local_api_key: bool = False
    with_local_llm: bool = False
    gate_enabled: bool = True
    min_recall_delta: float = 0.10
    min_net_gained_gold: int = 1
    max_regressed_cases: int = 0
    max_calls_per_net_gained_gold: float = 6.0
    max_partial_failure_delta: int = 0
    max_baseline_error_cases: int = 0
    max_baseline_partial_failure_cases: int = 0
    max_candidate_error_cases: int = 0
    max_candidate_partial_failure_cases: int = 0


def output_paths(config: PairRunConfig) -> dict[str, Path]:
    return {
        "baseline": config.output_dir / f"{config.run_name}-quick.json",
        "candidate": config.output_dir / f"{config.run_name}-{config.candidate_depth}.json",
        "comparison": config.output_dir / f"{config.run_name}-paired.json",
    }


def litsearch_command(config: PairRunConfig, depth: str, output: Path) -> list[str]:
    command = [
        sys.executable,
        str(SCRIPT_DIR / "run_litsearch.py"),
        "--dataset",
        str(config.dataset),
        "--case-manifest",
        str(config.case_manifest),
        "--samples",
        str(config.samples),
        "--offset",
        str(config.offset),
        "--depth",
        depth,
        "--result-limit",
        str(config.result_limit),
        "--cutoff",
        config.cutoff,
        "--cache-dir",
        str(config.cache_dir),
        "--gold-metadata",
        str(config.gold_metadata),
        "--output",
        str(output),
    ]
    if config.offline:
        command.append("--offline")
    if config.no_cache:
        command.append("--no-cache")
    if config.no_local_api_key:
        command.append("--no-local-api-key")
    if config.with_local_llm:
        command.append("--with-local-llm")
    return command


def comparison_command(config: PairRunConfig, paths: dict[str, Path]) -> list[str]:
    command = [
        sys.executable,
        str(SCRIPT_DIR / "compare_litsearch_reports.py"),
        "--baseline",
        str(paths["baseline"]),
        "--candidate",
        str(paths["candidate"]),
        "--output",
        str(paths["comparison"]),
    ]
    if config.gate_enabled:
        command.extend(
            [
                "--min-recall-delta",
                str(config.min_recall_delta),
                "--min-net-gained-gold",
                str(config.min_net_gained_gold),
                "--max-regressed-cases",
                str(config.max_regressed_cases),
                "--max-calls-per-net-gained-gold",
                str(config.max_calls_per_net_gained_gold),
                "--max-partial-failure-delta",
                str(config.max_partial_failure_delta),
                "--max-baseline-error-cases",
                str(config.max_baseline_error_cases),
                "--max-baseline-partial-failure-cases",
                str(config.max_baseline_partial_failure_cases),
                "--max-candidate-error-cases",
                str(config.max_candidate_error_cases),
                "--max-candidate-partial-failure-cases",
                str(config.max_candidate_partial_failure_cases),
                "--fail-on-gate",
            ]
        )
    return command


def build_commands(config: PairRunConfig) -> dict[str, list[str]]:
    paths = output_paths(config)
    return {
        "baseline": litsearch_command(config, "quick", paths["baseline"]),
        "candidate": litsearch_command(config, config.candidate_depth, paths["candidate"]),
        "comparison": comparison_command(config, paths),
    }


def validate_config(config: PairRunConfig, overwrite: bool, dry_run: bool) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", config.run_name):
        raise ValueError("--run-name 只能包含字母、数字、点、下划线和连字符")
    if config.samples < 1:
        raise ValueError("--samples 必须大于 0")
    if config.offset < 0:
        raise ValueError("--offset 不能为负数")
    if config.offline and config.no_cache:
        raise ValueError("--offline 不能与 --no-cache 同时使用")
    for label, path in (
        ("数据集", config.dataset),
        ("样本清单", config.case_manifest),
        ("gold 元数据", config.gold_metadata),
    ):
        if not path.is_file():
            raise ValueError(f"{label}不存在：{path}")
    if not overwrite and not dry_run:
        existing = [path for path in output_paths(config).values() if path.exists()]
        if existing:
            raise ValueError(f"输出已存在；更换 --run-name 或显式传 --overwrite：{existing[0]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument("--case-manifest", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=12)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--candidate-depth", choices=["balanced", "deep"], default="balanced")
    parser.add_argument("--result-limit", type=int, default=20)
    parser.add_argument("--cutoff", default="2024-07-01")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/evaluations/paper-search-cache/semantic-scholar"),
    )
    parser.add_argument(
        "--gold-metadata",
        type=Path,
        default=Path("data/evaluations/litsearch/gold_metadata.jsonl"),
    )
    parser.add_argument("--output-dir", type=Path, default=Path("docs/evolution-runs"))
    parser.add_argument("--run-name", required=True)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--no-local-api-key", action="store_true")
    parser.add_argument("--with-local-llm", action="store_true")
    parser.add_argument("--no-gate", action="store_true")
    parser.add_argument("--min-recall-delta", type=float, default=0.10)
    parser.add_argument("--min-net-gained-gold", type=int, default=1)
    parser.add_argument("--max-regressed-cases", type=int, default=0)
    parser.add_argument("--max-calls-per-net-gained-gold", type=float, default=6.0)
    parser.add_argument("--max-partial-failure-delta", type=int, default=0)
    parser.add_argument("--max-baseline-error-cases", type=int, default=0)
    parser.add_argument("--max-baseline-partial-failure-cases", type=int, default=0)
    parser.add_argument("--max-candidate-error-cases", type=int, default=0)
    parser.add_argument("--max-candidate-partial-failure-cases", type=int, default=0)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    config = PairRunConfig(
        dataset=args.dataset,
        case_manifest=args.case_manifest,
        samples=args.samples,
        offset=args.offset,
        candidate_depth=args.candidate_depth,
        result_limit=args.result_limit,
        cutoff=args.cutoff,
        cache_dir=args.cache_dir,
        gold_metadata=args.gold_metadata,
        output_dir=args.output_dir,
        run_name=args.run_name,
        offline=args.offline,
        no_cache=args.no_cache,
        no_local_api_key=args.no_local_api_key,
        with_local_llm=args.with_local_llm,
        gate_enabled=not args.no_gate,
        min_recall_delta=args.min_recall_delta,
        min_net_gained_gold=args.min_net_gained_gold,
        max_regressed_cases=args.max_regressed_cases,
        max_calls_per_net_gained_gold=args.max_calls_per_net_gained_gold,
        max_partial_failure_delta=args.max_partial_failure_delta,
        max_baseline_error_cases=args.max_baseline_error_cases,
        max_baseline_partial_failure_cases=args.max_baseline_partial_failure_cases,
        max_candidate_error_cases=args.max_candidate_error_cases,
        max_candidate_partial_failure_cases=args.max_candidate_partial_failure_cases,
    )
    try:
        validate_config(config, args.overwrite, args.dry_run)
    except ValueError as error:
        parser.error(str(error))

    paths = output_paths(config)
    commands = build_commands(config)
    if args.dry_run:
        print(
            json.dumps(
                {
                    "outputs": {key: str(path) for key, path in paths.items()},
                    "commands": commands,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    config.output_dir.mkdir(parents=True, exist_ok=True)
    for stage in ("baseline", "candidate", "comparison"):
        print(f"\n[{stage}] {' '.join(commands[stage])}", flush=True)
        result = subprocess.run(commands[stage], cwd=REPOSITORY_ROOT, check=False)
        if result.returncode != 0:
            return result.returncode
    print(f"Paired LitSearch report: {paths['comparison'].resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
