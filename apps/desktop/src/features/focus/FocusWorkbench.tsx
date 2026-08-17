import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, type Sparkles } from "lucide-react";
import { Button } from "@research-copilot/ui";
import { apiClient, formatErrorMessage } from "../../lib/client";
import type { ResearchInterest } from "@research-copilot/types";
import ResearchWorkbench, {
  type InterestTab,
} from "../knowledge/ResearchWorkbench";
import {
  applyInterestPlanSnapshots,
  useInterestPlanSnapshots,
} from "../knowledge/useInterestPlanRuns";
import MacWindowDragStrip from "../../components/MacWindowDragStrip";
import {
  IS_MACOS_DESKTOP,
  MACOS_WINDOW_DRAG_HEIGHT,
} from "../../lib/windowChrome";
import Survey from "../../pages/Survey";
import Papers from "../../pages/Papers";
import Knowledge from "../../pages/Knowledge";
import Copilot from "../../pages/Copilot";
import Writing from "../../pages/Writing";
import Tools from "../../pages/Tools";
import Code from "../../pages/Code";
import Submission from "../../pages/Submission";
import {
  BASE_INTEREST_TABS,
  FREE_TABS,
  PLANNER_TAB,
  normalizeFreeTab,
  normalizeInterestTab,
} from "./shared";

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Sparkles;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rc-focus-tab flex-shrink-0 ${active ? "rc-focus-tab--active" : ""}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rc-focus-stat-chip">
      <span className="text-ink-tertiary">{label}</span>
      <span className="font-semibold text-ink-primary">{value}</span>
    </div>
  );
}

export default function FocusWorkbench() {
  const { interestId, tab } = useParams<{
    interestId: string;
    tab?: string;
  }>();
  const navigate = useNavigate();
  const [interest, setInterest] = useState<ResearchInterest | null>(null);
  const planSnapshots = useInterestPlanSnapshots();
  const [loadingInterest, setLoadingInterest] = useState(false);
  const [interestError, setInterestError] = useState("");
  const [interestTab, setInterestTab] = useState<InterestTab>("papers");
  const [stats, setStats] = useState({ papers: 0, sessions: 0, notes: 0 });
  const isFree = interestId === "free";
  const freeTab = normalizeFreeTab(tab);
  const visibleInterest = useMemo(
    () =>
      interest
        ? applyInterestPlanSnapshots([interest], planSnapshots)[0]
        : null,
    [interest, planSnapshots],
  );

  const interestTabs =
    visibleInterest?.status === "planned"
      ? [PLANNER_TAB, ...BASE_INTEREST_TABS]
      : BASE_INTEREST_TABS;

  useEffect(() => {
    if (isFree) {
      setInterest(null);
      setLoadingInterest(false);
      setInterestError("");
      return;
    }
    if (!interestId) return;

    let cancelled = false;
    setLoadingInterest(true);
    setInterest(null);
    setInterestError("");

    apiClient.knowledge
      .listInterests()
      .then((list) => {
        if (cancelled) return;
        const found = list.find((item) => item.id === interestId);
        if (found) {
          setInterest(found);
          setInterestTab("overview");
          return;
        }
        setInterestError("未找到该研究主题，可能已被删除。");
      })
      .catch((error) => {
        if (!cancelled) setInterestError(formatErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingInterest(false);
      });

    return () => {
      cancelled = true;
    };
  }, [interestId, isFree]);

  useEffect(() => {
    if (isFree || !visibleInterest || !interestId) return;
    const nextTab = normalizeInterestTab(
      tab,
      visibleInterest.status === "planned",
    );
    if (nextTab !== interestTab) {
      setInterestTab(nextTab);
    }
    if (tab !== nextTab) {
      navigate(`/workbench/${interestId}/${nextTab}`, { replace: true });
    }
  }, [visibleInterest, interestId, interestTab, isFree, navigate, tab]);

  const title = isFree
    ? "自由主题"
    : visibleInterest?.folder_name?.trim() ||
      visibleInterest?.topic ||
      "研究主题";

  const tabButtons = isFree
    ? FREE_TABS.map(({ key, label, icon }) => (
        <TabButton
          key={key}
          active={freeTab === key}
          icon={icon}
          label={label}
          onClick={() => navigate(`/workbench/free/${key}`)}
        />
      ))
    : interestTabs.map(({ key, label, icon }) => (
        <TabButton
          key={key}
          active={interestTab === key}
          icon={icon}
          label={label}
          onClick={() => {
            setInterestTab(key);
            navigate(`/workbench/${interestId}/${key}`);
          }}
        />
      ));

  const FreePage = (() => {
    switch (freeTab) {
      case "survey":
        return <Survey hideFolders />;
      case "papers":
        return <Papers hideFolders />;
      case "writing":
        return <Writing />;
      case "knowledge":
        return <Knowledge hideFolders />;
      case "chat":
        return <Copilot hideFolders />;
      case "experiment":
        return <Code />;
      case "submission":
        return <Submission />;
      case "tools":
        return <Tools />;
    }
  })();

  return (
    <div className="rc-focus-workbench flex h-full min-w-0 flex-col bg-nm-bg">
      <div className="rc-focus-header flex-shrink-0">
        <MacWindowDragStrip
          style={{ height: `${MACOS_WINDOW_DRAG_HEIGHT}px` }}
        />
        {/* 身份行：返回 + 标题 + 统计 + 自由主题入口 */}
        <div className="flex h-auto min-h-11 flex-wrap items-center gap-2 px-3 py-1 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-0">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rc-focus-back-btn"
            aria-label="返回主题列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <p className="text-[15px] font-semibold text-ink-primary truncate flex-1 min-w-0">
            {title}
          </p>

          {!isFree && visibleInterest && (
            <div className="hidden flex-shrink-0 items-center gap-1.5 sm:flex">
              <StatChip label="论文" value={stats.papers} />
              <StatChip label="会话" value={stats.sessions} />
              <StatChip label="笔记" value={stats.notes} />
            </div>
          )}

          {!isFree && (
            <button
              type="button"
              onClick={() => navigate("/workbench/free/survey")}
              className="rc-focus-btn-secondary flex-shrink-0"
            >
              自由主题
            </button>
          )}
        </div>

        {/* 导航行：tab 横向滚动 */}
        <div
          className="rc-focus-tabbar flex items-center gap-1 overflow-x-auto px-3 pt-1.5"
          style={{ paddingBottom: IS_MACOS_DESKTOP ? "8px" : "6px" }}
        >
          {tabButtons}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isFree ? (
          FreePage
        ) : loadingInterest ? (
          <div className="flex h-full items-center justify-center gap-2 text-ink-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">加载主题工作台…</span>
          </div>
        ) : interestError ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="rc-focus-card rounded-3xl w-full max-w-md p-6 text-center">
              <p className="text-sm font-semibold text-ink-primary">
                无法打开主题工作台
              </p>
              <p className="mt-2 text-xs leading-6 text-apple-red break-all">
                {interestError}
              </p>
              <Button className="mt-4" onClick={() => navigate("/")}>
                返回主题列表
              </Button>
            </div>
          </div>
        ) : visibleInterest ? (
          <ResearchWorkbench
            interest={visibleInterest}
            activeTab={interestTab}
            onStats={(p, s, n) =>
              setStats({ papers: p, sessions: s, notes: n })
            }
          />
        ) : null}
      </div>
    </div>
  );
}
