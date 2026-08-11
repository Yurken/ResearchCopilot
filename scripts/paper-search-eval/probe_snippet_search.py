#!/usr/bin/env python3
"""Measure Semantic Scholar full-text snippet recall on a fixed LitSearch slice."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

from run_litsearch import load_local_semantic_scholar_key

SNIPPET_URL = "https://api.semanticscholar.org/graph/v1/snippet/search"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def selected_cases(
    dataset: list[dict[str, Any]], manifest_path: Path | None, offset: int, samples: int | None
) -> list[dict[str, Any]]:
    if manifest_path:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        case_ids = manifest.get("case_ids", [])
        by_id = {row["id"]: row for row in dataset}
        missing = [case_id for case_id in case_ids if case_id not in by_id]
        if missing:
            raise ValueError(f"样本清单含未知 case id：{missing[:3]}")
        rows = [by_id[case_id] for case_id in case_ids]
    else:
        rows = dataset
    start = max(0, offset)
    end = start + max(1, samples) if samples is not None else None
    return rows[start:end]


def gold_aliases(rows: list[dict[str, Any]]) -> dict[int, set[int]]:
    aliases: dict[int, set[int]] = defaultdict(set)
    for row in rows:
        original = int(row["original_corpus_id"])
        aliases[original].add(original)
        if row.get("corpus_id") is not None:
            aliases[original].add(int(row["corpus_id"]))
    return aliases


def cache_path(cache_dir: Path, query: str, cutoff: str, limit: int) -> Path:
    key = f"semantic-scholar-snippet-v1|{query}|:{cutoff}|{limit}"
    return cache_dir / f"{hashlib.sha256(key.encode()).hexdigest()}.json"


def fetch_snippets(
    query: str,
    cutoff: str,
    limit: int,
    api_key: str,
    cache_dir: Path,
    offline: bool,
) -> tuple[dict[str, Any], bool]:
    path = cache_path(cache_dir, query, cutoff, limit)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")), True
    if offline:
        raise FileNotFoundError(f"离线 snippet 缓存缺失：{path}")

    params = urllib.parse.urlencode(
        {"query": query, "limit": limit, "publicationDateOrYear": f":{cutoff}"}
    )
    request = urllib.request.Request(
        f"{SNIPPET_URL}?{params}",
        headers={"User-Agent": "xiaoyan-paper-search-eval/0.5.2", "x-api-key": api_key},
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read())
            cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return payload, False
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise
            retry_after = error.headers.get("Retry-After", "")
            wait = int(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1)
            time.sleep(min(30, max(2, wait)))
    raise RuntimeError(f"snippet search 失败：{last_error}")


def hit_count(returned: list[int], gold: list[set[int]], limit: int) -> int:
    returned_at_limit = set(returned[:limit])
    return sum(1 for aliases in gold if aliases & returned_at_limit)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path("data/evaluations/litsearch/query.jsonl"))
    parser.add_argument(
        "--gold-metadata",
        type=Path,
        default=Path("data/evaluations/litsearch/gold_metadata.jsonl"),
    )
    parser.add_argument("--case-manifest", type=Path)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--samples", type=int)
    parser.add_argument("--cutoff", default="2024-07-01")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--no-local-api-key", action="store_true")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/evaluations/paper-search-cache/semantic-scholar-snippets"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tmp/paper-search-eval/litsearch-snippet-report.json"),
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    dataset = read_jsonl(args.dataset)
    cases = selected_cases(dataset, args.case_manifest, args.offset, args.samples)
    if not cases:
        parser.error("选定的 snippet 样本为空")
    metadata = gold_aliases(read_jsonl(args.gold_metadata))
    api_key = "" if args.no_local_api_key or args.offline else load_local_semantic_scholar_key()
    if not args.offline and not api_key:
        parser.error("未找到 Semantic Scholar API Key")

    results = []
    cache_hits = 0
    cache_misses = 0
    for index, case in enumerate(cases, start=1):
        gold = [metadata.get(int(value), {int(value)}) for value in case["corpusids"]]
        error = None
        returned: list[int] = []
        titles: list[str] = []
        try:
            payload, cached = fetch_snippets(
                case["query"], args.cutoff, args.limit, api_key, args.cache_dir, args.offline
            )
            cache_hits += int(cached)
            cache_misses += int(not cached)
            for item in payload.get("data") or []:
                paper = item.get("paper") or {}
                corpus_id = paper.get("corpusId")
                if corpus_id is None:
                    continue
                returned.append(int(corpus_id))
                titles.append(str(paper.get("title") or ""))
        except Exception as exception:  # keep the rest of a fixed batch inspectable
            error = str(exception)
            cache_misses += 1
        row = {
            "id": case["id"],
            "query_set": case["query_set"],
            "specificity": case["specificity"],
            "quality": case["quality"],
            "gold_count": len(case["corpusids"]),
            "returned_corpus_ids": returned,
            "returned_titles": titles,
            "hits_at_5": hit_count(returned, gold, 5),
            "hits_at_10": hit_count(returned, gold, 10),
            "hits_at_20": hit_count(returned, gold, 20),
            "error": error,
        }
        results.append(row)
        print(f"[{index}/{len(cases)}] {case['id']}: hit@20={row['hits_at_20']}", flush=True)

    successful = [row for row in results if row["error"] is None]
    total_gold = sum(row["gold_count"] for row in successful)
    metrics = {
        "successful_count": len(successful),
        "gold_count": total_gold,
        "hits_at_5": sum(row["hits_at_5"] for row in successful),
        "hits_at_10": sum(row["hits_at_10"] for row in successful),
        "hits_at_20": sum(row["hits_at_20"] for row in successful),
    }
    for cutoff in (5, 10, 20):
        metrics[f"recall_at_{cutoff}"] = metrics[f"hits_at_{cutoff}"] / max(1, total_gold)
    report = {
        "suite": "LitSearch Semantic Scholar snippet probe",
        "case_manifest_path": str(args.case_manifest.resolve()) if args.case_manifest else None,
        "sample_offset": args.offset,
        "sample_count": len(cases),
        "cutoff_date": args.cutoff,
        "result_limit": args.limit,
        "metrics": metrics,
        "response_cache": {"hits": cache_hits, "misses": cache_misses, "offline": args.offline},
        "cases": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Snippet report: {args.output.resolve()}")
    print(json.dumps(metrics, indent=2))
    return 0 if successful else 1


if __name__ == "__main__":
    raise SystemExit(main())
