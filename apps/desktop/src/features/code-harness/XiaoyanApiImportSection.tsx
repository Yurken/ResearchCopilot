import { Check, KeyRound } from "lucide-react";
import { Button } from "@research-copilot/ui";

export default function XiaoyanApiImportSection({
  description,
  resultText,
  busy,
  disabled,
  onImport,
}: {
  description: string;
  resultText: string | null;
  busy: boolean;
  disabled: boolean;
  onImport: () => void;
}) {
  return (
    <div className="mt-5 flex flex-col gap-3 border-y border-nm-dark/10 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-primary">小妍 API</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-tertiary">{description}</p>
        {resultText ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            {resultText}
          </p>
        ) : null}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="flex-shrink-0"
        onClick={onImport}
        disabled={disabled || busy}
      >
        <KeyRound className="h-3.5 w-3.5" />
        配置小妍 API
      </Button>
    </div>
  );
}
