import { useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

interface OutputPanelProps {
  output: string;
}

export const OutputPanel: React.FC<OutputPanelProps> = ({ output }) => {
  const { copyToClipboard } = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const emptyPlaceholder = t('demo.outputInitialMessage');

  const handleCopy = async () => {
    const isValidOutput = output && output !== emptyPlaceholder;
    if (!isValidOutput) {
      return;
    }

    const success = await copyToClipboard(output);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="output-panel flex min-h-0 flex-1 flex-col"
      id="output-panel"
      data-blok-testid="output-panel"
    >
      <div
        className="output-header flex items-center justify-between gap-3 border-b border-border px-5 py-3"
        data-blok-testid="output-header"
      >
        <div
          className="output-title flex items-center gap-2 text-sm font-semibold text-foreground"
          data-blok-testid="output-title"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="text-primary"
          >
            <path
              d="M2 3v10a2 2 0 002 2h8a2 2 0 002-2V5l-2-2H4a2 2 0 00-2 2z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M6 9l2 2 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{t("demo.outputPanel.title")}</span>
        </div>
        <button
          className={cn(
            "output-copy inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            copied && "copied border-primary/40 bg-primary/10 text-primary",
          )}
          onClick={handleCopy}
          type="button"
          data-blok-testid="output-copy"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5 3v8a2 2 0 002 2h6V11H7a1 1 0 01-1-1V3H5zm2-1h6a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V2z" />
          </svg>
          <span className="copy-text">{copied ? t("demo.outputPanel.copied") : t("demo.outputPanel.copy")}</span>
        </button>
      </div>
      <pre
        className="output-content min-h-0 flex-1 overflow-auto bg-muted/40 p-5 font-mono text-[0.8125rem] leading-relaxed text-foreground"
        id="output-content"
        data-blok-testid="output-content"
      >
        {output}
      </pre>
    </div>
  );
};
