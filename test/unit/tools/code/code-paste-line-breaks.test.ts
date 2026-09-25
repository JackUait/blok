import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions } from '../../../../types';
import type { CodeData } from '../../../../types/tools/code';

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

describe('Code tool — line breaks in a pasted <pre>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['<pre>line1<br>line2</pre>', 'line1\nline2'],
    ['<pre><code>a<br>b<br>c</code></pre>', 'a\nb\nc'],
    ['<pre>keep\nnewline<br>too</pre>', 'keep\nnewline\ntoo'],
  ])('turns <br> into a newline: %s', async (html, expected) => {
    const { CodeTool } = await import('../../../../src/tools/code');
    const tool = new CodeTool(createOptions());
    const el = tool.render();

    document.body.appendChild(el);
    tool.onPaste(pasteEventFor(html) as never);

    expect(tool.save(el).code).toBe(expected);
    el.remove();
  });
});
