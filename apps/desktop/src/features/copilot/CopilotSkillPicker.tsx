import { useEffect, useMemo, useState } from "react";
import { Lock, LockOpen, Wrench, X, Zap } from "lucide-react";
import type { Skill } from "@research-copilot/types";

interface CopilotSkillPickerProps {
  skills: Skill[];
  selectedSkillId: string | null;
  onSelectedSkillChange: (skillId: string | null) => void;
  skillLocked: boolean;
  onSkillLockedChange: (locked: boolean) => void;
}

export default function CopilotSkillPicker({
  skills,
  selectedSkillId,
  onSelectedSkillChange,
  skillLocked,
  onSkillLockedChange,
}: CopilotSkillPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hoveredSkillId, setHoveredSkillId] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;

    const close = () => {
      setPickerOpen(false);
      setHoveredSkillId(null);
    };

    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pickerOpen]);

  const previewSkill = useMemo(() => {
    if (hoveredSkillId) {
      const hoveredSkill = skills.find((item) => item.id === hoveredSkillId);
      if (hoveredSkill) return hoveredSkill;
    }
    if (selectedSkillId) {
      const selectedSkill = skills.find((item) => item.id === selectedSkillId);
      if (selectedSkill) return selectedSkill;
    }
    return skills[0] ?? null;
  }, [hoveredSkillId, selectedSkillId, skills]);

  const selectedSkill = skills.find((item) => item.id === selectedSkillId) ?? null;

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setPickerOpen((prev) => !prev);
          }}
          data-open={pickerOpen}
          className="rc-dropdown-trigger inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium transition-all duration-150"
          style={{ color: pickerOpen ? "#007AFF" : "#636366" }}
        >
          <Zap className="w-3 h-3" />
          技能
        </button>

        {pickerOpen && (
          <div
            onClick={(event) => event.stopPropagation()}
            onMouseLeave={() => setHoveredSkillId(null)}
            className="absolute bottom-full mb-2 left-0 z-20 flex items-start gap-2"
          >
            <div className="rc-dropdown-menu w-44 max-h-[420px] flex-shrink-0 overflow-y-auto rounded-2xl py-2">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">技能库</p>
              <button
                type="button"
                onMouseEnter={() => setHoveredSkillId(null)}
                onClick={() => {
                  onSelectedSkillChange(null);
                  setPickerOpen(false);
                  setHoveredSkillId(null);
                }}
                className="w-full text-left px-3 py-2 text-xs transition-colors duration-100 flex items-center gap-2"
                style={{
                  color: !selectedSkillId ? "#007AFF" : "var(--rc-text-soft)",
                  background: !selectedSkillId ? "rgba(0,122,255,0.08)" : "transparent",
                  fontWeight: !selectedSkillId ? 600 : 400,
                }}
              >
                <X className="w-3 h-3 flex-shrink-0 opacity-50" />
                不使用技能
              </button>
              {skills.length === 0 ? (
                <p className="px-3 py-2 text-xs text-ink-tertiary">暂无已启用技能</p>
              ) : (
                skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onMouseEnter={() => setHoveredSkillId(skill.id)}
                    onClick={() => {
                      onSelectedSkillChange(skill.id);
                      setPickerOpen(false);
                      setHoveredSkillId(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs transition-colors duration-100 flex items-center gap-2"
                    style={{
                      color: selectedSkillId === skill.id ? "#007AFF" : "var(--rc-text-soft)",
                      background: hoveredSkillId === skill.id || selectedSkillId === skill.id
                        ? "rgba(0,122,255,0.08)" : "transparent",
                      fontWeight: selectedSkillId === skill.id ? 600 : 400,
                    }}
                  >
                    {skill.kind === "tool" ? (
                      <Wrench className="w-3 h-3 flex-shrink-0 opacity-60" />
                    ) : (
                      <Zap className="w-3 h-3 flex-shrink-0 opacity-60" />
                    )}
                    <span className="truncate">{skill.title}</span>
                    {skill.kind === "tool" ? (
                      <span className="ml-auto text-[10px] opacity-60">工具</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>

            <div className="rc-dropdown-menu flex w-56 flex-shrink-0 flex-col gap-2 self-start rounded-2xl p-3">
              {previewSkill ? (
                <>
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5"
                      style={{ background: "rgba(0,122,255,0.12)", color: "#007AFF" }}>
                      <Zap className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink-primary leading-tight">{previewSkill.title}</p>
                      <p className="text-[10px] font-mono text-ink-tertiary mt-0.5">/{previewSkill.name}</p>
                    </div>
                  </div>
                  {previewSkill.description ? (
                    <p className="text-[11px] leading-[1.6] text-ink-secondary">{previewSkill.description}</p>
                  ) : null}
                  {previewSkill.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {previewSkill.tags.map((tag) => (
                        <span key={tag} className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ background: "rgba(0,122,255,0.1)", color: "#007AFF" }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="rounded-xl px-2.5 py-2 overflow-y-auto"
                    style={{ background: "rgba(0,0,0,0.04)", maxHeight: 160 }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary mb-1">指令预览</p>
                    <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.6] text-ink-secondary">{previewSkill.prompt}</p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 py-6 text-center">
                  <Zap className="w-6 h-6 text-ink-tertiary opacity-30" />
                  <p className="text-xs text-ink-tertiary">悬停技能查看详情</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedSkill && (
        <div className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium flex-shrink-0"
          style={{ background: "rgba(0,122,255,0.1)", color: "#007AFF" }}>
          <Zap className="w-3 h-3" />
          {selectedSkill.title}
          <button
            type="button"
            onClick={() => onSkillLockedChange(!skillLocked)}
            title={skillLocked ? "已锁定：连续多轮生效，点击解除" : "默认仅本条生效，点击锁定以连续使用"}
            aria-label={skillLocked ? "解除技能锁定" : "锁定技能"}
            aria-pressed={skillLocked}
            className="ml-0.5 transition-opacity hover:opacity-60"
            style={{ opacity: skillLocked ? 1 : 0.55 }}
          >
            {skillLocked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectedSkillChange(null);
              onSkillLockedChange(false);
            }}
            title="移除技能"
            className="hover:opacity-60 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </>
  );
}
