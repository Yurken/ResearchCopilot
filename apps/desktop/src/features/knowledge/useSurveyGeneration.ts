import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Paper, ResearchInterest } from "@research-copilot/types";
import { apiClient, formatErrorMessage } from "../../lib/client";
import {
  citationFormatLabel,
  normalizeSurveyPaperLimit,
  SURVEY_DEFAULT_MAX_PAPERS,
  validateSurveyGenerationInput,
  type SurveyGenerationController,
  type StructuredSurveyResult,
  type SurveyAgentState,
} from "./shared";
import { createSurveyRequestId, registerSurveyEventListeners } from "./surveyEvents";
import {
  clearSurveyGenerationResult,
  hasSurveyGenerationResultState,
} from "./surveyDraftState";
import {
  clearSurveyRunSnapshot,
  failSurveyRunSnapshot,
  resumeSurveyRunSnapshot,
  startSurveyRunSnapshot,
  useActiveSurveyRunSnapshot,
  useSurveyRunEventBridge,
} from "./useSurveyRunSnapshots";

export function useSurveyGeneration(): SurveyGenerationController {
  useSurveyRunEventBridge();
  const runSnapshot = useActiveSurveyRunSnapshot();
  const [interests, setInterests] = useState<ResearchInterest[]>([]);
  const [selectedInterestId, setSelectedInterestId] = useState("");
  const [interestPapers, setInterestPapers] = useState<Paper[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(false);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxPapers, setMaxPapers] = useState(String(SURVEY_DEFAULT_MAX_PAPERS));
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [litTypes, setLitTypes] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [citationFormat, setCitationFormat] = useState("gbt7714");
  const [language, setLanguage] = useState("both");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [agents, setAgents] = useState<SurveyAgentState[]>([]);
  const [structured, setStructured] = useState<StructuredSurveyResult | null>(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [copying, setCopying] = useState(false);
  const contentRef = useRef("");
  const requestIdRef = useRef<string | null>(null);
  const unlistenersRef = useRef<Array<() => void>>([]);
  const restoredPaperIdsRef = useRef<string[] | null>(null);
  const cleanupSurveyListeners = useCallback(() => {
    unlistenersRef.current.forEach((cleanup) => cleanup());
    unlistenersRef.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.knowledge
      .listInterests()
      .then((data) => {
        if (!cancelled) setInterests(data);
      })
      .catch(() => {
        if (!cancelled) setInterests([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedInterestId) {
      setInterestPapers([]);
      setSelectedPaperIds([]);
      return;
    }

    let cancelled = false;
    setLoadingPapers(true);
    apiClient.papers
      .list(0, 200, selectedInterestId)
      .then((data) => {
        if (cancelled) return;
        setInterestPapers(data);
        if (restoredPaperIdsRef.current) {
          setSelectedPaperIds(restoredPaperIdsRef.current);
          restoredPaperIdsRef.current = null;
        } else {
          setSelectedPaperIds(data.map((paper) => paper.id));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setInterestPapers([]);
        setSelectedPaperIds([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPapers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedInterestId]);

  useEffect(() => cleanupSurveyListeners, [cleanupSurveyListeners]);

  useEffect(() => {
    if (!runSnapshot) return;
    requestIdRef.current = runSnapshot.requestId;
    contentRef.current = runSnapshot.content;
    setQuery(runSnapshot.query);
    setMaxPapers(String(runSnapshot.maxPapers));
    setTimeFrom(runSnapshot.timeFrom ? String(runSnapshot.timeFrom) : "");
    setTimeTo(runSnapshot.timeTo ? String(runSnapshot.timeTo) : "");
    setLitTypes(runSnapshot.litTypes);
    setDatabases(runSnapshot.databases);
    setCitationFormat(runSnapshot.citationFormat);
    setLanguage(runSnapshot.language);
    setSelectedInterestId(runSnapshot.selectedInterestId ?? "");
    restoredPaperIdsRef.current = runSnapshot.paperIds ?? null;
    setSelectedPaperIds(runSnapshot.paperIds ?? []);
    setContent(runSnapshot.content);
    setAgents(runSnapshot.agents);
    setStructured(runSnapshot.structured);
    setError(runSnapshot.error ?? "");
    setGenerating(runSnapshot.status === "running");
  }, [runSnapshot]);

  const effectiveMaxPapers = useMemo(() => {
    return normalizeSurveyPaperLimit(maxPapers).value ?? SURVEY_DEFAULT_MAX_PAPERS;
  }, [maxPapers]);

  const hasSessionResult = hasSurveyGenerationResultState({ agents, structured, content, error });

  const resetCurrentResult = useCallback(() => {
    if (generating || (!hasSessionResult && !runSnapshot)) return;
    clearSurveyGenerationResult({
      cleanupSurveyListeners,
      clearSnapshot: clearSurveyRunSnapshot,
      contentRef,
      requestIdRef,
      setContent,
      setAgents,
      setStructured,
      setError,
      setActionMessage,
      setActionError,
      setGenerating,
    });
  }, [cleanupSurveyListeners, error, generating, hasSessionResult, runSnapshot, structured, content, agents]);

  const selectInterest = useCallback(
    (id: string) => {
      if (id !== selectedInterestId) resetCurrentResult();
      setSelectedInterestId(id);
      const interest = interests.find((item) => item.id === id);
      if (interest) setQuery(interest.topic);
    },
    [interests, resetCurrentResult, selectedInterestId],
  );

  const togglePaper = useCallback((id: string) => {
    resetCurrentResult();
    setSelectedPaperIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, [resetCurrentResult]);

  const toggleAllPapers = useCallback(() => {
    resetCurrentResult();
    setSelectedPaperIds((prev) => (prev.length === interestPapers.length ? [] : interestPapers.map((paper) => paper.id)));
  }, [interestPapers, resetCurrentResult]);

  const toggleLitType = useCallback((value: string) => {
    resetCurrentResult();
    setLitTypes((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  }, [resetCurrentResult]);

  const toggleDatabase = useCallback((value: string) => {
    resetCurrentResult();
    setDatabases((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  }, [resetCurrentResult]);

  const setQueryValue = useCallback(
    (value: string) => {
      if (value !== query) resetCurrentResult();
      setQuery(value);
    },
    [query, resetCurrentResult],
  );

  const setMaxPapersValue = useCallback(
    (value: string) => {
      if (value !== maxPapers) resetCurrentResult();
      setMaxPapers(value);
    },
    [maxPapers, resetCurrentResult],
  );

  const setTimeFromValue = useCallback(
    (value: string) => {
      if (value !== timeFrom) resetCurrentResult();
      setTimeFrom(value);
    },
    [resetCurrentResult, timeFrom],
  );

  const setTimeToValue = useCallback(
    (value: string) => {
      if (value !== timeTo) resetCurrentResult();
      setTimeTo(value);
    },
    [resetCurrentResult, timeTo],
  );

  const setCitationFormatValue = useCallback(
    (value: string) => {
      if (value !== citationFormat) resetCurrentResult();
      setCitationFormat(value);
    },
    [citationFormat, resetCurrentResult],
  );

  const setLanguageValue = useCallback(
    (value: string) => {
      if (value !== language) resetCurrentResult();
      setLanguage(value);
    },
    [language, resetCurrentResult],
  );

  const handleGenerate = useCallback(async () => {
    if (generating) return;

    const validation = validateSurveyGenerationInput({ query, timeFrom, timeTo, maxPapers });
    if (validation.error) {
      setError(validation.error);
      return;
    }

    cleanupSurveyListeners();
    contentRef.current = "";
    const requestId = createSurveyRequestId();
    requestIdRef.current = requestId;
    const paperIds = selectedPaperIds.length > 0 ? selectedPaperIds.slice(0, validation.maxPapers) : undefined;
    startSurveyRunSnapshot({
      requestId,
      query: validation.query,
      maxPapers: validation.maxPapers,
      timeFrom: validation.timeFrom,
      timeTo: validation.timeTo,
      litTypes,
      databases,
      citationFormat,
      language,
      paperIds,
      selectedInterestId: selectedInterestId || undefined,
    });
    setContent("");
    setAgents([]);
    setStructured(null);
    setError("");
    setActionMessage("");
    setActionError("");
    setGenerating(true);

    try {
      const listeners = await registerSurveyEventListeners({
        requestIdRef,
        contentRef,
        setContent,
        setGenerating,
        setError,
        setActionError,
        setAgents,
        setStructured,
        cleanupSurveyListeners,
      });

      unlistenersRef.current = listeners;

      await apiClient.survey.generate(
        validation.query,
        validation.maxPapers,
        validation.timeFrom,
        validation.timeTo,
        litTypes.length > 0 ? litTypes : undefined,
        databases.length > 0 ? databases : undefined,
        citationFormat,
        language,
        paperIds,
        requestId,
      );
    } catch (nextError) {
      cleanupSurveyListeners();
      const message = formatErrorMessage(nextError);
      failSurveyRunSnapshot(message);
      setError(message);
      setGenerating(false);
    }
  }, [
    citationFormat,
    cleanupSurveyListeners,
    databases,
    generating,
    language,
    litTypes,
    maxPapers,
    query,
    selectedPaperIds,
    selectedInterestId,
    timeFrom,
    timeTo,
  ]);

  const handleResumeFailedRun = useCallback(async () => {
    if (!runSnapshot || runSnapshot.status !== "failed" || generating) return;

    cleanupSurveyListeners();
    const requestId = createSurveyRequestId();
    requestIdRef.current = requestId;
    contentRef.current = runSnapshot.content;
    resumeSurveyRunSnapshot(runSnapshot, requestId);
    setContent(runSnapshot.content);
    setStructured(null);
    setError("");
    setActionMessage("");
    setActionError("");
    setGenerating(true);

    try {
      const listeners = await registerSurveyEventListeners({
        requestIdRef,
        contentRef,
        setContent,
        setGenerating,
        setError,
        setActionError,
        setAgents,
        setStructured,
        cleanupSurveyListeners,
      });
      unlistenersRef.current = listeners;

      await apiClient.survey.generate(
        runSnapshot.query,
        runSnapshot.maxPapers,
        runSnapshot.timeFrom,
        runSnapshot.timeTo,
        runSnapshot.litTypes.length > 0 ? runSnapshot.litTypes : undefined,
        runSnapshot.databases.length > 0 ? runSnapshot.databases : undefined,
        runSnapshot.citationFormat,
        runSnapshot.language,
        runSnapshot.paperIds,
        requestId,
      );
    } catch (nextError) {
      cleanupSurveyListeners();
      const message = formatErrorMessage(nextError);
      failSurveyRunSnapshot(message);
      setError(message);
      setGenerating(false);
    }
  }, [cleanupSurveyListeners, generating, runSnapshot]);

  const copySurveyMarkdown = useCallback(async () => {
    const markdown = content.trim();
    if (!markdown) {
      setActionError("当前没有可复制的综述内容。");
      return;
    }
    setCopying(true);
    setActionError("");
    try {
      await navigator.clipboard.writeText(markdown);
      setActionMessage("已复制 Markdown。");
    } catch {
      setActionError("复制失败，可以在下方预览中手动选择文本。");
    } finally {
      setCopying(false);
    }
  }, [content]);

  const saveSurveyAsNote = useCallback(async () => {
    const markdown = content.trim();
    if (!markdown || savingNote) return;

    const noteQuery = structured?.query || query.trim() || "未命名综述";
    const noteTitle = `综述：${noteQuery.slice(0, 48)}`;
    setSavingNote(true);
    setActionError("");
    try {
      const note = await apiClient.knowledge.createNote({
        title: noteTitle,
        content: markdown,
        tags: ["综述", citationFormatLabel(structured?.citation_format ?? citationFormat)],
        research_interest_id: selectedInterestId || undefined,
      });
      setActionMessage(`已保存到知识笔记：${note.title}`);
      void apiClient.memory.add({
        type: "auto",
        action: "survey.save_note",
        summary: `保存了综述笔记：「${note.title}」`,
      });
    } catch (nextError) {
      setActionError(formatErrorMessage(nextError));
    } finally {
      setSavingNote(false);
    }
  }, [citationFormat, content, query, savingNote, selectedInterestId, structured]);

  const allPapersSelected = interestPapers.length > 0 && selectedPaperIds.length === interestPapers.length;
  const somePapersSelected = selectedPaperIds.length > 0 && selectedPaperIds.length < interestPapers.length;
  const selectedPaperLimitMessage =
    selectedPaperIds.length > effectiveMaxPapers
      ? `已勾选 ${selectedPaperIds.length} 篇，本次会优先使用前 ${effectiveMaxPapers} 篇。`
      : "";
  const currentCitationFormatLabel = citationFormatLabel(citationFormat);
  const hasAdvancedSettings = Boolean(
    timeFrom ||
      timeTo ||
      litTypes.length > 0 ||
      databases.length > 0 ||
      maxPapers !== String(SURVEY_DEFAULT_MAX_PAPERS),
  );
  const hasResults = agents.length > 0 || Boolean(structured) || Boolean(content);
  const canResumeFailedRun = Boolean(runSnapshot?.status === "failed" && agents.some((agent) => agent.status === "failed"));

  return {
    interests,
    selectedInterestId,
    selectInterest,
    interestPapers,
    loadingPapers,
    selectedPaperIds,
    allPapersSelected,
    somePapersSelected,
    selectedPaperLimitMessage,
    togglePaper,
    toggleAllPapers,
    query,
    setQuery: setQueryValue,
    advancedOpen,
    setAdvancedOpen,
    maxPapers,
    setMaxPapers: setMaxPapersValue,
    effectiveMaxPapers,
    timeFrom,
    setTimeFrom: setTimeFromValue,
    timeTo,
    setTimeTo: setTimeToValue,
    litTypes,
    toggleLitType,
    databases,
    toggleDatabase,
    citationFormat,
    setCitationFormat: setCitationFormatValue,
    language,
    setLanguage: setLanguageValue,
    citationFormatLabel: currentCitationFormatLabel,
    hasAdvancedSettings,
    generating,
    content,
    agents,
    structured,
    error,
    actionMessage,
    actionError,
    savingNote,
    copying,
    hasResults,
    canSaveResult: Boolean(content.trim()),
    canResumeFailedRun,
    handleGenerate,
    handleResumeFailedRun,
    copySurveyMarkdown,
    saveSurveyAsNote,
  };
}
