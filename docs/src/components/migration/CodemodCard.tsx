import { useMemo } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { CODEMOD_APPLY_COMMAND, CODEMOD_DRY_RUN_COMMAND } from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";

/**
 * The codemod as a terminal session: preview first, then apply — sequential,
 * the way the real workflow runs — followed by the CLI options and the
 * drop-in EditorJS alias note.
 */
export const CodemodCard: React.FC = () => {
  const { t } = useI18n();

  const codemodOptions = useMemo(() => [
    { flag: "--dry-run", description: t('migration.codemodDryRunDescription') },
    { flag: "--verbose", description: t('migration.codemodVerboseDescription') },
    { flag: "--use-library-i18n", description: t('migration.codemodI18nDescription') },
  ], [t]);

  const sessionSteps = useMemo(() => [
    {
      id: "dry-run",
      label: t('migration.codemodStepDryRun'),
      hint: t('migration.codemodPreviewLabel'),
      command: CODEMOD_DRY_RUN_COMMAND,
    },
    {
      id: "apply",
      label: t('migration.codemodStepApply'),
      hint: t('migration.codemodApplyLabel'),
      command: CODEMOD_APPLY_COMMAND,
    },
  ], [t]);

  return (
    <div className="flex flex-col gap-6" data-blok-testid="codemod-card">
      {/* One terminal window, two prompts — not two stacked cards. */}
      <div
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
        data-blok-testid="codemod-session"
      >
        <div className="divide-y divide-border">
          {sessionSteps.map((step, index) => (
            <div key={step.id} className="px-4 py-4 sm:px-5" data-blok-testid={`codemod-step-${step.id}`}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pl-1">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[10px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-sm font-semibold text-foreground">{step.label}</span>
                <span className="text-sm text-muted-foreground"><Typo>{step.hint}</Typo></span>
              </div>
              <CodeBlock code={step.command} language="bash" embedded />
            </div>
          ))}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
        data-blok-testid="codemod-options"
      >
        <h3 className="border-b border-border bg-secondary/50 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t('migration.codemodOptionsTitle')}
        </h3>
        <dl className="flex flex-col divide-y divide-border">
          {codemodOptions.map((option) => (
            <div
              key={option.flag}
              className="flex flex-col gap-1 px-5 py-3.5 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="shrink-0 font-mono text-xs font-semibold text-foreground sm:w-44">
                {option.flag}
              </dt>
              <dd className="text-sm text-muted-foreground"><Typo>{option.description}</Typo></dd>
            </div>
          ))}
        </dl>
      </div>

      <aside
        className="rounded-2xl border border-border bg-secondary/50 p-5"
        data-blok-testid="alias-note"
      >
        <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.aliasNoteTitle')}</Typo></h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          <Typo>{t('migration.aliasNoteDescription')}</Typo>
        </p>
        <code className="mt-3.5 block overflow-x-auto rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs whitespace-pre text-foreground">{t('migration.aliasNoteCode')}</code>
      </aside>
    </div>
  );
};
