import type { Artifact } from "@research-copilot/types";

export type ToolProgressStage =
  | "parsing"
  | "planning"
  | "drafting"
  | "repairing"
  | "building"
  | "saving"
  | "completed";

export interface ToolProgress {
  stage: ToolProgressStage;
  message: string;
}

export interface ToolSkillContext {
  sessionId?: string;
  userMessage: string;
  attachments?: ToolAttachment[];
  signal?: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
}

export interface ToolAttachment {
  name: string;
  extension: string;
  mediaTypeLabel: string;
  content: string;
  kind?: "text" | "image";
  imageData?: string;
  imageMediaType?: string;
}

export interface ToolExecutionResult {
  content: string;
  artifacts: Artifact[];
}

export interface ToolSkillDefinition {
  name: string;
  title: string;
  execute(context: ToolSkillContext): Promise<ToolExecutionResult>;
}
