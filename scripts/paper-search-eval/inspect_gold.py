#!/usr/bin/env python3
"""Inspect LitSearch gold-paper metadata, using the local snapshot by default."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from pathlib import Path


def local_api_key() -> str:
    explicit = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if explicit:
        return explicit
    database = Path.home() / "Library/Application Support/com.researchcopilot.desktop/research_copilot.db"
    if not database.exists():
        return ""
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        row = connection.execute(
            "SELECT value FROM settings WHERE key = ?",
            ("semantic_scholar_api_key",),
        ).fetchone()
    finally:
        connection.close()
    return row[0].strip() if row and isinstance(row[0], str) else ""


def fetch_paper(corpus_id: int, api_key: str) -> dict[str, object]:
    paper_id = urllib.parse.quote(f"CorpusId:{corpus_id}", safe=":")
    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}"
        "?fields=corpusId,title,abstract,year,venue"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "xiaoyan-paper-search-eval/1"})
    if api_key:
        request.add_header("x-api-key", api_key)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    abstract = payload.get("abstract") or ""
    return {
        "corpus_id": corpus_id,
        "title": payload.get("title"),
        "year": payload.get("year"),
        "venue": payload.get("venue"),
        "abstract_excerpt": abstract[:500],
    }


def load_gold_metadata(path: Path) -> dict[int, dict[str, object]]:
    if not path.exists():
        return {}
    return {
        int(row["original_corpus_id"]): row
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
        for row in [json.loads(line)]
    }


def snapshot_paper(corpus_id: int, metadata: dict[int, dict[str, object]]) -> dict[str, object]:
    row = metadata.get(corpus_id, {})
    return {
        "original_corpus_id": corpus_id,
        "paper_id": row.get("paper_id"),
        "corpus_id": row.get("corpus_id"),
        "title": row.get("title"),
        "external_ids": row.get("external_ids"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument(
        "--gold-metadata",
        type=Path,
        default=Path("data/evaluations/litsearch/gold_metadata.jsonl"),
    )
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument(
        "--online-details",
        action="store_true",
        help="Fetch abstracts, year, and venue from Semantic Scholar instead of using the snapshot.",
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    records = [
        json.loads(line)
        for line in args.dataset.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ][args.offset : args.offset + args.samples]
    metadata = load_gold_metadata(args.gold_metadata)
    if not metadata and not args.online_details:
        raise FileNotFoundError(
            f"Gold metadata snapshot not found: {args.gold_metadata}. "
            "Run `pnpm eval:paper-search:gold` first."
        )
    api_key = local_api_key() if args.online_details else ""
    output = []
    for record in records:
        output.append(
            {
                "id": record["id"],
                "query": record["query"],
                "gold_papers": [
                    fetch_paper(corpus_id, api_key)
                    if args.online_details
                    else snapshot_paper(corpus_id, metadata)
                    for corpus_id in record["corpusids"]
                ],
            }
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Gold metadata lookup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
