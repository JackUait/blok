// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { parseFragment } from '../../../src/html';
import type { ChildNode, Element, ParentNode } from '../../../src/html';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import type { SanitizerConfig } from '../../../types';

const DIV_CONTEXT = parseFragment('<div></div>').childNodes[0] as Element;

/**
 * Every attribute name in the tree a browser builds when it parses the output again.
 * @param html - sanitizer output
 */
const attributeNamesAfterReparse = (html: string): string[] => {
  const names: string[] = [];
  const pending: ParentNode[] = [ parseFragment(DIV_CONTEXT, html) ];

  for (const parent of pending) {
    parent.childNodes.forEach((child: ChildNode) => {
      if ('tagName' in child) {
        names.push(...child.attrs.map((attr) => attr.name));
        pending.push(child);
      }
    });
  }

  return names;
};

describe('view sanitizer security parity with the DOM cleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('script-carrying attributes', () => {
    it('drops an SVG values list that holds a script URL, even when the rule keeps every attribute', () => {
      const result = sanitizeHtmlFragment(
        '<svg><animate attributeName="href" values="https://a.invalid/;javascript:alert(1)"></animate></svg>',
        { svg: () => true, animate: () => true }
      );

      expect(result).not.toContain('javascript:');
      expect(result).toBe('<svg><animate attributeName="href"></animate></svg>');
    });

    it('drops srcdoc, even when the rule keeps every attribute', () => {
      const result = sanitizeHtmlFragment(
        '<iframe srcdoc="<script>alert(1)</script>" title="t"></iframe>',
        { iframe: () => true }
      );

      expect(result).toBe('<iframe title="t"></iframe>');
    });
  });

  describe('elements that change namespace on a reparse', () => {
    it('removes an element unwrapped inside SVG with its children', () => {
      const result = sanitizeHtmlFragment(
        '<svg><foreignObject><iframe><img src=x onerror=alert(1)></iframe></foreignObject></svg>',
        { svg: () => true, iframe: { src: true } }
      );

      expect(attributeNamesAfterReparse(result)).not.toContain('onerror');
      expect(result).toBe('<svg></svg>');
    });

    it('removes an element unwrapped inside MathML with its children', () => {
      const result = sanitizeHtmlFragment(
        '<math><mi><b>x</b></mi></math>',
        { math: () => true, b: {} }
      );

      expect(result).toBe('<math></math>');
    });

    it('keeps hoisting the children of an element unwrapped inside HTML', () => {
      expect(sanitizeHtmlFragment('<p><span><b>x</b></span></p>', { p: true, b: {} })).toBe('<p><b>x</b></p>');
    });

    it('removes an HTML mglyph that would reparse as MathML', () => {
      const result = sanitizeHtmlFragment(
        '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
        { math: () => true, mtext: () => true, table: () => true, mglyph: () => true, style: () => true }
      );

      expect(attributeNamesAfterReparse(result)).not.toContain('onerror');
      expect(result).not.toContain('mglyph');
    });

    it.each([
      [ '<svg><style>a{}</style><rect></rect></svg>', { svg: true, style: true, rect: true }, '<svg><rect></rect></svg>' ],
      [ '<svg><script>alert(1)</script></svg>', { svg: () => true, script: () => true }, '<svg></svg>' ],
      [ '<math><style>a{}</style></math>', { math: true, style: true }, '<math></math>' ],
      [ '<svg><foreignObject><style>a{}</style></foreignObject></svg>', { svg: true, foreignobject: true, style: true }, '<svg><foreignObject></foreignObject></svg>' ],
    ] as const)('removes script and style inside SVG or MathML even when the config allows them: %s', (html, config, expected) => {
      expect(sanitizeHtmlFragment(html, config)).toBe(expected);
    });

    it('keeps an allowed style outside SVG and MathML', () => {
      expect(sanitizeHtmlFragment('<style>a{}</style><b>x</b>', { style: true, b: {} })).toBe('<style>a{}</style><b>x</b>');
    });

    it('removes an HTML malignmark with its children', () => {
      expect(sanitizeHtmlFragment('<malignmark><b>x</b></malignmark>y', { malignmark: () => true, b: {} })).toBe('y');
    });
  });

  // Text collection on each unwrap is quadratic in depth (it always was); a loaded CI runner needs room.
  describe('deep nesting', { timeout: 30_000 }, () => {
    it('sanitizes ten thousand nested tags without overflowing the stack', () => {
      const result = sanitizeHtmlFragment('<b>'.repeat(10000) + 'x', { b: {} });

      expect(result).toBe('<b>x</b>');
    });

    it('keeps ten thousand nested tags the normalizer never collapses', () => {
      const html = '<blockquote>'.repeat(10000) + 'x' + '</blockquote>'.repeat(10000);

      expect(sanitizeHtmlFragment(html, { blockquote: true })).toBe(html);
    });
  });

  it('does not force a script-carrying value that a function rule returns', () => {
    const config = { b: () => ({ onclick: 'alert(1)', title: 't' }) } as unknown as SanitizerConfig;

    expect(sanitizeHtmlFragment('<b>x</b>', config)).toBe('<b title="t">x</b>');
  });

  // href/src keep their own pass, which runs the URL rewrite first.
  it('still hands a script href to the URL rewrite', () => {
    const transform = vi.fn((url: string) => url);

    sanitizeHtmlFragment('<a href="javascript:alert(1)">x</a>', { a: { href: true } }, transform);

    expect(transform).toHaveBeenCalledWith('javascript:alert(1)', 'href');
  });
});
