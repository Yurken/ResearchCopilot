import {
  ChevronLeft,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
} from "lucide-react";
import { Select } from "@research-copilot/ui";
import type { ChatSession, ResearchInterest } from "@research-copilot/types";
import { interestFolderName } from "../../lib/interestUtils";

interface CopilotSessionSidebarProps {
  sessions: ChatSession[];
  interests: ResearchInterest[];
  currentSession: ChatSession | null;
  selectedInterestId: string;
  sessionListCollapsed: boolean;
  sessionGroups: { key: string; title: string; subtitle?: string; sessions: ChatSession[] }[];
  ungroupedSessions: ChatSession[];
  hideFolders: boolean;
  renamingId: string | null;
  renameTitle: string;
  menuSessionId: string | null;
  onNewChat: () => void;
  onSelectInterest: (id: string) => void;
  onToggleCollapse: () => void;
  onLoadSession: (session: ChatSession) => void;
  onContextMenu: (e: React.MouseEvent, session: ChatSession) => void;
  onMenuToggle: (sessionId: string | null) => void;
  onPinSession: (id: string) => void;
  onStartRename: (session: ChatSession) => void;
  onDeleteSession: (id: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

export function CopilotSessionSidebar(props: CopilotSessionSidebarProps) {
  const {
    sessions, interests, currentSession, selectedInterestId,
    sessionListCollapsed, sessionGroups, ungroupedSessions,
    hideFolders, renamingId, renameTitle, menuSessionId,
    onNewChat, onSelectInterest, onToggleCollapse, onLoadSession,
    onContextMenu, onMenuToggle, onPinSession, onStartRename,
    onDeleteSession,
    onRenameTitleChange, onCommitRename, onCancelRename,
  } = props;

  const visibleSessions = hideFolders
    ? sessions
    : selectedInterestId
      ? (sessionGroups.find((g) => g.key === selectedInterestId)?.sessions ?? [])
      : ungroupedSessions;

  const renderSessionItem = (session: ChatSession) => {
    const isRenaming = renamingId === session.id;
    return (
      <div
        key={session.id}
        className="group relative flex min-w-0 items-center gap-2 rounded-2xl px-2.5 py-1.5 text-xs transition-all duration-150"
        onContextMenu={(e) => onContextMenu(e, session)}
        style={
          currentSession?.id === session.id
            ? { background: "var(--rc-accent-alpha, rgba(0,122,255,0.08))", color: "var(--rc-accent, #007AFF)" }
            : { color: "var(--rc-text-soft)" }
        }
      >
        {isRenaming ? (
          <input
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-primary outline-none"
            style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}
            value={renameTitle}
            onChange={(e) => onRenameTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={onCommitRename}
            autoFocus
          />
        ) : (
          <button className="min-w-0 flex-1 text-left" onClick={() => onLoadSession(session)}>
            <div className="flex items-center gap-1 truncate font-medium">
              {session.pinned && (
                <Pin className="h-3 w-3 flex-shrink-0 text-ink-tertiary" aria-label="已置顶" />
              )}
              <span className="truncate">{session.title || "新对话"}</span>
            </div>
          </button>
        )}
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onMenuToggle(menuSessionId === session.id ? null : session.id); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-tertiary hover:text-ink-primary"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {menuSessionId === session.id && (
            <div
              className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-2xl py-1.5 text-xs"
              style={{ background: "var(--rc-elevated)", boxShadow: "var(--rc-chip-shadow)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full px-3 py-1.5 text-left text-ink-secondary transition-colors hover:bg-nm-dark/8 hover:text-ink-primary"
                onClick={() => { onPinSession(session.id); onMenuToggle(null); }}
              >
                {session.pinned ? "取消置顶" : "置顶"}
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-ink-secondary transition-colors hover:bg-nm-dark/8 hover:text-ink-primary"
                onClick={() => onStartRename(session)}
              >
                重命名
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-apple-red transition-colors hover:bg-apple-red/8"
                onClick={() => { onDeleteSession(session.id); onMenuToggle(null); }}
              >
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (sessionListCollapsed) return null;

  return (
    <div
      className={`${hideFolders ? "w-[11.5rem]" : "w-52"} flex flex-shrink-0 flex-col`}
      style={{ background: "var(--rc-sidebar-bg)", borderRight: "1px solid var(--rc-border)" }}
    >
      <div className="p-3 pb-2 rc-copilot-session-sidebar-header">
        <div className="flex items-center gap-2">
          <button
            onClick={onNewChat}
            aria-label="新建对话"
            className="flex-1 px-3 flex items-center gap-2 rounded-2xl py-2.5 text-sm font-medium text-white transition-all duration-150 active:scale-[0.98]"
            style={{
              background: "var(--rc-button-primary-bg)",
              boxShadow: "var(--rc-button-primary-shadow)",
            }}
          >
            <Plus className="w-4 h-4" />
            新建对话
          </button>
          <button
            type="button"
            aria-label="收起会话列表"
            onClick={onToggleCollapse}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl text-ink-tertiary transition-colors hover:text-ink-primary"
            style={{ background: "var(--rc-surface)", boxShadow: "var(--rc-chip-shadow)" }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
        {!hideFolders && (
          <div className="mt-2">
            <Select
              label="新对话研究主题"
              value={selectedInterestId}
              onChange={onSelectInterest}
              className="text-xs"
              options={[
                { value: "", label: "未归类" },
                ...interests.map((i) => ({ value: i.id, label: interestFolderName(i) })),
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {visibleSessions.length === 0 && (
          <div className="flex flex-col items-center py-8 gap-2">
            <MessageSquare className="w-8 h-8 text-ink-tertiary opacity-40" />
            <p className="text-xs text-ink-tertiary">
              {hideFolders ? "暂无对话记录" : selectedInterestId ? "该主题下暂无对话" : "没有未归类的对话"}
            </p>
          </div>
        )}

        {visibleSessions.length > 0 ? (
          <div className="space-y-0.5">{visibleSessions.map(renderSessionItem)}</div>
        ) : null}
      </div>


    </div>
  );
}
