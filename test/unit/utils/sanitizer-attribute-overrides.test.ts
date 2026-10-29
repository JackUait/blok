import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import type { SanitizerConfig } from '../../../types';

const sanitize = (text: string, rules: SanitizerConfig): string => {
  const [block] = sanitizeBlocks([{ tool: 'custom', data: { text } }], { text: rules });
  const result = block?.data.text;

  if (typeof result !== 'string') {
    throw new Error('Expected a sanitized string');
  }

  return result;
};

const parseInert = (html: string): HTMLElement => {
  const root = document.implementation.createHTMLDocument('').createElement('div');

  root.innerHTML = html;

  return root;
};

const scriptCarrying = (html: string): string[] => Array.from(parseInert(html).querySelectorAll('*'))
  .flatMap((element) => Array.from(element.attributes)
    .filter((attr) => attr.name.startsWith('on') || /^\s*javascript:/i.test(attr.value))
    .map((attr) => `${element.nodeName}[${attr.name}]`));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Every `true` tag rule becomes a function rule, so this re-parse runs on
 * almost every sanitized field. It must parse in the same <div> context as
 * the cleaner, and its output must stay inert and stable.
 */
describe('function-rule attribute overrides', () => {
  const PERMISSIVE: SanitizerConfig = {
    a: () => ({ href: true, title: true }),
    b: true,
    p: { title: true },
    col: true,
    svg: true,
    math: true,
    mtext: true,
    style: true,
    noscript: true,
    textarea: true,
    title: true,
    xmp: true,
    iframe: true,
    noembed: true,
    noframes: true,
    template: true,
    img: { src: true },
  };

  it('keeps every tag after a col the cleaner unwrapped from its table', () => {
    const output = sanitize('<table><colgroup><col></colgroup></table><b>bold</b> <a href="https://x.y">l</a>', PERMISSIVE);

    expect(output).toContain('<b>bold</b>');
    expect(output).toContain('<a href="https://x.y">l</a>');
  });

  it.each([
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
    '<p title="</template><img src=x onerror=alert(1)>">x</p>',
    '<a title="</template><img src=x onerror=alert(1)>" href="https://x.y">x</a>',
    '<template><a href="javascript:alert(1)">x</a></template>',
    '<textarea></textarea><img src=x onerror=alert(1)>',
    '<title><img src=x onerror=alert(1)></title>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<iframe><img src=x onerror=alert(1)></iframe>',
    '<noembed><img src=x onerror=alert(1)></noembed>',
    '<noframes><img src=x onerror=alert(1)></noframes>',
    '<svg></p><style><a title="</style><img src=x onerror=alert(1)>">',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  ])('leaves nothing that runs, and is stable, for %s', (payload) => {
    const once = sanitize(payload, PERMISSIVE);

    expect(scriptCarrying(once)).toEqual([]);
    expect(sanitize(once, PERMISSIVE)).toBe(once);
  });
});
