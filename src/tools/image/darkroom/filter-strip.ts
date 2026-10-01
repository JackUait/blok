import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { cssFilter, DEFAULT_FILTERS, FILTER_PRESETS, type FilterSet } from '../adjust';
import { tr } from '../i18n';
import { createDial } from './dial';

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
  /** Selects and moves the slider without callbacks. */
  set(p: string, strength: number): void;
  /** Commits a pending slider key burst now. Call before undo, Reset or Done. */
  flush(): void;
  /** Scrolls the selected chip to the strip's middle. Call once the strip is visible. */
  reveal(): void;
  destroy(): void;
}

const FULL = 100;

const labelKey = (p: string): string =>
  `tools.image.filter${p.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;

export function createFilterStrip(o: FilterStripOptions): FilterStrip {
  const filters = o.filters ?? DEFAULT_FILTERS;
  const st = { current: o.value };
  // A look the host list leaves out still gets a chip while the image uses it.
  const names = filters.order.includes(o.value) ? [...filters.order] : [...filters.order, o.value];
  const nameOf = (p: string): string => filters.title(p)
    ?? ((FILTER_PRESETS as readonly string[]).includes(p) ? tr(o.i18n, labelKey(p)) : p);

  const root = document.createElement('div');
  const group = document.createElement('div');

  root.className = 'blok-darkroom__filter-panel';
  group.className = 'blok-darkroom__filters';
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

  const dial = createDial({
    min: 0,
    max: FULL,
    value: o.strength,
    label: tr(o.i18n, 'tools.image.filterStrength'),
    valueText: String,
    onInput: (v) => o.onStrengthInput(v),
    onCommit: (v) => o.onStrengthCommit(v),
  });

  root.append(group, dial.box);

  const render = (): void => {
    names.forEach((p, i) => {
      const on = p === st.current;

      chips[i].setAttribute('aria-checked', String(on));
      chips[i].setAttribute('data-active', String(on));
    });
    dial.box.hidden = st.current === 'none';
    roving.refresh();
  };

  const choose = (p: string): void => {
    if (p === st.current) return;
    dial.flush();
    st.current = p;
    dial.set(FULL);
    render();
    o.onSelect(p);
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => names.indexOf(st.current),
    onSelect: (i) => choose(names[i]),
  });

  const onClick = (e: MouseEvent): void => {
    const p = (e.currentTarget as HTMLElement).getAttribute('data-preset');

    if (p !== null) choose(p);
  };

  chips.forEach((chip) => chip.addEventListener('click', onClick));
  render();

  return {
    el: root,
    set(p: string, strength: number): void {
      st.current = p;
      dial.set(strength);
      render();
    },
    flush: dial.flush,
    reveal(): void {
      const on = chips[names.indexOf(st.current)];

      if (on === undefined) return;
      const box = group.getBoundingClientRect();
      const r = on.getBoundingClientRect();

      // Not scrollIntoView: that would also scroll the page behind the dialog.
      group.scrollLeft += r.left + r.width / 2 - (box.left + box.width / 2);
    },
    destroy(): void {
      dial.destroy();
      roving.destroy();
      chips.forEach((chip) => chip.removeEventListener('click', onClick));
    },
  };
}
