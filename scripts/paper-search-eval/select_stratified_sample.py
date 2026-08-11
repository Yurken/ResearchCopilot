#!/usr/bin/env python3
"""Create a deterministic LitSearch manifest stratified by published labels."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

Stratum = tuple[str, int, int]


def load_rows(dataset: Path) -> tuple[list[dict[str, Any]], bytes]:
    payload = dataset.read_bytes()
    rows = [json.loads(line) for line in payload.splitlines() if line.strip()]
    return rows, payload


def allocate_samples(groups: dict[Stratum, list[dict[str, Any]]], size: int) -> dict[Stratum, int]:
    keys = sorted(groups)
    if size < len(keys):
        raise ValueError(f"样本数 {size} 小于非空分层数 {len(keys)}，无法保证每层至少一条")
    population = sum(len(groups[key]) for key in keys)
    if size > population:
        raise ValueError(f"样本数 {size} 超过数据集总数 {population}")

    allocations = {key: 1 for key in keys}
    remaining = size - len(keys)
    residual_population = population - len(keys)
    if remaining == 0:
        return allocations

    fractional: list[tuple[float, Stratum]] = []
    assigned = 0
    for key in keys:
        capacity = len(groups[key]) - 1
        exact = remaining * capacity / residual_population
        extra = min(capacity, math.floor(exact))
        allocations[key] += extra
        assigned += extra
        fractional.append((exact - extra, key))

    for _, key in sorted(fractional, key=lambda item: (-item[0], item[1])):
        if assigned >= remaining:
            break
        if allocations[key] < len(groups[key]):
            allocations[key] += 1
            assigned += 1

    if sum(allocations.values()) != size:
        raise RuntimeError("分层配额计算未达到目标样本数")
    return allocations


def load_manifest_case_ids(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    case_ids = payload.get("case_ids")
    if not isinstance(case_ids, list) or not all(isinstance(case_id, str) for case_id in case_ids):
        raise ValueError(f"排除清单缺少有效 case_ids：{path}")
    return set(case_ids)


def build_manifest(
    rows: list[dict[str, Any]],
    dataset_payload: bytes,
    size: int,
    seed: int,
    excluded_case_ids: set[str] | None = None,
) -> dict[str, Any]:
    excluded_case_ids = excluded_case_ids or set()
    known_case_ids = {row["id"] for row in rows}
    unknown_excluded_ids = excluded_case_ids - known_case_ids
    if unknown_excluded_ids:
        raise ValueError(f"排除清单包含 {len(unknown_excluded_ids)} 个数据集中不存在的 case ID")
    original_groups: dict[Stratum, list[dict[str, Any]]] = defaultdict(list)
    groups: dict[Stratum, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = (row["query_set"], int(row["specificity"]), int(row["quality"]))
        original_groups[key].append(row)
        if row["id"] in excluded_case_ids:
            continue
        groups[key].append(row)

    allocations = allocate_samples(groups, size)
    rng = random.Random(seed)
    selected_ids: list[str] = []
    strata = []
    for key in sorted(groups):
        selected = rng.sample(groups[key], allocations[key])
        selected_ids.extend(row["id"] for row in selected)
        strata.append(
            {
                "query_set": key[0],
                "specificity": key[1],
                "quality": key[2],
                "population_count": len(groups[key]),
                "sample_count": allocations[key],
            }
        )

    selected_ids.sort()
    manifest = {
        "suite": "LitSearch",
        "selection": "stratified_without_replacement",
        "stratification_fields": ["query_set", "specificity", "quality"],
        "seed": seed,
        "sample_count": size,
        "dataset_sha256": hashlib.sha256(dataset_payload).hexdigest(),
        "case_ids": selected_ids,
        "strata": strata,
    }
    if excluded_case_ids:
        manifest["selection"] = "stratified_without_replacement_after_exclusion"
        manifest["excluded_case_count"] = len(excluded_case_ids)
        manifest["excluded_case_ids_sha256"] = hashlib.sha256(
            "\n".join(sorted(excluded_case_ids)).encode("utf-8")
        ).hexdigest()
        manifest["empty_strata_after_exclusion"] = [
            {
                "query_set": key[0],
                "specificity": key[1],
                "quality": key[2],
                "original_population_count": len(original_groups[key]),
                "excluded_count": len(original_groups[key]),
            }
            for key in sorted(original_groups)
            if key not in groups
        ]
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/evaluations/litsearch/query.jsonl"),
    )
    parser.add_argument("--samples", type=int, default=80)
    parser.add_argument("--seed", type=int, default=20260809)
    parser.add_argument(
        "--exclude-first",
        type=int,
        default=0,
        help="排除数据集开头 N 条，适合隔离已经使用过的连续基线",
    )
    parser.add_argument(
        "--exclude-manifest",
        action="append",
        type=Path,
        default=[],
        help="排除一个已有清单中的 case_ids；可重复传入",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/evaluations/litsearch-stratified-80-seed-20260809.json"),
    )
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    rows, payload = load_rows(args.dataset)
    if args.exclude_first < 0 or args.exclude_first > len(rows):
        parser.error(f"--exclude-first 必须在 0 到 {len(rows)} 之间")
    excluded_case_ids = {row["id"] for row in rows[: args.exclude_first]}
    for manifest_path in args.exclude_manifest:
        if not manifest_path.is_file():
            parser.error(f"排除清单不存在：{manifest_path}")
        try:
            excluded_case_ids.update(load_manifest_case_ids(manifest_path))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            parser.error(str(error))
    manifest = build_manifest(rows, payload, args.samples, args.seed, excluded_case_ids)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"LitSearch stratified manifest: {args.output.resolve()}")
    print(json.dumps({"sample_count": manifest["sample_count"], "strata": manifest["strata"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
