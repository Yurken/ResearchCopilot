import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { submissionApi } from "../../lib/client";
import {
  DEFAULT_CHECKLIST,
  rowToChecklistItem,
  type ChecklistItem,
  type Submission,
} from "./shared";

export function useSubmissionChecklist(submissions: Submission[], onError?: (error: unknown) => void) {
  const [checklistSubId, setChecklistSubId] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [checklistCat, setChecklistCat] = useState<string>("all");
  const reloadRequestRef = useRef(0);

  const reloadChecklist = useCallback(() => {
    const requestId = reloadRequestRef.current + 1;
    reloadRequestRef.current = requestId;
    if (!checklistSubId) {
      setChecklist(DEFAULT_CHECKLIST);
      return Promise.resolve();
    }

    return submissionApi
      .getChecklist(checklistSubId)
      .then((response) => {
        if (reloadRequestRef.current !== requestId) {
          return;
        }
        const items = response.checklist.map(rowToChecklistItem);
        setChecklist(items.length > 0 ? items : DEFAULT_CHECKLIST);
      })
      .catch((error) => {
        if (reloadRequestRef.current === requestId) {
          onError?.(error);
          setChecklist(DEFAULT_CHECKLIST);
        }
      });
  }, [checklistSubId, onError]);

  useEffect(() => {
    const firstSubmissionId = submissions[0]?.id ?? "";
    if (!firstSubmissionId) {
      if (checklistSubId) {
        setChecklistSubId("");
      }
      return;
    }

    if (!checklistSubId || !submissions.some((submission) => submission.id === checklistSubId)) {
      setChecklistSubId(firstSubmissionId);
    }
  }, [checklistSubId, submissions]);

  useEffect(() => {
    void reloadChecklist();
  }, [reloadChecklist]);

  useEffect(() => {
    setChecklistCat("all");
  }, [checklistSubId]);

  const toggleCheck = (id: string) => {
    const item = checklist.find((entry) => entry.id === id);
    if (!item) {
      return;
    }

    setChecklist((currentChecklist) =>
      currentChecklist.map((entry) => (entry.id === id ? { ...entry, checked: !entry.checked } : entry))
    );

    if (checklistSubId) {
      submissionApi.toggleChecklist(id).catch((error) => {
        onError?.(error);
        // 仅当当前值仍是本次乐观值时才回滚，避免覆盖后续成功操作的结果
        setChecklist((currentChecklist) =>
          currentChecklist.map((entry) =>
            entry.id === id && entry.checked === !item.checked ? { ...entry, checked: item.checked } : entry
          )
        );
      });
    }
  };

  const resetChecklist = () => {
    const checkedItems = checklist.filter((item) => item.checked);
    setChecklist((currentChecklist) => currentChecklist.map((item) => ({ ...item, checked: false })));

    if (!checklistSubId || checkedItems.length === 0) {
      return;
    }

    Promise.all(checkedItems.map((item) => submissionApi.toggleChecklist(item.id))).catch((error) => {
      onError?.(error);
      // 仅回滚仍处于重置后未勾选状态的项，避免覆盖用户在请求期间的新操作
      setChecklist((currentChecklist) =>
        currentChecklist.map((item) =>
          !item.checked && checkedItems.some((checkedItem) => checkedItem.id === item.id)
            ? { ...item, checked: true }
            : item
        )
      );
    });
  };

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(checklist.map((item) => item.category)))],
    [checklist]
  );
  const filteredChecklist = useMemo(
    () => (checklistCat === "all" ? checklist : checklist.filter((item) => item.category === checklistCat)),
    [checklist, checklistCat]
  );
  const visibleCategories = useMemo(
    () =>
      checklistCat === "all"
        ? Array.from(new Set(checklist.map((item) => item.category)))
        : [checklistCat],
    [checklist, checklistCat]
  );
  const checkedCount = checklist.filter((item) => item.checked).length;
  const progress = checklist.length > 0 ? Math.round((checkedCount / checklist.length) * 100) : 0;

  return {
    checklist,
    checklistCat,
    checklistSubId,
    categories,
    visibleCategories,
    filteredChecklist,
    checkedCount,
    progress,
    setChecklistCat,
    setChecklistSubId,
    toggleCheck,
    resetChecklist,
    reloadChecklist,
  };
}
