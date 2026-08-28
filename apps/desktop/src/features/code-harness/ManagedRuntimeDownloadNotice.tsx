import { AlertTriangle, Check, Download } from "lucide-react";
import { Button } from "@research-copilot/ui";
import {
  useManagedRuntimeDownload,
  type ManagedRuntimeProvider,
} from "./useManagedRuntimeDownload";

export default function ManagedRuntimeDownloadNotice({
  provider,
  label,
  available,
  executable,
  onInstalled,
}: {
  provider: ManagedRuntimeProvider;
  label: string;
  available: boolean;
  executable?: string | null;
  onInstalled: () => void | Promise<unknown>;
}) {
  const download = useManagedRuntimeDownload(provider, onInstalled);

  if (available) {
    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-700/15 bg-emerald-50/60 px-3.5 py-3 text-emerald-900">
        <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 text-xs leading-5">
          <p className="font-medium">{label} 已安装在小妍私有目录</p>
          {executable ? <p className="truncate opacity-75">{executable}</p> : null}
          {download.install ? <p className="opacity-75">版本 {download.install.version}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto flex-shrink-0"
          loading={download.downloading}
          onClick={() => void download.download()}
        >
          重新安装
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-amber-700/15 bg-amber-50/60 px-3.5 py-3 text-amber-900">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-5">
            未找到本机 {label}。可一键安装到小妍私有目录，不会修改系统环境。
          </p>
          {download.error ? <p className="mt-1 text-xs leading-5 text-red-700">{download.error}</p> : null}
        </div>
        <Button
          size="sm"
          className="flex-shrink-0"
          loading={download.downloading}
          onClick={() => void download.download()}
        >
          <Download className="h-3.5 w-3.5" />
          {download.downloading ? "安装中" : "一键安装"}
        </Button>
      </div>
    </div>
  );
}
