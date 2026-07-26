import type { ToolSkillDefinition } from "./types";
import { pptToolDefinition } from "./ppt/pptToolDefinition";

const registry = new Map<string, ToolSkillDefinition>();

export function registerToolSkill(definition: ToolSkillDefinition) {
  registry.set(definition.name, definition);
}

export function getToolSkill(name: string): ToolSkillDefinition | undefined {
  return registry.get(name);
}

export function hasToolSkill(name: string): boolean {
  return registry.has(name);
}

registerToolSkill(pptToolDefinition);
