import { useMemo } from "react";
import { CSS_MAPPINGS, VERSION_COMPATIBILITY } from "./migration-data";
import { useI18n } from "../../contexts/I18nContext";

export const MigrationSteps: React.FC = () => {
  const { t } = useI18n();

  const changeItems = useMemo(() => [
    {
      icon: "1",
      title: t('migration.changeImports'),
      removed: "import EditorJS from '@editorjs/editorjs';",
      added: "import { Blok } from '@jackuait/blok';",
    },
    {
      icon: "2",
      title: t('migration.changeToolImports'),
      removed: "import Header from '@editorjs/header';",
      added: "import { Header } from '@jackuait/blok/tools';",
    },
    {
      icon: "3",
      title: t('migration.changeTypes'),
      removed: "import type { EditorConfig } from '@editorjs/editorjs';",
      added: "import type { BlokConfig } from '@jackuait/blok';",
    },
    {
      icon: "4",
      title: t('migration.changeCssSelectors'),
      removed: ".ce-block",
      added: "[data-blok-element]",
    },
    {
      icon: "5",
      title: t('migration.changeDefaultHolder'),
      removed: '<div id="editorjs"></div>',
      added: '<div id="blok"></div>',
    },
    {
      icon: "6",
      title: t('migration.changeDataAttributes'),
      removed: "data-id",
      added: "data-blok-id",
    },
  ], [t]);

  return (
    <>
      <section
        className="mx-auto w-full max-w-5xl px-6 py-12"
        data-blok-testid="migration-section"
      >
        <div className="mb-8 text-center">
          <span className="mb-3 inline-block rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
            {t('migration.step2Badge')}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.step2Title')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('migration.step2Description')}
          </p>
        </div>

        <div
          className="mb-8 rounded-2xl border border-border bg-secondary/50 p-6"
          data-blok-testid="alias-note"
        >
          <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.aliasNoteTitle')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t('migration.aliasNoteDescription')}
          </p>
          <code className="mt-3 inline-block rounded-lg bg-card px-3 py-2 font-mono text-sm text-primary shadow-sm">{t('migration.aliasNoteCode')}</code>
        </div>

        <div
          className="grid gap-5 sm:grid-cols-2"
          data-blok-testid="changes-grid"
        >
          {changeItems.map((item) => (
            <article
              key={item.icon}
              className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              data-blok-testid="change-card"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-primary-foreground">{item.icon}</span>
                <h3 className="text-base font-bold tracking-tight text-foreground">{item.title}</h3>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                  <span className="select-none font-mono text-sm font-bold text-destructive" aria-label={t('migration.removed')}>−</span>
                  <code className="break-all font-mono text-xs text-muted-foreground line-through decoration-destructive/40">{item.removed}</code>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <span className="select-none font-mono text-sm font-bold text-primary" aria-label={t('migration.added')}>+</span>
                  <code className="break-all font-mono text-xs text-foreground">{item.added}</code>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-4xl px-6 py-12"
        data-blok-testid="css-reference-section"
      >
        <div className="mb-8 text-center">
          <span className="mb-3 inline-block rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
            {t('migration.step3Badge')}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.step3Title')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('migration.step3Description')}
          </p>
        </div>

        <div
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
          data-blok-testid="migration-table"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/50 px-5 py-4">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2 rounded-full bg-muted-foreground" />
                <span>{t('migration.heroFromEditorJS')}</span>
              </div>
              <svg className="text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <div className="flex items-center gap-2 text-primary">
                <span className="size-2 rounded-full bg-primary" />
                <span>{t('migration.heroBlok')}</span>
              </div>
            </div>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">{t('migration.selectorsCount').replace('{count}', String(CSS_MAPPINGS.length))}</span>
          </div>
          <div className="divide-y divide-border">
            {CSS_MAPPINGS.map((mapping, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <code className="break-all font-mono text-xs text-muted-foreground">{mapping.editorjs}</code>
                </div>
                <svg className="text-primary" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="min-w-0">
                  <code className="break-all font-mono text-xs text-foreground">{mapping.blok}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-5xl px-6 py-12"
        data-blok-testid="custom-tools-section"
      >
        <div className="mb-8 text-center">
          <span className="mb-3 inline-block rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
            {t('migration.step4Badge')}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.step4Title')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('migration.step4Description')}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-blok-testid="custom-tools-grid">
          <article className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-blok-testid="custom-tool-card">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-primary-foreground">@</span>
              <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.customInlineToolTitle')}</h3>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <span className="select-none font-mono text-sm font-bold text-destructive" aria-label={t('migration.removed')}>−</span>
                <code className="break-all font-mono text-xs text-muted-foreground line-through decoration-destructive/40">{t('migration.customInlineToolBefore')}</code>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <span className="select-none font-mono text-sm font-bold text-primary" aria-label={t('migration.added')}>+</span>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.customInlineToolAfter')}</code>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-blok-testid="custom-tool-card">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-primary-foreground">⚡</span>
              <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.customInlineToolFastPathTitle')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('migration.customInlineToolFastPathNote')}
            </p>
            <code className="mt-3 inline-block rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-primary">{t('migration.customInlineToolFastPathCode')}</code>
          </article>

          <article className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-blok-testid="custom-tool-card">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-primary-foreground">✓</span>
              <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.customBlockToolTitle')}</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('migration.customBlockToolNote')}
            </p>
          </article>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-secondary/50 p-6" data-blok-testid="dropped-fields-note">
          <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.droppedFieldsTitle')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t('migration.droppedFieldsWarning')}
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 px-4 py-2.5">
                <code className="break-all font-mono text-xs text-muted-foreground">{t('migration.droppedFieldsColBlock')}</code>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.droppedFieldsColFields')}</code>
              </div>
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 px-4 py-2.5">
                <code className="break-all font-mono text-xs text-muted-foreground">{t('migration.droppedFieldsQuoteBlock')}</code>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.droppedFieldsQuoteFields')}</code>
              </div>
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 px-4 py-2.5">
                <code className="break-all font-mono text-xs text-muted-foreground">{t('migration.droppedFieldsImageBlock')}</code>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.droppedFieldsImageFields')}</code>
              </div>
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 px-4 py-2.5">
                <code className="break-all font-mono text-xs text-muted-foreground">{t('migration.droppedFieldsLinkToolBlock')}</code>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.droppedFieldsLinkToolFields')}</code>
              </div>
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 px-4 py-2.5">
                <code className="break-all font-mono text-xs text-muted-foreground">{t('migration.droppedFieldsListBlock')}</code>
                <code className="break-all font-mono text-xs text-foreground">{t('migration.droppedFieldsListFields')}</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-4xl px-6 py-12"
        data-blok-testid="supported-versions-section"
      >
        <div className="mb-8 text-center">
          <span className="mb-3 inline-block rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
            {t('migration.supportedVersionsBadge')}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.supportedVersionsTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {t('migration.supportedVersionsDescription')}
          </p>
        </div>

        <div className="mb-8 rounded-2xl border border-border bg-secondary/50 p-6" data-blok-testid="supported-versions-target">
          <h3 className="text-base font-bold tracking-tight text-foreground">{t('migration.supportedVersionsTargetTitle')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t('migration.supportedVersionsTarget')}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card" data-blok-testid="compatibility-matrix">
          <div className="divide-y divide-border">
            {VERSION_COMPATIBILITY.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/40"
                data-blok-testid="compatibility-row"
              >
                <div className="min-w-0">
                  <code className="break-all font-mono text-xs text-muted-foreground">{row.tool}</code>
                </div>
                <svg className="text-primary" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{t(row.statusKey)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-sm leading-relaxed text-muted-foreground" data-blok-testid="compatibility-stub-note">
          {t('migration.supportedVersionsStubNote')}
        </p>
      </section>
    </>
  );
};
