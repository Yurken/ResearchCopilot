import { apiClient } from "../../lib/client";
import type { ArtifactSaveInput, ArtifactSaveResult } from "./types";
import type { Artifact } from "@research-copilot/types";

export const artifactStorage = {
  async save(input: ArtifactSaveInput): Promise<ArtifactSaveResult> {
    const bytes = Array.from(new Uint8Array(input.buffer));
    const result = await apiClient.artifact.save({
      id: input.id,
      kind: input.kind,
      name: input.name,
      title: input.title,
      description: input.description,
      bytes,
      metadata: input.metadata,
    });
    return { artifact: result };
  },

  async open(artifact: Artifact): Promise<void> {
    await apiClient.artifact.open(artifact.id, artifact.localPath);
  },

  async reveal(artifact: Artifact): Promise<void> {
    await apiClient.artifact.reveal(artifact.id, artifact.localPath);
  },

  async saveAs(artifact: Artifact): Promise<boolean> {
    return await apiClient.artifact.saveAs(artifact.id, artifact.localPath);
  },

  async delete(artifact: Artifact): Promise<void> {
    await apiClient.artifact.delete(artifact.id, artifact.localPath);
  },
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
