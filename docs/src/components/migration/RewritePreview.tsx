import { DIFF_CHANGES } from "./migration-data";
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
 * DIFF_CHANGES rendered as a flat, editor-style diff — full-width tinted rows
 * with a −/+ gutter and blank lines between groups, no boxes or labels — with
 * a link down to the full list.
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

        <div className="py-4 font-mono text-xs leading-5">
          {PREVIEW_CHANGES.map((change, index) => (
            <div
              key={change.titleKey}
              className={cn("rw-row", index > 0 && "mt-5")}
              style={{ "--rw-delay": `${450 + index * 650}ms` } as React.CSSProperties}
            >
              <div className="flex items-start gap-3 bg-destructive/[0.05] px-5 py-1">
                <span className="select-none font-bold text-destructive/60" aria-label={t('migration.removed')}>−</span>
                <code className="rw-removed min-w-0 break-all text-muted-foreground line-through decoration-destructive/40">{change.removed}</code>
              </div>
              <div className="rw-added flex items-start gap-3 px-5 py-1">
                <span className="select-none font-bold text-muted-foreground/50" aria-label={t('migration.added')}>+</span>
                <code className="min-w-0 break-all font-medium text-foreground">{change.added}</code>
              </div>
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
