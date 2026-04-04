import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';

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
  } as CodeData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'code-block-id' } as never,
});

describe('CodeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

      expect(codeEl.getAttribute('contenteditable')).toBe('true');
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

      expect(!Array.isArray(toolbox) && toolbox.searchTerms).toContain('code');
      expect(!Array.isArray(toolbox) && toolbox.searchTerms).toContain('snippet');
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
      expect((config as { patterns: Record<string, RegExp> }).patterns.code).toBeInstanceOf(RegExp);
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
});
