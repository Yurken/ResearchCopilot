import { generatePptArtifact } from "../../pptService";
import { artifactStorage } from "../../../../features/artifacts/artifactStorage";
import type { Artifact } from "@research-copilot/types";
import type { ToolExecutionResult, ToolSkillContext } from "../types";
import { parsePptRequest } from "./pptRequestParser";

export async function executePptTool(context: ToolSkillContext): Promise<ToolExecutionResult> {
  const { userMessage, attachments = [], signal, onProgress } = context;

  const parsed = await parsePptRequest(userMessage, attachments, signal);

  const result = await generatePptArtifact(
    {
      mode: parsed.mode,
      topic: parsed.topic,
      outline: parsed.outline,
      documentName: parsed.documentName,
      documentContent: parsed.documentContent,
      style: parsed.style,
      language: parsed.language,
      pageCount: parsed.pageCount,
      audience: parsed.audience,
      scenario: parsed.scenario,
    },
    {
      sessionId: context.sessionId,
      signal,
      onProgress,
    },
  );

  const artifactId = crypto.randomUUID();
  const { artifact } = await artifactStorage.save({
    id: artifactId,
    kind: "pptx",
    name: `${result.fileBaseName}.pptx`,
    title: result.title,
    description: `${result.slideCount} 页演示文稿`,
    buffer: result.buffer,
    metadata: {
      slideCount: result.slideCount,
      style: parsed.style ?? "auto",
      language: parsed.language ?? "auto",
      scenario: parsed.scenario,
      audience: parsed.audience,
    },
  });

  const artifacts: Artifact[] = [artifact];

  return {
    content: `已根据你的要求生成 ${result.slideCount} 页《${result.title}》演示文稿。`,
    artifacts,
  };
}
