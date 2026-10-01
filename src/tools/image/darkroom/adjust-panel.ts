import type { ImageAdjust } from '../../../../types/tools/image';
import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { ADJUST_KEYS } from '../adjust';
import { tr } from '../i18n';
import { createDial } from './dial';

type Adjust = Required<ImageAdjust>;
type Tool = keyof Adjust;

export interface AdjustPanelOptions {
  i18n?: I18nInstance;
  value: Adjust;
  onInput(a: Adjust): void;
  onCommit(a: Adjust): void;
}

export interface AdjustPanel {
  el: HTMLElement;
  /** Updates chips and dial without callbacks; drops a pending key commit. */
  set(a: Adjust): void;
  /** Commits a pending dial key burst now. Call before undo, Reset or Done. */
  flush(): void;
  destroy(): void;
}

const LABEL_KEYS: Record<Tool, string> = {
  brightness: 'tools.image.adjustBrightness',
  contrast: 'tools.image.adjustContrast',
  saturation: 'tools.image.adjustSaturation',
};

const RANGE = 100;

export function createAdjustPanel(o: AdjustPanelOptions): AdjustPanel {
  const value: Adjust = { ...o.value };
  const st: { tool: Tool } = { tool: ADJUST_KEYS[0] };
  const label = (t: Tool): string => tr(o.i18n, LABEL_KEYS[t]);

  const root = document.createElement('div');
  const group = document.createElement('div');

  root.className = 'blok-darkroom__adjust';
  group.className = 'blok-darkroom__adjust-tools';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', tr(o.i18n, 'tools.image.adjustTools'));

  const chips = ADJUST_KEYS.map((t) => {
    const chip = document.createElement('button');
    const dot = document.createElement('span');

    chip.type = 'button';
    chip.className = 'blok-darkroom__chip blok-darkroom__adjust-chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-tool', t);
    chip.textContent = label(t);
    dot.className = 'blok-darkroom__adjust-dot';
    dot.setAttribute('data-role', 'adjust-dot');
    dot.setAttribute('aria-hidden', 'true');
    chip.appendChild(dot);
    group.appendChild(chip);

    return chip;
  });

  const dial = createDial({
    min: -RANGE,
    max: RANGE,
    value: value[st.tool],
    label: label(st.tool),
    valueText: String,
    onInput: (v) => {
      value[st.tool] = v;
      renderChips();
      o.onInput({ ...value });
    },
    onCommit: (v) => {
      value[st.tool] = v;
      o.onCommit({ ...value });
    },
  });

  root.append(group, dial.el);

  const renderChips = (): void => {
    ADJUST_KEYS.forEach((t, i) => {
      const on = t === st.tool;

      chips[i].setAttribute('aria-checked', String(on));
      chips[i].setAttribute('data-active', String(on));
      chips[i].setAttribute('data-changed', String(value[t] !== 0));
    });
    roving.refresh();
  };

  const choose = (t: Tool): void => {
    if (t === st.tool) return;
    // Before the swap: a pending dial commit writes to whatever `tool` is when it fires.
    dial.flush();
    st.tool = t;
    dial.configure({ min: -RANGE, max: RANGE, value: value[t], label: label(t), valueText: String });
    renderChips();
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => ADJUST_KEYS.indexOf(st.tool),
    onSelect: (i) => choose(ADJUST_KEYS[i]),
  });

  const onClick = (e: MouseEvent): void => {
    const t = ADJUST_KEYS.find((k) => k === (e.currentTarget as HTMLElement).getAttribute('data-tool'));

    if (t !== undefined) choose(t);
  };

  chips.forEach((chip) => chip.addEventListener('click', onClick));
  renderChips();

  return {
    el: root,
    set(a: Adjust): void {
      Object.assign(value, a);
      dial.set(value[st.tool]);
      renderChips();
    },
    flush: dial.flush,
    destroy(): void {
      dial.destroy();
      roving.destroy();
      chips.forEach((chip) => chip.removeEventListener('click', onClick));
    },
  };
}
