import type { ImageMarkup, ImageMarkupTextStyle } from '../../../../types/tools/image';
import {
  IconArrowDiagonal,
  IconCheck,
  IconCursor,
  IconEllipse,
  IconEraser,
  IconFill,
  IconHighlighter,
  IconLineDiagonal,
  IconPencil,
  IconRectangle,
  IconText,
  IconTrash,
} from '../../../components/icons';
import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import type { RovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { tr } from '../i18n';
import { contrastInk, MARKUP_COLORS } from '../markup/model';

export type MarkupTool = 'select' | 'pen' | 'highlighter' | 'text' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'eraser';
export type MarkupSizeIndex = 0 | 1 | 2;

export interface MarkupPanelState {
  tool: MarkupTool;
  /** One of MARKUP_COLORS. */
  color: string;
  size: MarkupSizeIndex;
  textStyle: ImageMarkupTextStyle;
  fill: boolean;
}

/** What is selected on the stage, so the panel can show context controls. */
export type MarkupSelectionKind = null | ImageMarkup['type'];

export interface MarkupPanelOptions {
  i18n?: I18nInstance;
  state: MarkupPanelState;
  /** The user picked something. */
  onChange(next: MarkupPanelState, changed: keyof MarkupPanelState): void;
  /** Delete the selected mark. */
  onDelete(): void;
  /** The "Clear markup" panel reset. */
  onClear(): void;
}

export interface MarkupPanel {
  el: HTMLElement;
  /** Updates every control without callbacks. */
  set(state: MarkupPanelState): void;
  setSelection(kind: MarkupSelectionKind): void;
  /** Shows or hides the Clear markup reset. */
  setHasMarkup(has: boolean): void;
  destroy(): void;
}

const RED = '#ff3b30';

export const DEFAULT_MARKUP_STATE: MarkupPanelState = {
  tool: 'pen',
  color: RED,
  size: 1,
  textStyle: 'outline',
  fill: false,
};

const DEFAULT_COLORS: Partial<Record<MarkupTool, string>> = {
  pen: RED,
  highlighter: '#ffcc00',
  text: '#ffffff',
};

export function defaultColorFor(tool: MarkupTool): string | null {
  return DEFAULT_COLORS[tool] ?? null;
}

interface ToolDef { tool: MarkupTool; key: string; icon: string; letter: string }

/** Visual order, split into groups by hairlines. Arrow keys follow it. */
const RAIL: ToolDef[][] = [
  [{ tool: 'select', key: 'markupSelect', icon: IconCursor, letter: 'V' }],
  [
    { tool: 'pen', key: 'markupPen', icon: IconPencil, letter: 'P' },
    { tool: 'highlighter', key: 'markupHighlighter', icon: IconHighlighter, letter: 'H' },
    { tool: 'eraser', key: 'markupEraser', icon: IconEraser, letter: 'E' },
  ],
  [{ tool: 'text', key: 'markupText', icon: IconText, letter: 'T' }],
  [
    { tool: 'rect', key: 'markupRectangle', icon: IconRectangle, letter: 'R' },
    { tool: 'ellipse', key: 'markupEllipse', icon: IconEllipse, letter: 'O' },
    { tool: 'arrow', key: 'markupArrow', icon: IconArrowDiagonal, letter: 'A' },
    { tool: 'line', key: 'markupLine', icon: IconLineDiagonal, letter: 'L' },
  ],
];

const TOOLS = RAIL.flat();

/** Same order as MARKUP_COLORS. */
const COLOR_KEYS = [
  'tools.image.markupColorWhite',
  'tools.image.markupColorBlack',
  'tools.colorPicker.color.red',
  'tools.colorPicker.color.orange',
  'tools.colorPicker.color.yellow',
  'tools.colorPicker.color.green',
  'tools.colorPicker.color.blue',
  'tools.colorPicker.color.purple',
  'tools.colorPicker.color.pink',
];

const SIZES: { size: MarkupSizeIndex; key: string }[] = [
  { size: 0, key: 'tools.image.markupSizeThin' },
  { size: 1, key: 'tools.image.markupSizeMedium' },
  { size: 2, key: 'tools.image.markupSizeThick' },
];

const TEXT_STYLE_DEFS: { style: ImageMarkupTextStyle; key: string }[] = [
  { style: 'plain', key: 'tools.image.markupTextPlain' },
  { style: 'outline', key: 'tools.image.markupTextOutline' },
  { style: 'background', key: 'tools.image.markupTextBackground' },
];

const BOX_KINDS: readonly MarkupSelectionKind[] = ['rect', 'ellipse'];

/** Tools whose colour the panel remembers per tool. */
const remembers = (t: MarkupTool): boolean => defaultColorFor(t) !== null;

export function createMarkupPanel(o: MarkupPanelOptions): MarkupPanel {
  const t = (key: string): string => tr(o.i18n, key);
  const st: MarkupPanelState = { ...o.state };
  const ui: { selection: MarkupSelectionKind } = { selection: null };
  const picked: Partial<Record<MarkupTool, string>> = {};
  const cleanups: (() => void)[] = [];

  const listen = (node: HTMLElement, fn: () => void): void => {
    node.addEventListener('click', fn);
    cleanups.push(() => node.removeEventListener('click', fn));
  };

  const makeGroup = (className: string, key: string): HTMLDivElement => {
    const radiogroup = document.createElement('div');

    radiogroup.className = className;
    radiogroup.setAttribute('role', 'radiogroup');
    radiogroup.setAttribute('aria-label', t(key));

    return radiogroup;
  };

  const makeRadio = (className: string, testid: string, label: string): HTMLButtonElement => {
    const radio = document.createElement('button');

    radio.type = 'button';
    radio.className = className;
    radio.setAttribute('role', 'radio');
    radio.setAttribute('aria-label', label);
    radio.setAttribute('data-blok-testid', testid);

    return radio;
  };

  const makeSep = (): HTMLSpanElement => {
    const sep = document.createElement('span');

    sep.className = 'blok-darkroom__markup-sep';
    sep.setAttribute('aria-hidden', 'true');

    return sep;
  };

  const root = document.createElement('div');

  root.className = 'blok-darkroom__panel blok-darkroom__markup';

  /* Row 1: tools */

  const rail = makeGroup('blok-darkroom__markup-rail', 'tools.image.markupTools');
  const puck = document.createElement('span');

  puck.className = 'blok-darkroom__markup-puck';
  puck.setAttribute('aria-hidden', 'true');
  rail.appendChild(puck);

  const toolBtns = RAIL.flatMap((defs, g) => {
    if (g > 0) rail.appendChild(makeSep());

    return defs.map((d) => {
      const label = t(`tools.image.${d.key}`);
      const btn = makeRadio('blok-darkroom__markup-tool', `markup-tool-${d.tool}`, label);

      btn.setAttribute('data-tool', d.tool);
      btn.setAttribute('aria-keyshortcuts', d.letter);
      btn.title = `${label} (${d.letter})`;
      btn.innerHTML = d.icon;
      rail.appendChild(btn);

      return btn;
    });
  });

  /* Row 2: colour + size, then the contextual cluster */

  const swatches = makeGroup('blok-darkroom__markup-swatches', 'tools.image.markupColors');
  const swatchBtns = MARKUP_COLORS.map((color, i) => {
    const btn = makeRadio('blok-darkroom__markup-swatch', `markup-color-${color.slice(1)}`, t(COLOR_KEYS[i]));

    btn.setAttribute('data-color', color);
    btn.style.setProperty('--blok-markup-swatch', color);
    btn.style.setProperty('--blok-markup-swatch-ink', contrastInk(color));
    btn.innerHTML = IconCheck;
    swatches.appendChild(btn);

    return btn;
  });

  const sizes = makeGroup('blok-darkroom__markup-sizes', 'tools.image.markupSizes');
  const sizeBtns = SIZES.map(({ size, key }) => {
    const btn = makeRadio('blok-darkroom__markup-size', `markup-size-${size}`, t(key));
    const dot = document.createElement('span');

    btn.setAttribute('data-size', String(size));
    dot.className = 'blok-darkroom__markup-dot';
    btn.appendChild(dot);
    sizes.appendChild(btn);

    return btn;
  });

  const paint = document.createElement('div');

  paint.className = 'blok-darkroom__markup-cluster blok-darkroom__markup-ctl';
  paint.append(swatches, makeSep(), sizes);

  const styles = makeGroup('blok-darkroom__markup-styles blok-darkroom__markup-ctl', 'tools.image.markupTextStyles');
  const styleBtns = TEXT_STYLE_DEFS.map(({ style, key }) => {
    const btn = makeRadio('blok-darkroom__markup-style', `markup-text-style-${style}`, t(key));
    const preview = document.createElement('span');

    btn.setAttribute('data-style', style);
    preview.className = 'blok-darkroom__markup-aa';
    preview.setAttribute('aria-hidden', 'true');
    preview.textContent = 'Aa';
    btn.appendChild(preview);
    styles.appendChild(btn);

    return btn;
  });

  const makeIconBtn = (className: string, testid: string, key: string, icon: string): HTMLButtonElement => {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className = `blok-darkroom__markup-btn ${className} blok-darkroom__markup-ctl`;
    btn.setAttribute('data-blok-testid', testid);
    btn.setAttribute('aria-label', t(key));
    btn.title = t(key);
    btn.innerHTML = icon;

    return btn;
  };

  const fillBtn = makeIconBtn('blok-darkroom__markup-fill', 'markup-fill', 'tools.image.markupFill', IconFill);
  const deleteBtn = makeIconBtn('blok-darkroom__markup-delete', 'markup-delete', 'blockSettings.delete', IconTrash);

  const extra = document.createElement('div');

  extra.className = 'blok-darkroom__markup-cluster blok-darkroom__markup-extra blok-darkroom__markup-ctl';
  extra.append(styles, fillBtn, deleteBtn);

  // Three columns: the side ones share one width, so the paint cluster stays centred as extras come and go.
  const grid = document.createElement('div');
  const context = document.createElement('div');
  const lead = document.createElement('span');

  grid.className = 'blok-darkroom__markup-grid';
  context.className = 'blok-darkroom__markup-context';
  lead.setAttribute('aria-hidden', 'true');
  grid.append(lead, paint, extra);
  context.appendChild(grid);

  const reset = document.createElement('button');

  reset.type = 'button';
  reset.className = 'blok-darkroom__btn blok-darkroom__btn--ghost blok-darkroom__panel-reset';
  reset.setAttribute('data-action', 'reset-markup');
  reset.setAttribute('data-blok-testid', 'markup-reset');
  reset.setAttribute('data-shown', 'false');
  reset.textContent = t('tools.image.resetMarkup');

  root.append(rail, context, reset);

  /* State → DOM */

  const checkedTool = (): HTMLElement => toolBtns[TOOLS.findIndex((d) => d.tool === st.tool)];

  /** A browser drops focus to <body> from a hidden control; hand it to the checked tool. */
  const rescueFocus = (gone: HTMLElement): void => {
    const active = document.activeElement;

    if (active instanceof Node && gone.contains(active)) checkedTool().focus({ preventScroll: true });
  };

  const setShown = (node: HTMLElement, on: boolean): void => {
    node.toggleAttribute('hidden', !on);
    if (!on) rescueFocus(node);
  };

  const check = (btns: HTMLElement[], on: (i: number) => boolean): void => {
    btns.forEach((b, i) => b.setAttribute('aria-checked', String(on(i))));
  };

  const render = (): void => {
    const toolIndex = TOOLS.findIndex((d) => d.tool === st.tool);
    const groupIndex = RAIL.findIndex((defs) => defs.some((d) => d.tool === st.tool));
    const sel = ui.selection;

    check(toolBtns, (i) => i === toolIndex);
    rail.style.setProperty('--blok-markup-puck-i', String(toolIndex));
    rail.style.setProperty('--blok-markup-puck-s', String(groupIndex));
    check(swatchBtns, (i) => MARKUP_COLORS[i] === st.color);
    check(sizeBtns, (i) => SIZES[i].size === st.size);
    check(styleBtns, (i) => TEXT_STYLE_DEFS[i].style === st.textStyle);
    fillBtn.setAttribute('aria-pressed', String(st.fill));
    root.style.setProperty('--blok-markup-color', st.color);
    root.style.setProperty('--blok-markup-ink', contrastInk(st.color));

    const showPaint = sel !== null || (st.tool !== 'eraser' && st.tool !== 'select');
    const showStyles = st.tool === 'text' || sel === 'text';
    const showFill = st.tool === 'rect' || st.tool === 'ellipse' || BOX_KINDS.includes(sel);
    const showDelete = sel !== null;

    setShown(paint, showPaint);
    setShown(styles, showStyles);
    setShown(fillBtn, showFill);
    setShown(deleteBtn, showDelete);
    setShown(extra, showStyles || showFill || showDelete);
    rovings.forEach((r) => r.refresh());
  };

  const emit = (changed: keyof MarkupPanelState): void => {
    render();
    o.onChange({ ...st }, changed);
  };

  const pickTool = (tool: MarkupTool): void => {
    if (tool === st.tool) return;
    st.tool = tool;
    const color = picked[tool] ?? defaultColorFor(tool);

    if (color !== null) st.color = color;
    emit('tool');
  };

  const pickColor = (color: string): void => {
    if (color === st.color) return;
    st.color = color;
    if (remembers(st.tool)) picked[st.tool] = color;
    emit('color');
  };

  const pickSize = (size: MarkupSizeIndex): void => {
    if (size === st.size) return;
    st.size = size;
    emit('size');
  };

  const pickStyle = (style: ImageMarkupTextStyle): void => {
    if (style === st.textStyle) return;
    st.textStyle = style;
    emit('textStyle');
  };

  const rovings: RovingRadioGroup[] = [
    rovingRadioGroup({
      radios: toolBtns,
      getSelectedIndex: () => TOOLS.findIndex((d) => d.tool === st.tool),
      onSelect: (i) => pickTool(TOOLS[i].tool),
    }),
    rovingRadioGroup({
      radios: swatchBtns,
      getSelectedIndex: () => MARKUP_COLORS.indexOf(st.color),
      onSelect: (i) => pickColor(MARKUP_COLORS[i]),
    }),
    rovingRadioGroup({
      radios: sizeBtns,
      getSelectedIndex: () => SIZES.findIndex((s) => s.size === st.size),
      onSelect: (i) => pickSize(SIZES[i].size),
    }),
    rovingRadioGroup({
      radios: styleBtns,
      getSelectedIndex: () => TEXT_STYLE_DEFS.findIndex((s) => s.style === st.textStyle),
      onSelect: (i) => pickStyle(TEXT_STYLE_DEFS[i].style),
    }),
  ];

  toolBtns.forEach((b, i) => listen(b, () => pickTool(TOOLS[i].tool)));
  swatchBtns.forEach((b, i) => listen(b, () => pickColor(MARKUP_COLORS[i])));
  sizeBtns.forEach((b, i) => listen(b, () => pickSize(SIZES[i].size)));
  styleBtns.forEach((b, i) => listen(b, () => pickStyle(TEXT_STYLE_DEFS[i].style)));
  listen(fillBtn, () => {
    st.fill = !st.fill;
    emit('fill');
  });
  listen(deleteBtn, () => o.onDelete());
  listen(reset, () => o.onClear());

  render();

  return {
    el: root,
    set(state: MarkupPanelState): void {
      Object.assign(st, state);
      render();
    },
    setSelection(kind: MarkupSelectionKind): void {
      ui.selection = kind;
      render();
    },
    setHasMarkup(has: boolean): void {
      // An attribute, not [hidden]: the reset keeps its box so the panel never jumps.
      reset.setAttribute('data-shown', String(has));
      if (!has) rescueFocus(reset);
    },
    destroy(): void {
      rovings.forEach((r) => r.destroy());
      cleanups.splice(0).forEach((fn) => fn());
    },
  };
}
