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
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8"
      data-blok-testid="codemod-card"
    >
      <div className="flex flex-col gap-6">
        {sessionSteps.map((step, index) => (
          <div key={step.id} data-blok-testid={`codemod-step-${step.id}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
                {index + 1}
              </span>
              <span className="text-sm font-semibold text-foreground">{step.label}</span>
              <span className="text-sm text-muted-foreground"><Typo>{step.hint}</Typo></span>
            </div>
            <CodeBlock code={step.command} language="bash" />
          </div>
        ))}
      </div>

      <div className="mt-8 border-t border-border pt-6" data-blok-testid="codemod-options">
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          {t('migration.codemodOptionsTitle')}
        </h3>
        <dl className="mt-4 flex flex-col divide-y divide-border">
          {codemodOptions.map((option) => (
            <div
              key={option.flag}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <dt className="shrink-0 font-mono text-xs font-semibold text-foreground sm:w-40">
                {option.flag}
              </dt>
              <dd className="text-sm text-muted-foreground"><Typo>{option.description}</Typo></dd>
            </div>
          ))}
        </dl>
      </div>

      <div
        className="mt-6 rounded-xl bg-secondary/60 p-5"
        data-blok-testid="alias-note"
      >
        <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.aliasNoteTitle')}</Typo></h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          <Typo>{t('migration.aliasNoteDescription')}</Typo>
        </p>
        <code className="mt-3 inline-block rounded-lg bg-card px-3 py-2 font-mono text-xs text-foreground shadow-sm">{t('migration.aliasNoteCode')}</code>
      </div>
    </div>
  );
};
