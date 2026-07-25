import type { KeyboardEvent } from "react";
import { AlertCircle, Clock, FileSearch, Globe2, Loader2, Trash2 } from "lucide-react";
import type { PaperSearchHistoryEntry } from "../../lib/client";
import { Button, Card, DatePicker, Input, Textarea } from "@research-copilot/ui";
import type { ArxivRankingMode } from "@research-copilot/types";
import {
  ARXIV_MODE_OPTIONS,
  CS_GROUPS,
  DOMAIN_VENUES,
  NON_CS_KEYS,
  RANK_OPTIONS,
  computeStaticVenues,
  type RankKey,
} from "./shared";
import { PaperDiscoveryCollapsibleSection } from "./PaperDiscoveryCollapsibleSection";

const insetShadow = "var(--rc-inset-shadow)";
const raisedShadow = "var(--rc-raised-shadow)";

interface PaperDiscoveryPanelProps {
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
  venueFilterLoading: boolean;
  dynamicJournalTerms: string[];
  cutoffDate: string;
  cutoffDateMax: string;
  limit: string;
  mode: ArxivRankingMode;
  loading: boolean;
  error: string;
  canSearch: boolean;
  history?: PaperSearchHistoryEntry[];
  historyLoading?: boolean;
  onApplyHistory?: (entry: PaperSearchHistoryEntry) => void;
  onRemoveHistory?: (id: string) => void;
  onTopicChange: (value: string) => void;
  onAllTermsChange: (value: string) => void;
  onTitleTermsChange: (value: string) => void;
  onAbstractTermsChange: (value: string) => void;
  onAuthorsChange: (value: string) => void;
  onCommentsTermsChange: (value: string) => void;
  onExcludeTermsChange: (value: string) => void;
  onDomainsChange: (value: string[]) => void;
  onVenueTypeChange: (value: "all" | "conference" | "journal") => void;
  onRanksChange: (value: RankKey[]) => void;
  onCutoffDateChange: (value: string) => void;
  onLimitChange: (value: string) => void;
  onModeChange: (value: ArxivRankingMode) => void;
  onSubmit: () => void | Promise<void>;
}

export function PaperDiscoveryPanel({
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
  cutoffDateMax,
  limit,
  mode,
  loading,
  error,
  canSearch,
  history,
  historyLoading,
  onApplyHistory,
  onRemoveHistory,
  onTopicChange,
  onAllTermsChange,
  onTitleTermsChange,
  onAbstractTermsChange,
  onAuthorsChange,
  onCommentsTermsChange,
  onExcludeTermsChange,
  onDomainsChange,
  onVenueTypeChange,
  onRanksChange,
  onCutoffDateChange,
  onLimitChange,
  onModeChange,
  onSubmit,
}: PaperDiscoveryPanelProps) {
  const currentMode = ARXIV_MODE_OPTIONS.find((item) => item.value === mode) ?? ARXIV_MODE_OPTIONS[0];
  const { categories, journalTerms: staticTerms } = computeStaticVenues(selectedDomains, venueType, selectedRanks);
  const totalTerms = new Set([...staticTerms, ...dynamicJournalTerms]).size;
  const filledTermCount = [allTerms, titleTerms, abstractTerms, authors, commentsTerms, excludeTerms]
    .filter((value) => value.trim().length > 0)
    .length;

  const handleSubmitKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      void onSubmit();
    }
  };

  return (
    <Card padding="md" className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
          <Globe2 className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ink-primary">论文检索</p>
          <p className="text-xs leading-5 text-ink-tertiary">
            同步检索学术数据源和网络来源，按相关性与研究价值排序，帮你快速定位值得读的工作。
          </p>
        </div>
      </div>

      {historyLoading || (history && history.length > 0) ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-tertiary">
            <Clock className="h-3.5 w-3.5" />
            <span>最近检索</span>
            {historyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {history?.map((entry) => {
              let label = entry.draft_json.slice(0, 40);
              try {
                const parsed = JSON.parse(entry.draft_json) as Record<string, unknown>;
                const parts: string[] = [];
                if (parsed.topic) parts.push(String(parsed.topic));
                if (parsed.allTerms) parts.push(String(parsed.allTerms));
                if (parsed.titleTerms) parts.push(String(parsed.titleTerms));
                const selectedDomains = parsed.selectedDomains;
                if (parts.length === 0 && Array.isArray(selectedDomains) && selectedDomains.length > 0) {
                  parts.push(String(selectedDomains.join(", ")));
                }
                if (parts.length > 0) {
                  label = parts.join(" · ").slice(0, 60);
                }
              } catch {
                // keep fallback
              }
              return (
                <div
                  key={entry.id}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-xl border border-apple-blue/15 bg-apple-blue/5 px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-apple-blue/30 hover:bg-apple-blue/10"
                >
                  <button
                    type="button"
                    onClick={() => onApplyHistory?.(entry)}
                    className="min-w-0 truncate text-left"
                    title="应用此检索条件"
                  >
                    {label || "未命名检索"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveHistory?.(entry.id)}
                    className="shrink-0 rounded p-0.5 text-ink-tertiary opacity-60 transition-opacity hover:text-apple-red hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Textarea
        value={topic}
        onChange={(event) => onTopicChange(event.target.value)}
        onKeyDown={handleSubmitKeyDown}
        rows={3}
        placeholder="例如：请帮我查找使用分层神经网络捕获手语视频时空特征的研究，并关注可复现的方法。"
        label="告诉小妍你的检索需求"
      />

      <PaperDiscoveryCollapsibleSection
        title="检索词"
        description="可选；补充通用、标题、摘要、作者、扩展与排除条件。"
        status={filledTermCount > 0 ? `已填写 ${filledTermCount} 项` : undefined}
      >
        <div className="grid grid-cols-3 gap-3">
          <Input
            value={allTerms}
            onChange={(event) => onAllTermsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：model memory, tool use"
            label="通用关键词"
          />
          <Input
            value={titleTerms}
            onChange={(event) => onTitleTermsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：planning, memory"
            label="标题关键词"
          />
          <Input
            value={abstractTerms}
            onChange={(event) => onAbstractTermsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：benchmark, long-term"
            label="摘要关键词"
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <Input
            value={authors}
            onChange={(event) => onAuthorsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：Geoffrey Hinton, Percy Liang"
            label="作者"
          />
          <Input
            value={commentsTerms}
            onChange={(event) => onCommentsTermsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：code, benchmark, workshop"
            label="扩展关键词"
          />
          <Input
            value={excludeTerms}
            onChange={(event) => onExcludeTermsChange(event.target.value)}
            onKeyDown={handleSubmitKeyDown}
            placeholder="例如：robotics, medical imaging"
            label="排除词"
          />
        </div>
      </PaperDiscoveryCollapsibleSection>

      <PaperDiscoveryCollapsibleSection
        title="领域筛选步骤"
        description="可选；按研究领域、刊会类型和等级自动补充检索范围。"
        status={selectedDomains.length > 0 ? `已选 ${selectedDomains.length} 个领域` : undefined}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold tracking-wide text-ink-tertiary">
              步骤 1 · 研究领域
              <span className="ml-1 font-normal">（可多选）</span>
            </label>
            {selectedDomains.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onDomainsChange([]);
                  onRanksChange([]);
                }}
                className="text-[11px] text-ink-tertiary transition-colors hover:text-apple-red"
              >
                清空筛选
              </button>
            ) : null}
          </div>

          <div className="space-y-2 rounded-xl p-2.5" style={{ background: "var(--rc-elevated)", boxShadow: insetShadow }}>
            <p className="px-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">计算机科学</p>
            {CS_GROUPS.map((group) => {
              const groupKeys = group.keys;
              const allSelected = groupKeys.every((key) => selectedDomains.includes(key));
              const someSelected = groupKeys.some((key) => selectedDomains.includes(key));
              return (
                <div key={group.label} className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onDomainsChange(
                        allSelected
                          ? selectedDomains.filter((key) => !groupKeys.includes(key))
                          : [...new Set([...selectedDomains, ...groupKeys])]
                      )
                    }
                    className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-semibold transition-all duration-100 active:scale-95"
                    style={
                      allSelected
                        ? { background: "#0062CC", color: "#fff" }
                        : someSelected
                          ? {
                              background: "rgba(0,122,255,0.15)",
                              color: "var(--apple-blue,#007AFF)",
                              border: "1px solid rgba(0,122,255,0.3)",
                            }
                          : { background: "var(--rc-surface)", color: "var(--rc-text-muted)", boxShadow: raisedShadow }
                    }
                  >
                    {group.label}
                  </button>
                  <span className="text-ink-tertiary" style={{ fontSize: 10 }}>
                    ›
                  </span>
                  {groupKeys.map((key) => {
                    const domain = DOMAIN_VENUES[key];
                    const selected = selectedDomains.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          onDomainsChange(
                            selected
                              ? selectedDomains.filter((value) => value !== key)
                              : [...selectedDomains, key]
                          )
                        }
                        className="rounded-xl px-2.5 py-1 text-xs font-medium transition-all duration-100 active:scale-95"
                        style={
                          selected
                            ? {
                                background: "var(--rc-button-primary-bg)",
                                color: "#fff",
                                boxShadow: "var(--rc-button-primary-shadow)",
                              }
                            : { background: "var(--rc-surface)", color: "var(--rc-text-soft)", boxShadow: raisedShadow }
                        }
                      >
                        {domain?.label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <p className="px-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">其他领域</p>
            <div className="flex flex-wrap gap-1.5">
              {NON_CS_KEYS.map((key) => {
                const domain = DOMAIN_VENUES[key];
                const selected = selectedDomains.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      onDomainsChange(
                        selected
                          ? selectedDomains.filter((value) => value !== key)
                          : [...selectedDomains, key]
                      )
                    }
                    className="rounded-xl px-2.5 py-1 text-xs font-medium transition-all duration-100 active:scale-95"
                    style={
                      selected
                        ? {
                            background: "var(--rc-button-primary-bg)",
                            color: "#fff",
                            boxShadow: "var(--rc-button-primary-shadow)",
                          }
                        : { background: "var(--rc-elevated)", color: "var(--rc-text-soft)", boxShadow: raisedShadow }
                    }
                  >
                    {domain?.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {selectedDomains.length > 0 ? (
          <>
            <div className="space-y-2">
              <label className="text-xs font-semibold tracking-wide text-ink-tertiary">步骤 2 · 类型</label>
              <div className="inline-flex gap-0.5 rounded-xl p-0.5" style={{ background: "var(--rc-elevated)", boxShadow: insetShadow }}>
                {(["all", "conference", "journal"] as const).map((type) => {
                  const label = type === "all" ? "全部" : type === "conference" ? "会议" : "期刊";
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onVenueTypeChange(type)}
                      className="rounded-lg px-3 py-1 text-xs font-medium transition-all duration-150"
                      style={
                        venueType === type
                          ? { background: "var(--rc-surface)", color: "var(--rc-text)", boxShadow: raisedShadow }
                          : { color: "var(--rc-text-muted)" }
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold tracking-wide text-ink-tertiary">
                步骤 3 · 等级
                <span className="ml-1 font-normal">（可多选）</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {RANK_OPTIONS.map(({ key, label, color }) => {
                  const selected = selectedRanks.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        onRanksChange(
                          selected
                            ? selectedRanks.filter((value) => value !== key)
                            : [...selectedRanks, key]
                        )
                      }
                      className="rounded-xl px-2.5 py-1 text-xs font-semibold transition-all duration-100 active:scale-95"
                      style={
                        selected
                          ? { background: color, color: "#fff", boxShadow: "var(--rc-chip-shadow)" }
                          : { background: `${color}15`, color, border: `1px solid ${color}40` }
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {selectedDomains.length > 0 && selectedRanks.length > 0 ? (
          <p className="flex items-center gap-1.5 text-[11px] text-ink-tertiary">
            {venueFilterLoading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                正在从本地数据库加载期刊列表…
              </>
            ) : (
              <>
                已匹配 <span className="font-semibold text-apple-blue">{totalTerms}</span> 个会议/期刊
                {categories.length > 0 ? (
                  <>
                    ，<span className="font-semibold text-apple-blue">{categories.length}</span> 个 arXiv 分类
                  </>
                ) : null}
              </>
            )}
          </p>
        ) : null}

        {selectedDomains.length === 0 ? (
          <p className="text-[11px] text-ink-tertiary">选择领域后，继续选择类型和等级，自动填充期刊/会议检索范围。</p>
        ) : null}
        {selectedDomains.length > 0 && selectedRanks.length === 0 ? (
          <p className="text-[11px] text-ink-tertiary">请在步骤 3 选择至少一个等级以确定检索范围。</p>
        ) : null}
      </PaperDiscoveryCollapsibleSection>

      <p className="text-xs leading-5 text-ink-tertiary">
        学术数据源会查找发布于截止日期及以前的论文；同次检索还会补充相关网络来源。
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <DatePicker
          label="截止日期"
          max={cutoffDateMax}
          value={cutoffDate}
          onChange={onCutoffDateChange}
        />
        <Input
          label="返回篇数"
          type="number"
          min={1}
          max={50}
          value={limit}
          onChange={(event) => onLimitChange(event.target.value)}
          placeholder="6"
        />
        <div className="w-full">
          <label className="mb-1.5 ml-1 block text-xs font-medium text-ink-tertiary">排序方式</label>
          <div className="inline-flex w-full gap-0.5 rounded-2xl p-1" style={{ background: "var(--rc-surface)", boxShadow: insetShadow }}>
            {ARXIV_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onModeChange(option.value)}
                className="flex-1 rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-150"
                style={
                  mode === option.value
                    ? { background: "var(--rc-elevated)", boxShadow: raisedShadow, color: "var(--rc-text)" }
                    : { color: "var(--rc-text-muted)" }
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs leading-5 text-ink-tertiary">
          当前模式：<span className="font-medium text-ink-secondary">{currentMode.label}</span>
          {`，${currentMode.description}`}
        </p>
        <Button onClick={() => void onSubmit()} loading={loading} disabled={!canSearch}>
          <FileSearch className="h-4 w-4" />
          检索论文与网络来源
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-apple-red/10 bg-[#F7ECEA] px-3 py-2 text-sm text-apple-red">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </Card>
  );
}
