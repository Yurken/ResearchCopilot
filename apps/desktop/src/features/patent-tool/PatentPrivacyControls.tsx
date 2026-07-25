import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Card } from "@research-copilot/ui";
import type { PatentSearchPlan } from "./shared";

function ConsentRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-black/[0.025] dark:hover:bg-white/[0.035]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-[var(--rc-border)] accent-apple-blue"
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink-secondary">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-5 text-ink-tertiary">{description}</span>
      </span>
    </label>
  );
}

export function PatentPrivacyControls({
  plan,
  searchConsent,
  aiConsent,
  onSearchConsentChange,
  onAiConsentChange,
}: {
  plan: PatentSearchPlan;
  searchConsent: boolean;
  aiConsent: boolean;
  onSearchConsentChange: (checked: boolean) => void;
  onAiConsentChange: (checked: boolean) => void;
}) {
  return (
    <Card variant="inset" padding="sm" className="space-y-2">
      <div className="flex items-start gap-2 px-3 pt-1">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-apple-orange" />
        <div>
          <p className="text-xs font-semibold text-ink-secondary">未公开发明信息外发控制</p>
          <p className="mt-1 text-[11px] leading-5 text-ink-tertiary">
            默认不发送。公开网络检索可能使用 Tavily 或 DuckDuckGo；AI 评估会使用当前配置的聊天模型服务，可能是云端服务。
          </p>
        </div>
      </div>
      <ConsentRow
        checked={searchConsent}
        onChange={onSearchConsentChange}
        title="允许发送技术特征做公开网络检索"
        description={`载荷预览：${plan.features.filter(Boolean).join("；") || "填写技术方案后显示"}。只发送这里展示的内容，不额外附加原始方案；请先自行移除项目名、组织名和敏感参数。`}
      />
      <ConsentRow
        checked={aiConsent}
        onChange={onAiConsentChange}
        title="允许 AI 深度评估发送完整技术方案"
        description="将发送完整方案、披露状态及最多 8 条网页线索；受 NDA 或商业秘密约束时请勿开启。"
      />
      {!searchConsent && !aiConsent ? (
        <p className="flex items-center gap-1.5 px-3 pb-1 text-[11px] text-ink-tertiary">
          <LockKeyhole className="h-3.5 w-3.5" /> 当前保持仅本地编辑与检索式预览。
        </p>
      ) : null}
    </Card>
  );
}
