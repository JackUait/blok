import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';
import { clean } from '../../../../src/components/utils/sanitizer';
import { CODE_LANGUAGE_ATTR } from '../../../../src/components/modules/paste/constants';

vi.mock('../../../../src/shared/katex', () => ({
  renderLatex: vi.fn().mockResolvedValue('<span class="katex">rendered</span>'),
}));

vi.mock('../../../../src/tools/code/mermaid-loader', () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg>mermaid diagram</svg>'),
}));

vi.mock('../../../../src/tools/code/language-detector', () => ({
  detectLanguage: vi.fn(),
}));

const createOptions = (): BlockToolConstructorOptions<CodeData> =>
  ({
    data: {} as CodeData,
    config: {},
    api: {
      styles: {},
      i18n: { t: (key: string): string => key },
    } as unknown as API,
    readOnly: false,
    block: { id: 'code-1' },
  }) as unknown as BlockToolConstructorOptions<CodeData>;

const pasteEventFor = (html: string): { detail: { data: HTMLElement } } => {
  const host = document.createElement('div');

  host.innerHTML = html;

  return { detail: { data: host.firstElementChild as HTMLElement } };
};

describe('Code tool — language carried in from a pasted code block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('whitelists the language attribute on PRE so it survives sanitization', async () => {
    /**
     * Sources that print the language outside the <pre> (Gemini renders it in
     * the code block's header bar) can only hand it over as an attribute. The
     * paste sanitizer drops every attribute a tool does not name, so the stamp
     * is worthless unless pasteConfig lists it.
     */
    const { CodeTool } = await import('../../../../src/tools/code');
    const html = `<pre ${CODE_LANGUAGE_ATTR}="sql"><code>SELECT 1;</code></pre>`;

    const cleaned = clean(html, {
      pre: { [CODE_LANGUAGE_ATTR]: true },
      code: {},
    });

    expect(cleaned).toContain(`${CODE_LANGUAGE_ATTR}="sql"`);
    expect(JSON.stringify((CodeTool.pasteConfig as { tags?: unknown }).tags)).toContain(
      CODE_LANGUAGE_ATTR
    );
  });

  it('adopts the pasted language', async () => {
    const { CodeTool } = await import('../../../../src/tools/code');
    const tool = new CodeTool(createOptions());
    const el = tool.render();

    document.body.appendChild(el);
    tool.onPaste(
      pasteEventFor(`<pre ${CODE_LANGUAGE_ATTR}="sql"><code>SELECT 1;</code></pre>`) as never
    );

    expect(tool.save(el).language).toBe('sql');
    el.remove();
  });

  it('normalizes an alias to the highlightable language id', async () => {
    /** Models label fences `js`/`py`/`sh`; Prism only knows the canonical ids. */
    const { CodeTool } = await import('../../../../src/tools/code');
    const tool = new CodeTool(createOptions());
    const el = tool.render();

    document.body.appendChild(el);
    tool.onPaste(
      pasteEventFor(`<pre ${CODE_LANGUAGE_ATTR}="js"><code>let a = 1;</code></pre>`) as never
    );

    expect(tool.save(el).language).toBe('javascript');
    el.remove();
  });

  it('leaves the default language when the paste carries none', async () => {
    const { CodeTool } = await import('../../../../src/tools/code');
    const tool = new CodeTool(createOptions());
    const el = tool.render();

    document.body.appendChild(el);
    tool.onPaste(pasteEventFor('<pre><code>plain</code></pre>') as never);

    expect(tool.save(el).language).toBe('plain text');
    el.remove();
  });

  it('ignores a language it cannot resolve rather than showing a bogus label', async () => {
    const { CodeTool } = await import('../../../../src/tools/code');
    const tool = new CodeTool(createOptions());
    const el = tool.render();

    document.body.appendChild(el);
    tool.onPaste(
      pasteEventFor(`<pre ${CODE_LANGUAGE_ATTR}="not-a-language"><code>x</code></pre>`) as never
    );

    expect(tool.save(el).language).toBe('plain text');
    el.remove();
  });
});
