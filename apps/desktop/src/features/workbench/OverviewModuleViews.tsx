import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  FileText,
  Layers3,
  MessageSquareText,
  Route,
} from "lucide-react";
import { Badge } from "@research-copilot/ui";
import { Link } from "react-router-dom";
import {
  toneStyle,
  toneToBadgeVariant,
  type WorkbenchAgendaItem,
  type WorkbenchAssetItem,
  type WorkbenchHandoffItem,
  type WorkbenchInterestItem,
  type WorkbenchRiskItem,
} from "./shared";

function surfaceStyle(variant: "inset" | "soft" | "outset" = "inset") {
  if (variant === "outset") {
    return {
      background: "var(--rc-bg)",
      border: "1px solid var(--rc-border)",
      boxShadow: "var(--rc-card-flat-shadow)",
    };
  }
  return {
    background: variant === "inset" ? "var(--rc-card-inset-bg)" : "rgb(var(--rc-bg-rgb) / 0.14)",
    border: "1px solid var(--rc-card-inset-outline)",
    boxShadow: variant === "inset" ? "var(--rc-card-inset-shadow)" : "var(--rc-card-flat-shadow)",
  };
}

// 扁平内层：卡片整体保留浮雕，内部标签/序号用淡蓝色调底，不用灰底也不再层层浮雕。
const flatPanelStyle = {
  background: "rgba(0,122,255,0.08)",
} as const;

function iconTintStyle(tone: "blue" | "red" = "blue") {
  return { background: tone === "red" ? "rgba(255,59,48,0.10)" : "rgba(0,122,255,0.10)" } as const;
}



function ToneTag({ label, tone }: { label: string; tone: WorkbenchAgendaItem["tone"] }) {
  const style = toneStyle(tone);

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: style.background, color: style.color }}
    >
      {label}
    </span>
  );
}

export function AgendaTimeline({ items }: { items: WorkbenchAgendaItem[] }) {
  return (
    <ol className="grid gap-3">
      {items.map((item, index) => (
        <li key={item.id}>
          <Link
            to={item.action.to}
            state={item.action.state}
            className="group relative grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 rounded-[20px] p-3.5 pr-10 transition-transform hover:-translate-y-0.5"
            style={surfaceStyle("soft")}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-apple-blue"
              style={flatPanelStyle}
            >
              {index + 1}
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ToneTag label={item.label} tone={item.tone} />
                <p className="truncate text-sm font-semibold text-ink-primary">{item.title}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">{item.description}</p>
            </div>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function InterestBoard({ items }: { items: WorkbenchInterestItem[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <Link key={item.id} to={item.action.to} state={item.action.state} className="group relative flex min-h-[176px] flex-col rounded-[22px] p-4 transition-transform hover:-translate-y-0.5" style={surfaceStyle("soft")}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-apple-blue" style={iconTintStyle()}>
                <Route className="h-4 w-4" />
              </span>
              <p className="truncate text-sm font-semibold text-ink-primary">{item.title}</p>
            </div>
            <Badge variant={toneToBadgeVariant(item.stageTone)}>{item.stage}</Badge>
          </div>

          <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-ink-secondary pr-6">{item.summary}</p>

          <div className="mt-3 grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {item.stats.map((stat) => (
                <span key={stat} className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-tertiary" style={flatPanelStyle}>
                  {stat}
                </span>
              ))}
            </div>
            <div className="rounded-2xl px-3 py-2" style={flatPanelStyle}>
              <p className="line-clamp-2 text-xs leading-5 text-ink-secondary">{item.nextStep}</p>
            </div>
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function HandoffQueue({ items }: { items: WorkbenchHandoffItem[] }) {
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <Link key={item.id} to={item.action.to} state={item.action.state} className="group relative grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-3 rounded-[20px] p-3.5 pr-10 transition-transform hover:-translate-y-0.5" style={surfaceStyle("soft")}>
          <span className="flex h-9 w-9 items-center justify-center rounded-[14px] text-apple-blue" style={iconTintStyle()}>
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ToneTag label={item.label} tone={item.tone} />
              <p className="truncate text-sm font-semibold text-ink-primary">{item.title}</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">{item.description}</p>
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function RiskAlertList({ items }: { items: WorkbenchRiskItem[] }) {
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <Link key={item.id} to={item.action.to} state={item.action.state} className="group relative rounded-[20px] border-l-4 border-apple-red px-4 py-3.5 transition-transform hover:-translate-y-0.5" style={surfaceStyle("soft")}>
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-apple-red" style={iconTintStyle("red")}>
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ToneTag label={item.label} tone={item.tone} />
                <p className="text-sm font-semibold text-ink-primary">{item.title}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">{item.description}</p>
            </div>
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-apple-red/10 text-apple-red">
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function AssetShelf({ items }: { items: WorkbenchAssetItem[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
      {items.map((item, index) => {
        const Icon = index % 3 === 0 ? FileText : index % 3 === 1 ? BookOpenCheck : Layers3;

        return (
          <Link key={item.id} to={item.action.to} state={item.action.state} className="group relative flex min-h-[148px] min-w-0 flex-col overflow-hidden rounded-[22px] p-4 transition-transform hover:-translate-y-0.5" style={surfaceStyle("soft")}>
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl text-apple-blue" style={iconTintStyle()}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-apple-blue" style={flatPanelStyle}>
                {item.label}
              </span>
            </div>
            <p className="mt-3 line-clamp-2 pr-6 text-sm font-semibold text-ink-primary">{item.title}</p>
            <p className="mt-1 line-clamp-3 flex-1 break-words pr-6 text-xs leading-5 text-ink-secondary">{item.description}</p>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
