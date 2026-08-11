import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ArxivRankingMode,
  ArxivSearchRequest,
  ArxivSearchResponse,
  PaperSearchDepth,
  WebSearchOutcome,
} from "@research-copilot/types";
import {
  DOMAIN_VENUES,
  RANK_OPTIONS,
  buildAppliedFilterEntries,
  computeStaticVenues,
  formatDateInput,
  getDefaultCutoffDate,
  hasPaperDiscoveryCriteria,
  splitStructuredInput,
  type RankKey,
} from "./shared";
import { formatErrorMessage, journalApi, paperSearchApi } from "../../lib/client";
import type { PaperSearchHistoryEntry } from "../../lib/client";
import { usePersistentState } from "../../hooks/usePersistentStringState";
import { executePaperDiscoverySearch } from "./paperDiscoverySearchService";

const PAPER_DISCOVERY_SESSION_KEY = "rc:tools:paper-discovery:v1";

interface PaperDiscoveryDraft {
  topic: string;
  allTerms: string;
  titleTerms: string;
  abstractTerms: string;
  authors: string;
  commentsTerms: string;
  excludeTerms: string;
  selectedDomains: string[];
  venueType: "all" | "conference" | "journal";
  selectedRanks: RankKey[];
  cutoffDate: string;
  limit: string;
  mode: ArxivRankingMode;
  searchDepth: PaperSearchDepth;
}

interface PaperDiscoverySession {
  draft: PaperDiscoveryDraft;
}

function createPaperDiscoverySession(): PaperDiscoverySession {
  return {
    draft: {
      topic: "",
      allTerms: "",
      titleTerms: "",
      abstractTerms: "",
      authors: "",
      commentsTerms: "",
      excludeTerms: "",
      selectedDomains: [],
      venueType: "all",
      selectedRanks: [],
      cutoffDate: getDefaultCutoffDate(),
      limit: "6",
      mode: "relevance",
      searchDepth: "balanced",
    },
  };
}

export function usePaperDiscoverySearch() {
  const [session, setSession] = usePersistentState<PaperDiscoverySession>(
    PAPER_DISCOVERY_SESSION_KEY,
    createPaperDiscoverySession(),
  );
  const {
    topic,
    allTerms,
    titleTerms,
    abstractTerms,
    authors,
    commentsTerms,
    excludeTerms,
    selectedDomains,
    venueType,
    selectedRanks,
    cutoffDate,
    limit,
    mode,
    searchDepth = "balanced",
  } = session.draft;
  const [venueFilterLoading, setVenueFilterLoading] = useState(false);
  const [dynamicJournalTerms, setDynamicJournalTerms] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [journalTerms, setJournalTerms] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [webSupplementError, setWebSupplementError] = useState("");
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<ArxivSearchResponse | null>(null);
  const [webSupplement, setWebSupplement] = useState<WebSearchOutcome | null>(null);
  const [history, setHistory] = useState<PaperSearchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const lastSearchAt = useRef<number>(0);

  const updateDraft = <Key extends keyof PaperDiscoveryDraft>(
    key: Key,
    value: PaperDiscoveryDraft[Key],
  ) => {
    setSession((current) => ({
      ...current,
      draft: { ...current.draft, [key]: value },
    }));
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const items = await paperSearchApi.getHistory(20);
      setHistory(items);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDomains.length === 0 || selectedRanks.length === 0) {
      setVenueFilterLoading(false);
      setCategories([]);
      setJournalTerms("");
      setDynamicJournalTerms([]);
      return;
    }

    const { categories: staticCategories, journalTerms: staticTerms } = computeStaticVenues(
      selectedDomains,
      venueType,
      selectedRanks,
    );
    setCategories(staticCategories);

    const dynamicRanks = selectedRanks.filter((rank) => RANK_OPTIONS.find((option) => option.key === rank)?.dynamic);
    if (dynamicRanks.length === 0) {
      setVenueFilterLoading(false);
      setDynamicJournalTerms([]);
      setJournalTerms(staticTerms.join(", "));
      return;
    }

    if (venueType === "conference") {
      setVenueFilterLoading(false);
      setDynamicJournalTerms([]);
      setJournalTerms(staticTerms.join(", "));
      return;
    }

    const wosCategories = [...new Set(selectedDomains.flatMap((domainKey) => DOMAIN_VENUES[domainKey]?.wosCats ?? []))];
    setVenueFilterLoading(true);
    let cancelled = false;
    journalApi.rankFilter(wosCategories, dynamicRanks).then((titles) => {
      if (cancelled) return;
      setDynamicJournalTerms(titles);
      setJournalTerms([...new Set([...staticTerms, ...titles])].join(", "));
    }).catch(() => {
      if (cancelled) return;
      setDynamicJournalTerms([]);
      setJournalTerms(staticTerms.join(", "));
    }).finally(() => {
      if (cancelled) return;
      setVenueFilterLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedDomains, selectedRanks, venueType]);

  useEffect(() => {
    void loadHistory();
  }, []);

  const request = useMemo<ArxivSearchRequest>(
    () => ({
      topic: topic.trim(),
      all_terms: splitStructuredInput(allTerms),
      title_terms: splitStructuredInput(titleTerms),
      abstract_terms: splitStructuredInput(abstractTerms),
      authors: splitStructuredInput(authors),
      categories,
      comments_terms: splitStructuredInput(commentsTerms),
      journal_ref_terms: splitStructuredInput(journalTerms),
      exclude_terms: splitStructuredInput(excludeTerms),
    }),
    [abstractTerms, allTerms, authors, categories, commentsTerms, excludeTerms, journalTerms, titleTerms, topic],
  );
  const canSearch = useMemo(() => hasPaperDiscoveryCriteria(request), [request]);
  const appliedFilters = useMemo(
    () => buildAppliedFilterEntries(result?.applied_filters, result?.cutoff_date),
    [result],
  );

  const submit = async () => {
    if (!canSearch || loading) return;

    const now = Date.now();
    if (now - lastSearchAt.current < 3000) return;
    lastSearchAt.current = now;

    const parsedLimit = Number(limit);
    try {
      setLoading(true);
      setError("");
      setWebSupplementError("");
      setSearched(true);
      setResult(null);
      setWebSupplement(null);
      const outcome = await executePaperDiscoverySearch({
        request,
        cutoffDate,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 6,
        mode,
        searchDepth,
      });
      setResult(outcome.result);
      setWebSupplement(outcome.webSupplement);
      setWebSupplementError(outcome.webSupplementError);

      try {
        const draftJson = JSON.stringify({ ...session.draft, searchDepth });
        const resultJson = JSON.stringify({
          ...outcome.result,
          web_supplement: outcome.webSupplement,
        });
        await paperSearchApi.saveHistory(draftJson, resultJson);
        await loadHistory();
      } catch (historyError) {
        console.error("保存论文检索历史失败：", historyError);
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  const applyHistory = (entry: PaperSearchHistoryEntry) => {
    try {
      const parsed = JSON.parse(entry.draft_json) as PaperDiscoveryDraft;
      setSession((current) => ({
        ...current,
        draft: { ...createPaperDiscoverySession().draft, ...parsed },
      }));
    } catch (e) {
      console.error("恢复检索历史失败：", e);
      return;
    }

    try {
      const parsedResult = JSON.parse(entry.result_json) as {
        web_supplement?: WebSearchOutcome | null;
      } & ArxivSearchResponse;
      const { web_supplement: restoredWebSupplement, ...restoredResult } = parsedResult;
      setSearched(true);
      setResult(restoredResult);
      setWebSupplement(restoredWebSupplement ?? null);
    } catch (e) {
      console.error("恢复检索结果失败：", e);
      setSearched(false);
      setResult(null);
      setWebSupplement(null);
    }
  };

  const removeHistory = async (id: string) => {
    try {
      await paperSearchApi.deleteHistory(id);
      await loadHistory();
    } catch (e) {
      console.error("删除检索历史失败：", e);
    }
  };

  return {
    panelProps: {
      topic,
      allTerms,
      titleTerms,
      abstractTerms,
      authors,
      commentsTerms,
      excludeTerms,
      selectedDomains,
      venueType,
      selectedRanks,
      venueFilterLoading,
      dynamicJournalTerms,
      cutoffDate,
      cutoffDateMax: formatDateInput(new Date()),
      limit,
      mode,
      searchDepth,
      loading,
      error,
      canSearch,
      onTopicChange: (value: string) => updateDraft("topic", value),
      onAllTermsChange: (value: string) => updateDraft("allTerms", value),
      onTitleTermsChange: (value: string) => updateDraft("titleTerms", value),
      onAbstractTermsChange: (value: string) => updateDraft("abstractTerms", value),
      onAuthorsChange: (value: string) => updateDraft("authors", value),
      onCommentsTermsChange: (value: string) => updateDraft("commentsTerms", value),
      onExcludeTermsChange: (value: string) => updateDraft("excludeTerms", value),
      onDomainsChange: (value: string[]) => updateDraft("selectedDomains", value),
      onVenueTypeChange: (value: PaperDiscoveryDraft["venueType"]) => updateDraft("venueType", value),
      onRanksChange: (value: RankKey[]) => updateDraft("selectedRanks", value),
      onCutoffDateChange: (value: string) => updateDraft("cutoffDate", value),
      onLimitChange: (value: string) => updateDraft("limit", value),
      onModeChange: (value: ArxivRankingMode) => updateDraft("mode", value),
      onSearchDepthChange: (value: PaperSearchDepth) => updateDraft("searchDepth", value),
      onSubmit: submit,
      history,
      historyLoading,
      onApplyHistory: applyHistory,
      onRemoveHistory: removeHistory,
    },
    resultProps: {
      result,
      webSupplement: webSupplement ?? null,
      webSupplementError,
      appliedFilters,
      searched,
      loading,
      error,
    },
  };
}
