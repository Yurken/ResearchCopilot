import { describe, expect, it } from "vitest";
import { toReviewerResult } from "../../../features/submission/useAiSubmissionReview";

describe("toReviewerResult", () => {
  it("展示证据定位并容忍模型返回代码块", () => {
    const result = toReviewerResult({
      submissionId: "submission-1",
      index: 0,
      reviewer: "方法与创新审稿人",
      focus: "方法",
      raw: `\`\`\`json
{"summary":"方法摘要","strengths":["定义清楚"],"evidence_locations":["Sec. 3 方法定义"],"weaknesses":["缺少消融"],"questions":[],"suggestions":["补消融"],"verdict":"weak_reject"}
\`\`\``,
    });

    expect(result.content).toContain("**证据定位：**");
    expect(result.content).toContain("Sec. 3 方法定义");
    expect(result.verdict).toBe("major_revision");
    expect(result.suggestions).toEqual(["补消融"]);
    expect(result.id).toBe("submission-1:0");
  });

  it("无效 JSON 保留原文作为可见降级", () => {
    const result = toReviewerResult({
      submissionId: "submission-1",
      index: 0,
      reviewer: "领域主席",
      focus: "综合",
      raw: "模型暂未返回结构化结果",
    });

    expect(result.content).toBe("模型暂未返回结构化结果");
    expect(result.verdict).toBe("major_revision");
    expect(result.suggestions).toEqual([]);
  });
});
