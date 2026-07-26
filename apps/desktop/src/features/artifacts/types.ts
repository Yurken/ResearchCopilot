import type { Artifact } from "@research-copilot/types";

export type { Artifact };

export interface ArtifactSaveInput {
  id: string;
  kind: Artifact["kind"];
  name: string;
  title?: string;
  description?: string;
  buffer: ArrayBuffer;
  metadata?: Record<string, unknown>;
}

export interface ArtifactSaveResult {
  artifact: Artifact;
}
