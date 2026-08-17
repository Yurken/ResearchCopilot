#!/usr/bin/env python3
"""Resolve LitSearch corpus IDs to current Semantic Scholar paper identities."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_URL = "https://api.semanticscholar.org/graph/v1/paper/batch"
FIELDS = "paperId,corpusId,title,externalIds"
BATCH_SIZE = 500


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


def load_local_semantic_scholar_key() -> str:
    database = resolve_local_db()
    if database is None or not database.exists():
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


def load_corpus_ids(dataset: Path) -> list[int]:
    values: set[int] = set()
    with dataset.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                values.update(int(value) for value in json.loads(line)["corpusids"])
    return sorted(values)


def fetch_batch(corpus_ids: list[int], api_key: str) -> list[dict | None]:
    query = urllib.parse.urlencode({"fields": FIELDS})
    body = json.dumps({"ids": [f"CorpusId:{value}" for value in corpus_ids]}).encode()
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "xiaoyan-paper-search-eval/0.5.3",
    }
    if api_key:
        headers["x-api-key"] = api_key
    request = urllib.request.Request(
        f"{API_URL}?{query}", data=body, headers=headers, method="POST"
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            retry_after = error.headers.get("Retry-After", "").strip()
            wait_seconds = int(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1)
            time.sleep(min(30, max(2, wait_seconds)))
    raise RuntimeError("Semantic Scholar batch request exhausted retries")


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
        default=Path("data/evaluations/litsearch/gold_metadata.jsonl"),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/evaluations/paper-search-cache/gold-metadata"),
    )
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--no-local-api-key", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    if not args.dataset.exists():
        print("未找到 LitSearch JSONL，请先运行 `pnpm eval:paper-search:prepare`。", file=sys.stderr)
        return 2

    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if not api_key and not args.no_local_api_key:
        api_key = load_local_semantic_scholar_key()
        if api_key:
            print("Using Semantic Scholar API key from Xiaoyan's local read-only settings.")

    corpus_ids = load_corpus_ids(args.dataset)
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    resolved: list[dict] = []
    for start in range(0, len(corpus_ids), BATCH_SIZE):
        batch = corpus_ids[start : start + BATCH_SIZE]
        digest = hashlib.sha256(
            (FIELDS + "|" + ",".join(map(str, batch))).encode()
        ).hexdigest()
        cache_path = args.cache_dir / f"{digest}.json"
        if cache_path.exists() and not args.refresh:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
        else:
            payload = fetch_batch(batch, api_key)
            cache_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        if len(payload) != len(batch):
            raise RuntimeError("Semantic Scholar batch response length mismatch")
        for original_corpus_id, paper in zip(batch, payload, strict=True):
            resolved.append(
                {
                    "original_corpus_id": original_corpus_id,
                    "paper_id": paper.get("paperId") if paper else None,
                    "corpus_id": paper.get("corpusId") if paper else None,
                    "title": paper.get("title") if paper else None,
                    "external_ids": paper.get("externalIds") if paper else None,
                }
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in resolved),
        encoding="utf-8",
    )
    resolved_count = sum(1 for row in resolved if row["paper_id"])
    print(f"Gold metadata: {args.output}")
    print(f"Corpus IDs: {len(resolved)}; resolved: {resolved_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
