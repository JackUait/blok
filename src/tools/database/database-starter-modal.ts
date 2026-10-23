import { IconBoard, IconChevronLeft, IconCross, IconListBulleted, IconTable, IconTimeline } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { PROPERTY_TYPE_META } from './database-property-types';
import { hiddenPropertyCount } from './database-starters';
import type { StarterBuild, StarterChoice, StarterMeta, StarterRow } from './database-starters';
import { createOptionPill } from './cells/display';
import type { PropertyDefinition, PropertyType, SelectOption, ViewType } from './types';

export interface StarterPicks {
  features: Set<string>;
  views: Set<string>;
}

export interface StarterCustomizeOptions {
  meta: StarterMeta;
  t: (key: string, vars?: Record<string, string>) => string;
  /** The database the picks would build, for the preview. */
  preview: (picks: StarterPicks) => StarterBuild;
  /** Opened from the templates gallery: step one leads back to it with "←", and its button reads "Continue" (findings-creation N09). */
  onBack?: () => void;
  directionSource?: Element | null;
}

const VIEW_ICONS: Partial<Record<ViewType, string>> = { table: IconTable, board: IconBoard, list: IconListBulleted, timeline: IconTimeline };

const iconOf = (kind: StarterChoice['kind']): string =>
  VIEW_ICONS[kind as ViewType] ?? (Object.hasOwn(PROPERTY_TYPE_META, kind) ? PROPERTY_TYPE_META[kind as PropertyType].icon : '');

const counter = { next: 0 };

const TAB_ICONS: Partial<Record<ViewType, string>> = { ...VIEW_ICONS, list: IconListBulleted };

/** A preview glyph: Blok's own icon constants, never user text. */
const glyphOf = (svg: string): HTMLElement => {
  const icon = document.createElement('span');

  icon.setAttribute('data-blok-database-starter-preview-glyph', '');
  icon.setAttribute('aria-hidden', 'true');
  // No whitespace text: the preview's cells are read by their text.
  icon.innerHTML = svg.replace(/>\s+</g, '><').trim();

  return icon;
};

/**
 * research/30 B8: a grouped table's preview is drawn grouped. A heading per
 * group in the view's manual order, each over its rows, then the no-value
 * group. The heading's look was not measured: the option pill.
 */
const groupedLines = (
  made: StarterBuild,
  view: StarterBuild['views'][number],
  rows: StarterRow[],
  rowLine: (row: StarterRow) => HTMLElement,
  t: StarterCustomizeOptions['t']
): HTMLElement[] => {
  const property = made.schema.find((p) => p.id === view.groupBy);

  // Only grouped tables were seen grouped; a grouped board's preview was not read.
  if (view.type !== 'table' || property === undefined || (property.type !== 'select' && property.type !== 'multiSelect')) return rows.map(rowLine);
  const keyOf = (option: SelectOption): string => view.groupOrder?.[option.id] ?? option.position;
  const options = [...(property.config?.options ?? [])].sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));
  const valuesOf = (row: StarterRow): string[] => {
    const value = row.data.properties[property.id];

    if (typeof value === 'string') return [value];

    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  };
  const heading = (content: HTMLElement | string): HTMLElement => {
    const el = document.createElement('div');

    el.setAttribute('data-blok-database-starter-preview-group', '');
    el.append(content);

    return el;
  };
  const empty = rows.filter((row) => valuesOf(row).length === 0);

  return [
    ...options.flatMap((option) => [heading(createOptionPill(option)), ...rows.filter((row) => valuesOf(row).includes(option.id)).map(rowLine)]),
    heading(t('tools.database.noValueGroup', { property: property.name })),
    ...empty.map(rowLine),
  ];
};

/**
 * Notion's two-step "Customize" modal (research/27 §1b): feature chips, then
 * view cards, beside a preview. Resolves the picks on Done, null when closed.
 * A pick is ringed in primary ink, never blue (no-blue law).
 */
export const openStarterCustomize = (options: StarterCustomizeOptions): Promise<StarterPicks | null> => new Promise((resolve) => {
  const { meta, t } = options;
  const name = t(meta.nameKey);
  const picks: StarterPicks = {
    features: new Set(meta.features.filter((c) => c.on).map((c) => c.id)),
    views: new Set(meta.views.filter((c) => c.on).map((c) => c.id)),
  };
  const backdrop = document.createElement('div');
  const surface = document.createElement('div');
  const form = document.createElement('div');
  const nav = document.createElement('button');
  const heading = document.createElement('div');
  const hint = document.createElement('div');
  const choices = document.createElement('div');
  const primary = document.createElement('button');
  const preview = document.createElement('div');
  const hidden = document.createElement('div');
  const step = { at: 1 };
  const focus: { view?: string } = {};

  counter.next += 1;
  backdrop.setAttribute('data-blok-popover', '');
  backdrop.setAttribute('data-blok-database-starter-backdrop', '');
  surface.setAttribute('data-blok-database-starter-modal', '');
  surface.setAttribute('data-blok-testid', 'database-starter-modal');
  form.setAttribute('data-blok-database-starter-form', '');
  nav.type = 'button';
  nav.setAttribute('data-blok-database-starter-nav', '');
  heading.id = `blok-database-starter-heading-${counter.next}`;
  heading.setAttribute('data-blok-database-starter-heading', '');
  heading.setAttribute('data-blok-testid', 'database-starter-heading');
  heading.textContent = t('tools.database.starterCustomize', { name });
  hint.setAttribute('data-blok-database-starter-hint', '');
  choices.setAttribute('data-blok-database-starter-choices', '');
  primary.type = 'button';
  primary.setAttribute('data-blok-database-starter-primary', '');
  preview.setAttribute('data-blok-database-starter-preview', '');
  preview.setAttribute('aria-hidden', 'true');
  hidden.setAttribute('data-blok-database-starter-preview-hidden', '');

  const drawPreview = (): void => {
    const made = options.preview(picks);
    const title = document.createElement('div');
    const tabs = document.createElement('div');
    const table = document.createElement('div');
    // research/30 B8: a view card turned on shows its view; else the first view.
    const shownName = meta.views.find((c) => c.id === focus.view && picks.views.has(c.id));
    const first = made.views.find((view) => shownName !== undefined && view.name === t(shownName.labelKey)) ?? made.views[0];
    const last = made.previewLast ?? [];
    const shown = (first?.visibleProperties ?? []).filter((id) => !last.includes(id));
    const columns = [made.schema[0], ...[...shown, ...last.filter((id) => (first?.visibleProperties ?? []).includes(id))].map((id) => made.schema.find((p) => p.id === id))]
      .filter((p) => p !== undefined);
    const line = (cells: Array<string | HTMLElement>, header: boolean): HTMLElement => {
      const row = document.createElement('div');

      row.setAttribute('data-blok-database-starter-preview-row', header ? 'header' : '');
      row.append(...cells.map((content) => {
        const cell = document.createElement('span');

        cell.append(content);

        return cell;
      }));

      return row;
    };

    title.setAttribute('data-blok-database-starter-preview-title', '');
    title.textContent = made.title;
    tabs.setAttribute('data-blok-database-starter-preview-tabs', '');
    tabs.append(...made.views.map((view) => {
      const tab = document.createElement('span');

      tab.append(glyphOf(TAB_ICONS[view.type] ?? IconTable), view.name);
      if (view === first) tab.setAttribute('aria-current', 'true');

      return tab;
    }));
    table.setAttribute('data-blok-database-starter-preview-table', '');
    const order = first?.rowOrder;
    const rows = [...made.rows].sort((x, y) => ((order?.[x.id] ?? x.data.position) < (order?.[y.id] ?? y.data.position) ? -1 : 1));
    // findings-creation N07: the rows' own values, an option as its pill.
    const value = (row: StarterRow, property: PropertyDefinition): string | HTMLElement => {
      const raw = row.data.properties[property.id];
      const option = property.config?.options?.find((o) => o.id === (Array.isArray(raw) ? raw[0] : raw));

      if (option !== undefined) return createOptionPill(option);

      return typeof raw === 'string' && property.type === 'text' ? raw : '';
    };
    const rowLine = (row: StarterRow): HTMLElement => line(columns.map((p, i) => (i === 0 ? row.data.title ?? '' : value(row, p))), false);
    const header = line(columns.map((p) => p.name), true);

    [...header.children].forEach((cell, i) => cell.prepend(glyphOf(PROPERTY_TYPE_META[columns[i].type].icon)));
    table.append(header, ...(first === undefined ? rows.map(rowLine) : groupedLines(made, first, rows, rowLine, t)));
    // research/30 B8: "0 hidden properties" under the table.
    hidden.textContent = t('tools.database.starterHiddenProperties', { count: String(hiddenPropertyCount(made, first)) });
    preview.replaceChildren(title, tabs, table, hidden);
  };

  const chip = (item: StarterChoice, chosen: Set<string>, kind: 'feature' | 'view'): HTMLButtonElement => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    const label = document.createElement('span');
    const paint = (): void => button.setAttribute('aria-pressed', String(chosen.has(item.id)));

    button.type = 'button';
    button.setAttribute(kind === 'feature' ? 'data-blok-database-starter-chip' : 'data-blok-database-starter-card', '');
    button.setAttribute('data-blok-testid', `database-starter-${kind}-${item.id}`);
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconOf(item.kind);
    label.textContent = t(item.labelKey);
    button.append(icon, label);
    button.addEventListener('click', () => {
      // research/30 B8: the last view stays on.
      if (kind === 'view' && chosen.size === 1 && chosen.has(item.id)) return;
      if (chosen.has(item.id)) chosen.delete(item.id);
      else chosen.add(item.id);
      if (kind === 'view' && chosen.has(item.id)) focus.view = item.id;
      paint();
      drawPreview();
    });
    paint();

    return button;
  };

  const backToGallery = options.onBack;

  const draw = (): void => {
    const first = step.at === 1;
    const closes = first && backToGallery === undefined;
    const firstNavId = backToGallery === undefined ? 'database-starter-close' : 'database-starter-back-gallery';
    const firstLabel = backToGallery === undefined ? 'tools.database.starterGetStarted' : 'tools.database.buttonConfirmContinue';

    nav.innerHTML = closes ? IconCross : IconChevronLeft;
    nav.setAttribute('aria-label', t(closes ? 'tools.database.close' : 'tools.database.peekBack'));
    nav.setAttribute('data-blok-testid', first ? firstNavId : 'database-starter-back');
    hint.textContent = first ? t('tools.database.starterFeaturesHint') : t('tools.database.starterViewsHint', { name });
    choices.setAttribute('data-step', first ? 'features' : 'views');
    choices.replaceChildren(...(first ? meta.features.map((c) => chip(c, picks.features, 'feature')) : meta.views.map((c) => chip(c, picks.views, 'view'))));
    primary.textContent = t(first ? firstLabel : 'tools.database.layoutSectionDone');
    primary.setAttribute('data-blok-testid', first ? 'database-starter-next' : 'database-starter-done');
  };

  form.append(nav, heading, hint, choices, primary);
  surface.append(form, preview);
  backdrop.appendChild(surface);
  draw();
  drawPreview();

  const settled = { done: false };
  const finish = (answer: StarterPicks | null): void => {
    if (settled.done) return;
    settled.done = true;
    handle.close();
    resolve(answer);
  };
  const handle = openModalDialog({
    content: backdrop,
    surface,
    role: 'dialog',
    labelledBy: heading.id,
    initialFocus: () => nav,
    directionSource: options.directionSource ?? null,
    onDismiss: () => finish(null),
  });

  nav.addEventListener('click', () => {
    if (step.at === 1) {
      finish(null);
      backToGallery?.();

      return;
    }
    step.at = 1;
    draw();
    nav.focus();
  });
  primary.addEventListener('click', () => {
    if (step.at === 2) {
      finish({ features: new Set(picks.features), views: new Set(picks.views) });

      return;
    }
    step.at = 2;
    draw();
    nav.focus();
  });
});
