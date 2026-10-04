import type { ImageMarkup, ImageMarkupTextStyle } from '../../../../types/tools/image';
import {
  IconArrowDiagonal,
  IconCheck,
  IconCursor,
  IconEllipse,
  IconEmojiStar,
  IconEraser,
  IconFill,
  IconHexagon,
  IconHighlighter,
  IconLineDiagonal,
  IconMessage,
  IconPencil,
  IconRectangle,
  IconRoundedRectangle,
  IconSearch,
  IconSpotlight,
  IconText,
  IconTrash,
} from '../../../components/icons';
import { openModalDialog, type ModalDialogHandle } from '../../../components/utils/modal-dialog';
import { createPositionTracker, positionFixedAnchored } from '../../../components/utils/popover/anchored-position';
import type { I18nInstance } from '../../../components/utils/tools';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import type { RovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { tr } from '../i18n';
import { contrastInk, MARKUP_COLORS, takesFill } from '../markup/model';

export type MarkupTool =
  | 'select' | 'pen' | 'highlighter' | 'text' | 'eraser'
  | 'rect' | 'rounded-rect' | 'ellipse' | 'arrow' | 'line' | 'bubble' | 'star' | 'polygon' | 'spotlight' | 'magnifier';
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
  /** The photo, so the framing shape tiles can show it. */
  url?: string;
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
  /** Picks a tool as a click on the rail would, colour and size included. */
  pickTool(tool: MarkupTool): void;
  /** One size up or down, as a click on the next size would; a no-op while the sizes are hidden. */
  stepSize(delta: 1 | -1): void;
  /** Picks the shape the Shapes button shows. */
  pickShape(): void;
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

interface ToolDef { tool: MarkupTool; key: string; icon: string; letter?: string }

/** Apple's shape grid order, two to a row. */
const SHAPE_DEFS: ToolDef[] = [
  { tool: 'line', key: 'markupLine', icon: IconLineDiagonal, letter: 'L' },
  { tool: 'arrow', key: 'markupArrow', icon: IconArrowDiagonal, letter: 'A' },
  { tool: 'rect', key: 'markupRectangle', icon: IconRectangle, letter: 'R' },
  { tool: 'rounded-rect', key: 'markupRoundedRectangle', icon: IconRoundedRectangle },
  { tool: 'ellipse', key: 'markupEllipse', icon: IconEllipse, letter: 'O' },
  { tool: 'bubble', key: 'markupSpeechBubble', icon: IconMessage },
  { tool: 'star', key: 'markupStar', icon: IconEmojiStar },
  { tool: 'polygon', key: 'markupPolygon', icon: IconHexagon },
  { tool: 'spotlight', key: 'markupSpotlight', icon: IconSpotlight },
  { tool: 'magnifier', key: 'markupMagnifier', icon: IconSearch },
];

/** These frame the photo instead of drawing on it: no ink to pick, and a hairline above them in the grid. */
const FRAMING_TOOLS: readonly MarkupTool[] = ['spotlight', 'magnifier'];
const isFraming = (t: MarkupTool | MarkupSelectionKind): boolean => FRAMING_TOOLS.some((f) => f === t);

const isShapeTool = (t: MarkupTool): boolean => SHAPE_DEFS.some((d) => d.tool === t);

/** The rail's one button for every shape; it shows the last shape picked. */
const SHAPES_SLOT = 'shapes';

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab']);

type Slot = ToolDef | typeof SHAPES_SLOT;

/** Visual order, split into groups by hairlines. Arrow keys follow it. */
const RAIL: Slot[][] = [
  [{ tool: 'select', key: 'markupSelect', icon: IconCursor, letter: 'V' }],
  [
    { tool: 'pen', key: 'markupPen', icon: IconPencil, letter: 'P' },
    { tool: 'highlighter', key: 'markupHighlighter', icon: IconHighlighter, letter: 'H' },
    { tool: 'eraser', key: 'markupEraser', icon: IconEraser, letter: 'E' },
  ],
  [{ tool: 'text', key: 'markupText', icon: IconText, letter: 'T' }],
  [SHAPES_SLOT],
];

const SLOTS = RAIL.flat();

const slotHolds = (slot: Slot, tool: MarkupTool): boolean => (slot === SHAPES_SLOT ? isShapeTool(tool) : slot.tool === tool);

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

/** Tools whose colour the panel remembers per tool. */
const remembers = (t: MarkupTool): boolean => defaultColorFor(t) !== null;

export function createMarkupPanel(o: MarkupPanelOptions): MarkupPanel {
  const t = (key: string): string => tr(o.i18n, key);
  const st: MarkupPanelState = { ...o.state };
  const ui: { selection: MarkupSelectionKind; shape: MarkupTool } = { selection: null, shape: isShapeTool(o.state.tool) ? o.state.tool : 'rect' };
  const picked: Partial<Record<MarkupTool, string>> = {};
  // The eraser keeps its own size, so picking a big eraser never thickens the pen.
  const sizes: { ink: MarkupSizeIndex; eraser: MarkupSizeIndex } = { ink: st.size, eraser: st.tool === 'eraser' ? st.size : 1 };
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

  const titled = (btn: HTMLElement, d: ToolDef): void => {
    const label = t(`tools.image.${d.key}`);

    btn.setAttribute('data-tool', d.tool);
    btn.setAttribute('title', d.letter === undefined ? label : `${label} (${d.letter})`);
    if (d.letter !== undefined) btn.setAttribute('aria-keyshortcuts', d.letter);
    btn.insertAdjacentHTML('beforeend', d.icon);
  };

  const shapeIcon = document.createElement('span');
  const toolBtns = RAIL.flatMap((slots, g) => {
    if (g > 0) rail.appendChild(makeSep());

    return slots.map((slot) => {
      if (slot === SHAPES_SLOT) {
        const label = t('tools.image.markupShapes');
        const btn = makeRadio('blok-darkroom__markup-tool blok-darkroom__markup-shapes-btn', 'markup-tool-shapes', label);

        btn.setAttribute('data-tool', SHAPES_SLOT);
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.title = label;
        shapeIcon.className = 'blok-darkroom__markup-shapes-icon';
        btn.append(shapeIcon);
        rail.appendChild(btn);

        return btn;
      }
      const btn = makeRadio('blok-darkroom__markup-tool', `markup-tool-${slot.tool}`, t(`tools.image.${slot.key}`));

      titled(btn, slot);
      rail.appendChild(btn);

      return btn;
    });
  });
  const shapesBtn = toolBtns[SLOTS.indexOf(SHAPES_SLOT)];

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

  const sizeGroup = makeGroup('blok-darkroom__markup-sizes', 'tools.image.markupSizes');
  const sizeBtns = SIZES.map(({ size, key }) => {
    const btn = makeRadio('blok-darkroom__markup-size', `markup-size-${size}`, t(key));
    const dot = document.createElement('span');

    btn.setAttribute('data-size', String(size));
    dot.className = 'blok-darkroom__markup-dot';
    btn.appendChild(dot);
    sizeGroup.appendChild(btn);

    return btn;
  });

  const paint = document.createElement('div');

  paint.className = 'blok-darkroom__markup-cluster blok-darkroom__markup-ctl';
  const paintSep = makeSep();

  paint.append(swatches, paintSep, sizeGroup);

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

  const slotOf = (tool: MarkupTool): number => SLOTS.findIndex((slot) => slotHolds(slot, tool));
  const checkedTool = (): HTMLElement => toolBtns[slotOf(st.tool)];

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
    const toolIndex = slotOf(st.tool);
    const groupIndex = RAIL.findIndex((slots) => slots.some((slot) => slotHolds(slot, st.tool)));
    const sel = ui.selection;

    check(toolBtns, (i) => i === toolIndex);
    if (isShapeTool(st.tool)) ui.shape = st.tool;
    if (shapesBtn.getAttribute('data-shape') !== ui.shape) {
      shapesBtn.setAttribute('data-shape', ui.shape);
      shapeIcon.innerHTML = SHAPE_DEFS.find((d) => d.tool === ui.shape)?.icon ?? '';
    }
    picker.items.forEach((b, i) => b.setAttribute('aria-checked', String(SHAPE_DEFS[i]?.tool === st.tool)));
    paintPicker();
    rail.style.setProperty('--blok-markup-puck-i', String(toolIndex));
    rail.style.setProperty('--blok-markup-puck-s', String(groupIndex));
    check(swatchBtns, (i) => MARKUP_COLORS[i] === st.color);
    check(sizeBtns, (i) => SIZES[i].size === st.size);
    check(styleBtns, (i) => TEXT_STYLE_DEFS[i].style === st.textStyle);
    fillBtn.setAttribute('aria-pressed', String(st.fill));
    root.style.setProperty('--blok-markup-color', st.color);
    root.style.setProperty('--blok-markup-ink', contrastInk(st.color));

    const showColors = sel !== null ? !isFraming(sel) : st.tool !== 'eraser' && st.tool !== 'select' && !isFraming(st.tool);
    const showPaint = showColors || st.tool === 'eraser';
    const showStyles = st.tool === 'text' || sel === 'text';
    const showFill = sel !== null ? takesFill(sel) : takesFill(st.tool);
    const showDelete = sel !== null;

    root.setAttribute('data-tool', st.tool);
    setShown(paint, showPaint);
    setShown(swatches, showColors);
    setShown(paintSep, showColors);
    setShown(styles, showStyles);
    setShown(fillBtn, showFill);
    setShown(deleteBtn, showDelete);
    setShown(extra, showStyles || showFill || showDelete);
    root.toggleAttribute('data-context-empty', !showPaint && !showStyles && !showFill && !showDelete);
    rovings.forEach((r) => r.refresh());
  };

  const picker: { handle: ModalDialogHandle | null; el: HTMLElement | null; items: HTMLElement[]; roving: RovingRadioGroup | null } = {
    handle: null, el: null, items: [], roving: null,
  };

  /** The tiles draw in the ink the user will draw with. */
  const paintPicker = (): void => {
    const el = picker.el;

    if (el === null) return;
    el.style.setProperty('--blok-markup-color', st.color);
    el.setAttribute('data-size', String(st.size));
    el.toggleAttribute('data-fill', st.fill);
    // Ink that takes a light contrast ink is too dark to read on the dark glass.
    el.toggleAttribute('data-ink-dark', contrastInk(st.color) !== contrastInk('#ffffff'));
  };

  const photoTile = (btn: HTMLElement, tool: MarkupTool, url: string): void => {
    const photo = (): HTMLImageElement => {
      const img = document.createElement('img');

      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.src = url;

      return img;
    };
    const mark = document.createElement('span');

    mark.className = tool === 'magnifier' ? 'blok-darkroom__markup-lens' : 'blok-darkroom__markup-spot';
    mark.setAttribute('aria-hidden', 'true');
    if (tool === 'magnifier') mark.appendChild(photo());
    btn.setAttribute('data-photo', '');
    btn.append(photo(), mark);
  };

  const closePicker = (): void => picker.handle?.close();

  const openPicker = (): void => {
    if (picker.handle) return;
    const content = document.createElement('div');
    const grid = makeGroup('blok-darkroom__markup-shape-grid', 'tools.image.markupShapes');

    content.className = 'blok-darkroom__markup-shapes';
    content.setAttribute('data-blok-testid', 'markup-shapes');
    // The focus ring waits for a navigation key: opening the picker is not navigating.
    content.addEventListener('keydown', (e) => {
      if (NAV_KEYS.has(e.key)) content.setAttribute('data-blok-keyboard-navigated', '');
    });
    picker.el = content;
    picker.items = SHAPE_DEFS.map((d, i) => {
      const btn = makeRadio('blok-darkroom__markup-shape', `markup-shape-${d.tool}`, t(`tools.image.${d.key}`));
      const url = isFraming(d.tool) ? o.url : undefined;

      titled(btn, url === undefined ? d : { ...d, icon: '' });
      if (url !== undefined) photoTile(btn, d.tool, url);
      // pathLength 1 lets one dash length trace every glyph, whatever its real length.
      btn.querySelectorAll('svg > *').forEach((m) => m.setAttribute('pathLength', '1'));
      btn.style.setProperty('--blok-markup-shape-i', String(i));
      // Framing tiles have no ink to pick.
      if (!isFraming(d.tool)) btn.setAttribute('data-ink', '');
      if (takesFill(d.tool)) btn.setAttribute('data-fillable', '');
      btn.setAttribute('aria-checked', String(d.tool === st.tool));
      btn.addEventListener('click', () => {
        pickTool(d.tool);
        closePicker();
      });
      if (d.tool === FRAMING_TOOLS[0]) grid.appendChild(makeSep());
      grid.appendChild(btn);

      return btn;
    });
    content.appendChild(grid);
    paintPicker();
    picker.roving = rovingRadioGroup({
      radios: picker.items,
      orientation: 'both',
      getSelectedIndex: () => SHAPE_DEFS.findIndex((d) => d.tool === st.tool),
      onSelect: (i) => pickTool(SHAPE_DEFS[i].tool),
    });
    const reposition = (): void => {
      positionFixedAnchored(content, shapesBtn, { side: 'top', align: 'center', offset: 8 });
    };
    const tracker = createPositionTracker(content, reposition);

    picker.handle = openModalDialog({
      content,
      // Inside the panel, so it inherits the dark-glass tokens; the top layer still lifts it.
      container: root,
      label: t('tools.image.markupShapes'),
      anchor: shapesBtn,
      initialFocus: () => picker.items[Math.max(0, SHAPE_DEFS.findIndex((d) => d.tool === ui.shape))] ?? null,
      onDismiss: closePicker,
      onClose: () => {
        tracker.detach();
        picker.roving?.destroy();
        picker.roving = null;
        picker.items = [];
        picker.el = null;
        picker.handle = null;
        shapesBtn.setAttribute('aria-expanded', 'false');
        // A click does not focus a button in Safari, so focus restore alone could land on body.
        if (shapesBtn.isConnected) shapesBtn.focus({ preventScroll: true });
      },
    });
    shapesBtn.setAttribute('aria-expanded', 'true');
    reposition();
    tracker.attach();
  };

  const emit = (changed: keyof MarkupPanelState): void => {
    render();
    o.onChange({ ...st }, changed);
  };

  const pickTool = (tool: MarkupTool): void => {
    if (tool === st.tool) return;
    if (st.tool === 'eraser') sizes.eraser = st.size;
    else sizes.ink = st.size;
    st.tool = tool;
    st.size = tool === 'eraser' ? sizes.eraser : sizes.ink;
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

  const pickSlot = (i: number): void => {
    const slot = SLOTS[i];

    if (slot !== undefined) pickTool(slot === SHAPES_SLOT ? ui.shape : slot.tool);
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
      getSelectedIndex: () => slotOf(st.tool),
      onSelect: (i) => pickSlot(i),
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

  toolBtns.forEach((b, i) => listen(b, () => (b === shapesBtn ? openPicker() : pickSlot(i))));
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
    pickTool,
    stepSize(delta: 1 | -1): void {
      const next = SIZES[SIZES.findIndex((s) => s.size === st.size) + delta];

      if (next !== undefined && !paint.hidden) pickSize(next.size);
    },
    pickShape(): void {
      pickTool(ui.shape);
    },
    setHasMarkup(has: boolean): void {
      // An attribute, not [hidden]: the reset keeps its box so the panel never jumps.
      reset.setAttribute('data-shown', String(has));
      if (!has) rescueFocus(reset);
    },
    destroy(): void {
      closePicker();
      rovings.forEach((r) => r.destroy());
      cleanups.splice(0).forEach((fn) => fn());
    },
  };
}
