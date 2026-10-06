import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup, type RovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { cssFilter, DEFAULT_FILTERS, FILTER_PRESETS, type FilterGroupKey, type FilterSet } from '../adjust';
import { tr } from '../i18n';
import { createDial } from './dial';
import { createModeTabs } from './mode-tabs';

export interface FilterStripOptions {
  i18n?: I18nInstance;
  url: string;
  /** Default: every built-in. */
  filters?: FilterSet;
  value: string;
  strength: number;
  onSelect(p: string): void;
  onStrengthInput(s: number): void;
  onStrengthCommit(s: number): void;
}

export interface FilterStrip {
  el: HTMLElement;
  /** Selects, opens that look's family and moves the slider, without callbacks. */
  set(p: string, strength: number): void;
  /** Commits a pending slider key burst now. Call before undo, Reset or Done. */
  flush(): void;
  /** Scrolls the selected chip to the strip's middle. Call once the strip is visible. */
  reveal(): void;
  destroy(): void;
}

const FULL = 100;

/** Up to this many looks fit one row; more are split into families. */
const ONE_ROW_LOOKS = 7;

const GROUP_LABEL_KEYS: Record<FilterGroupKey, string> = {
  vivid: 'tools.image.filterGroupVivid',
  dramatic: 'tools.image.filterGroupDramatic',
  tone: 'tools.image.filterGroupTone',
  soft: 'tools.image.filterGroupSoft',
  vintage: 'tools.image.filterGroupVintage',
  bw: 'tools.image.filterGroupBlackWhite',
  custom: 'tools.image.filterGroupCustom',
};

const counter = { instances: 0 };

/** How far the row must scroll to centre the item. Not scrollIntoView: that would also scroll the page behind the dialog. */
const centreOffset = (row: HTMLElement, item: HTMLElement): number => {
  const box = row.getBoundingClientRect();
  const r = item.getBoundingClientRect();

  return r.left + r.width / 2 - (box.left + box.width / 2);
};

const labelKey = (p: string): string =>
  `tools.image.filter${p.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;

export function createFilterStrip(o: FilterStripOptions): FilterStrip {
  const filters = o.filters ?? DEFAULT_FILTERS;
  // A look the host list leaves out still gets a chip while the image uses it.
  const extra = filters.order.includes(o.value) ? null : o.value;
  const names = extra === null ? [...filters.order] : [...filters.order, extra];
  const families = filters.groups.map((g) => g.key);
  const extraFamily = extra === null ? undefined : filters.groupOf(extra);

  if (extraFamily !== undefined && !families.includes(extraFamily)) families.push(extraFamily);

  const grouped = families.length > 1 && names.length - 1 > ONE_ROW_LOOKS;
  const familyOf = (p: string): FilterGroupKey => filters.groupOf(p) ?? families[0] ?? 'custom';
  const st = { current: o.value, family: familyOf(o.value) };
  const nameOf = (p: string): string => filters.title(p)
    ?? ((FILTER_PRESETS as readonly string[]).includes(p) ? tr(o.i18n, labelKey(p)) : p);

  const root = document.createElement('div');
  const group = document.createElement('div');

  root.className = 'blok-darkroom__filter-panel';
  group.className = 'blok-darkroom__filters';
  group.id = `blok-darkroom-filters-${++counter.instances}`;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', tr(o.i18n, 'tools.image.filterPresets'));

  const chips = names.map((p) => {
    const chip = document.createElement('button');
    const img = document.createElement('img');
    const name = document.createElement('span');

    chip.type = 'button';
    chip.className = 'blok-darkroom__filter';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-preset', p);
    img.className = 'blok-darkroom__filter-thumb';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = o.url;
    img.style.filter = cssFilter(p, {}, FULL, filters);
    name.className = 'blok-darkroom__filter-name';
    name.textContent = nameOf(p);
    chip.append(img, name);
    group.appendChild(chip);

    return chip;
  });

  if (chips.length > 1) {
    const divider = document.createElement('span');

    divider.className = 'blok-darkroom__filter-divider';
    divider.setAttribute('data-role', 'filter-divider');
    divider.setAttribute('aria-hidden', 'true');
    chips[0].after(divider);
  }

  const dial = createDial({
    min: 0,
    max: FULL,
    value: o.strength,
    label: tr(o.i18n, 'tools.image.filterStrength'),
    valueText: String,
    resetTo: FULL,
    onInput: (v) => o.onStrengthInput(v),
    onCommit: (v) => o.onStrengthCommit(v),
  });

  const shown = (p: string): boolean => p === 'none' || !grouped || familyOf(p) === st.family;

  // The arrows walk only the chips on screen, so the group is rebuilt whenever the family changes.
  const nav: { visible: string[]; roving: RovingRadioGroup | null } = { visible: [], roving: null };

  const render = (): void => {
    names.forEach((p, i) => {
      const on = p === st.current;

      chips[i].hidden = !shown(p);
      chips[i].setAttribute('aria-checked', String(on));
      chips[i].setAttribute('data-active', String(on));
      if (chips[i].hidden) chips[i].setAttribute('tabindex', '-1');
    });
    dial.box.hidden = st.current === 'none';
    nav.roving?.refresh();
  };

  const choose = (p: string): void => {
    if (p === st.current) return;
    dial.flush();
    st.current = p;
    dial.set(FULL);
    render();
    o.onSelect(p);
  };

  const openFamily = (family: FilterGroupKey): void => {
    st.family = family;
    nav.roving?.destroy();
    nav.visible = names.filter(shown);
    nav.roving = rovingRadioGroup({
      radios: chips.filter((_, i) => shown(names[i])),
      getSelectedIndex: () => nav.visible.indexOf(st.current),
      onSelect: (i) => choose(nav.visible[i]),
    });
    render();
  };

  const tabs = grouped
    ? createModeTabs({
      modes: families.map((key) => ({ key, label: tr(o.i18n, GROUP_LABEL_KEYS[key]) })),
      panels: {},
      selected: st.family,
      label: tr(o.i18n, 'tools.image.filterGroups'),
      onSelect: (key) => openFamily(key as FilterGroupKey),
    })
    : null;

  if (tabs) {
    tabs.el.classList.add('blok-darkroom__tabs--families');
    tabs.el.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute('aria-controls', group.id));
    root.append(tabs.el);
  }
  root.append(group, dial.box);

  const onClick = (e: MouseEvent): void => {
    const p = (e.currentTarget as HTMLElement).getAttribute('data-preset');

    if (p !== null) choose(p);
  };

  chips.forEach((chip) => chip.addEventListener('click', onClick));
  openFamily(st.family);

  return {
    el: root,
    set(p: string, strength: number): void {
      st.current = p;
      dial.set(strength);
      if (grouped && p !== 'none' && familyOf(p) !== st.family) {
        tabs?.select(familyOf(p));
        openFamily(familyOf(p));
      } else {
        render();
      }
    },
    flush: dial.flush,
    reveal(): void {
      const tab = tabs?.el.querySelector<HTMLElement>('[aria-selected="true"]');

      if (tabs && tab) tabs.el.scrollLeft += centreOffset(tabs.el, tab);
      const on = chips[names.indexOf(st.current)];

      if (on !== undefined && !on.hidden) group.scrollLeft += centreOffset(group, on);
    },
    destroy(): void {
      dial.destroy();
      nav.roving?.destroy();
      tabs?.destroy();
      chips.forEach((chip) => chip.removeEventListener('click', onClick));
    },
  };
}
