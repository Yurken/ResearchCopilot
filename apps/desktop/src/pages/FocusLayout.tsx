import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import FocusHome from "../features/focus/FocusHome";
import FocusWorkbench from "../features/focus/FocusWorkbench";
import FocusSettingsWrapper from "../features/focus/FocusSettingsWrapper";
import { type LegacyFreeTab } from "../features/focus/shared";
import Planner from "./Planner";
import NoteReader from "./NoteReader";
import PaperReader from "./PaperReader";
import Code from "./Code";

function FocusLegacyRouteRedirect({ tab }: { tab: LegacyFreeTab }) {
  const normalized = tab === "copilot" || tab === "xiaoyan" ? "chat" : tab;
  return <Navigate to={`/workbench/free/${normalized}`} replace />;
}

export default function FocusApp() {
  return (
    <div className="flex h-full bg-nm-bg">
      <main className="flex-1 min-w-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<FocusHome />} />
          <Route path="/workbench/:interestId" element={<FocusWorkbench />} />
          <Route path="/workbench/:interestId/:tab" element={<FocusWorkbench />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/survey" element={<FocusLegacyRouteRedirect tab="survey" />} />
          <Route path="/papers" element={<FocusLegacyRouteRedirect tab="papers" />} />
          <Route path="/papers/:id/reader" element={<PaperReader />} />
          <Route path="/writing" element={<FocusLegacyRouteRedirect tab="writing" />} />
          <Route path="/knowledge" element={<FocusLegacyRouteRedirect tab="knowledge" />} />
          <Route path="/chat" element={<FocusLegacyRouteRedirect tab="chat" />} />
          <Route path="/xiaoyan" element={<FocusLegacyRouteRedirect tab="xiaoyan" />} />
          <Route path="/copilot" element={<FocusLegacyRouteRedirect tab="copilot" />} />
          <Route path="/tools" element={<FocusLegacyRouteRedirect tab="tools" />} />
          <Route path="/experiment" element={<Navigate to="/code" replace />} />
          <Route path="/code" element={<Code />} />
          <Route path="/submission" element={<FocusLegacyRouteRedirect tab="submission" />} />
          <Route path="/notes/:id" element={<NoteReader />} />
          <Route path="/settings" element={<FocusSettingsWrapper />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Link to="/settings" className="fixed bottom-5 left-5 z-50">
        <button
          type="button"
          className="rc-focus-back-btn w-9 h-9 rounded-2xl text-[#8E8E93] hover:text-ink-primary"
        >
          <SettingsIcon className="w-4.5 h-4.5" />
        </button>
      </Link>
    </div>
  );
}
