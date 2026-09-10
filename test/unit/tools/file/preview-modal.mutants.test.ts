import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/tools/file/text-preview', () => ({
  loadTextPreview: vi.fn(),
}));

vi.mock('../../../../src/tools/file/office-preview', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../src/tools/file/office-preview');

  return { ...actual, fillOfficeBody: vi.fn() };
});

vi.mock('../../../../src/tools/file/preview', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../src/tools/file/preview');

  return { ...actual, getPreviewKind: vi.fn(actual.getPreviewKind as typeof getPreviewKind) };
});

vi.mock('../../../../src/markdown/markdownToHtml', () => ({
  markdownToHtml: vi.fn(),
}));

vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn(),
  isHighlightable: vi.fn(),
}));

vi.mock('../../../../src/tools/code/prism-applier', () => ({
  applyPrismHighlight: vi.fn(),
  ensurePrismStyles: vi.fn(),
}));

import { openFilePreview, type FilePreviewOptions } from '../../../../src/tools/file/preview-modal';
import { loadTextPreview } from '../../../../src/tools/file/text-preview';
import { fillOfficeBody } from '../../../../src/tools/file/office-preview';
import { getPreviewKind } from '../../../../src/tools/file/preview';
import { markdownToHtml } from '../../../../src/markdown/markdownToHtml';
import { tokenizePrism, isHighlightable } from '../../../../src/tools/code/prism-loader';
import { applyPrismHighlight, ensurePrismStyles } from '../../../../src/tools/code/prism-applier';

type Labels = FilePreviewOptions['labels'];

/** Every label distinct, so a `??` flipped to `&&` shows up as the wrong string. */
const FULL_LABELS: Labels = {
  close: 'Close preview',
  raw: 'Raw source',
  render: 'Rendered',
  loading: 'Loading the file…',
  error: 'Preview failed',
  download: 'Save file',
  openInNewTab: 'Open in a new tab',
  backToContent: 'Back to the document',
};

const MINIMAL_LABELS: Labels = { close: 'Close preview' };

const MD_TOKENS = '<span class="token">md</span>';
const CODE_TOKENS = '<span class="token">code</span>';

/** jsdom lays nothing out, so the toggle pill needs measurable segments. */
const SEGMENT_METRICS: Record<string, { width: number; left: number }> = {
  'preview-render': { width: 120, left: 0 },
  'preview-raw': { width: 60, left: 120 },
};

let teardown: (() => void) | null = null;
let offsetWidthDescriptor: PropertyDescriptor | undefined;
let offsetLeftDescriptor: PropertyDescriptor | undefined;

function segmentMetrics(el: HTMLElement): { width: number; left: number } | undefined {
  const action = el.getAttribute('data-action');

  return action === null ? undefined : SEGMENT_METRICS[action];
}

function stubOffsets(): void {
  offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  offsetLeftDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      return segmentMetrics(this)?.width ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement): number {
      return segmentMetrics(this)?.left ?? 0;
    },
  });
}

function restoreOffsets(): void {
  if (offsetWidthDescriptor !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
    offsetWidthDescriptor = undefined;
  }
  if (offsetLeftDescriptor !== undefined) {
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', offsetLeftDescriptor);
    offsetLeftDescriptor = undefined;
  }
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function dialogEl(): HTMLElement {
  const el = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (el === null) {
    throw new Error('dialog not mounted');
  }

  return el;
}

function childAt(parent: Element, index: number): HTMLElement {
  const el = parent.children[index];
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no element child at index ${index}`);
  }

  return el;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`missing ${selector}`);
  }

  return el;
}

function findButton(root: ParentNode, selector: string): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(selector);
  if (el === null) {
    throw new Error(`missing ${selector}`);
  }

  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'body text' });
  vi.mocked(fillOfficeBody).mockResolvedValue(undefined);
  vi.mocked(markdownToHtml).mockResolvedValue('<h1>Hi</h1>');
  vi.mocked(tokenizePrism).mockResolvedValue(CODE_TOKENS);
  vi.mocked(isHighlightable).mockReturnValue(true);
  stubOffsets();
});

afterEach(() => {
  teardown?.();
  teardown = null;
  restoreOffsets();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('openFilePreview — modal chrome', () => {
  it('builds the backdrop, dialog, header, title and actions with their class names', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'report.pdf', labels: FULL_LABELS });

    const backdrop = find(document.body, '[data-role="file-preview-backdrop"]');
    expect(backdrop.className).toBe('blok-file-preview-backdrop');

    const dialog = dialogEl();
    expect(dialog.parentElement).toBe(backdrop);
    expect(dialog.className).toBe('blok-file-preview');

    const header = childAt(dialog, 0);
    expect(header.className).toBe('blok-file-preview-header');

    const title = childAt(header, 0);
    expect(title.className).toBe('blok-file-preview-title');
    expect(title.children.length).toBe(2);

    const titleIcon = childAt(title, 0);
    expect(titleIcon.className).toBe('blok-file-preview-title-icon');
    expect(titleIcon.getAttribute('aria-hidden')).toBe('true');
    expect(titleIcon.innerHTML).toContain('svg');

    const titleText = childAt(title, 1);
    expect(titleText.className).toBe('blok-file-preview-title-text');
    expect(titleText.textContent).toBe('report.pdf');

    const actions = childAt(header, 1);
    expect(actions.className).toBe('blok-file-preview-actions');

    const close = findButton(actions, '[data-action="close-preview"]');
    expect(close.className).toBe('blok-file-preview-close');
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Close preview');

    expect(childAt(dialog, 1).className).toBe('blok-file-preview-body');
  });

  it('drops the file name into the title text only when there is one', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels: FULL_LABELS });

    const titleText = childAt(childAt(childAt(dialogEl(), 0), 0), 1);
    expect(titleText.children.length).toBe(0);
    expect(titleText.textContent).toBe('');
  });

  it('never writes to the title text when there is no file name', () => {
    // jsdom turns `textContent = undefined` into '' (measured), so the element's
    // final text cannot witness a write carrying an absent file name — the
    // assignment itself has to be the one watched.
    const writes: Node[] = [];
    const originalSet = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')?.set;
    if (originalSet === undefined) {
      throw new Error('Node.prototype.textContent has no setter to spy on');
    }
    vi.spyOn(Node.prototype, 'textContent', 'set').mockImplementation(function record(
      this: Node,
      value: string | null,
    ): void {
      writes.push(this);
      originalSet.call(this, value);
    });

    teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels: FULL_LABELS });

    const titleText = childAt(childAt(childAt(dialogEl(), 0), 0), 1);
    expect(writes).not.toContain(titleText);
  });

  it('writes role, aria-modal and the file-name label before the modal primitive does', () => {
    const attrLog: { el: Element; name: string; value: string }[] = [];
    const original = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function record(
      this: Element,
      name: string,
      value: string,
    ): void {
      attrLog.push({ el: this, name, value });
      original.call(this, name, value);
    });

    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'report.pdf', labels: FULL_LABELS });

    const dialog = dialogEl();
    const own = attrLog.filter((entry) => entry.el === dialog);
    // The modal primitive re-writes all three, so only the FIRST write proves
    // what buildElements itself put on the dialog.
    expect(own.find((entry) => entry.name === 'role')?.value).toBe('dialog');
    expect(own.find((entry) => entry.name === 'aria-modal')?.value).toBe('true');
    expect(own.find((entry) => entry.name === 'aria-label')?.value).toBe('report.pdf');
    expect(dialog.getAttribute('aria-label')).toBe('report.pdf');
  });

  it('renders the pdf iframe with its class, title and src', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'report.pdf', labels: FULL_LABELS });

    const frame = find(document.body, '[data-role="file-preview-frame"]');
    expect(frame.className).toBe('blok-file-preview-frame');
    expect(frame.getAttribute('title')).toBe('report.pdf');
    expect(frame.getAttribute('src')).toBe('https://example.com/a.pdf');
  });

  it('titles the pdf iframe with the close label when there is no file name', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels: FULL_LABELS });

    expect(find(document.body, '[data-role="file-preview-frame"]').getAttribute('title')).toBe('Close preview');
  });

  it('renders the error placeholder with its class for an unsafe pdf url', () => {
    teardown = openFilePreview({ url: 'data:application/pdf;base64,AAAA', mimeType: 'application/pdf', labels: FULL_LABELS });

    const body = childAt(dialogEl(), 1);
    const error = find(body, '[data-role="file-preview-error"]');
    expect(error.className).toBe('blok-file-preview-error');
    expect(body.children.length).toBe(1);
  });

  it('renders the open-in-new-tab anchor with its class and label', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'report.pdf', labels: FULL_LABELS });

    const open = find(document.body, '[data-action="preview-open-tab"]');
    expect(open.className).toBe('blok-file-preview-open');
    expect(open.getAttribute('aria-label')).toBe('Open in a new tab');
    expect(open.title).toBe('Open in a new tab');
  });

  it('leaves the open-in-new-tab anchor unlabelled when no label is supplied', () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'report.pdf', labels: MINIMAL_LABELS });

    const open = find(document.body, '[data-action="preview-open-tab"]');
    expect(open.hasAttribute('aria-label')).toBe(false);
    expect(open.title).toBe('');
  });

  it('shows the loading placeholder — not an iframe, not an open-tab anchor — for a text file', () => {
    vi.mocked(loadTextPreview).mockReturnValue(new Promise(() => undefined));

    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: FULL_LABELS });

    const body = childAt(dialogEl(), 1);
    expect(body.querySelector('[data-role="file-preview-frame"]')).toBeNull();
    expect(document.body.querySelector('[data-action="preview-open-tab"]')).toBeNull();

    const loading = find(body, '[data-role="file-preview-loading"]');
    expect(loading.className).toBe('blok-file-preview-loading');
    expect(loading.textContent).toBe('Loading the file…');
    expect(body.children.length).toBe(1);
  });

  it('falls back to the built-in loading label', () => {
    vi.mocked(loadTextPreview).mockReturnValue(new Promise(() => undefined));

    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: MINIMAL_LABELS });

    expect(find(document.body, '[data-role="file-preview-loading"]').textContent).toBe('Loading…');
  });
});

describe('openFilePreview — text and code bodies', () => {
  it('replaces the loading placeholder with a plain <pre>', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'plain body' });

    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await vi.waitFor(() => {
      expect(body.querySelector('[data-role="file-preview-text"]')).not.toBeNull();
    });

    const pre = find(body, '[data-role="file-preview-text"]');
    expect(pre.className).toBe('blok-file-preview-pre');
    expect(pre.textContent).toBe('plain body');
    expect(body.querySelector('[data-role="file-preview-loading"]')).toBeNull();
  });

  it('mounts the four scroll-haze strips once a text body has rendered', async () => {
    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await vi.waitFor(() => {
      expect(body.querySelectorAll('[data-blok-haze]').length).toBe(4);
    });
  });

  it('does not mount the scroll haze over a pdf iframe', async () => {
    teardown = openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'a.pdf', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await flush();

    expect(body.querySelectorAll('[data-blok-haze]').length).toBe(0);
  });

  it('destroys the scroll haze on teardown', async () => {
    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await vi.waitFor(() => {
      expect(body.querySelectorAll('[data-blok-haze]').length).toBe(4);
    });

    teardown();
    teardown = null;

    expect(body.querySelectorAll('[data-blok-haze]').length).toBe(0);
  });

  it('writes nothing into the detached body when the fetch lands after teardown', async () => {
    const pending: { settle: ((result: { ok: true; text: string }) => void) | null } = { settle: null };
    vi.mocked(loadTextPreview).mockReturnValue(new Promise((resolve) => {
      pending.settle = resolve;
    }));

    teardown = openFilePreview({ url: 'https://example.com/notes.txt', fileName: 'notes.txt', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    teardown();
    teardown = null;
    if (pending.settle === null) {
      throw new Error('loadTextPreview was never awaited');
    }
    pending.settle({ ok: true, text: 'late' });
    await flush();

    // The body is detached by now, so it has to be inspected directly — a
    // document-wide query would pass no matter what the fill did.
    expect(body.querySelector('[data-role="file-preview-text"]')).toBeNull();
    expect(body.querySelector('[data-role="file-preview-loading"]')).not.toBeNull();
    expect(body.querySelectorAll('[data-blok-haze]').length).toBe(0);
  });

  it('highlights code with the language of the file name, not of the url', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'const x = 1;' });

    teardown = openFilePreview({ url: 'https://example.com/legacy.py', fileName: 'app.ts', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await vi.waitFor(() => {
      expect(applyPrismHighlight).toHaveBeenCalled();
    });

    const pre = find(body, '[data-role="file-preview-code"]');
    expect(pre.className).toBe('blok-file-preview-pre');
    expect(body.querySelector('[data-role="file-preview-loading"]')).toBeNull();
    expect(isHighlightable).toHaveBeenCalledWith('typescript');
    expect(tokenizePrism).toHaveBeenCalledWith('const x = 1;', 'typescript');
    expect(applyPrismHighlight).toHaveBeenCalledWith(pre.firstElementChild, CODE_TOKENS, 'typescript');
  });

  it('skips tokenizing when the language is not highlightable', async () => {
    vi.mocked(isHighlightable).mockReturnValue(false);

    teardown = openFilePreview({ url: 'https://example.com/app.ts', fileName: 'app.ts', labels: FULL_LABELS });
    const body = childAt(dialogEl(), 1);

    await vi.waitFor(() => {
      expect(body.querySelector('[data-role="file-preview-code"]')).not.toBeNull();
    });
    await flush();

    expect(tokenizePrism).not.toHaveBeenCalled();
    expect(applyPrismHighlight).not.toHaveBeenCalled();
  });

  it('leaves code unhighlighted when the tokenizer yields nothing', async () => {
    vi.mocked(tokenizePrism).mockResolvedValue(null);

    teardown = openFilePreview({ url: 'https://example.com/app.ts', fileName: 'app.ts', labels: FULL_LABELS });

    await vi.waitFor(() => {
      expect(tokenizePrism).toHaveBeenCalled();
    });
    await flush();

    expect(applyPrismHighlight).not.toHaveBeenCalled();
  });

  it('falls back to the plain language when the extension maps to nothing', async () => {
    vi.mocked(getPreviewKind).mockReturnValueOnce('code');
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'unknown body' });

    teardown = openFilePreview({ url: 'https://example.com/notes.zzz', fileName: 'notes.zzz', labels: FULL_LABELS });

    await vi.waitFor(() => {
      expect(tokenizePrism).toHaveBeenCalled();
    });

    expect(tokenizePrism).toHaveBeenCalledWith('unknown body', 'plain');
  });
});

interface MarkdownParts {
  body: HTMLElement;
  toolbar: HTMLElement;
  indicator: HTMLElement;
  renderBtn: HTMLButtonElement;
  rawBtn: HTMLButtonElement;
  renderView: HTMLElement;
  rawView: HTMLElement;
}

async function openMarkdown(labels: Labels): Promise<MarkdownParts> {
  teardown = openFilePreview({ url: 'https://example.com/readme.md', fileName: 'readme.md', labels });

  const dialog = dialogEl();
  const header = childAt(dialog, 0);
  const body = childAt(dialog, 1);

  await vi.waitFor(() => {
    expect(applyPrismHighlight).toHaveBeenCalled();
  });

  const toolbar = childAt(header, 2);

  return {
    body,
    toolbar,
    indicator: childAt(toolbar, 0),
    renderBtn: findButton(toolbar, '[data-action="preview-render"]'),
    rawBtn: findButton(toolbar, '[data-action="preview-raw"]'),
    renderView: find(body, '[data-role="file-preview-md-render"]'),
    rawView: find(body, '[data-role="file-preview-md-raw"]'),
  };
}

describe('openFilePreview — markdown', () => {
  beforeEach(() => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: '# Hi' });
    vi.mocked(tokenizePrism).mockResolvedValue(MD_TOKENS);
  });

  it('builds the header toggle, both views and the pill in their rendered state', async () => {
    const md = await openMarkdown(FULL_LABELS);

    expect(md.toolbar.className).toBe('blok-file-preview-toggle');
    expect(md.toolbar.getAttribute('role')).toBe('group');
    expect(md.toolbar.getAttribute('aria-label')).toBe('Rendered / Raw source');

    expect(md.indicator.className).toBe('blok-file-preview-toggle-indicator');
    expect(md.indicator.getAttribute('aria-hidden')).toBe('true');

    expect(md.renderBtn.type).toBe('button');
    expect(md.renderBtn.textContent).toBe('Rendered');
    expect(md.rawBtn.type).toBe('button');
    expect(md.rawBtn.textContent).toBe('Raw source');

    expect(md.body.querySelector('[data-role="file-preview-loading"]')).toBeNull();
    expect(md.renderView.className).toBe('blok-file-preview-md');
    expect(md.renderView.innerHTML).toBe('<h1>Hi</h1>');
    expect(md.rawView.className).toBe('blok-file-preview-pre');
    expect(md.rawView.children.length).toBe(1);
    expect(md.rawView.firstElementChild?.textContent).toBe('# Hi');

    expect(md.renderView.hidden).toBe(false);
    expect(md.rawView.hidden).toBe(true);
    expect(md.renderBtn.getAttribute('aria-pressed')).toBe('true');
    expect(md.rawBtn.getAttribute('aria-pressed')).toBe('false');

    expect(md.indicator.style.width).toBe('120px');
    expect(md.indicator.style.transform).toBe('translateX(0px)');
    expect(md.indicator.style.transition).toBe('');

    expect(ensurePrismStyles).toHaveBeenCalled();
    expect(markdownToHtml).toHaveBeenCalledWith('# Hi', {
      baseUrl: 'https://example.com/readme.md',
      backToContentLabel: 'Back to the document',
    });
    expect(tokenizePrism).toHaveBeenCalledWith('# Hi', 'markdown');
    expect(applyPrismHighlight).toHaveBeenCalledWith(md.rawView.firstElementChild, MD_TOKENS, 'markdown');
  });

  it('moves both views, both aria-pressed flags and the pill on every toggle click', async () => {
    const md = await openMarkdown(FULL_LABELS);

    md.rawBtn.click();

    expect(md.rawView.hidden).toBe(false);
    expect(md.renderView.hidden).toBe(true);
    expect(md.renderBtn.getAttribute('aria-pressed')).toBe('false');
    expect(md.rawBtn.getAttribute('aria-pressed')).toBe('true');
    expect(md.indicator.style.width).toBe('60px');
    expect(md.indicator.style.transform).toBe('translateX(120px)');

    md.renderBtn.click();

    expect(md.rawView.hidden).toBe(true);
    expect(md.renderView.hidden).toBe(false);
    expect(md.renderBtn.getAttribute('aria-pressed')).toBe('true');
    expect(md.rawBtn.getAttribute('aria-pressed')).toBe('false');
    expect(md.indicator.style.width).toBe('120px');
    expect(md.indicator.style.transform).toBe('translateX(0px)');
  });

  it('falls back to the built-in toggle labels', async () => {
    const md = await openMarkdown(MINIMAL_LABELS);

    expect(md.toolbar.getAttribute('aria-label')).toBe('Preview / Source');
    expect(md.renderBtn.textContent).toBe('Preview');
    expect(md.rawBtn.textContent).toBe('Source');
  });

  it('parks the pill without a transition and hides the raw view before the first paint', async () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => {
      records.push(...batch);
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['style', 'hidden'],
    });

    const md = await openMarkdown(FULL_LABELS);
    records.push(...observer.takeRecords());
    observer.disconnect();

    // Both writes are overwritten before the test can read them, so the record
    // stream is the only witness that they happened at all.
    const suppressed = records.some(
      (record) => record.target === md.indicator
        && record.attributeName === 'style'
        && (record.oldValue ?? '').includes('transition: none'),
    );
    expect(suppressed).toBe(true);

    const preHidden = records.some(
      (record) => record.target === md.rawView && record.attributeName === 'hidden' && record.oldValue === '',
    );
    expect(preHidden).toBe(true);
  });

  it('leaves the raw markdown unhighlighted when the tokenizer yields nothing', async () => {
    vi.mocked(tokenizePrism).mockResolvedValue(null);

    teardown = openFilePreview({ url: 'https://example.com/readme.md', fileName: 'readme.md', labels: FULL_LABELS });

    await vi.waitFor(() => {
      expect(tokenizePrism).toHaveBeenCalled();
    });
    await flush();

    expect(applyPrismHighlight).not.toHaveBeenCalled();
  });
});

describe('openFilePreview — office bodies', () => {
  it('hands the office fill a probe that flips only on teardown', () => {
    teardown = openFilePreview({ url: 'blob:https://example.com/abc', fileName: 'sheet.xlsx', labels: FULL_LABELS });

    const call = vi.mocked(fillOfficeBody).mock.calls[0];
    if (call === undefined) {
      throw new Error('fillOfficeBody was not called');
    }
    const isClosed = call[3];

    expect(isClosed()).toBe(false);

    teardown();
    teardown = null;

    expect(isClosed()).toBe(true);
  });
});
