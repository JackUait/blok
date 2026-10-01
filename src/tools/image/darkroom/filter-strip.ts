import type { ImageFilterPreset } from '../../../../types/tools/image';
import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { cssFilter, FILTER_PRESETS } from '../adjust';
import { tr } from '../i18n';

export interface FilterStripOptions {
  i18n?: I18nInstance;
  url: string;
  value: ImageFilterPreset;
  onSelect(p: ImageFilterPreset): void;
}

export interface FilterStrip {
  el: HTMLElement;
  /** Selects without calling onSelect. */
  set(p: ImageFilterPreset): void;
  destroy(): void;
}

const labelKey = (p: ImageFilterPreset): string => `tools.image.filter${p[0].toUpperCase()}${p.slice(1)}`;

export function createFilterStrip(o: FilterStripOptions): FilterStrip {
  const st = { current: o.value };
  const root = document.createElement('div');

  root.className = 'blok-darkroom__filters';
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', tr(o.i18n, 'tools.image.filterPresets'));

  const chips = FILTER_PRESETS.map((p) => {
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
    img.style.filter = cssFilter(p, {});
    name.className = 'blok-darkroom__filter-name';
    name.textContent = tr(o.i18n, labelKey(p));
    chip.append(img, name);
    root.appendChild(chip);

    return chip;
  });

  const render = (): void => {
    FILTER_PRESETS.forEach((p, i) => {
      const on = p === st.current;

      chips[i].setAttribute('aria-checked', String(on));
      chips[i].setAttribute('data-active', String(on));
    });
    roving.refresh();
  };

  const choose = (p: ImageFilterPreset): void => {
    if (p === st.current) return;
    st.current = p;
    render();
    o.onSelect(p);
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => FILTER_PRESETS.indexOf(st.current),
    onSelect: (i) => choose(FILTER_PRESETS[i]),
  });

  const onClick = (e: MouseEvent): void => {
    const p = FILTER_PRESETS.find((k) => k === (e.currentTarget as HTMLElement).getAttribute('data-preset'));

    if (p !== undefined) choose(p);
  };

  chips.forEach((chip) => chip.addEventListener('click', onClick));
  render();

  return {
    el: root,
    set(p: ImageFilterPreset): void {
      st.current = p;
      render();
    },
    destroy(): void {
      roving.destroy();
      chips.forEach((chip) => chip.removeEventListener('click', onClick));
    },
  };
}
