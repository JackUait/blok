import { Link } from "react-router-dom";
import {
  BLOK_VERSION_BREAKING_CHANGES,
  COMPATIBILITY_GROUPS,
  CSS_MAPPINGS,
  DIFF_CHANGES,
  MIGRATION_STEPS,
} from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";

interface SectionHeaderProps {
  /** 1-based step number shown as a mono ordinal ("02"). */
  step: number;
  title: string;
  description: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ step, title, description }) => (
  <header className="mb-8">
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-sm tabular-nums text-muted-foreground/70">
        {String(step).padStart(2, "0")}
      </span>
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        <Typo>{title}</Typo>
      </h2>
    </div>
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
      <Typo>{description}</Typo>
    </p>
  </header>
);

const stepNumber = (id: string): number =>
  MIGRATION_STEPS.findIndex((step) => step.id === id) + 1;

/** Steps 2–5 of the migration guide, plus the Blok → Blok upgrade coda. */
export const MigrationSteps: React.FC = () => {
  const { t } = useI18n();

  return (
    <>
      <section
        id="changes"
        className="scroll-mt-24 py-12"
        data-blok-testid="changes-section"
      >
        <SectionHeader
          step={stepNumber("changes")}
          title={t('migration.sectionChangesTitle')}
          description={t('migration.sectionChangesDescription')}
        />

        <div
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
          data-blok-testid="changes-diff"
        >
          <div className="divide-y divide-border">
            {DIFF_CHANGES.map((change) => (
              <div
                key={change.titleKey}
                className="grid gap-2 px-5 py-4 transition-colors hover:bg-secondary/40 sm:grid-cols-[10rem_1fr] sm:gap-4"
                data-blok-testid="change-row"
              >
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  <Typo>{t(change.titleKey)}</Typo>
                </h3>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <span className="select-none font-mono text-sm font-bold text-destructive" aria-label={t('migration.removed')}>−</span>
                    <code className="break-all font-mono text-xs leading-5 text-muted-foreground line-through decoration-destructive/40">{change.removed}</code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="select-none font-mono text-sm font-bold text-primary" aria-label={t('migration.added')}>+</span>
                    <code className="break-all font-mono text-xs leading-5 text-foreground">{change.added}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="css"
        className="scroll-mt-24 py-12"
        data-blok-testid="css-reference-section"
      >
        <SectionHeader
          step={stepNumber("css")}
          title={t('migration.sectionCssTitle')}
          description={t('migration.sectionCssDescription')}
        />

        <div
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
          data-blok-testid="migration-table"
        >
          <div className="flex items-center gap-3 border-b border-border bg-secondary/50 px-5 py-3.5 text-sm font-semibold">
            <span className="text-muted-foreground"><Typo>{t('migration.heroFromEditorJS')}</Typo></span>
            <svg className="text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <span className="text-foreground">{t('migration.heroBlok')}</span>
          </div>
          <div className="divide-y divide-border">
            {CSS_MAPPINGS.map((mapping) => (
              <div
                key={mapping.editorjs}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/40"
              >
                <code className="min-w-0 break-all font-mono text-xs text-muted-foreground">{mapping.editorjs}</code>
                <svg className="text-muted-foreground" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <code className="min-w-0 break-all font-mono text-xs text-foreground">{mapping.blok}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="tools"
        className="scroll-mt-24 py-12"
        data-blok-testid="custom-tools-section"
      >
        <SectionHeader
          step={stepNumber("tools")}
          title={t('migration.sectionToolsTitle')}
          description={t('migration.sectionToolsDescription')}
        />

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card" data-blok-testid="custom-tools-grid">
          <div className="divide-y divide-border">
            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customInlineToolTitle')}</Typo></h3>
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <span className="select-none font-mono text-sm font-bold text-destructive" aria-label={t('migration.removed')}>−</span>
                  <code className="break-all font-mono text-xs leading-5 text-muted-foreground line-through decoration-destructive/40">{t('migration.customInlineToolBefore')}</code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="select-none font-mono text-sm font-bold text-primary" aria-label={t('migration.added')}>+</span>
                  <code className="break-all font-mono text-xs leading-5 text-foreground">{t('migration.customInlineToolAfter')}</code>
                </div>
              </div>
            </article>

            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customInlineToolFastPathTitle')}</Typo></h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <Typo>{t('migration.customInlineToolFastPathNote')}</Typo>
              </p>
              <code className="mt-3 inline-block rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-foreground">{t('migration.customInlineToolFastPathCode')}</code>
            </article>

            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customBlockToolTitle')}</Typo></h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <Typo>{t('migration.customBlockToolNote')}</Typo>
              </p>
            </article>
          </div>
        </div>

        <div className="mt-8" data-blok-testid="dropped-fields-note">
          <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.droppedFieldsTitle')}</Typo></h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            <Typo>{t('migration.droppedFieldsWarning')}</Typo>
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[8rem_1fr] items-center gap-3 bg-secondary/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground sm:grid-cols-[10rem_1fr]">
                <span><Typo>{t('migration.droppedFieldsColBlock')}</Typo></span>
                <span><Typo>{t('migration.droppedFieldsColFields')}</Typo></span>
              </div>
              {([
                ['droppedFieldsQuoteBlock', 'droppedFieldsQuoteFields'],
                ['droppedFieldsImageBlock', 'droppedFieldsImageFields'],
                ['droppedFieldsLinkToolBlock', 'droppedFieldsLinkToolFields'],
                ['droppedFieldsListBlock', 'droppedFieldsListFields'],
              ] as const).map(([blockKey, fieldsKey]) => (
                <div key={blockKey} className="grid grid-cols-[8rem_1fr] items-baseline gap-3 px-4 py-2.5 sm:grid-cols-[10rem_1fr]">
                  <code className="break-all font-mono text-xs text-muted-foreground">{t(`migration.${blockKey}`)}</code>
                  <span className="text-xs leading-5 text-foreground"><Typo>{t(`migration.${fieldsKey}`)}</Typo></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="verify"
        className="scroll-mt-24 py-12"
        data-blok-testid="supported-versions-section"
      >
        <SectionHeader
          step={stepNumber("verify")}
          title={t('migration.sectionVerifyTitle')}
          description={t('migration.sectionVerifyDescription')}
        />

        <div className="mb-6 rounded-xl bg-secondary/60 p-5" data-blok-testid="supported-versions-target">
          <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.supportedVersionsTargetTitle')}</Typo></h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            <Typo>{t('migration.supportedVersionsTarget')}</Typo>
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card" data-blok-testid="compatibility-matrix">
          <div className="divide-y divide-border">
            {COMPATIBILITY_GROUPS.map((group) => (
              <div key={group.id} className="px-5 py-5" data-blok-testid="compatibility-group">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                  <h3 className="shrink-0 text-sm font-bold tracking-tight text-foreground"><Typo>{t(group.titleKey)}</Typo></h3>
                  <p className="text-sm text-muted-foreground"><Typo>{t(group.hintKey)}</Typo></p>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {group.tools.map((tool) => (
                    <li key={tool}>
                      <code className="inline-block rounded-full border border-border bg-secondary/40 px-2.5 py-1 font-mono text-xs text-foreground">{tool}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground" data-blok-testid="compatibility-stub-note">
          <Typo>{t('migration.supportedVersionsStubNote')}</Typo>
        </p>
      </section>

      <section
        className="border-t border-border py-12"
        data-blok-testid="blok-upgrade-section"
      >
        <header className="mb-8">
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            <Typo>{t('migration.blokUpgradeTitle')}</Typo>
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            <Typo>{t('migration.blokUpgradeDescription')}</Typo>
          </p>
        </header>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card" data-blok-testid="blok-upgrade-table">
          <div className="divide-y divide-border">
            {BLOK_VERSION_BREAKING_CHANGES.map((change) => (
              <div
                key={change.version}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-4"
                data-blok-testid="blok-upgrade-row"
              >
                <code className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
                  v{change.version}
                </code>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <Typo>{t(change.descriptionKey)}</Typo>{' '}
                  <Link
                    to={change.link}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    <Typo>{t('migration.blokUpgradeViewChangelog')}</Typo>
                  </Link>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};
