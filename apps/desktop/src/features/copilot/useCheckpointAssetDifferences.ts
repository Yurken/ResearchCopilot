import { useEffect, useState } from "react";
import { apiClient } from "../../lib/client";
import { compareCheckpointAssets, type CheckpointAssetDifference, type ResearchCheckpointHandoff } from "../research-context/checkpointHandoff";

export function useCheckpointAssetDifferences(handoff: ResearchCheckpointHandoff) {
  const [differences, setDifferences] = useState<CheckpointAssetDifference[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (handoff.source !== "asset_auto" || !handoff.contextId) {
      setDifferences([]);
      return;
    }
    if (handoff.contextType === "interest") {
      void apiClient.knowledge.listInterests().then((interests) => {
        const interest = interests.find((item) => item.id === handoff.contextId);
        if (!interest || cancelled) return;
        setDifferences(compareCheckpointAssets(handoff.assetSnapshot, {
          topic: interest.topic,
          keywords: interest.keywords ?? [],
          profile: interest.profile,
          hypothesis_card: interest.hypothesis_card,
          learning_path: interest.learning_path,
        }));
      }).catch(() => { if (!cancelled) setDifferences([]); });
    } else if (handoff.contextType === "experiment") {
      void apiClient.experiment.get(handoff.contextId).then((experiment) => {
        if (cancelled) return;
        setDifferences(compareCheckpointAssets(handoff.assetSnapshot, {
          title: experiment.title,
          config: experiment.config,
          result: experiment.result,
          notes: experiment.notes,
        }));
      }).catch(() => { if (!cancelled) setDifferences([]); });
    }
    return () => { cancelled = true; };
  }, [handoff]);

  return differences;
}
