import type { ImageAdjust } from '../../../../types/tools/image';
import { IconCross } from '../../../components/icons';
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

const RESET_KEYS: Record<Tool, string> = {
  brightness: 'tools.image.resetBrightness',
  contrast: 'tools.image.resetContrast',
  saturation: 'tools.image.resetSaturation',
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

    chip.type = 'button';
    chip.className = 'blok-darkroom__chip blok-darkroom__adjust-chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-tool', t);
    chip.textContent = label(t);
    group.appendChild(chip);

    return chip;
  });

  // A button may not sit inside a radio, so the resets live in a layer laid over the chips' grid.
  const resetLayer = document.createElement('div');
  const row = document.createElement('div');

  resetLayer.className = 'blok-darkroom__adjust-resets';
  row.className = 'blok-darkroom__adjust-row';
  const resets = ADJUST_KEYS.map((t) => {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className = 'blok-darkroom__adjust-reset';
    btn.setAttribute('data-role', 'adjust-reset');
    btn.setAttribute('data-tool', t);
    btn.setAttribute('aria-label', tr(o.i18n, RESET_KEYS[t]));
    btn.innerHTML = IconCross;
    resetLayer.appendChild(btn);

    return btn;
  });

  row.append(group, resetLayer);

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

  root.append(row, dial.box);

  const renderChips = (): void => {
    ADJUST_KEYS.forEach((t, i) => {
      const on = t === st.tool;

      chips[i].setAttribute('aria-checked', String(on));
      chips[i].setAttribute('data-active', String(on));
      chips[i].setAttribute('data-changed', String(value[t] !== 0));
      // An attribute, not [hidden]: darkroom.css keeps its grid cell so nothing shifts.
      resets[i].setAttribute('data-shown', String(value[t] !== 0));
      if (value[t] === 0 && document.activeElement === resets[i]) dial.el.focus({ preventScroll: true });
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

  // One step for that tool only; the selected tool stays.
  const onReset = (e: MouseEvent): void => {
    const t = ADJUST_KEYS.find((k) => k === (e.currentTarget as HTMLElement).getAttribute('data-tool'));

    if (t === undefined || value[t] === 0) return;
    dial.flush();
    value[t] = 0;
    if (t === st.tool) dial.set(0);
    renderChips();
    o.onInput({ ...value });
    o.onCommit({ ...value });
  };

  chips.forEach((chip) => chip.addEventListener('click', onClick));
  resets.forEach((btn) => btn.addEventListener('click', onReset));
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
      resets.forEach((btn) => btn.removeEventListener('click', onReset));
    },
  };
}
