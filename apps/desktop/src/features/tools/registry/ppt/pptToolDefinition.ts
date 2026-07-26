import type { ToolSkillDefinition } from "../types";
import { executePptTool } from "./executePptTool";

export const pptToolDefinition: ToolSkillDefinition = {
  name: "ppt-generate",
  title: "AI 幻灯片生成",
  execute: executePptTool,
};
