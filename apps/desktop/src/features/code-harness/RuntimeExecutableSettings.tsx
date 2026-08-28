import { FolderOpen, RotateCcw } from "lucide-react";
import { Button, Input } from "@research-copilot/ui";

export default function RuntimeExecutableSettings({
  id,
  label,
  value,
  detectedExecutable,
  validationResult,
  busy,
  onChange,
  onPick,
  onValidate,
  onUseAuto,
}: {
  id: string;
  label: string;
  value: string | null;
  detectedExecutable?: string | null;
  validationResult?: string;
  busy: boolean;
  onChange: (value: string | null) => void;
  onPick: () => void;
  onValidate: () => void;
  onUseAuto: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-ink-secondary" htmlFor={id}>
          使用其他本机 {label}
        </label>
        {value ? (
          <Button variant="ghost" size="sm" onClick={onUseAuto} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" />
            恢复自动选择
          </Button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          placeholder={detectedExecutable ?? `选择 ${label} 可执行文件`}
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" onClick={onPick} aria-label={`选择 ${label} 可执行文件`}>
          <FolderOpen className="h-4 w-4" />
        </Button>
        <Button variant="ghost" onClick={onValidate} disabled={!value || busy}>
          检查
        </Button>
      </div>
      <p className="text-xs leading-5 text-ink-tertiary">
        留空时优先使用自动发现的本机版本；未找到时使用小妍私有目录中的版本。
      </p>
      {validationResult ? (
        <p className="text-xs font-medium text-emerald-700">{validationResult}</p>
      ) : null}
    </div>
  );
}
