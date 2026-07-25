import { Languages, MessageCircleQuestion, Sparkles } from "lucide-react";

export type ReaderRightPanel = "translation" | "qa" | "research" | null;

export default function ReaderRightRail({ active, onSelect }: { active: ReaderRightPanel; onSelect: (panel: Exclude<ReaderRightPanel, null>) => void }) {
  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-l py-2" style={{ background: "var(--rc-card-bg)", borderColor: "var(--rc-border)" }}>
      <RailButton label="翻译" active={active === "translation"} onClick={() => onSelect("translation")} icon={Languages} />
      <RailButton label="问答" active={active === "qa"} onClick={() => onSelect("qa")} icon={MessageCircleQuestion} />
      <RailButton label="研究" active={active === "research"} onClick={() => onSelect("research")} icon={Sparkles} />
    </nav>
  );
}

function RailButton({ label, active, onClick, icon: Icon }: { label: string; active: boolean; onClick: () => void; icon: typeof Languages }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-8 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors"
      style={{ color: active ? "var(--rc-accent)" : "var(--rc-text-tertiary)", background: active ? "var(--rc-chip-bg)" : "transparent" }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
