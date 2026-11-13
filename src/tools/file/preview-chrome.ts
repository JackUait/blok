import { onHover } from '../../components/utils/tooltip';
import { LANGUAGES } from '../code/constants';
import { extToPrismLang } from './code-languages';
import { resolveFileIcon, type FileIconCategory } from './file-icon';
import { humanFileSize } from './format';
import { extOf, type PreviewKind } from './preview';
import { DEFAULT_PREVIEW_LABELS, type PreviewLabels } from './preview-labels';

/** What a preview body can ask of the modal around it. */
export interface PreviewChrome {
  readonly labels: PreviewLabels;
  readonly header: HTMLElement;
  readonly body: HTMLElement;
  /** The type name the header shows: "Word", "TypeScript". */
  readonly typeName: string;
  /** Bytes, when known. */
  readonly size: number | undefined;
  /** Facts counted after load ("2 pages"). Shown between the type and the size. */
  setFacts(facts: string[]): void;
  /** The status bar under the body, or null to take it away. */
  setBar(bar: HTMLElement | null): void;
  /** Layers over the body (pill, rail, minimap). They survive a body refill. */
  addOverlay(overlay: HTMLElement): void;
  isClosed(): boolean;
  onRelease(release: () => void): void;
  /** Keys pressed anywhere in the open preview. */
  onKey(handler: (event: KeyboardEvent) => void): void;
}

/** A chrome with no modal around it: facts and the bar go nowhere, overlays land in `body`. */
export function detachedChrome(
  body: HTMLElement,
  isClosed: () => boolean = () => false,
  onRelease: (release: () => void) => void = () => undefined,
): PreviewChrome {
  return {
    labels: DEFAULT_PREVIEW_LABELS,
    header: document.createElement('div'),
    body,
    typeName: '',
    size: undefined,
    setFacts: () => undefined,
    setBar: () => undefined,
    addOverlay: (overlay) => body.appendChild(overlay),
    isClosed,
    onRelease,
    onKey: () => undefined,
  };
}

/** Marks a layer over the body, so the scroll haze does not take it for the view. */
export const OVERLAY_ATTR = 'data-blok-preview-overlay';

const BADGES: Record<string, string> = { docx: 'DOC', xlsx: 'XLS', pptx: 'PPT', markdown: 'MD' };
const KIND_BADGES: Record<PreviewKind, string> = {
  pdf: 'PDF', docx: 'DOC', xlsx: 'XLS', pptx: 'PPT', markdown: 'MD', code: 'CODE', text: 'TXT',
};
const OFFICE_NAMES: Partial<Record<PreviewKind, string>> = {
  pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', markdown: 'Markdown',
};

export interface PreviewType {
  badge: string;
  name: string;
  category: FileIconCategory;
}

/** Whether a text file is comma-separated values, by name or type. */
export function isCsv(file: { url: string; fileName?: string; mimeType?: string }): boolean {
  return file.mimeType === 'text/csv' || extOf(file.fileName ?? file.url) === 'csv';
}

/** Whether a text file is a log, by name. */
export function isLog(file: { url: string; fileName?: string }): boolean {
  return extOf(file.fileName ?? file.url) === 'log';
}

/** The badge text, type name and colour category the header shows for a file. */
export function describePreviewType(
  file: { url: string; fileName?: string; mimeType?: string },
  kind: PreviewKind,
  labels: PreviewLabels,
): PreviewType {
  const ext = extOf(file.fileName ?? file.url);
  const badge = BADGES[ext] ?? (ext === '' ? KIND_BADGES[kind] : ext.slice(0, 4).toUpperCase());
  const { category } = resolveFileIcon(file);
  const office = OFFICE_NAMES[kind];
  if (office !== undefined) {
    return { badge, name: office, category };
  }
  if (kind === 'code') {
    const lang = extToPrismLang(ext);

    return { badge, name: LANGUAGES.find((entry) => entry.id === lang)?.name ?? badge, category };
  }

  return { badge, name: isCsv(file) ? 'CSV' : labels.text, category };
}

/** The header's "Word · 2 pages · 18 KB" line. */
export function metaText(typeName: string, facts: string[], size: number | undefined): string {
  return [typeName, ...facts, humanFileSize(size)].filter((part) => part !== '').join(' · ');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, role?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (role !== undefined) {
    node.setAttribute('data-role', role);
  }

  return node;
}

/** A round icon button. `icon` is one of our own SVG constants. */
export function iconButton(icon: string, label: string, action: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'blok-file-preview-icon-button');
  button.type = 'button';
  button.setAttribute('data-action', action);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  button.addEventListener('click', onClick);

  return button;
}

/** An icon button whose name shows as a delayed hover hint, not a native title. */
export function hintButton(icon: string, label: string, action: string, onClick: () => void): HTMLButtonElement {
  const button = iconButton(icon, label, action, onClick);
  button.removeAttribute('title');
  onHover(button, label);

  return button;
}

/** The floating pill of controls at the bottom of the body. */
export function buildPill(items: HTMLElement[]): HTMLElement {
  const pill = el('div', 'blok-file-preview-pill', 'file-preview-pill');
  pill.setAttribute('role', 'toolbar');
  pill.setAttribute(OVERLAY_ATTR, '');
  pill.append(...items);

  return pill;
}

export function pillText(role: string): HTMLElement {
  return el('span', 'blok-file-preview-pill-text', role);
}

export function pillDivider(): HTMLElement {
  const divider = el('span', 'blok-file-preview-pill-divider');
  divider.setAttribute('aria-hidden', 'true');

  return divider;
}

/** The status bar under the body. */
export function buildBar(items: HTMLElement[]): HTMLElement {
  const bar = el('div', 'blok-file-preview-bar', 'file-preview-bar');
  bar.append(...items);

  return bar;
}

export function barText(text: string, role?: string): HTMLElement {
  const item = el('span', 'blok-file-preview-bar-text', role);
  item.textContent = text;

  return item;
}

export function barSpacer(): HTMLElement {
  return el('span', 'blok-file-preview-bar-spacer');
}

/** A text button in the status bar. `pressed` makes it a toggle. */
export function barButton(
  label: string,
  action: string,
  onClick: (button: HTMLButtonElement) => void,
  opts: { icon?: string; pressed?: boolean } = {},
): HTMLButtonElement {
  const button = el('button', 'blok-file-preview-bar-button');
  button.type = 'button';
  button.setAttribute('data-action', action);
  if (opts.icon !== undefined) {
    const glyph = el('span', 'blok-file-preview-bar-icon');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = opts.icon;
    button.appendChild(glyph);
  }
  const text = el('span', 'blok-file-preview-bar-label');
  text.textContent = label;
  button.appendChild(text);
  if (opts.pressed !== undefined) {
    button.setAttribute('aria-pressed', String(opts.pressed));
  }
  button.addEventListener('click', () => onClick(button));

  return button;
}

/** A Copy button for the bar; its label reads "Copied" for a moment after a click. */
export function copyButton(text: () => string, labels: PreviewLabels, icon: string): HTMLButtonElement {
  const state: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };

  return barButton(labels.copy, 'preview-copy', (button) => {
    const label = button.querySelector('.blok-file-preview-bar-label');
    const done = (): void => {
      if (label === null) {
        return;
      }
      label.textContent = labels.copied;
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
      state.timer = setTimeout(() => {
        label.textContent = labels.copy;
      }, 1400);
    };
    void navigator.clipboard?.writeText(text()).then(done, () => undefined);
  }, { icon });
}

/**
 * The segmented switch in the header's centre: a rendered view and its source.
 * `onChange(true)` asks for the source. Returns `show`, to switch from code.
 */
export function mountViewToggle(
  header: HTMLElement,
  renderLabel: string,
  rawLabel: string,
  onChange: (raw: boolean) => void,
): (raw: boolean) => void {
  const toggle = el('div', 'blok-file-preview-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', `${renderLabel} / ${rawLabel}`);
  const button = (label: string, action: string): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = 'button';
    node.setAttribute('data-action', action);
    node.textContent = label;

    return node;
  };
  const renderBtn = button(renderLabel, 'preview-render');
  const rawBtn = button(rawLabel, 'preview-raw');
  // The pill glides under the active segment. JS measures it: the two labels
  // differ in width across locales, so a fixed 50/50 split would misalign.
  const indicator = el('span', 'blok-file-preview-toggle-indicator');
  indicator.setAttribute('aria-hidden', 'true');
  toggle.append(indicator, renderBtn, rawBtn);
  header.appendChild(toggle);

  const show = (raw: boolean): void => {
    const target = raw ? rawBtn : renderBtn;
    renderBtn.setAttribute('aria-pressed', String(!raw));
    rawBtn.setAttribute('aria-pressed', String(raw));
    indicator.style.width = `${target.offsetWidth}px`;
    indicator.style.transform = `translateX(${target.offsetLeft}px)`;
    onChange(raw);
  };
  renderBtn.addEventListener('click', () => show(false));
  rawBtn.addEventListener('click', () => show(true));

  // No transition for the first placement, or the pill slides in from the track's edge on open.
  indicator.style.transition = 'none';
  show(false);
  indicator.getBoundingClientRect();
  indicator.style.transition = '';

  return show;
}
