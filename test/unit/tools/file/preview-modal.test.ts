import { describe, it, expect, afterEach, vi } from 'vitest';
import { openFilePreview } from '../../../../src/tools/file/preview-modal';

vi.mock('../../../../src/tools/file/text-preview', () => ({
  loadTextPreview: vi.fn(),
}));
vi.mock('../../../../src/tools/file/office-preview', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../src/tools/file/office-preview');
  return {
    ...actual,
    fillOfficeBody: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../../../../src/markdown/markdownToHtml', () => ({
  markdownToHtml: vi.fn(),
}));
vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn().mockResolvedValue('<span class="token">x</span>'),
  isHighlightable: vi.fn().mockReturnValue(true),
}));
vi.mock('../../../../src/tools/code/prism-applier', () => ({
  // eslint-disable-next-line no-param-reassign
  applyPrismHighlight: vi.fn((el: HTMLElement, html: string) => { el.innerHTML = html; return () => {}; }),
  ensurePrismStyles: vi.fn(),
}));

import { loadTextPreview } from '../../../../src/tools/file/text-preview';
import { markdownToHtml } from '../../../../src/markdown/markdownToHtml';
import { fillOfficeBody } from '../../../../src/tools/file/office-preview';

const labels = { close: 'Close preview' };

const LABELS = {
  close: 'Close', raw: 'Source', render: 'Preview',
  loading: 'Loading…', error: 'Error', download: 'Download',
};

function getDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

afterEach(() => {
  document.body.querySelectorAll('[role="dialog"], .blok-file-preview-backdrop').forEach((el) => el.remove());
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('openFilePreview', () => {
  it('appends a dialog and an iframe with the given http(s) src', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'a.pdf', labels });

    const dialog = getDialog();
    expect(dialog).not.toBeNull();

    const frame = document.body.querySelector<HTMLIFrameElement>('[data-role="file-preview-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('https://example.com/a.pdf');
  });

  it('accepts a blob: url as the iframe src', () => {
    openFilePreview({ url: 'blob:https://example.com/abc-123', mimeType: 'application/pdf', labels });

    const frame = document.body.querySelector<HTMLIFrameElement>('[data-role="file-preview-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('blob:https://example.com/abc-123');
  });

  it('renders an error fallback and no iframe for a data: url', () => {
    openFilePreview({ url: 'data:text/html,<script>alert(1)</script>', mimeType: 'application/pdf', labels });

    expect(document.body.querySelector('[data-role="file-preview-frame"]')).toBeNull();
    expect(document.body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
  });

  it('renders an open-in-new-tab anchor for a pdf pointing at the file', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', fileName: 'a.pdf', labels: { ...labels, openInNewTab: 'Open in new tab' } });

    const open = document.body.querySelector<HTMLAnchorElement>('[data-action="preview-open-tab"]');
    expect(open).not.toBeNull();
    expect(open?.getAttribute('href')).toBe('https://example.com/a.pdf');
    expect(open?.target).toBe('_blank');
    expect(open?.rel).toContain('noopener');
    expect(open?.getAttribute('aria-label')).toBe('Open in new tab');
  });

  it('renders the open-in-new-tab anchor for a blob: pdf', () => {
    openFilePreview({ url: 'blob:https://example.com/abc-123', mimeType: 'application/pdf', labels: { ...labels, openInNewTab: 'Open in new tab' } });

    const open = document.body.querySelector<HTMLAnchorElement>('[data-action="preview-open-tab"]');
    expect(open?.getAttribute('href')).toBe('blob:https://example.com/abc-123');
  });

  it('omits the open-in-new-tab anchor for a text file', () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: '' });
    const teardown = openFilePreview({ url: 'notes.txt', fileName: 'notes.txt', labels: { ...labels, openInNewTab: 'Open in new tab' } });

    expect(document.body.querySelector('[data-action="preview-open-tab"]')).toBeNull();
    teardown();
  });

  it('closes on Escape keydown', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });
    expect(getDialog()).not.toBeNull();

     
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(getDialog()).toBeNull();
  });

  it('closes when the backdrop is pressed but not when the dialog is pressed', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const dialog = getDialog();
    if (!dialog) throw new Error('dialog missing');
    // A pointer press inside the dialog surface must not dismiss.
    const insidePress = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(insidePress, 'target', { value: dialog });
    document.dispatchEvent(insidePress);
    expect(getDialog()).not.toBeNull();

    const backdrop = document.body.querySelector<HTMLElement>('[data-role="file-preview-backdrop"]');
    if (!backdrop) throw new Error('backdrop missing');
    // A pointer press on the dim backdrop (outside the surface) dismisses.
    const outsidePress = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(outsidePress, 'target', { value: backdrop });
    document.dispatchEvent(outsidePress);
    expect(getDialog()).toBeNull();
  });

  it('closes when the close button is clicked', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const close = document.body.querySelector<HTMLButtonElement>('[data-action="close-preview"]');
    if (!close) throw new Error('close button missing');
    close.click();

    expect(getDialog()).toBeNull();
  });

  it('makes background siblings inert while open and clears it on teardown (H4)', () => {
    const behind = document.createElement('div');
    behind.setAttribute('data-role', 'editor-behind');
    document.body.appendChild(behind);

    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    expect(behind.hasAttribute('inert')).toBe(true);

    teardown();
    expect(behind.hasAttribute('inert')).toBe(false);
  });

  it('focuses the close button on open', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });

    const close = document.body.querySelector<HTMLButtonElement>('[data-action="close-preview"]');
    expect(close).toHaveFocus();
  });

  it('restores focus to the previously focused element after teardown', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    teardown();

    expect(trigger).toHaveFocus();
  });

  it('is idempotent when teardown is called twice', () => {
    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    teardown();
    expect(() => teardown()).not.toThrow();
    expect(getDialog()).toBeNull();
  });

  it('locks body scroll while open and restores the prior value on close', () => {
    document.body.style.overflow = 'scroll';

    const teardown = openFilePreview({ url: 'https://example.com/a.pdf', labels });
    expect(document.body.style.overflow).toBe('hidden');

    teardown();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('restores body scroll when closed via the close button', () => {
    openFilePreview({ url: 'https://example.com/a.pdf', labels });
    expect(document.body.style.overflow).toBe('hidden');

    const close = document.body.querySelector<HTMLButtonElement>('[data-action="close-preview"]');
    if (!close) throw new Error('close button missing');
    close.click();

    expect(document.body.style.overflow).toBe('');
  });
});

describe('openFilePreview — text kinds', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.clearAllMocks();
  });

  it('renders a plain <pre> for a text file', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'plain body' });
    const teardown = openFilePreview({ url: 'notes.txt', fileName: 'notes.txt', labels: LABELS });
    await vi.waitFor(() => {
      const pre = document.querySelector('[data-role="file-preview-text"]');
      expect(pre?.textContent).toBe('plain body');
    });
    teardown();
  });

  it('highlights a code file via Prism', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: 'const x = 1;' });
    const teardown = openFilePreview({ url: 'app.ts', fileName: 'app.ts', labels: LABELS });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-role="file-preview-code"] .token')).not.toBeNull();
    });
    teardown();
  });

  it('shows the Markdown render view by default and toggles to raw', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: true, text: '# Hi' });
    vi.mocked(markdownToHtml).mockResolvedValue('<h1>Hi</h1>');
    const teardown = openFilePreview({ url: 'readme.md', fileName: 'readme.md', labels: LABELS });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-role="file-preview-md-render"]')?.innerHTML).toContain('<h1>Hi</h1>');
    });

    const rawBtn = document.querySelector<HTMLButtonElement>('[data-action="preview-raw"]');
    rawBtn?.click();
    await vi.waitFor(() => {
      const raw = document.querySelector('[data-role="file-preview-md-raw"]');
      expect(raw).not.toBeNull();
      expect((raw as HTMLElement).hidden).toBe(false);
    });
    teardown();
  });

  it('shows an error with a download link when the fetch fails', async () => {
    vi.mocked(loadTextPreview).mockResolvedValue({ ok: false, reason: 'fetch-error' });
    const teardown = openFilePreview({ url: 'notes.txt', fileName: 'notes.txt', labels: LABELS });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
      expect(document.querySelector('[data-action="preview-download"]')).not.toBeNull();
    });
    teardown();
  });

  it('does not write to the DOM if torn down before the fetch resolves', async () => {
    let resolve!: (v: { ok: true; text: string }) => void;
    vi.mocked(loadTextPreview).mockReturnValue(new Promise(r => { resolve = r; }));
    const teardown = openFilePreview({ url: 'notes.txt', fileName: 'notes.txt', labels: LABELS });
    teardown();
    resolve({ ok: true, text: 'late' });
    await Promise.resolve();
    expect(document.querySelector('[data-role="file-preview-text"]')).toBeNull();
  });

  it('routes docx files to fillOfficeBody', async () => {
    const teardown = openFilePreview({ url: 'blob:x', fileName: 'a.docx', labels: LABELS });
    expect(fillOfficeBody).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ fileName: 'a.docx' }),
      'docx',
      expect.any(Function),
    );
    teardown();
  });

  it('routes xlsx files to fillOfficeBody', () => {
    const teardown = openFilePreview({ url: 'blob:x', fileName: 'a.xlsx', labels: LABELS });
    expect(fillOfficeBody).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), 'xlsx', expect.any(Function));
    teardown();
  });

  it('routes pptx files to fillOfficeBody', () => {
    const teardown = openFilePreview({ url: 'blob:x', fileName: 'a.pptx', labels: LABELS });
    expect(fillOfficeBody).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), 'pptx', expect.any(Function));
    teardown();
  });

  it('does not route pdf files to fillOfficeBody', () => {
    const teardown = openFilePreview({ url: 'blob:x', fileName: 'a.pdf', labels: LABELS });
    expect(fillOfficeBody).not.toHaveBeenCalled();
    teardown();
  });
});
