import { useEffect, useState } from "react";
import { submissionApi } from "../../lib/client";
import { rowToVersion, type PaperVersion, type Submission as SubmissionItem } from "./shared";

type VersionsBySubmission = Record<string, PaperVersion[]>;

export function useSubmissionVersions(
  submissions: SubmissionItem[],
  selectedSubmissionId: string,
  onError?: (error: unknown) => void,
) {
  const [versionsBySubmission, setVersionsBySubmission] = useState<VersionsBySubmission>({});
  const [renamingVersionId, setRenamingVersionId] = useState<string | null>(null);

  // 只在投稿 id 集合变化时重拉：看板推进/回退只改状态，不应触发对所有投稿的版本全量 N+1 重拉
  const submissionIdsKey = submissions.map((submission) => submission.id).join("\n");

  useEffect(() => {
    const submissionIds = submissionIdsKey ? submissionIdsKey.split("\n") : [];
    if (submissionIds.length === 0) {
      setVersionsBySubmission({});
      return;
    }

    let cancelled = false;

    Promise.allSettled(
      submissionIds.map(async (submissionId) => {
        const response = await submissionApi.listVersions(submissionId);
        return {
          submissionId,
          versions: (response.versions as unknown[]).map(rowToVersion),
        };
      })
    )
      .then((results) => {
        if (cancelled) {
          return;
        }

        setVersionsBySubmission((currentVersions) => {
          const nextVersions: VersionsBySubmission = {};

          results.forEach((result, index) => {
            const submissionId = submissionIds[index];
            if (!submissionId) {
              return;
            }

            if (result.status === "fulfilled") {
              nextVersions[submissionId] = result.value.versions;
              return;
            }

            onError?.(result.reason);
            nextVersions[submissionId] = currentVersions[submissionId] ?? [];
          });

          return nextVersions;
        });
      })
      .catch((error) => {
        onError?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [submissionIdsKey, onError]);

  const versions = selectedSubmissionId ? versionsBySubmission[selectedSubmissionId] ?? [] : [];
  const versionCounts = submissions.reduce<Record<string, number>>((counts, submission) => {
    counts[submission.id] = versionsBySubmission[submission.id]?.length ?? 0;
    return counts;
  }, {});

  // 版本列表统一为「最新在前」，与 submission_list_versions 的 created_at DESC 一致；
  // 新版本插入头部，避免与 DB 顺序混用导致 versions[0] 指向旧版本。
  const appendVersion = (version: PaperVersion) => {
    setVersionsBySubmission((currentVersions) => ({
      ...currentVersions,
      [version.submissionId]: [version, ...(currentVersions[version.submissionId] ?? [])],
    }));
  };

  const updateVersion = (versionId: string, updater: (version: PaperVersion) => PaperVersion) => {
    setVersionsBySubmission((currentVersions) =>
      Object.fromEntries(
        Object.entries(currentVersions).map(([submissionId, versions]) => [
          submissionId,
          versions.map((version) => (version.id === versionId ? updater(version) : version)),
        ])
      ) as VersionsBySubmission
    );
  };

  const patchVersion = async (
    versionId: string,
    patch: Partial<Pick<PaperVersion, "tag" | "label" | "stage" | "content" | "notes" | "filePath" | "fileName">>
  ) => {
    const previousVersion = Object.values(versionsBySubmission)
      .flat()
      .find((version) => version.id === versionId);
    updateVersion(versionId, (version) => ({ ...version, ...patch }));
    await submissionApi.updateVersion(versionId, patch).catch((error) => {
      if (previousVersion) {
        updateVersion(versionId, (version) => {
          const stillOptimistic = (Object.entries(patch) as Array<[keyof typeof patch, unknown]>)
            .every(([key, value]) => version[key] === value);
          return stillOptimistic ? previousVersion : version;
        });
      }
      onError?.(error);
      throw error;
    });
  };

  const renameVersion = async (versionId: string, label: string): Promise<boolean> => {
    const normalizedLabel = label.trim();
    if (!normalizedLabel || renamingVersionId) return false;
    setRenamingVersionId(versionId);
    try {
      await patchVersion(versionId, { label: normalizedLabel });
      return true;
    } catch {
      return false;
    } finally {
      setRenamingVersionId(null);
    }
  };

  return {
    versions,
    versionCounts,
    renamingVersionId,
    appendVersion,
    updateVersion,
    patchVersion,
    renameVersion,
  };
}
