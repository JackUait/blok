import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';

vi.mock('../../../../src/tools/code/katex-loader', () => ({
  renderLatex: vi.fn().mockResolvedValue('<span class="katex">rendered</span>'),
}));

vi.mock('../../../../src/tools/code/mermaid-loader', () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg>mermaid diagram</svg>'),
}));

const mockTokenizeCode = vi.fn().mockResolvedValue(null);
const mockIsHighlightable = vi.fn().mockReturnValue(false);
const mockDisposeHighlighter = vi.fn();

vi.mock('../../../../src/tools/code/shiki-loader', () => ({
  tokenizeCode: (...args: unknown[]): unknown => mockTokenizeCode(...args),
  isHighlightable: (...args: unknown[]): unknown => mockIsHighlightable(...args),
  disposeHighlighter: mockDisposeHighlighter,
}));

const mockApplyHighlights = vi.fn().mockReturnValue(() => {});
const mockIsHighlightingSupported = vi.fn().mockReturnValue(false);
const mockDisposeAllHighlights = vi.fn();

vi.mock('../../../../src/tools/code/highlight-applier', () => ({
  applyHighlights: (...args: unknown[]): unknown => mockApplyHighlights(...args),
  isHighlightingSupported: (): unknown => mockIsHighlightingSupported(),
  disposeAllHighlights: mockDisposeAllHighlights,
}));

const createMockAPI = (): API =>
  ({
    styles: {
      block: 'ce-block',
      inlineToolbar: '',
      inlineToolButton: '',
      inlineToolButtonActive: '',
      settingsButton: '',
      settingsButtonActive: '',
      selected: '',
    },
    i18n: { t: (k: string) => k },
    blocks: {
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      insert: vi.fn(),
    },
  }) as unknown as API;

const createOptions = (
  data: Partial<CodeData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<CodeData> => ({
  data: {
    code: data.code ?? '',
    language: data.language ?? 'plain text',
    ...(data.lineNumbers !== undefined ? { lineNumbers: data.lineNumbers } : {}),
  } as CodeData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'code-block-id' } as never,
});

describe('CodeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenizeCode.mockResolvedValue(null);
    mockIsHighlightable.mockReturnValue(false);
    mockApplyHighlights.mockReturnValue(() => {});
    mockIsHighlightingSupported.mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();

    // Clean up any language picker elements left in document.body
    document.querySelectorAll('[data-blok-testid="code-language-picker"]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blok-language-picker-backdrop]').forEach((el) => el.remove());
  });

  describe('render()', () => {
    it('returns a wrapper div with header and code element', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());
      const el = tool.render();

      expect(el).toBeInstanceOf(HTMLDivElement);
      expect(el.querySelector('[data-blok-testid="code-content"]')).toBeTruthy();
      expect(el.querySelector('[data-blok-testid="code-language-btn"]')).toBeTruthy();
      expect(el.querySelector('[data-blok-testid="code-copy-btn"]')).toBeTruthy();
      expect(el.querySelector('[data-blok-testid="code-wrap-btn"]')).toBeTruthy();
    });

    it('renders existing code content', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'console.log("hi")' }));
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]')!;

      expect(codeEl.textContent).toBe('console.log("hi")');
    });

    it('sets contentEditable on code element when not read-only', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]')!;

      expect(codeEl.getAttribute('contenteditable')).toBe('plaintext-only');
    });

    it('does not set contentEditable in read-only mode', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({}, { readOnly: true }));
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]')!;

      expect(codeEl.getAttribute('contenteditable')).toBeNull();
    });

    it('displays language name in header button', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ language: 'javascript' }));
      const el = tool.render();
      const btn = el.querySelector('[data-blok-testid="code-language-btn"]')!;

      expect(btn.textContent).toBe('JavaScript');
    });

    it('language button opens language picker on click', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ language: 'javascript' }));
      const el = tool.render();

      const langBtn = el.querySelector('[data-blok-testid="code-language-btn"]') as HTMLButtonElement;

      // Picker is appended to document.body after render, but hidden
      const pickerEl = document.body.querySelector('[data-blok-testid="code-language-picker"]') as HTMLElement;

      expect(pickerEl).not.toBeNull();
      expect(pickerEl.hidden).toBe(true);

      // Click language button to open the picker
      langBtn.click();

      expect(pickerEl.hidden).toBe(false);

      // Clean up
      tool.removed();
    });

    it('removed() cleans up picker element from document.body', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());

      tool.render();

      expect(document.body.querySelector('[data-blok-testid="code-language-picker"]')).not.toBeNull();

      tool.removed();

      expect(document.body.querySelector('[data-blok-testid="code-language-picker"]')).toBeNull();
    });
  });

  describe('save()', () => {
    it('returns code as textContent and language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'let x = 1;', language: 'javascript' }));
      const el = tool.render();
      const data = tool.save(el);

      expect(data.code).toBe('let x = 1;');
      expect(data.language).toBe('javascript');
    });

    it('returns raw text, not HTML', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: '<div>hello</div>' }));
      const el = tool.render();
      const data = tool.save(el);

      expect(data.code).toBe('<div>hello</div>');
      expect(data.code).not.toContain('&lt;');
    });
  });

  describe('validate()', () => {
    it('returns true for non-empty code', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());

      expect(tool.validate({ code: 'x', language: 'plain text' } as CodeData)).toBe(true);
    });

    it('returns false for empty code', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());

      expect(tool.validate({ code: '', language: 'plain text' } as CodeData)).toBe(false);
      expect(tool.validate({ code: '   ', language: 'plain text' } as CodeData)).toBe(false);
    });
  });

  describe('merge()', () => {
    it('appends code with newline separator', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1' }));

      tool.render();
      tool.merge({ code: 'line 2', language: 'plain text' } as CodeData);

      const el = tool.render();
      const data = tool.save(el);

      expect(data.code).toBe('line 1\nline 2');
    });
  });

  describe('static toolbox', () => {
    it('has icon and titleKey', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const toolbox = CodeTool.toolbox;

      expect(toolbox).toBeDefined();
      expect(!Array.isArray(toolbox) && toolbox.icon).toBeTruthy();
      expect(!Array.isArray(toolbox) && toolbox.titleKey).toBe('code');
    });

    it('has search terms', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const toolbox = CodeTool.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.searchTerms).toEqual(['code', 'pre', 'snippet', 'program']);
    });
  });

  describe('static properties', () => {
    it('isReadOnlySupported returns true', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');

      expect(CodeTool.isReadOnlySupported).toBe(true);
    });

    it('pasteConfig accepts PRE tags and triple-backtick pattern', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const config = CodeTool.pasteConfig;

      expect((config as { tags: string[] }).tags).toContain('PRE');
      expect((config as { patterns: Record<string, RegExp> }).patterns.code).toEqual(/^```/);
    });

    it('sanitize config allows code tag', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const sanitize = CodeTool.sanitize;

      expect(sanitize).toHaveProperty('code');
    });

    it('conversionConfig exports code field', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');

      expect(CodeTool.conversionConfig).toEqual({ export: 'code', import: 'code' });
    });
  });

  describe('copy button', () => {
    it('copies code to clipboard on click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);

      Object.assign(navigator, {
        clipboard: { writeText },
      });

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'copied text' }));
      const el = tool.render();
      const copyBtn = el.querySelector('[data-blok-testid="code-copy-btn"]') as HTMLButtonElement;

      copyBtn.click();

      expect(writeText).toHaveBeenCalledWith('copied text');
    });
  });

  describe('wrap toggle', () => {
    it('toggles whitespace style on code element', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;
      const wrapBtn = el.querySelector('[data-blok-testid="code-wrap-btn"]') as HTMLButtonElement;

      expect(codeEl.className).toContain('whitespace-pre-wrap');

      wrapBtn.click();
      expect(codeEl.className).toContain('whitespace-pre');
      expect(codeEl.className).not.toContain('whitespace-pre-wrap');

      wrapBtn.click();
      expect(codeEl.className).toContain('whitespace-pre-wrap');
    });
  });

  describe('renderSettings()', () => {
    it('returns menu config with language submenu', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ language: 'javascript' }));

      tool.render();
      const settings = tool.renderSettings();

      expect(Array.isArray(settings)).toBe(true);
      expect((settings as Array<{ name: string }>)[0].name).toBe('code-language');
    });
  });

  describe('read-only mode', () => {
    it('renders code without contentEditable', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'read only code' }, { readOnly: true }));
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]')!;

      expect(codeEl.textContent).toBe('read only code');
      expect(codeEl.getAttribute('contenteditable')).toBeNull();
    });
  });

  describe('onPaste()', () => {
    it('has an onPaste method on the prototype', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');

      expect(typeof CodeTool.prototype.onPaste).toBe('function');
    });
  });

  describe('preview tab', () => {
    it('shows tab buttons for latex language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-code-tab"]')).toBeTruthy();
      expect(el.querySelector('[data-blok-testid="code-preview-tab"]')).toBeTruthy();
    });

    it('does not show tab buttons for non-previewable language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'const x = 1;', language: 'javascript' }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-code-tab"]')).toBeNull();
      expect(el.querySelector('[data-blok-testid="code-preview-tab"]')).toBeNull();
    });

    it('shows preview container for latex language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-preview"]')).toBeTruthy();
    });

    it('defaults to preview tab active for latex', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();

      const preElement = el.querySelector('pre')!;
      const previewEl = el.querySelector('[data-blok-testid="code-preview"]')!;

      // Preview is visible, code is hidden
      expect(preElement.hidden).toBe(true);
      expect((previewEl as HTMLElement).hidden).toBe(false);
    });

    it('clicking code tab shows code and hides preview', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();

      const codeTab = el.querySelector('[data-blok-testid="code-code-tab"]') as HTMLButtonElement;

      codeTab.click();

      const preElement = el.querySelector('pre')!;
      const previewEl = el.querySelector('[data-blok-testid="code-preview"]')!;

      expect(preElement.hidden).toBe(false);
      expect((previewEl as HTMLElement).hidden).toBe(true);
    });

    it('clicking preview tab shows preview and hides code', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();

      // Switch to code first
      const codeTab = el.querySelector('[data-blok-testid="code-code-tab"]') as HTMLButtonElement;
      codeTab.click();

      // Switch back to preview
      const previewTab = el.querySelector('[data-blok-testid="code-preview-tab"]') as HTMLButtonElement;
      previewTab.click();

      const preElement = el.querySelector('pre')!;
      const previewEl = el.querySelector('[data-blok-testid="code-preview"]')!;

      expect(preElement.hidden).toBe(true);
      expect((previewEl as HTMLElement).hidden).toBe(false);
    });

    it('read-only mode with latex shows preview only (no tabs)', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }, { readOnly: true }));
      const el = tool.render();

      // Preview shown, code hidden
      expect(el.querySelector('[data-blok-testid="code-preview"]')).toBeTruthy();
      expect(el.querySelector('pre')!.hidden).toBe(true);
      // No tabs in read-only
      expect(el.querySelector('[data-blok-testid="code-code-tab"]')).toBeNull();
      expect(el.querySelector('[data-blok-testid="code-preview-tab"]')).toBeNull();
    });

    it('shows tab buttons for mermaid language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'graph TD; A-->B;', language: 'mermaid' }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-code-tab"]')).toBeTruthy();
      expect(el.querySelector('[data-blok-testid="code-preview-tab"]')).toBeTruthy();
    });

    it('shows preview container for mermaid language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'graph TD; A-->B;', language: 'mermaid' }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-preview"]')).toBeTruthy();
    });

    it('calls renderMermaid (not renderLatex) for mermaid language', async () => {
      const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');
      const { renderLatex } = await import('../../../../src/tools/code/katex-loader');
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'graph TD; A-->B;', language: 'mermaid' }));
      tool.render();

      // Wait for async renderPreview to complete
      await vi.waitFor(() => {
        expect(renderMermaid).toHaveBeenCalledWith('graph TD; A-->B;');
      });
      expect(renderLatex).not.toHaveBeenCalled();
    });

    it('calls renderLatex (not renderMermaid) for latex language', async () => {
      const { renderMermaid } = await import('../../../../src/tools/code/mermaid-loader');
      const { renderLatex } = await import('../../../../src/tools/code/katex-loader');
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      tool.render();

      await vi.waitFor(() => {
        expect(renderLatex).toHaveBeenCalledWith('E = mc^2');
      });
      expect(renderMermaid).not.toHaveBeenCalled();
    });

    it('read-only mode with mermaid shows preview only (no tabs)', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'graph TD; A-->B;', language: 'mermaid' }, { readOnly: true }));
      const el = tool.render();

      expect(el.querySelector('[data-blok-testid="code-preview"]')).toBeTruthy();
      expect(el.querySelector('pre')!.hidden).toBe(true);
      expect(el.querySelector('[data-blok-testid="code-code-tab"]')).toBeNull();
      expect(el.querySelector('[data-blok-testid="code-preview-tab"]')).toBeNull();
    });
  });

  describe('syntax highlighting', () => {
    it('highlights code after rendered() for highlightable language when supported', async () => {
      mockIsHighlightingSupported.mockReturnValue(true);
      mockIsHighlightable.mockReturnValue(true);
      mockTokenizeCode.mockResolvedValue({
        light: { tokens: [[{ content: 'const', color: '#A626A4', offset: 0 }]], fg: '#383A42' },
        dark: { tokens: [[{ content: 'const', color: '#4FC1FF', offset: 0 }]], fg: '#D4D4D4' },
      });

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'const x = 1', language: 'javascript' }));
      tool.render();
      tool.rendered();

      await vi.waitFor(() => {
        expect(mockTokenizeCode).toHaveBeenCalledWith('const x = 1', 'javascript');
      });
      expect(mockApplyHighlights).toHaveBeenCalled();
    });

    it('does not highlight when CSS Highlight API is not supported', async () => {
      mockIsHighlightingSupported.mockReturnValue(false);
      mockIsHighlightable.mockReturnValue(true);

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'const x = 1', language: 'javascript' }));
      tool.render();
      tool.rendered();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockTokenizeCode).not.toHaveBeenCalled();
    });

    it('does not highlight unhighlightable languages', async () => {
      mockIsHighlightingSupported.mockReturnValue(true);
      mockIsHighlightable.mockReturnValue(false);

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'plain text', language: 'plain text' }));
      tool.render();
      tool.rendered();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockTokenizeCode).not.toHaveBeenCalled();
    });

    it('re-highlights when language changes', async () => {
      mockIsHighlightingSupported.mockReturnValue(true);
      mockIsHighlightable.mockReturnValue(true);
      mockTokenizeCode.mockResolvedValue({
        light: { tokens: [[{ content: 'x', color: '#FF0000', offset: 0 }]], fg: '#000' },
        dark: { tokens: [[{ content: 'x', color: '#00FF00', offset: 0 }]], fg: '#FFF' },
      });

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'x = 1', language: 'javascript' }));
      tool.render();

      const settings = tool.renderSettings() as Array<{ children: { items: Array<{ onActivate: () => void; title: string }> } }>;
      const pythonItem = settings[0].children.items.find((i) => i.title === 'Python');
      pythonItem?.onActivate();

      await vi.waitFor(() => {
        expect(mockTokenizeCode).toHaveBeenCalledWith(expect.any(String), 'python');
      });
    });

    it('disposes highlights in removed()', async () => {
      const mockCleanup = vi.fn();
      mockIsHighlightingSupported.mockReturnValue(true);
      mockIsHighlightable.mockReturnValue(true);
      mockTokenizeCode.mockResolvedValue({
        light: { tokens: [[{ content: 'x', color: '#FF0000', offset: 0 }]], fg: '#000' },
        dark: { tokens: [[{ content: 'x', color: '#00FF00', offset: 0 }]], fg: '#FFF' },
      });
      mockApplyHighlights.mockReturnValue(mockCleanup);

      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'test', language: 'javascript' }));
      tool.render();
      tool.rendered();

      await vi.waitFor(() => {
        expect(mockApplyHighlights).toHaveBeenCalled();
      });

      tool.removed();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe('line numbers', () => {
    it('renders a gutter element with line numbers', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1\nline 2\nline 3' }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]');

      expect(gutter).not.toBeNull();
      expect(gutter!.children).toHaveLength(3);
    });

    it('gutter shows correct line numbers', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'a\nb\nc\nd\ne' }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]')!;

      expect(gutter.children[0].textContent).toBe('1');
      expect(gutter.children[4].textContent).toBe('5');
    });

    it('updates gutter on input', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1' }));
      const el = tool.render();
      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]')!;

      expect(gutter.children).toHaveLength(1);

      // Simulate typing a new line
      codeEl.textContent = 'line 1\nline 2\nline 3';
      codeEl.dispatchEvent(new Event('input', { bubbles: true }));

      expect(gutter.children).toHaveLength(3);
    });

    it('updates gutter immediately when Enter creates a new line', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1' }));
      const el = tool.render();

      // Element must be in the DOM for window.getSelection() to work
      document.body.appendChild(el);

      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]')!;

      expect(gutter.children).toHaveLength(1);

      // Place caret at end of the code element
      const range = document.createRange();
      const textNode = codeEl.firstChild!;
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      // Dispatch keydown Enter — handled by handleCodeKeydown which inserts
      // '\n' via Range API; preventDefault suppresses the native input event
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      codeEl.dispatchEvent(enterEvent);

      // Gutter must update immediately — not wait for the next input event
      expect(gutter.children).toHaveLength(2);
      expect(gutter.children[0].textContent).toBe('1');
      expect(gutter.children[1].textContent).toBe('2');

      el.remove();
    });

    it('appends trailing BR when Enter creates a trailing newline', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'hello' }));
      const el = tool.render();
      document.body.appendChild(el);

      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;

      // Place caret at end
      const range = document.createRange();
      range.setStart(codeEl.firstChild!, 5);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      // Press Enter at end of text
      codeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // A <br> sentinel should be appended so the browser renders the empty line
      expect(codeEl.lastChild).toBeInstanceOf(HTMLBRElement);
      // textContent must NOT include the BR (it's invisible to content)
      expect(codeEl.textContent).toBe('hello\n');

      el.remove();
    });

    it('does not append BR when Enter is pressed in the middle of text', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'helloworld' }));
      const el = tool.render();
      document.body.appendChild(el);

      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;

      // Place caret in the middle (after "hello")
      const range = document.createRange();
      range.setStart(codeEl.firstChild!, 5);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      codeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // No BR needed — newline is followed by "world"
      expect(codeEl.lastChild).not.toBeInstanceOf(HTMLBRElement);
      expect(codeEl.textContent).toBe('hello\nworld');

      el.remove();
    });

    it('removes trailing BR when input makes content no longer end with newline', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'hello' }));
      const el = tool.render();
      document.body.appendChild(el);

      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;

      // Place caret at end and press Enter to create trailing newline + BR
      const range = document.createRange();
      range.setStart(codeEl.firstChild!, 5);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      codeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(codeEl.lastChild).toBeInstanceOf(HTMLBRElement);

      // Simulate user typing on the new line (browser modifies text node)
      const textNode = codeEl.firstChild!;
      (textNode as Text).data = 'hello\nx';
      codeEl.dispatchEvent(new Event('input', { bubbles: true }));

      // BR should be removed — content no longer ends with \n
      expect(codeEl.lastChild).not.toBeInstanceOf(HTMLBRElement);

      el.remove();
    });

    it('save() excludes the trailing BR from saved data', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'hello' }));
      const el = tool.render();
      document.body.appendChild(el);

      const codeEl = el.querySelector('[data-blok-testid="code-content"]') as HTMLElement;

      // Press Enter at end to create trailing newline + BR
      const range = document.createRange();
      range.setStart(codeEl.firstChild!, 5);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      codeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // save() should return the text content without the BR
      const data = tool.save(el);
      expect(data.code).toBe('hello\n');

      el.remove();
    });

    it('line numbers toggle button exists in header', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions());
      const el = tool.render();
      const btn = el.querySelector('[data-blok-testid="code-line-numbers-btn"]');

      expect(btn).not.toBeNull();
      expect(btn).toBeInstanceOf(HTMLButtonElement);
    });

    it('clicking line numbers button hides the gutter', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1\nline 2' }));
      const el = tool.render();
      const btn = el.querySelector('[data-blok-testid="code-line-numbers-btn"]') as HTMLButtonElement;
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      expect(gutter.hidden).toBe(false);

      btn.click();

      expect(gutter.hidden).toBe(true);
    });

    it('clicking line numbers button twice restores the gutter', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'a\nb' }));
      const el = tool.render();
      const btn = el.querySelector('[data-blok-testid="code-line-numbers-btn"]') as HTMLButtonElement;
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      btn.click();
      expect(gutter.hidden).toBe(true);

      btn.click();
      expect(gutter.hidden).toBe(false);
    });

    it('save() includes lineNumbers field', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'test' }));
      const el = tool.render();
      const data = tool.save(el);

      expect(data).toHaveProperty('lineNumbers');
      expect(data.lineNumbers).toBe(true);
    });

    it('save() returns lineNumbers false after toggling off', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'test' }));
      const el = tool.render();

      const btn = el.querySelector('[data-blok-testid="code-line-numbers-btn"]') as HTMLButtonElement;
      btn.click();

      const data = tool.save(el);
      expect(data.lineNumbers).toBe(false);
    });

    it('restores lineNumbers false from saved data', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'hello', lineNumbers: false } as Partial<CodeData>));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      expect(gutter.hidden).toBe(true);
    });

    it('defaults lineNumbers to true when not provided', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'hello' }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      expect(gutter.hidden).toBe(false);
    });

    it('gutter updates after merge()', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'line 1' }));
      tool.render();

      tool.merge({ code: 'line 2\nline 3', language: 'plain text' } as CodeData);

      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]')!;

      // 'line 1\nline 2\nline 3' = 3 lines
      expect(gutter.children).toHaveLength(3);
    });

    it('gutter is hidden when preview is active for previewable language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      // Preview defaults to active for previewable languages
      expect(gutter.hidden).toBe(true);
    });

    it('gutter is restored when switching from preview to code tab', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;
      const codeTab = el.querySelector('[data-blok-testid="code-code-tab"]') as HTMLButtonElement;

      expect(gutter.hidden).toBe(true);

      codeTab.click();

      expect(gutter.hidden).toBe(false);
    });

    it('gutter is hidden in read-only mode with previewable language', async () => {
      const { CodeTool } = await import('../../../../src/tools/code');
      const tool = new CodeTool(createOptions({ code: 'E = mc^2', language: 'latex' }, { readOnly: true }));
      const el = tool.render();
      const gutter = el.querySelector('[data-blok-testid="code-gutter"]') as HTMLElement;

      expect(gutter.hidden).toBe(true);
    });
  });
});
