import type { ChatMessage } from "@research-copilot/types";
import ExternalLink from "../../components/ExternalLink";

export interface CopilotSourceLinksProps {
  sources?: ChatMessage["sources"];
}

export function CopilotSourceLinks({ sources }: CopilotSourceLinksProps) {
  if (!sources?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2" aria-label="回答依据">
      {sources.map((source, index) => (
        <ExternalLink
          key={`${source.source}-${index}`}
          href={source.url}
          title={source.content}
          className="inline-flex rounded-full px-2.5 py-1 text-[11px] text-ink-tertiary transition-colors hover:text-apple-blue"
          style={{
            background: "var(--rc-chip-inset-bg)",
            boxShadow: "var(--rc-chip-inset-shadow)",
          }}
        >
          {source.source || `来源 ${index + 1}`}
        </ExternalLink>
      ))}
    </div>
  );
}
