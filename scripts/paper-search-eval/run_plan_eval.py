#!/usr/bin/env python3
"""Run the deterministic query-planning stage against all LitSearch queries."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tmp/paper-search-eval/litsearch-plan-report.json"),
    )
    parser.add_argument(
        "--case-manifest",
        type=Path,
        help="只评测清单中的 case_ids，并保持清单顺序",
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    if not args.dataset.exists():
        print(
            "未找到标准化数据集。请先运行 `pnpm eval:paper-search:prepare`。",
            file=sys.stderr,
        )
        return 2
    if args.case_manifest is not None and not args.case_manifest.is_file():
        parser.error(f"样本清单不存在：{args.case_manifest}")

    env = os.environ.copy()
    env.update(
        {
            "PAPER_SEARCH_PLAN_EVAL_DATASET": str(args.dataset.resolve()),
            "PAPER_SEARCH_PLAN_EVAL_OUTPUT": str(args.output.resolve()),
        }
    )
    if args.case_manifest is not None:
        env["PAPER_SEARCH_PLAN_EVAL_CASE_MANIFEST"] = str(args.case_manifest.resolve())
    command = [
        "cargo",
        "test",
        "offline_litsearch_plan_eval",
        "--lib",
        "--",
        "--ignored",
        "--nocapture",
        "--test-threads=1",
    ]
    return subprocess.run(
        command,
        cwd=Path("apps/desktop/src-tauri"),
        env=env,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
