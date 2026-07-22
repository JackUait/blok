// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import { PLAINTEXT } from '../../../src/shared/sanitize-rules';
import { INLINE_TEXT_SANITIZE } from '../../../src/components/shared/inline-content-sanitize';
import type { SanitizerRule } from '../../../types';
import type { TagConfig } from '../../../types/configs/sanitizer-config';

describe('view sanitizeHtmlFragment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DOM-free guarantee', () => {
    it('runs without document or window (node environment)', () => {
      expect(typeof document).toBe('undefined');
      expect(typeof window).toBe('undefined');

      const result = sanitizeHtmlFragment('<p onclick="x()">hello <b>bold</b></p>', {
        p: true,
        b: {},
      });

      expect(result).toBe('<p>hello <b>bold</b></p>');
    });
  });

  describe('allowlist enforcement per rule shape', () => {
    it('keeps tags allowed with an empty attr-map and strips their attributes', () => {
      const result = sanitizeHtmlFragment('<b class="x" onclick="y()">text</b>', { b: {} });

      expect(result).toBe('<b>text</b>');
    });

    it('`true` rule keeps only safe attributes (class/id/title/role/dir/lang + data-*/aria-*)', () => {
      const input = '<p class="c" id="i" title="t" role="note" dir="ltr" lang="en" data-x="1" aria-label="l" onclick="y()" style="color:red" href="#">x</p>';
      const result = sanitizeHtmlFragment(input, { p: true });

      expect(result).toBe('<p class="c" id="i" title="t" role="note" dir="ltr" lang="en" data-x="1" aria-label="l">x</p>');
    });

    it('attr-map keeps only listed attributes', () => {
      const result = sanitizeHtmlFragment('<a href="https://x.y" target="_blank" onclick="z()">l</a>', {
        a: { href: true, target: true },
      });

      expect(result).toBe('<a href="https://x.y" target="_blank">l</a>');
    });

    it('attr-map string value keeps the attribute only when it matches (janitor semantics, no forcing)', () => {
      const kept = sanitizeHtmlFragment('<a href="https://x.y" rel="nofollow">l</a>', {
        a: { href: true, rel: 'nofollow' },
      });
      const dropped = sanitizeHtmlFragment('<a href="https://x.y" rel="noopener">l</a>', {
        a: { href: true, rel: 'nofollow' },
      });
      const absentStaysAbsent = sanitizeHtmlFragment('<a href="https://x.y">l</a>', {
        a: { href: true, rel: 'nofollow' },
      });

      expect(kept).toBe('<a href="https://x.y" rel="nofollow">l</a>');
      expect(dropped).toBe('<a href="https://x.y">l</a>');
      expect(absentStaysAbsent).toBe('<a href="https://x.y">l</a>');
    });

    it('function rule string values are forced onto the element (applyAttributeOverrides semantics)', () => {
      const rule: SanitizerRule = () => ({ href: true, rel: 'nofollow' });
      const result = sanitizeHtmlFragment('<a href="https://x.y" rel="noopener">l</a>', { a: rule });

      expect(result).toBe('<a href="https://x.y" rel="nofollow">l</a>');

      const added = sanitizeHtmlFragment('<a href="https://x.y">l</a>', { a: rule });

      expect(added).toBe('<a href="https://x.y" rel="nofollow">l</a>');
    });

    it('function rule returning false unwraps the tag', () => {
      const rule: SanitizerRule = () => false;
      const result = sanitizeHtmlFragment('<span>inner</span>', { span: rule });

      expect(result).toBe('inner');
    });

    it('function rule returning true keeps all attributes', () => {
      const rule: SanitizerRule = () => true;
      const result = sanitizeHtmlFragment('<span foo="1" onclick="x()">inner</span>', { span: rule });

      expect(result).toBe('<span foo="1" onclick="x()">inner</span>');
    });

    it('function rule returning null keeps the tag without attributes (wrapFunctionRule semantics)', () => {
      const rule = (() => null) as unknown as SanitizerRule;
      const result = sanitizeHtmlFragment('<span foo="1">inner</span>', { span: rule });

      expect(result).toBe('<span>inner</span>');
    });

    it('function rule receives an element facade with tagName/getAttribute/hasAttribute/attributes', () => {
      const seen: Record<string, unknown> = {};
      const rule: SanitizerRule = (el: Element): TagConfig => {
        seen.tagName = el.tagName;
        seen.href = el.getAttribute('href');
        seen.hasTarget = el.hasAttribute('target');
        seen.attributeNames = Array.from(el.attributes).map((attr) => attr.name);

        return { href: true };
      };

      sanitizeHtmlFragment('<a href="/x" target="_blank">l</a>', { a: rule });

      expect(seen.tagName).toBe('A');
      expect(seen.href).toBe('/x');
      expect(seen.hasTarget).toBe(true);
      expect(seen.attributeNames).toEqual(['href', 'target']);
    });
  });

  describe('unwrap semantics (html-janitor parity)', () => {
    it('unwraps non-allowlisted tags keeping their children', () => {
      const result = sanitizeHtmlFragment('<div><b>keep</b> tail</div>', { b: {} });

      expect(result).toBe('<b>keep</b> tail');
    });

    it('unwraps deeply, re-evaluating hoisted children against the config', () => {
      const result = sanitizeHtmlFragment('<div><section><i>x</i></section></div>', { i: {} });

      expect(result).toBe('<i>x</i>');
    });

    it('strips all tags with an empty config, keeping text', () => {
      const result = sanitizeHtmlFragment('<p>a<b>b</b></p>', {});

      expect(result).toBe('ab');
    });

    it('unwraps nested block elements even when allowed (janitor keepNestedBlockElements=false)', () => {
      const result = sanitizeHtmlFragment('<li><p>x</p></li>', { li: {}, p: {} });

      expect(result).toBe('<li>x</li>');
    });

    it('unwraps inline elements containing block elements (invalid markup)', () => {
      const result = sanitizeHtmlFragment('<b><p>x</p></b>', { b: {}, p: {} });

      expect(result).toBe('<p>x</p>');
    });

    it('removes whitespace-only text nodes adjacent to block elements', () => {
      const result = sanitizeHtmlFragment('<p>a</p>\n  <p>b</p>', { p: {} });

      expect(result).toBe('<p>a</p><p>b</p>');
    });
  });

  describe('script/style/comment removal', () => {
    it('drops script elements entirely, including contents', () => {
      const result = sanitizeHtmlFragment('a<script>alert(1)</script>b', { p: {} });

      expect(result).toBe('ab');
    });

    it('drops style elements entirely, including contents', () => {
      const result = sanitizeHtmlFragment('a<style>.x{color:red}</style>b', { p: {} });

      expect(result).toBe('ab');
    });

    it('drops comment nodes', () => {
      const result = sanitizeHtmlFragment('a<!-- comment -->b', {});

      expect(result).toBe('ab');
    });
  });

  describe('URL scheme policy on href/src', () => {
    it('strips javascript: href but keeps the element', () => {
      const result = sanitizeHtmlFragment('<a href="javascript:alert(1)">l</a>', { a: { href: true } });

      expect(result).toBe('<a>l</a>');
    });

    it('strips smuggled schemes ("java\\nscript:")', () => {
      const result = sanitizeHtmlFragment('<a href="java\nscript:alert(1)">l</a>', { a: { href: true } });

      expect(result).toBe('<a>l</a>');
    });

    it('strips vbscript: src', () => {
      const result = sanitizeHtmlFragment('<img src="vbscript:x">', { img: { src: true } });

      expect(result).toBe('<img>');
    });

    it('keeps safe raster data:image src', () => {
      const result = sanitizeHtmlFragment('<img src="data:image/png;base64,AAAA">', { img: { src: true } });

      expect(result).toBe('<img src="data:image/png;base64,AAAA">');
    });

    it('strips non-image data: src (svg+xml, text/html)', () => {
      const svg = sanitizeHtmlFragment('<img src="data:image/svg+xml,<svg/>">', { img: { src: true } });
      const html = sanitizeHtmlFragment('<img src="data:text/html,x">', { img: { src: true } });

      expect(svg).toBe('<img>');
      expect(html).toBe('<img>');
    });

    it('strips data: and blob: href, keeps blob: src', () => {
      const dataHref = sanitizeHtmlFragment('<a href="data:image/png;base64,AAAA">l</a>', { a: { href: true } });
      const blobHref = sanitizeHtmlFragment('<a href="blob:https://x/uuid">l</a>', { a: { href: true } });
      const blobSrc = sanitizeHtmlFragment('<img src="blob:https://x/uuid">', { img: { src: true } });

      expect(dataHref).toBe('<a>l</a>');
      expect(blobHref).toBe('<a>l</a>');
      expect(blobSrc).toBe('<img src="blob:https://x/uuid">');
    });

    it('keeps http(s), relative and unknown-custom scheme URLs', () => {
      const result = sanitizeHtmlFragment('<a href="slack://open">l</a><a href="/rel">m</a>', { a: { href: true } });

      expect(result).toBe('<a href="slack://open">l</a><a href="/rel">m</a>');
    });
  });

  describe('PLAINTEXT sentinel', () => {
    it('returns entity-escaped text when the whole config is PLAINTEXT', () => {
      const result = sanitizeHtmlFragment('<b>a & b</b> "q" \'s\'', PLAINTEXT);

      expect(result).toBe('&lt;b&gt;a &amp; b&lt;/b&gt; &quot;q&quot; &#39;s&#39;');
    });

    it('treats a PLAINTEXT tag-level rule as not allowlisted (clean() drops such entries)', () => {
      const result = sanitizeHtmlFragment('<code>x</code>', { code: PLAINTEXT });

      expect(result).toBe('x');
    });
  });

  describe('real function rules from inline-content-sanitize', () => {
    const config = INLINE_TEXT_SANITIZE;

    it('preserveColorStyles keeps only color/background-color styles on mark', () => {
      const result = sanitizeHtmlFragment(
        '<mark style="color: red; font-size: 2em; background-color: blue">x</mark>',
        config
      );

      expect(result).toBe('<mark style="color: red; background-color: blue;">x</mark>');
    });

    it('preserveColorStyles strips the style attribute when no color props remain', () => {
      const result = sanitizeHtmlFragment('<mark style="font-size: 2em">x</mark>', config);

      expect(result).toBe('<mark>x</mark>');
    });

    it('preserveEquationSpan keeps spans with data-latex and only that attribute', () => {
      const result = sanitizeHtmlFragment(
        '<span data-latex="a^2" class="katex" contenteditable="false">a²</span>',
        config
      );

      expect(result).toBe('<span data-latex="a^2">a²</span>');
    });

    it('preserveEquationSpan unwraps spans without data-latex', () => {
      const result = sanitizeHtmlFragment('<span class="decor">plain</span>', config);

      expect(result).toBe('plain');
    });

    it('round-trips the full inline mark set', () => {
      const input = '<strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <a href="https://x.y" target="_blank" rel="noopener">l</a> <code>c</code><br>';
      const result = sanitizeHtmlFragment(input, config);

      expect(result).toBe(input);
    });
  });
});
