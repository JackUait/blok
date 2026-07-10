import { Link } from "react-router-dom";
import {
  BLOK_VERSION_BREAKING_CHANGES,
  COMPATIBILITY_GROUPS,
  CSS_MAPPINGS,
  DIFF_CHANGES,
  MIGRATION_STEPS,
} from "./migration-data";
import { MigrationSectionHeader } from "./MigrationSectionHeader";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";

const stepNumber = (id: string): number =>
  MIGRATION_STEPS.findIndex((step) => step.id === id) + 1;

/** Shared chrome for every step section: chapter rule + consistent rhythm. */
const SECTION_CLASS = "scroll-mt-28 border-t border-border pt-12 pb-16";

/** Shared chrome for the bordered content shells inside each step. */
const SHELL_CLASS = "overflow-hidden rounded-2xl border border-border bg-card shadow-card";

/** Selector-mapping columns. The arrow gets its own track so the header labels
 *  sit directly above the code they name. */
const MAPPING_GRID =
  "grid grid-cols-[minmax(0,1fr)_0.8125rem_minmax(0,1fr)] items-center gap-x-3";

interface DiffProps {
  removed: string;
  added: string;
}

/**
 * A before/after pair. The palette has no green, so the added line earns its
 * emphasis from weight and full-contrast ink rather than a foreign hue.
 */
const Diff: React.FC<DiffProps> = ({ removed, added }) => {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-start gap-2.5 rounded-lg bg-destructive/[0.06] px-2.5 py-1.5">
        <span className="select-none font-mono text-sm leading-5 font-bold text-destructive/70" aria-label={t('migration.removed')}>−</span>
        <code className="min-w-0 break-all font-mono text-xs leading-5 text-muted-foreground line-through decoration-destructive/40">{removed}</code>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5">
        <span className="select-none font-mono text-sm leading-5 font-bold text-foreground/50" aria-label={t('migration.added')}>+</span>
        <code className="min-w-0 break-all font-mono text-xs leading-5 font-medium text-foreground">{added}</code>
      </div>
    </div>
  );
};

/** Steps 2–5 of the migration guide, plus the Blok → Blok upgrade coda. */
export const MigrationSteps: React.FC = () => {
  const { t } = useI18n();

  return (
    <>
      <section id="changes" className={SECTION_CLASS} data-blok-testid="changes-section">
        <MigrationSectionHeader
          step={stepNumber("changes")}
          title={t('migration.sectionChangesTitle')}
          description={t('migration.sectionChangesDescription')}
        />

        <div className={SHELL_CLASS} data-blok-testid="changes-diff">
          <div className="divide-y divide-border">
            {DIFF_CHANGES.map((change) => (
              <div
                key={change.titleKey}
                className="grid gap-2.5 px-4 py-4 transition-colors hover:bg-secondary/40 sm:grid-cols-[9rem_1fr] sm:gap-5 sm:px-5"
                data-blok-testid="change-row"
              >
                <h3 className="pt-1.5 text-sm font-semibold tracking-tight text-foreground">
                  <Typo>{t(change.titleKey)}</Typo>
                </h3>
                <Diff removed={change.removed} added={change.added} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="css" className={SECTION_CLASS} data-blok-testid="css-reference-section">
        <MigrationSectionHeader
          step={stepNumber("css")}
          title={t('migration.sectionCssTitle')}
          description={t('migration.sectionCssDescription')}
        />

        <div className={SHELL_CLASS} data-blok-testid="migration-table">
          <div className={`${MAPPING_GRID} border-b border-border bg-secondary/50 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground`}>
            <span><Typo>{t('migration.heroFromEditorJS')}</Typo></span>
            <span aria-hidden />
            <span className="text-foreground">{t('migration.heroBlok')}</span>
          </div>
          <div className="divide-y divide-border">
            {CSS_MAPPINGS.map((mapping) => (
              <div
                key={mapping.editorjs}
                className={`group ${MAPPING_GRID} px-5 py-3 transition-colors hover:bg-secondary/40`}
              >
                <code className="min-w-0 break-all font-mono text-xs text-muted-foreground">{mapping.editorjs}</code>
                <svg className="text-muted-foreground/40 transition-colors group-hover:text-primary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <code className="min-w-0 break-all font-mono text-xs font-medium text-foreground">{mapping.blok}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tools" className={SECTION_CLASS} data-blok-testid="custom-tools-section">
        <MigrationSectionHeader
          step={stepNumber("tools")}
          title={t('migration.sectionToolsTitle')}
          description={t('migration.sectionToolsDescription')}
        />

        <div className={SHELL_CLASS} data-blok-testid="custom-tools-grid">
          <div className="divide-y divide-border">
            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="mb-3 text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customInlineToolTitle')}</Typo></h3>
              <Diff
                removed={t('migration.customInlineToolBefore')}
                added={t('migration.customInlineToolAfter')}
              />
            </article>

            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customInlineToolFastPathTitle')}</Typo></h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                <Typo>{t('migration.customInlineToolFastPathNote')}</Typo>
              </p>
              <code className="mt-3 inline-block rounded-lg border border-border bg-secondary/60 px-3 py-2 font-mono text-xs text-foreground">{t('migration.customInlineToolFastPathCode')}</code>
            </article>

            <article className="px-5 py-5" data-blok-testid="custom-tool-card">
              <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.customBlockToolTitle')}</Typo></h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                <Typo>{t('migration.customBlockToolNote')}</Typo>
              </p>
            </article>
          </div>
        </div>

        <div className="mt-10" data-blok-testid="dropped-fields-note">
          <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.droppedFieldsTitle')}</Typo></h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            <Typo>{t('migration.droppedFieldsWarning')}</Typo>
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[7rem_1fr] items-center gap-3 bg-secondary/50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:grid-cols-[10rem_1fr]">
                <span><Typo>{t('migration.droppedFieldsColBlock')}</Typo></span>
                <span><Typo>{t('migration.droppedFieldsColFields')}</Typo></span>
              </div>
              {([
                ['droppedFieldsQuoteBlock', 'droppedFieldsQuoteFields'],
                ['droppedFieldsImageBlock', 'droppedFieldsImageFields'],
                ['droppedFieldsLinkToolBlock', 'droppedFieldsLinkToolFields'],
                ['droppedFieldsListBlock', 'droppedFieldsListFields'],
              ] as const).map(([blockKey, fieldsKey]) => (
                <div key={blockKey} className="grid grid-cols-[7rem_1fr] items-baseline gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/40 sm:grid-cols-[10rem_1fr]">
                  <code className="break-all font-mono text-xs text-foreground">{t(`migration.${blockKey}`)}</code>
                  <span className="text-xs leading-5 text-muted-foreground"><Typo>{t(`migration.${fieldsKey}`)}</Typo></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="verify" className={SECTION_CLASS} data-blok-testid="supported-versions-section">
        <MigrationSectionHeader
          step={stepNumber("verify")}
          title={t('migration.sectionVerifyTitle')}
          description={t('migration.sectionVerifyDescription')}
        />

        <aside className="mb-6 rounded-2xl border border-border bg-secondary/50 p-5" data-blok-testid="supported-versions-target">
          <h3 className="text-sm font-bold tracking-tight text-foreground"><Typo>{t('migration.supportedVersionsTargetTitle')}</Typo></h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            <Typo>{t('migration.supportedVersionsTarget')}</Typo>
          </p>
        </aside>

        <div className={SHELL_CLASS} data-blok-testid="compatibility-matrix">
          <div className="divide-y divide-border">
            {COMPATIBILITY_GROUPS.map((group) => (
              <div key={group.id} className="px-5 py-5" data-blok-testid="compatibility-group">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                  <h3 className="shrink-0 text-sm font-bold tracking-tight text-foreground"><Typo>{t(group.titleKey)}</Typo></h3>
                  <p className="text-sm text-muted-foreground"><Typo>{t(group.hintKey)}</Typo></p>
                </div>
                <ul className="mt-3.5 flex flex-wrap gap-2">
                  {group.tools.map((tool) => (
                    <li key={tool}>
                      <code className="inline-block rounded-full border border-border bg-secondary/40 px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground/25">{tool}</code>
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

      <section className="border-t border-border pt-12 pb-16" data-blok-testid="blok-upgrade-section">
        <header className="mb-8">
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            <Typo>{t('migration.blokUpgradeTitle')}</Typo>
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            <Typo>{t('migration.blokUpgradeDescription')}</Typo>
          </p>
        </header>

        <div className={SHELL_CLASS} data-blok-testid="blok-upgrade-table">
          <div className="divide-y divide-border">
            {BLOK_VERSION_BREAKING_CHANGES.map((change) => (
              <div
                key={change.version}
                className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-start sm:gap-4"
                data-blok-testid="blok-upgrade-row"
              >
                <code className="shrink-0 rounded-lg border border-border bg-secondary/60 px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
                  v{change.version}
                </code>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
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
