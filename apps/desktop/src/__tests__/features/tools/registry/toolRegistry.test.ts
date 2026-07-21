import { describe, it, expect } from "vitest";
import { getToolSkill, hasToolSkill } from "../../../../features/tools/registry/toolRegistry";
import { executeToolSkill, ToolSkillNotImplementedError } from "../../../../features/tools/registry/executeToolSkill";

describe("Tool Registry", () => {
  it("应包含 ppt-generate 工具技能", () => {
    expect(hasToolSkill("ppt-generate")).toBe(true);
    const skill = getToolSkill("ppt-generate");
    expect(skill).toBeDefined();
    expect(skill?.name).toBe("ppt-generate");
    expect(skill?.title).toBe("AI 幻灯片生成");
  });

  it("不存在的工具技能返回 undefined", () => {
    expect(hasToolSkill("not-exist")).toBe(false);
    expect(getToolSkill("not-exist")).toBeUndefined();
  });

  it("执行不存在的工具技能抛出 ToolSkillNotImplementedError", async () => {
    await expect(
      executeToolSkill("not-exist", { userMessage: "test" }),
    ).rejects.toThrow(ToolSkillNotImplementedError);
  });
});
