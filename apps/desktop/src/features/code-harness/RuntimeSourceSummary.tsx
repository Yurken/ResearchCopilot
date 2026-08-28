import { Check } from "lucide-react";
import ManagedRuntimeDownloadNotice from "./ManagedRuntimeDownloadNotice";
import type { ManagedRuntimeProvider } from "./useManagedRuntimeDownload";

export default function RuntimeSourceSummary({
  provider,
  label,
  usingCustom,
  customExecutable,
  pathAvailable,
  pathExecutable,
  managedAvailable,
  managedExecutable,
  onInstalled,
}: {
  provider: ManagedRuntimeProvider;
  label: string;
  usingCustom: boolean;
  customExecutable: string | null;
  pathAvailable: boolean;
  pathExecutable: string | null;
  managedAvailable: boolean;
  managedExecutable?: string | null;
  onInstalled: () => void | Promise<unknown>;
}) {
  const executable = usingCustom ? customExecutable : pathExecutable;
  if ((usingCustom && executable) || (!usingCustom && pathAvailable)) {
    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-700/15 bg-emerald-50/60 px-3.5 py-3 text-emerald-900">
        <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 text-xs leading-5">
          <p className="font-medium">
            {usingCustom ? `使用指定的本机 ${label}` : `已发现本机 ${label}`}
          </p>
          <p className="break-all opacity-75">{executable}</p>
        </div>
      </div>
    );
  }

  return (
    <ManagedRuntimeDownloadNotice
      provider={provider}
      label={label}
      available={managedAvailable}
      executable={managedExecutable}
      onInstalled={onInstalled}
    />
  );
}
