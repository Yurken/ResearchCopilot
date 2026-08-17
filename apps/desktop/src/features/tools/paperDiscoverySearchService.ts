import type {
  ArxivRankingMode,
  ArxivSearchRequest,
  ArxivSearchResponse,
  PaperSearchDepth,
  WebSearchOutcome,
} from "@research-copilot/types";
import { apiClient } from "../../lib/client";
import { buildWebSupplementQuery, mergeWebSearchOutcomes } from "./shared";

interface ExecutePaperDiscoverySearchInput {
  request: ArxivSearchRequest;
  cutoffDate: string;
  limit: number;
  mode: ArxivRankingMode;
  searchDepth: PaperSearchDepth;
}

export interface PaperDiscoverySearchOutcome {
  result: ArxivSearchResponse;
  webSupplement: WebSearchOutcome | null;
  webSupplementError: string;
}

export async function executePaperDiscoverySearch({
  request,
  cutoffDate,
  limit,
  mode,
  searchDepth,
}: ExecutePaperDiscoverySearchInput): Promise<PaperDiscoverySearchOutcome> {
  const startedAt = Date.now();
  const paperSearch = await apiClient.paperSearch.search(
    request,
    cutoffDate,
    limit,
    mode,
    searchDepth,
  );
  const fallbackWebQuery = buildWebSupplementQuery(request);
  const webQueries = (paperSearch.search_queries?.length
    ? paperSearch.search_queries
    : [fallbackWebQuery]
  ).slice(0, searchDepth === "quick" ? 1 : searchDepth === "balanced" ? 2 : 4);
  const webSearches = await Promise.allSettled(
    webQueries.map((query) => apiClient.webSearch.query(query, cutoffDate)),
  );
  const webSupplement = mergeWebSearchOutcomes(
    webSearches.flatMap((search) => search.status === "fulfilled" ? [search.value] : []),
  );
  const failedCount = webSearches.filter((search) => search.status === "rejected").length;
  const metrics = paperSearch.metrics
    ? {
        ...paperSearch.metrics,
        web_api_calls: webQueries.length,
        duration_ms: Date.now() - startedAt,
      }
    : undefined;

  return {
    result: { ...paperSearch, metrics },
    webSupplement,
    webSupplementError: failedCount > 0
      ? `网络补充有 ${failedCount}/${webSearches.length} 条查询未完成，已保留其余结果。`
      : "",
  };
}
