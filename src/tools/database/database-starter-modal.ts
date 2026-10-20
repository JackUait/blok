import { IconBoard, IconChevronLeft, IconCross, IconList, IconTable, IconTimeline } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { PROPERTY_TYPE_META } from './database-property-types';
import type { StarterBuild, StarterChoice, StarterMeta } from './database-starters';
import type { PropertyType, ViewType } from './types';

export interface StarterPicks {
  features: Set<string>;
  views: Set<string>;
}

export interface StarterCustomizeOptions {
  meta: StarterMeta;
  t: (key: string, vars?: Record<string, string>) => string;
  /** The database the picks would build, for the preview. */
  preview: (picks: StarterPicks) => StarterBuild;
  directionSource?: Element | null;
}

const VIEW_ICONS: Partial<Record<ViewType, string>> = { table: IconTable, board: IconBoard, list: IconList, timeline: IconTimeline };

const iconOf = (kind: StarterChoice['kind']): string =>
  VIEW_ICONS[kind as ViewType] ?? (Object.hasOwn(PROPERTY_TYPE_META, kind) ? PROPERTY_TYPE_META[kind as PropertyType].icon : '');

const counter = { next: 0 };

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
  const step = { at: 1 };

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

  const drawPreview = (): void => {
    const made = options.preview(picks);
    const title = document.createElement('div');
    const tabs = document.createElement('div');
    const table = document.createElement('div');
    const first = made.views[0];
    const columns = [made.schema[0], ...(first?.visibleProperties ?? []).map((id) => made.schema.find((p) => p.id === id))]
      .filter((p) => p !== undefined);
    const line = (cells: string[], header: boolean): HTMLElement => {
      const row = document.createElement('div');

      row.setAttribute('data-blok-database-starter-preview-row', header ? 'header' : '');
      row.append(...cells.map((text) => {
        const cell = document.createElement('span');

        cell.textContent = text;

        return cell;
      }));

      return row;
    };

    title.setAttribute('data-blok-database-starter-preview-title', '');
    title.textContent = made.title;
    tabs.setAttribute('data-blok-database-starter-preview-tabs', '');
    tabs.append(...made.views.map((view) => {
      const tab = document.createElement('span');

      tab.textContent = view.name;

      return tab;
    }));
    table.setAttribute('data-blok-database-starter-preview-table', '');
    table.append(line(columns.map((p) => p.name), true), ...made.rows.map((row) => line(columns.map((p, i) => (i === 0 ? row.data.title ?? '' : '')), false)));
    preview.replaceChildren(title, tabs, table);
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
      if (chosen.has(item.id)) chosen.delete(item.id);
      else chosen.add(item.id);
      paint();
      drawPreview();
    });
    paint();

    return button;
  };

  const draw = (): void => {
    const first = step.at === 1;

    nav.innerHTML = first ? IconCross : IconChevronLeft;
    nav.setAttribute('aria-label', t(first ? 'tools.database.close' : 'tools.database.peekBack'));
    nav.setAttribute('data-blok-testid', first ? 'database-starter-close' : 'database-starter-back');
    hint.textContent = first ? t('tools.database.starterFeaturesHint') : t('tools.database.starterViewsHint', { name });
    choices.setAttribute('data-step', first ? 'features' : 'views');
    choices.replaceChildren(...(first ? meta.features.map((c) => chip(c, picks.features, 'feature')) : meta.views.map((c) => chip(c, picks.views, 'view'))));
    primary.textContent = t(first ? 'tools.database.starterGetStarted' : 'tools.database.layoutSectionDone');
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
