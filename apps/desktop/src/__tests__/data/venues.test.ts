import { describe, expect, it } from "vitest";
import type { CcfEntry } from "@research-copilot/types";
import {
  buildVenueTemplatesFromCcfCatalog,
  filterVenueTemplates,
  type VenueTemplate,
} from "../../data/venues";

const templates: VenueTemplate[] = [
  {
    id: "tpami",
    name: "TPAMI",
    fullName: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    type: "journal",
    ccf: "A",
    area: "人工智能",
    publisher: "IEEE",
  },
  {
    id: "acl",
    name: "ACL",
    fullName: "Annual Meeting of the Association for Computational Linguistics",
    type: "conference",
    ccf: "A",
    area: "人工智能",
  },
];

describe("filterVenueTemplates", () => {
  it("按跨字段的多个关键词筛选刊会", () => {
    const result = filterVenueTemplates({
      area: "all",
      query: "IEEE TPAMI",
      templates,
      type: "all",
    });

    expect(result.map((venue) => venue.name)).toEqual(["TPAMI"]);
  });

  it("同时应用搜索、领域和类型筛选", () => {
    const result = filterVenueTemplates({
      area: "人工智能",
      query: "CCF A 期刊",
      templates,
      type: "journal",
    });

    expect(result.map((venue) => venue.name)).toEqual(["TPAMI"]);
  });
});

describe("buildVenueTemplatesFromCcfCatalog", () => {
  it("为跨领域重名刊会生成唯一标识", () => {
    const duplicatedLabels: CcfEntry[] = [
      {
        kind: "journal",
        rating: "A",
        area: "计算机网络",
        label: "TCC",
        full_name: "IEEE Transactions on Cloud Computing",
        publisher: "IEEE",
        url: "",
      },
      {
        kind: "conference",
        rating: "C",
        area: "网络与信息安全",
        label: "TCC",
        full_name: "Theory of Cryptography Conference",
        publisher: "Springer",
        url: "",
      },
    ];

    const result = buildVenueTemplatesFromCcfCatalog(duplicatedLabels);

    expect(new Set(result.map((venue) => venue.id))).toHaveLength(result.length);
  });
});
