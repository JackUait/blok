import { DIFF_CHANGES } from "./migration-data";
import { Diff } from "./Diff";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { cn } from "@/lib/utils";

/** One rewrite per surface the codemod touches: an import, a CSS selector,
 *  a DOM attribute — breadth, not just the headline import swap. */
const PREVIEW_CHANGES = [DIFF_CHANGES[0], DIFF_CHANGES[3], DIFF_CHANGES[5]];

interface RewritePreviewProps {
  className?: string;
}

/**
 * Hero visual: the codemod's output as a floating diff window. Real rows from
 * DIFF_CHANGES — a preview of step 2, not marketing artwork — with a link
 * down to the full list.
 */
export const RewritePreview: React.FC<RewritePreviewProps> = ({ className }) => {
  const { t } = useI18n();

  return (
    <div className={cn("relative", className)} data-blok-testid="hero-rewrite-preview">
      {/* Soft brand glow — the same atmosphere the home hero uses. */}
      <div aria-hidden className="absolute -inset-x-10 -top-12 -bottom-8 -z-10">
        <div className="absolute top-0 right-0 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 left-6 size-52 rounded-full bg-chart-3/10 blur-3xl" />
      </div>

      <div className="hero-float rewrite-live overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border bg-secondary/50 px-4 py-2.5">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            migrate-from-editorjs
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/70">
            <span className="text-destructive/70">−{PREVIEW_CHANGES.length}</span>{" "}
            <span className="text-foreground/70">+{PREVIEW_CHANGES.length}</span>
          </span>
        </div>

        <div className="divide-y divide-border">
          {PREVIEW_CHANGES.map((change, index) => (
            <div
              key={change.titleKey}
              className="rw-row px-4 py-3.5"
              style={{ "--rw-delay": `${450 + index * 650}ms` } as React.CSSProperties}
            >
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                <Typo>{t(change.titleKey)}</Typo>
              </p>
              <Diff removed={change.removed} added={change.added} />
            </div>
          ))}
        </div>

        <a
          href="#changes"
          className="group flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <Typo>{t('migration.sectionChangesTitle')}</Typo>
          <svg className="shrink-0 transition-transform group-hover:translate-x-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
    </div>
  );
};
