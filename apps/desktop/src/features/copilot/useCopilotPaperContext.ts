import { useEffect, useState } from "react";
import { papersApi } from "../../lib/client";

export function useCopilotPaperContext(contextType?: string, contextId?: string) {
  const [paperTitle, setPaperTitle] = useState("");

  useEffect(() => {
    if (contextType !== "paper" || !contextId) {
      setPaperTitle("");
      return;
    }
    let cancelled = false;
    papersApi.get(contextId)
      .then((paper) => {
        if (!cancelled) setPaperTitle(paper.title);
      })
      .catch(() => {
        if (!cancelled) setPaperTitle("");
      });
    return () => {
      cancelled = true;
    };
  }, [contextId, contextType]);

  return paperTitle;
}
