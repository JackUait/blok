import { useState, useMemo } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { cn } from "@/lib/utils";

type Tab = "dry-run" | "apply";

const DRY_RUN_CODE =
  "npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run";
const APPLY_CODE = "npx -p @jackuait/blok migrate-from-editorjs ./src";

export const CodemodCard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("dry-run");
  const { t } = useI18n();

  const codemodOptions = useMemo(() => [
    {
      flag: "--dry-run",
      description: t('migration.codemodDryRunDescription'),
    },
    {
      flag: "--verbose",
      description: t('migration.codemodVerboseDescription'),
    },
    {
      flag: "--use-library-i18n",
      description: t('migration.codemodI18nDescription'),
    },
  ], [t]);

  return (
    <div
      className="overflow-hidden"
      data-blok-testid="codemod-card"
    >
      <div className="p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-sm"
            data-blok-testid="codemod-icon"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-foreground">{t('migration.codemodTitle')}</h2>
          </div>
        </div>

        <div
          className="mb-5 inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
          data-blok-testid="codemod-tabs"
        >
          <button
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === "dry-run"
                ? "active bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("dry-run")}
            type="button"
            data-blok-testid="codemod-tab-dry-run"
          >
            <span className="flex items-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span>{t('migration.codemodPreviewTab')}</span>
          </button>
          <button
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === "apply"
                ? "active bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("apply")}
            type="button"
            data-blok-testid="codemod-tab-apply"
          >
            <span className="flex items-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>
            <span>{t('migration.codemodApplyTab')}</span>
          </button>
        </div>

        <div data-blok-testid="codemod-content">
          <div
            className={cn(
              activeTab === "dry-run" ? "active block" : "hidden",
            )}
            data-blok-testid="codemod-panel-dry-run"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary" />
              <p className="text-sm font-medium text-foreground">
                <Typo>{t('migration.codemodPreviewLabel')}</Typo> <span className="text-muted-foreground"><Typo>{t('migration.codemodPreviewHint')}</Typo></span>
              </p>
            </div>
            <CodeBlock code={DRY_RUN_CODE} language="bash" />
          </div>
          <div
            className={cn(
              activeTab === "apply" ? "active block" : "hidden",
            )}
            data-blok-testid="codemod-panel-apply"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-foreground" />
              <p className="text-sm font-medium text-foreground"><Typo>{t('migration.codemodApplyLabel')}</Typo></p>
            </div>
            <CodeBlock code={APPLY_CODE} language="bash" />
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6" data-blok-testid="codemod-options">
          <div className="mb-4">
            <h4
              className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground"
              data-blok-testid="codemod-options-title"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {t('migration.codemodOptionsTitle')}
            </h4>
          </div>
          <div className="flex flex-col gap-2">
            {codemodOptions.map((option) => (
              <div
                key={option.flag}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-secondary/40 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <code className="w-fit shrink-0 rounded-md bg-card px-2 py-0.5 font-mono text-xs font-semibold text-primary shadow-sm">{option.flag}</code>
                <span className="text-sm text-muted-foreground"><Typo>{option.description}</Typo></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
