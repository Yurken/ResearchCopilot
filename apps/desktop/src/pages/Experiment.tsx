import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ExperimentRecord, ExperimentCodeSession } from "@research-copilot/types";
import { CapsuleTabs } from "@research-copilot/ui";
import { experimentApi, formatErrorMessage } from "../lib/client";
import { useDomainEventRefresh } from "../hooks/useDomainEventRefresh";
import { ExperimentCodeWorkspace } from "../features/experiment/ExperimentCodeWorkspace";
import { ExperimentSnapshotPanel } from "../features/experiment/ExperimentSnapshotPanel";
import { ExperimentRecordPanel } from "../features/experiment/ExperimentRecordPanel";
import { useExperimentWorkingDirectory } from "../features/experiment/useExperimentWorkingDirectory";
import { EXPERIMENT_MODULES, type ExperimentModuleKey } from "../features/module-visibility/shared";
import { useModuleVisibility } from "../features/module-visibility/useModuleVisibility";
import { mapExperimentRecord } from "../features/experiment/shared";

type ExperimentTab = ExperimentModuleKey;

interface ExperimentProps {
  experimentId?: string;
}

export default function Experiment({ experimentId }: ExperimentProps) {
  const { config: moduleVisibility } = useModuleVisibility();
  const visibleTabs = EXPERIMENT_MODULES.filter((tab) => moduleVisibility.experiment[tab.key]);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [activeTab, setActiveTab] = useState<ExperimentTab>("records");
  const [activeCodeSession, setActiveCodeSession] = useState<ExperimentCodeSession | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }, []);

  const [workingDir, setWorkingDir] = useExperimentWorkingDirectory(
    experiment?.id ?? null,
    experiment?.defaultWorkingDir ?? null,
    showToast,
  );

  const loadExperiment = useCallback(async () => {
    try {
      let record: ExperimentRecord | null = null;
      if (experimentId) {
        record = mapExperimentRecord(await experimentApi.get(experimentId));
      } else {
        const result = await experimentApi.list();
        record = (result.experiments ?? []).map(mapExperimentRecord)[0] ?? null;
      }
      setExperiment(record);
    } catch (error) {
      showToast(`加载实验失败：${formatErrorMessage(error)}`);
    }
  }, [experimentId, showToast]);

  const refreshActiveExperiment = useCallback(async () => {
    if (!experiment?.id) return;
    try {
      setExperiment(mapExperimentRecord(await experimentApi.get(experiment.id)));
    } catch {
      showToast("恢复成功，但实验记录刷新失败，请重新进入页面");
    }
  }, [experiment?.id, showToast]);

  useEffect(() => {
    setLoading(true);
    loadExperiment().finally(() => setLoading(false));
  }, [loadExperiment]);

  useEffect(() => {
    setActiveCodeSession(null);
  }, [experiment?.id]);

  useEffect(() => {
    if (!moduleVisibility.experiment[activeTab]) {
      const fallback = EXPERIMENT_MODULES.find((tab) => moduleVisibility.experiment[tab.key]);
      setActiveTab(fallback?.key ?? "records");
    }
  }, [activeTab, moduleVisibility.experiment]);

  useDomainEventRefresh("experiment:created", () => { loadExperiment(); });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--rc-surface)" }}>
      {/* Header + horizontal segmented tabs */}
      <div className="app-header flex items-center justify-between flex-shrink-0 px-6 pb-3 border-b border-nm-dark/10">
        <CapsuleTabs
          options={visibleTabs.map((tab) => ({
            value: tab.key,
            label: tab.label,
            testId: `tab-${tab.key}`,
          }))}
          value={activeTab}
          onChange={(nextTab) => setActiveTab(nextTab as ExperimentTab)}
        />
        {experiment && (
          <p className="max-w-[45%] truncate text-xs text-ink-tertiary" title={experiment.title}>
            当前实验：<span className="font-medium text-ink-secondary">{experiment.title}</span>
          </p>
        )}
      </div>

      {/* Main workspace */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-ink-tertiary" />
          </div>
        ) : activeTab === "records" ? (
          <div className="h-full overflow-hidden">
            <ExperimentRecordPanel
              onError={showToast}
              activeExperimentId={experiment?.id ?? null}
              onActiveExperimentChange={(nextExperiment) => {
                setExperiment(nextExperiment);
                setActiveCodeSession(null);
              }}
            />
          </div>
        ) : !experiment ? (
          <div className="flex h-full items-center justify-center p-5">
            <div className="text-center space-y-3">
              <p className="text-sm text-ink-tertiary">暂无实验记录</p>
              <button
                type="button"
                className="text-sm font-medium text-[var(--rc-accent)] hover:underline"
                onClick={() => setActiveTab(moduleVisibility.experiment.records ? "records" : visibleTabs[0]?.key ?? "records")}
              >
                {moduleVisibility.experiment.records ? "新建第一条实验记录" : `打开${visibleTabs[0]?.label ?? "可见"}页签`}
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-hidden">
            {activeTab === "code" && (
              <div className="h-full p-2">
                <ExperimentCodeWorkspace
                  key={experiment.id}
                  experimentId={experiment.id}
                  workingDir={workingDir}
                  onWorkingDirChange={setWorkingDir}
                  onActiveSessionChange={setActiveCodeSession}
                />
              </div>
            )}

            {activeTab === "snapshots" && (
              <div className="h-full overflow-y-auto p-5 max-lg:p-4">
                <ExperimentSnapshotPanel
                  key={experiment.id}
                  experimentId={experiment.id}
                  experimentTitle={experiment.title}
                  activeSession={activeCodeSession}
                  workingDir={workingDir}
                  onError={showToast}
                  onNotify={showToast}
                  onRestored={refreshActiveExperiment}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-2xl text-sm font-medium text-white pointer-events-none z-50"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
