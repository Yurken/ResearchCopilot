import { formatErrorMessage } from "../../../lib/client";
import { getToolSkill, hasToolSkill } from "./toolRegistry";
import type { ToolExecutionResult, ToolSkillContext } from "./types";

export class ToolSkillNotImplementedError extends Error {
  readonly toolName: string;

  constructor(name: string) {
    super(`工具技能“${name}”尚未实现`);
    this.name = "ToolSkillNotImplementedError";
    this.toolName = name;
  }
}

export async function executeToolSkill(
  name: string,
  context: ToolSkillContext,
): Promise<ToolExecutionResult> {
  if (!hasToolSkill(name)) {
    throw new ToolSkillNotImplementedError(name);
  }

  const skill = getToolSkill(name);
  if (!skill) {
    throw new ToolSkillNotImplementedError(name);
  }
  try {
    return await skill.execute(context);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    const message = formatErrorMessage(err);
    throw new Error(`执行 ${skill.title} 失败：${message}`);
  }
}
