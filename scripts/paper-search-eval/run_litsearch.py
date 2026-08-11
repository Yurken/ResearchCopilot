#!/usr/bin/env python3
"""Run the real Xiaoyan paper-search pipeline against a LitSearch slice."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

LOCAL_LLM_SETTING_KEYS = (
    "multi_agent_literature_scout_base_url",
    "multi_agent_literature_scout_api_key",
    "multi_agent_literature_scout_model",
    "multi_agent_literature_scout_temperature",
    "copilot_simple_base_url",
    "copilot_simple_api_key",
    "copilot_simple_model",
    "copilot_simple_temperature",
    "llm_provider",
    "openai_base_url",
    "openai_api_key",
    "openai_chat_model",
    "anthropic_api_key",
    "anthropic_chat_model",
    "openai_compatible_base_url",
    "openai_compatible_api_key",
    "openai_compatible_chat_model",
)


def resolve_local_db() -> Path | None:
    explicit = os.environ.get("RC_DB_PATH", "").strip()
    if explicit:
        return Path(explicit)
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/com.researchcopilot.desktop/research_copilot.db"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "").strip()
        return Path(appdata) / "com.researchcopilot.desktop/research_copilot.db" if appdata else None
    base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "com.researchcopilot.desktop/research_copilot.db"


def load_local_settings(keys: tuple[str, ...]) -> dict[str, str]:
    database = resolve_local_db()
    if database is None or not database.exists():
        return {}
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        placeholders = ",".join("?" for _ in keys)
        rows = connection.execute(
            f"SELECT key, value FROM settings WHERE key IN ({placeholders})",
            keys,
        ).fetchall()
    finally:
        connection.close()
    return {
        key: value.strip()
        for key, value in rows
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }


def load_local_semantic_scholar_key() -> str:
    return load_local_settings(("semantic_scholar_api_key",)).get("semantic_scholar_api_key", "")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument("--samples", type=int)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument(
        "--case-manifest",
        type=Path,
        help="包含 case_ids 的固定样本清单；可配合 --samples 与 --offset 分批执行",
    )
    parser.add_argument("--depth", choices=["quick", "balanced", "deep"], default="quick")
    parser.add_argument("--result-limit", type=int, default=20)
    parser.add_argument("--cutoff", default="2024-07-01")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/evaluations/paper-search-cache/semantic-scholar"),
        help="成功的 Semantic Scholar JSON 响应缓存目录",
    )
    parser.add_argument(
        "--gold-metadata",
        type=Path,
        default=Path("data/evaluations/litsearch/gold_metadata.jsonl"),
        help="LitSearch gold 的当前 Semantic Scholar 规范 ID 快照",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="禁用评测响应缓存",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="只使用已有缓存；缺失任一响应即失败",
    )
    parser.add_argument(
        "--no-local-api-key",
        action="store_true",
        help="不从小妍本地数据库只读复用 Semantic Scholar API Key",
    )
    parser.add_argument(
        "--with-local-llm",
        action="store_true",
        help="显式复用小妍本地论文检索/主模型配置；可能产生模型 API 费用",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tmp/paper-search-eval/litsearch-report.json"),
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    if args.offline and args.no_cache:
        parser.error("--offline 不能与 --no-cache 同时使用")

    selected_case_ids: list[str] = []
    if args.case_manifest:
        if not args.case_manifest.exists():
            parser.error(f"样本清单不存在：{args.case_manifest}")
        manifest = json.loads(args.case_manifest.read_text(encoding="utf-8"))
        selected_case_ids = manifest.get("case_ids", [])
        if not selected_case_ids or not all(isinstance(case_id, str) for case_id in selected_case_ids):
            parser.error("样本清单必须包含非空字符串数组 case_ids")
        if len(selected_case_ids) != len(set(selected_case_ids)):
            parser.error("样本清单 case_ids 不能重复")
        manifest_offset = max(0, args.offset)
        manifest_limit = max(1, args.samples) if args.samples is not None else None
        selected_case_ids = selected_case_ids[
            manifest_offset : manifest_offset + manifest_limit if manifest_limit else None
        ]
        if not selected_case_ids:
            parser.error("--offset / --samples 在样本清单中选出了空切片")

    if not args.dataset.exists():
        print(
            "未找到标准化数据集。请先运行 `pnpm eval:paper-search:prepare`。",
            file=sys.stderr,
        )
        return 2
    if not args.gold_metadata.exists():
        print(
            "未找到 gold 规范 ID 快照；请先运行 `pnpm eval:paper-search:gold`。将暂时按原始 Corpus ID 评分。",
            file=sys.stderr,
        )

    env = os.environ.copy()
    if (
        not args.offline
        and not env.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
        and not args.no_local_api_key
    ):
        local_key = load_local_semantic_scholar_key()
        if local_key:
            env["SEMANTIC_SCHOLAR_API_KEY"] = local_key
            print("Using Semantic Scholar API key from Xiaoyan's local read-only settings.")
    env.update(
        {
            "PAPER_SEARCH_EVAL_DATASET": str(args.dataset.resolve()),
            "PAPER_SEARCH_EVAL_OUTPUT": str(args.output.resolve()),
            "PAPER_SEARCH_EVAL_SAMPLES": str(len(selected_case_ids) or max(1, args.samples or 5)),
            "PAPER_SEARCH_EVAL_OFFSET": str(0 if selected_case_ids else max(0, args.offset)),
            "PAPER_SEARCH_EVAL_DEPTH": args.depth,
            "PAPER_SEARCH_EVAL_RESULT_LIMIT": str(min(50, max(1, args.result_limit))),
            "PAPER_SEARCH_EVAL_CUTOFF": args.cutoff,
        }
    )
    if selected_case_ids:
        env["PAPER_SEARCH_EVAL_CASE_IDS"] = ",".join(selected_case_ids)
        env["PAPER_SEARCH_EVAL_CASE_MANIFEST"] = str(args.case_manifest.resolve())
    if not args.no_cache:
        env["PAPER_SEARCH_EVAL_CACHE_DIR"] = str(args.cache_dir.resolve())
    if args.gold_metadata.exists():
        env["PAPER_SEARCH_EVAL_GOLD_METADATA"] = str(args.gold_metadata.resolve())
    if args.offline:
        env["PAPER_SEARCH_EVAL_OFFLINE"] = "1"
    if args.with_local_llm:
        llm_settings = load_local_settings(LOCAL_LLM_SETTING_KEYS)
        if not llm_settings:
            parser.error("未找到可用的小妍本地 LLM 配置")
        env["PAPER_SEARCH_EVAL_LLM_SETTINGS"] = json.dumps(llm_settings)
        print("Using Xiaoyan's local read-only LLM settings for planning and reranking.")
    command = [
        "cargo",
        "test",
        "live_litsearch_eval",
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
