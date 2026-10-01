import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import type { CodeTool as CodeToolClass } from '../../../../src/tools/code';

vi.mock('../../../../src/shared/katex', () => ({
  renderLatex: vi.fn().mockResolvedValue('<span class="katex">rendered</span>'),
}));

vi.mock('../../../../src/tools/code/mermaid-loader', () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg></svg>'),
}));

vi.mock('../../../../src/tools/code/language-detector', () => ({
  detectLanguage: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn().mockResolvedValue(null),
  isHighlightable: vi.fn().mockReturnValue(false),
}));

const TRANSLATIONS: Record<string, string> = {
  'tools.code.plainText': 'Plain text',
  'tools.code.filename': 'File name',
  'tools.code.copyCode': 'Copy code',
  'tools.code.copied': 'Copied!',
};

const dispatchChange = vi.fn();

const createOptions = (
  data: Partial<CodeData> = {},
  readOnly = false
): BlockToolConstructorOptions<CodeData> => ({
  data: { code: data.code ?? '', language: data.language ?? 'plain text', ...data },
  config: {},
  api: {
    i18n: { t: (k: string) => TRANSLATIONS[k] ?? k },
    blocks: { getCurrentBlockIndex: vi.fn().mockReturnValue(0), insert: vi.fn() },
  } as unknown as API,
  readOnly,
  block: { id: 'code-block-id', dispatchChange } as never,
});

const loadTool = async (): Promise<typeof CodeToolClass> =>
  (await import('../../../../src/tools/code')).CodeTool;

const query = <T extends Element = HTMLElement>(root: Element, testId: string): T | null =>
  root.querySelector<T>(`[data-blok-testid="${testId}"]`);

describe('code block header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('language dot', () => {
    it('paints the language color next to the language name', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ language: 'typescript' })).render();
      const dot = query(el, 'code-language-dot');

      expect(dot?.style.backgroundColor).toBe('rgb(49, 120, 198)');
      expect(dot?.getAttribute('aria-hidden')).toBe('true');
    });

    it('falls back to the neutral ink for plain text', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ language: 'plain text' })).render();

      expect(query(el, 'code-language-dot')?.style.backgroundColor).toBe('var(--blok-gray-text)');
    });

    it('repaints when the language changes through setData', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ language: 'plain text' }));
      const el = tool.render();

      tool.setData({ code: '', language: 'python' });

      expect(query(el, 'code-language-dot')?.style.backgroundColor).toBe('rgb(53, 114, 165)');
    });
  });

  describe('filename', () => {
    it('keeps the code as the first input, so a new block puts the caret in the code', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ filename: 'block.ts' })).render();
      const { Dom } = await import('../../../../src/components/dom');

      expect(Dom.findAllInputs(el)).toStrictEqual([query(el, 'code-content')]);
    });

    it('swaps button and field inside a mutation-free slot, so opening it is not an edit', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ filename: 'a.ts' })).render();
      const slot = query(el, 'code-filename')?.parentElement;

      expect(slot?.getAttribute(DATA_ATTR.mutationFree)).toBe('true');

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      expect(query(el, 'code-filename-input')?.parentElement).toBe(slot);
    });

    it('shows the saved filename', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ filename: 'block.ts' })).render();

      expect(query(el, 'code-filename')?.textContent).toBe('block.ts');
    });

    it('omits filename from saved data when there is none, so old documents keep their shape', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x' }));
      const el = tool.render();

      expect(tool.save(el)).not.toHaveProperty('filename');
    });

    it('saves a filename typed into the field and reports the change', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x' }));
      const el = tool.render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      const input = query<HTMLInputElement>(el, 'code-filename-input');

      expect(input).not.toBeNull();
      expect(input).toHaveFocus();
      expect(input?.hasAttribute(DATA_ATTR.keyboardOwner)).toBe(true);

      if (!input) return;

      input.value = '  src/block.ts ';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(tool.save(el)).toMatchObject({ filename: 'src/block.ts' });
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(query(el, 'code-filename-input')).toBeNull();
      expect(query(el, 'code-filename')?.textContent).toBe('src/block.ts');
    });

    it('moves the caret into the code after Enter in the field', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'x' })).render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();
      query(el, 'code-filename-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(query(el, 'code-content')).toHaveFocus();
    });

    it('restores the previous filename on Escape without reporting a change', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x', filename: 'a.ts' }));
      const el = tool.render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      const input = query<HTMLInputElement>(el, 'code-filename-input');

      if (!input) throw new Error('no input');

      input.value = 'b.ts';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(tool.save(el)).toMatchObject({ filename: 'a.ts' });
      expect(dispatchChange).not.toHaveBeenCalled();
    });

    it('survives the blur Chrome fires while the field is being removed', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x', filename: 'a.ts' }));
      const el = tool.render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      const input = query<HTMLInputElement>(el, 'code-filename-input');

      if (!input) throw new Error('no input');

      const replaceWith = input.replaceWith.bind(input);

      // jsdom does not blur a focused element on removal; Chrome does, synchronously.
      vi.spyOn(input, 'replaceWith').mockImplementation((...nodes) => {
        input.dispatchEvent(new FocusEvent('blur'));
        replaceWith(...nodes);
      });

      input.value = 'b.ts';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(tool.save(el)).toMatchObject({ filename: 'a.ts' });
      expect(dispatchChange).not.toHaveBeenCalled();
      expect(query(el, 'code-filename')?.textContent).toBe('a.ts');
    });

    it('commits on blur', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x' }));
      const el = tool.render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      const input = query<HTMLInputElement>(el, 'code-filename-input');

      if (!input) throw new Error('no input');

      input.value = 'main.go';
      input.blur();

      expect(tool.save(el)).toMatchObject({ filename: 'main.go' });
      expect(dispatchChange).toHaveBeenCalledTimes(1);
    });

    it('clears the filename when the field is emptied', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x', filename: 'a.ts' }));
      const el = tool.render();

      document.body.appendChild(el);
      query<HTMLButtonElement>(el, 'code-filename')?.click();

      const input = query<HTMLInputElement>(el, 'code-filename-input');

      if (!input) throw new Error('no input');

      input.value = '   ';
      input.blur();

      expect(tool.save(el)).not.toHaveProperty('filename');
    });

    it('applies a filename from setData (undo/redo)', async () => {
      const CodeTool = await loadTool();
      const tool = new CodeTool(createOptions({ code: 'x' }));
      const el = tool.render();

      tool.setData({ code: 'x', language: 'plain text', filename: 'z.py' });

      expect(query(el, 'code-filename')?.textContent).toBe('z.py');
      expect(tool.save(el)).toMatchObject({ filename: 'z.py' });
    });

    it('in read-only renders the filename as plain text and hides it when empty', async () => {
      const CodeTool = await loadTool();
      const withName = new CodeTool(createOptions({ filename: 'a.ts' }, true)).render();
      const without = new CodeTool(createOptions({}, true)).render();

      expect(query(withName, 'code-filename')?.tagName).toBe('SPAN');
      expect(query(withName, 'code-filename')?.textContent).toBe('a.ts');
      expect(query(without, 'code-filename')?.hidden).toBe(true);
      // Keeps the header from reading as a text host of the block.
      expect(query(without, 'code-filename')?.getAttribute('aria-hidden')).toBe('true');
      expect(query(withName, 'code-filename')?.hasAttribute('aria-hidden')).toBe(false);
    });
  });

  describe('copy button', () => {
    it('carries a visible label next to its icon', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'x' })).render();
      const copy = query(el, 'code-copy-btn');

      expect(copy?.querySelector('svg')).not.toBeNull();
      expect(query(el, 'code-copy-label')?.textContent).toBe('Copy code');
    });

    it('turns into a check and "Copied!" after copying', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);

      Object.assign(navigator, { clipboard: { writeText } });

      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'x' })).render();
      const copy = query<HTMLButtonElement>(el, 'code-copy-btn');

      copy?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(copy?.getAttribute('data-copied')).toBe('true');
      expect(query(el, 'code-copy-label')?.textContent).toBe('Copied!');
    });
  });

  describe('controls', () => {
    it('reveal for keyboard focus inside the block, not only for hover', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'x' })).render();
      const controls = query(el, 'code-controls');

      expect(controls?.className).toContain('group-focus-within/code:opacity-100');
      expect(controls?.className).toContain('group-hover/code:opacity-100');
    });
  });

  describe('preview area', () => {
    it('stays hidden for a language with no preview, so it adds no empty strip under the code', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ language: 'typescript', code: 'x' })).render();

      expect(query(el, 'code-preview')?.hidden).toBe(true);
    });

    it('shows for a previewable language', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ language: 'mermaid', code: 'graph TD' })).render();

      expect(query(el, 'code-preview')?.hidden).toBe(false);
    });
  });

  describe('active line', () => {
    it('renders a hidden, layout-inert overlay that core never scores as an edit', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'a\nb' })).render();
      const overlay = query(el, 'code-active-line');

      expect(overlay?.hidden).toBe(true);
      expect(overlay?.getAttribute('aria-hidden')).toBe('true');
      expect(overlay?.getAttribute(DATA_ATTR.mutationFree)).toBe('true');
      expect(overlay?.className).toContain('pointer-events-none');
      expect(overlay?.className).toContain('absolute');
    });

    it('marks the current line the neutral way: gray band and primary-ink number, never blue', async () => {
      const { ACTIVE_LINE_STYLES, GUTTER_LINE_STYLES } = await import('../../../../src/tools/code/constants');

      expect(ACTIVE_LINE_STYLES).toContain('var(--blok-item-hover-bg)');
      expect(GUTTER_LINE_STYLES).toContain('data-[active=true]:text-text-primary');
      expect(`${ACTIVE_LINE_STYLES} ${GUTTER_LINE_STYLES}`).not.toMatch(/blue|accent|link|focus-ring/);
    });

    it('is not rendered in read-only', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'a' }, true)).render();

      expect(query(el, 'code-active-line')).toBeNull();
    });

    it('marks the gutter mutation-free, since its numbers and heights are derived', async () => {
      const CodeTool = await loadTool();
      const el = new CodeTool(createOptions({ code: 'a' })).render();

      expect(query(el, 'code-gutter')?.getAttribute(DATA_ATTR.mutationFree)).toBe('true');
    });
  });
});
