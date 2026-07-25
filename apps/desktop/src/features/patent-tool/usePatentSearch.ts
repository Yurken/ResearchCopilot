import { useCallback, useMemo, useRef, useState } from "react";
import { apiClient, formatErrorMessage } from "../../lib/client";
import {
  buildAiPatentPrompt,
  buildPatentabilityReport,
  buildPatentSearchPlan,
  rankPatentResults,
  type DisclosureStatus,
  type PatentSearchPlan,
  type PatentSearchResult,
} from "./shared";

interface PatentSearchSnapshot {
  id: number;
  description: string;
  keywords: string;
  disclosureStatus: DisclosureStatus;
  plan: PatentSearchPlan;
  provider: string;
  searchedAt: string;
}

export function usePatentSearch() {
  const [description, setDescriptionState] = useState("");
  const [keywords, setKeywordsState] = useState("");
  const [disclosureStatus, setDisclosureStatusState] = useState<DisclosureStatus>("private");
  const [results, setResults] = useState<PatentSearchResult[]>([]);
  const [snapshot, setSnapshot] = useState<PatentSearchSnapshot | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [searchConsent, setSearchConsentState] = useState(false);
  const [aiConsent, setAiConsentState] = useState(false);
  const [aiReport, setAiReport] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const searchRequestId = useRef(0);
  const aiRequestId = useRef(0);

  const plan = useMemo(() => buildPatentSearchPlan(description, keywords), [description, keywords]);
  const report = useMemo(
    () => buildPatentabilityReport(results, snapshot?.disclosureStatus ?? disclosureStatus),
    [disclosureStatus, results, snapshot?.disclosureStatus],
  );

  const invalidateResults = useCallback(() => {
    searchRequestId.current += 1;
    aiRequestId.current += 1;
    setResults([]);
    setSnapshot(null);
    setSearched(false);
    setLoading(false);
    setProvider("");
    setError("");
    setAiReport("");
    setAiLoading(false);
    setAiError("");
  }, []);

  const setDescription = (value: string) => {
    setDescriptionState(value);
    invalidateResults();
  };
  const setKeywords = (value: string) => {
    setKeywordsState(value);
    invalidateResults();
  };
  const setDisclosureStatus = (value: DisclosureStatus) => {
    setDisclosureStatusState(value);
    invalidateResults();
  };
  const setSearchConsent = (value: boolean) => {
    setSearchConsentState(value);
    if (!value) invalidateResults();
  };
  const setAiConsent = (value: boolean) => {
    setAiConsentState(value);
    if (!value) {
      aiRequestId.current += 1;
      setAiReport("");
      setAiLoading(false);
      setAiError("");
    }
  };

  const search = async () => {
    if (!description.trim() || loading) return;
    if (!searchConsent) {
      setError("请先确认允许将检索式中的技术特征发送给公开网络搜索服务。");
      return;
    }

    const requestId = ++searchRequestId.current;
    const requestPlan = buildPatentSearchPlan(description, keywords);
    const requestInput = { description, keywords, disclosureStatus };
    try {
      setLoading(true);
      setError("");
      setSearched(false);
      setResults([]);
      setSnapshot(null);
      setAiReport("");
      const outcome = await apiClient.webSearch.query(requestPlan.webQuery);
      if (requestId !== searchRequestId.current) return;
      setProvider(outcome.provider);
      setResults(rankPatentResults(outcome.items, requestPlan));
      setSnapshot({
        id: requestId,
        ...requestInput,
        plan: requestPlan,
        provider: outcome.provider,
        searchedAt: new Date().toISOString(),
      });
      setSearched(true);
    } catch (nextError) {
      if (requestId !== searchRequestId.current) return;
      setResults([]);
      setSnapshot(null);
      setSearched(true);
      setError(formatErrorMessage(nextError));
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
  };

  const generateAiReport = async () => {
    if (!snapshot || results.length === 0 || aiLoading) return;
    if (!aiConsent) {
      setAiError("请先确认允许将完整技术方案与网页线索发送给当前配置的聊天模型服务。");
      return;
    }

    const requestId = ++aiRequestId.current;
    try {
      setAiLoading(true);
      setAiError("");
      setAiReport("");
      let content = "";
      for await (const chunk of apiClient.chat.stream({
        message: buildAiPatentPrompt(snapshot.description, snapshot.plan, results, snapshot.disclosureStatus),
        chat_mode: "direct",
        tag: "1",
      })) {
        if (requestId !== aiRequestId.current) return;
        if (chunk.type === "delta") {
          content += chunk.value;
          setAiReport(content);
        } else if (chunk.type === "error") {
          throw new Error(String(chunk.value));
        }
      }
    } catch (nextError) {
      if (requestId === aiRequestId.current) setAiError(formatErrorMessage(nextError));
    } finally {
      if (requestId === aiRequestId.current) setAiLoading(false);
    }
  };

  return {
    description,
    keywords,
    disclosureStatus,
    plan,
    results,
    report,
    searched,
    loading,
    error,
    provider,
    searchConsent,
    aiConsent,
    aiReport,
    aiLoading,
    aiError,
    snapshot,
    setDescription,
    setKeywords,
    setDisclosureStatus,
    setSearchConsent,
    setAiConsent,
    search,
    generateAiReport,
  };
}
