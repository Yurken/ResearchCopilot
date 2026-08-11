#!/usr/bin/env python3
"""Download/verify LitSearch queries and normalize them to JSONL for Rust evals."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

LITSEARCH_REVISION = "cf3021a3bd442c7c334dca78b9c8b7da170c6a1b"
LITSEARCH_URL = (
    "https://huggingface.co/datasets/princeton-nlp/LitSearch/resolve/"
    f"{LITSEARCH_REVISION}/query/full-00000-of-00001.parquet?download=true"
)
LITSEARCH_SHA256 = "38cdbe4a6b7a7f5776d08055bfbf6e4511000aa2a523866592b4bb273388b914"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: Path) -> None:
    source.parent.mkdir(parents=True, exist_ok=True)
    partial = source.with_suffix(f"{source.suffix}.partial")
    print(f"Downloading {LITSEARCH_URL}")
    try:
        urllib.request.urlretrieve(LITSEARCH_URL, partial)
    except Exception as error:
        partial.unlink(missing_ok=True)
        raise RuntimeError(
            "LitSearch 下载失败。可从官方 Hugging Face 文件页手动下载查询 Parquet，"
            f"保存到 {source} 后重新运行。原始错误：{error}"
        ) from error
    partial.replace(source)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("data/evaluations/litsearch/query.parquet"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()

    if args.force_download or not args.source.exists():
        download(args.source)

    actual_sha = sha256(args.source)
    if actual_sha != LITSEARCH_SHA256:
        raise RuntimeError(
            f"LitSearch SHA-256 不匹配：expected={LITSEARCH_SHA256} actual={actual_sha}"
        )

    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise RuntimeError(
            "缺少 pyarrow。请使用 `uv run --with pyarrow python "
            "scripts/paper-search-eval/prepare_dataset.py`。"
        ) from error

    table = parquet.read_table(args.source)
    required = {"query_set", "query", "specificity", "quality", "corpusids"}
    missing = required.difference(table.column_names)
    if missing:
        raise RuntimeError(f"LitSearch 缺少字段：{sorted(missing)}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output:
        for index, row in enumerate(table.to_pylist()):
            record = {
                "id": f"litsearch-{index:04d}",
                "query_set": row["query_set"],
                "query": row["query"],
                "specificity": row["specificity"],
                "quality": row["quality"],
                "corpusids": row["corpusids"],
            }
            output.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "source": str(args.source),
                "output": str(args.output),
                "sha256": actual_sha,
                "rows": table.num_rows,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
