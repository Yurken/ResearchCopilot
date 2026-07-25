import { describe, expect, it } from "vitest";
import { mapExperimentRecord } from "../../features/experiment/shared";

describe("mapExperimentRecord", () => {
  it("统一解析数据库行和 JSON 配置", () => {
    expect(mapExperimentRecord({
      id: "experiment-1",
      title: "Ablation",
      config: '{"seed":42}',
      defaultWorkingDir: "/project",
      created_at: "2026-07-22",
      updated_at: "2026-07-22",
    })).toMatchObject({
      id: "experiment-1",
      config: { seed: 42 },
      defaultWorkingDir: "/project",
      createdAt: "2026-07-22",
    });
  });
});
