import { AlertTriangle, ArrowRight, FileText, FlaskConical, ImageIcon, Loader2, Paperclip, SearchCheck, Sparkles, X } from "lucide-react";
import { Button } from "@research-copilot/ui";
import { useIdeaFromMaterials } from "./useIdeaFromMaterials";
import { hypothesisCardFromIdea, hypothesisCardToPlanningDraft, type HypothesisPlanningDraft } from "./hypothesisPlanning";

interface Props {
  onSelect: (draft: HypothesisPlanningDraft) => void;
  onClose: () => void;
}

export default function IdeaFromMaterialsPanel({ onSelect, onClose }: Props) {
  const { notes, setNotes, items, ideas, feedback, setFeedback, reading, loading, error, addFiles, removeItem, generate } =
    useIdeaFromMaterials();

  const hasMaterials = notes.trim().length > 0 || items.length > 0;

  return (
    <div
      className="rounded-2xl p-4 space-y-4"
      style={{ background: "var(--rc-elevated)", boxShadow: "var(--rc-inset-shadow)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-primary flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-apple-blue flex-shrink-0" />
            给小妍一些资料，形成可验证假设
          </p>
          <p className="mt-0.5 text-xs text-ink-tertiary">
            从材料线索出发，区分支持、反证与未知，并给出证伪条件和验证步骤
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-tertiary hover:text-ink-primary px-2 py-1 rounded-lg transition-colors flex-shrink-0"
        >
          收起
        </button>
      </div>

      {/* 自由文字 / 碎片 */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-ink-secondary">粘贴文字、笔记或讨论记录</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例如：和导师讨论时提到想结合扩散模型做分子生成；会议里说现有数据噪声大、缺评测基准…"
          rows={4}
          className="w-full resize-none rounded-xl px-3 py-2 text-xs text-ink-primary placeholder:text-ink-tertiary outline-none"
          style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
        />
      </div>

      {/* 文件 / 图片材料 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-secondary">添加文档或图片（可选）</p>
          <button
            type="button"
            onClick={() => void addFiles()}
            disabled={reading}
            className="inline-flex items-center gap-1 text-xs text-apple-blue hover:underline disabled:opacity-50"
          >
            {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            添加文件（txt / md / pdf / 图片）
          </button>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span
                key={item.id}
                className="group inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] text-ink-soft"
                style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
                title={item.name}
              >
                {item.kind === "image" ? (
                  <ImageIcon className="h-3.5 w-3.5 flex-shrink-0 text-apple-blue" />
                ) : (
                  <FileText className="h-3.5 w-3.5 flex-shrink-0 text-apple-blue" />
                )}
                <span className="max-w-[8rem] truncate">{item.name}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-ink-tertiary hover:text-apple-red"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {error ? <p className="text-xs text-apple-red flex-1">{error}</p> : <span className="flex-1" />}
        <Button size="sm" onClick={() => void generate()} disabled={!hasMaterials || loading || reading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {ideas.length > 0 ? "按修正重新生成" : "生成候选假设"}
        </Button>
      </div>

      {ideas.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="idea-feedback" className="text-xs font-medium text-ink-secondary">
            修正要求（可选）
          </label>
          <textarea
            id="idea-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="例如：不要依赖新增标注数据；优先给出两周内能完成的验证方案…"
            rows={2}
            className="w-full resize-none rounded-xl px-3 py-2 text-xs text-ink-primary placeholder:text-ink-tertiary outline-none"
            style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
          />
        </div>
      ) : null}

      {/* 结果 */}
      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-apple-blue" />
          <span className="text-xs text-ink-tertiary">小妍正在核对材料、构造可证伪假设…</span>
        </div>
      ) : ideas.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-secondary">候选假设卡（进入规划前可采用、修改或放弃）</p>
          <div className="flex flex-col gap-2">
            {ideas.map((idea, index) => (
              <article
                key={`${idea.title}-${index}`}
                className="w-full px-3 py-3 rounded-xl"
                style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const card = hypothesisCardFromIdea(idea);
                    onSelect(hypothesisCardToPlanningDraft(card));
                  }}
                  className="group flex w-full items-start justify-between gap-2 text-left"
                >
                  <span className="text-xs font-semibold text-ink-primary group-hover:text-apple-blue">{idea.title}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-apple-blue" />
                </button>
                <p className="mt-2 text-[11px] leading-5 text-ink-secondary"><strong>候选假设：</strong>{idea.hypothesis}</p>
                {idea.rationale ? <p className="mt-1 text-[11px] leading-5 text-ink-tertiary"><strong>提出理由：</strong>{idea.rationale}</p> : null}
                <IdeaList icon={SearchCheck} title="材料支持线索" items={idea.evidence} empty="材料中没有明确支持线索" />
                <IdeaList icon={AlertTriangle} title="反证与冲突" items={idea.counter_evidence} empty="材料中未提供反证，仍需主动检索" />
                <div className="mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-5 text-ink-secondary" style={{ background: "var(--rc-chip-bg)" }}>
                  <strong>证伪条件：</strong>{idea.falsification}
                </div>
                <IdeaList icon={FlaskConical} title="验证步骤" items={idea.validation_steps} ordered />
                <IdeaList icon={AlertTriangle} title="仍不确定" items={idea.uncertainties} empty="暂无显式记录，请在规划时继续核对" />
                {idea.keywords.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {idea.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-tertiary"
                        style={{ background: "var(--rc-chip-bg)" }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IdeaList({
  icon: Icon,
  title,
  items,
  empty,
  ordered = false,
}: {
  icon: typeof SearchCheck;
  title: string;
  items: string[];
  empty?: string;
  ordered?: boolean;
}) {
  const values = items.length > 0 ? items : empty ? [empty] : [];
  if (values.length === 0) return null;
  return (
    <div className="mt-2 text-[11px] leading-5 text-ink-tertiary">
      <p className="flex items-center gap-1 font-medium text-ink-secondary"><Icon className="h-3.5 w-3.5" />{title}</p>
      <ul className="mt-0.5 space-y-0.5 pl-4">
        {values.map((item, index) => <li key={`${title}-${item}`}>{ordered ? `${index + 1}.` : "•"} {item}</li>)}
      </ul>
    </div>
  );
}
