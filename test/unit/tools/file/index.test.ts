import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTool } from '../../../../src/tools/file';
import type { FileData, FileConfig } from '../../../../types/tools/file';
import type { API, BlockAPI, BlockToolConstructorOptions, FilePasteEvent } from '../../../../types';

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'b1',
  name: 'file',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const createOptions = (
  data: Partial<FileData> = {},
  config: FileConfig = {},
  block?: BlockAPI
): BlockToolConstructorOptions<FileData, FileConfig> => ({
  data: { url: '', ...data } as FileData,
  config,
  api: createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const filePasteEvent = (file: File): FilePasteEvent => {
  const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
  Object.defineProperty(event, 'type', { value: 'file' });
  return event;
};

describe('FileTool — rendering', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders the empty state when data.url is empty', () => {
    const root = new FileTool(createOptions()).render();
    expect(root.querySelector('input[type="file"]')).not.toBeNull();
    expect(root.querySelector('[data-tab="link"]')).not.toBeNull();
  });

  it('renders the download card when data.url is present', () => {
    const root = new FileTool(createOptions({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf' })).render();
    const link = root.querySelector<HTMLAnchorElement>('a[data-action="download"]');
    expect(link?.getAttribute('href')).toBe('https://cdn/doc.pdf');
    expect(root.querySelector('[data-role="file-name"]')?.textContent).toBe('doc.pdf');
  });

  it('anchors the toolbar to the file card, not the bottom caption', () => {
    // The caption row is contenteditable and sits below the card. Without an
    // explicit anchor the toolbar's contenteditable-descendant search would
    // center the +/drag handle on the caption (block bottom). The tool must
    // anchor the toolbar to the card at the top instead.
    const tool = new FileTool(createOptions({
      url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', caption: 'hello', captionVisible: true,
    }));
    const root = tool.render();

    expect(root.querySelector('[data-role="file-caption"]')).not.toBeNull();
    expect(tool.getToolbarAnchorElement()).toBe(root.querySelector('[data-role="file-card"]'));
  });
});

describe('FileTool — save & validate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('save() returns the sparse persisted shape', () => {
    const tool = new FileTool(createOptions({
      url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048, mimeType: 'application/pdf', caption: 'hi',
    }));
    tool.render();
    expect(tool.save()).toEqual({
      url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', size: 2048, mimeType: 'application/pdf', caption: 'hi',
    });
  });

  it('save() omits undefined optional fields', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf' }));
    tool.render();
    expect(tool.save()).toEqual({ url: 'https://cdn/doc.pdf' });
  });

  it('validate() is false for an empty url', () => {
    expect(new FileTool(createOptions()).validate({ url: '' } as FileData)).toBe(false);
  });

  it('validate() is true for a non-empty url', () => {
    expect(new FileTool(createOptions()).validate({ url: 'https://cdn/x' } as FileData)).toBe(true);
  });
});

describe('FileTool — toolbox & paste config', () => {
  it('toolbox uses the file titleKey', () => {
    expect(FileTool.toolbox).toMatchObject({ titleKey: 'file' });
  });

  it('isReadOnlySupported is true', () => {
    expect(FileTool.isReadOnlySupported).toBe(true);
  });

  it('pasteConfig claims non-image files and never image/*', () => {
    const { pasteConfig } = FileTool;
    if (pasteConfig === false) throw new Error('pasteConfig is false');
    expect(pasteConfig.files?.mimeTypes).toContain('application/*');
    expect(pasteConfig.files?.mimeTypes).not.toContain('image/*');
  });

  it('pasteConfig declares no URL patterns (avoids hijacking links)', () => {
    const { pasteConfig } = FileTool;
    if (pasteConfig === false) throw new Error('pasteConfig is false');
    expect(pasteConfig.patterns).toBeUndefined();
  });
});

describe('FileTool — upload flow', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('onPaste(file) uploads and transitions to the rendered card', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: 'https://cdn/a.pdf', fileName: 'a.pdf', size: 10 });
    const block = createMockBlock();
    const tool = new FileTool(createOptions({}, { uploader: { uploadByFile } }, block));
    const root = tool.render();
    tool.onPaste(filePasteEvent(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })));
    await flush();
    expect(root.querySelector('[data-role="file-name"]')?.textContent).toBe('a.pdf');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('shows the error state when the upload fails', async () => {
    const uploadByFile = vi.fn().mockRejectedValue(new Error('boom'));
    const tool = new FileTool(createOptions({}, { uploader: { uploadByFile } }));
    const root = tool.render();
    tool.onPaste(filePasteEvent(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })));
    await flush();
    expect(root.querySelector('[data-role="file-error"]')).not.toBeNull();
  });
});

describe('FileTool — caption & read-only', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the caption on blur', () => {
    const block = createMockBlock();
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf' }, {}, block));
    const root = tool.render();
    const caption = root.querySelector<HTMLElement>('[data-role="file-caption"]');
    if (!caption) throw new Error('caption missing');
    caption.textContent = 'a caption';
    caption.dispatchEvent(new Event('blur'));
    expect(tool.save().caption).toBe('a caption');
    expect(block.dispatchChange).toHaveBeenCalled();
  });

  it('setReadOnly(true) makes the caption non-editable', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf' }));
    const root = tool.render();
    tool.setReadOnly(true);
    expect(root.querySelector('[data-role="file-caption"]')?.getAttribute('contenteditable')).toBe('false');
  });
});

describe('FileTool — preview', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('[data-role="file-preview-backdrop"]').forEach((el) => el.remove());
  });

  it('opens a preview dialog when a PDF card body is clicked', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' }));
    const root = tool.render();
    const body = root.querySelector<HTMLElement>('[data-role="file-card"]');
    expect(body?.tagName).toBe('BUTTON');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    body?.click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('does not open a dialog for a non-previewable file; card body stays a download link', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/a.zip', fileName: 'a.zip' }));
    const root = tool.render();
    const body = root.querySelector<HTMLElement>('[data-role="file-card"]');
    expect(body?.tagName).toBe('A');
    body?.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('labels the separate download link for assistive tech', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' }));
    const root = tool.render();
    const link = root.querySelector<HTMLAnchorElement>('a[data-action="download"]');
    expect(link?.getAttribute('aria-label')).toBe('tools.file.download');
  });

  it('removed() tears down an open preview', () => {
    const tool = new FileTool(createOptions({ url: 'https://cdn/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' }));
    const root = tool.render();
    root.querySelector<HTMLElement>('[data-role="file-card"]')?.click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    tool.removed();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
