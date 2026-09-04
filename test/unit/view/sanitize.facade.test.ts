// @vitest-environment node
/**
 * The DOM-free sanitizer hands function rules a hand-built Element: a parse5
 * node wearing getAttribute/style/classList/textContent. Nothing else in the
 * suite reads those back, so the whole facade could return empty strings and
 * every existing test would still pass — which is exactly what the mutation run
 * reported for this file.
 *
 * A rule here records what the facade said, and the assertions are on the
 * recording. The facade is not exported, so a rule is the only way in.
 */
import { describe, it, expect } from 'vitest';

import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import type { SanitizerConfig } from '../../../types/configs/sanitizer-config';

/**
 * The facade is declared as `Element` but carries `style` and `classList`, which
 * live on `HTMLElement`. Rules in this repo read them, so the tests do too.
 */
type FacadeElement = HTMLElement;

/** Runs one function rule over `html` and returns what the rule saw. */
const capture = <T>(html: string, tag: string, read: (element: FacadeElement) => T): T[] => {
  const seen: T[] = [];
  const config = {
    [tag]: (element: FacadeElement) => {
      seen.push(read(element));

      return true;
    },
  } as unknown as SanitizerConfig;

  sanitizeHtmlFragment(html, config);

  return seen;
};

describe('view sanitizer element facade', () => {
  describe('attributes and tag', () => {
    it('reports the tag name upper-cased, as the DOM does', () => {
      expect(capture('<a href="/x">l</a>', 'a', (el) => el.tagName)).toEqual(['A']);
    });

    it('reads an attribute and answers null for one that is absent', () => {
      expect(capture('<a href="/x">l</a>', 'a', (el) => el.getAttribute('href'))).toEqual(['/x']);
      expect(capture('<a href="/x">l</a>', 'a', (el) => el.getAttribute('rel'))).toEqual([null]);
    });

    it('answers hasAttribute on presence, including an empty value', () => {
      expect(capture('<a href="">l</a>', 'a', (el) => el.hasAttribute('href'))).toEqual([true]);
      expect(capture('<a href="">l</a>', 'a', (el) => el.hasAttribute('rel'))).toEqual([false]);
    });

    it('lists every attribute as a name/value pair', () => {
      const [attrs] = capture('<a href="/x" rel="nofollow">l</a>', 'a', (el) =>
        Array.from(el.attributes).map(({ name, value }) => `${name}=${value}`));

      expect(attrs).toEqual(['href=/x', 'rel=nofollow']);
    });

    it('collects text from nested children, not just the first one', () => {
      expect(capture('<p>a<b>b</b>c</p>', 'p', (el) => el.textContent)).toEqual(['abc']);
    });
  });

  describe('style', () => {
    const style = '<p style="color: red; FONT-WEIGHT: bold">t</p>';

    it('counts the declarations it parsed', () => {
      expect(capture(style, 'p', (el) => el.style.length)).toEqual([2]);
    });

    it('reads a value by property name, case-insensitively', () => {
      expect(capture(style, 'p', (el) => el.style.getPropertyValue('color'))).toEqual(['red']);
      expect(capture(style, 'p', (el) => el.style.getPropertyValue('font-weight'))).toEqual(['bold']);
      expect(capture(style, 'p', (el) => el.style.getPropertyValue('FONT-WEIGHT'))).toEqual(['bold']);
    });

    it('answers an empty string for a property that is not set', () => {
      expect(capture(style, 'p', (el) => el.style.getPropertyValue('margin'))).toEqual(['']);
    });

    it('names a declaration by index and answers empty past the end', () => {
      expect(capture(style, 'p', (el) => el.style.item(0))).toEqual(['color']);
      expect(capture(style, 'p', (el) => el.style.item(1))).toEqual(['font-weight']);
      expect(capture(style, 'p', (el) => el.style.item(9))).toEqual(['']);
    });

    it('returns the value it removed, and nothing for an absent property', () => {
      expect(capture(style, 'p', (el) => el.style.removeProperty('color'))).toEqual(['red']);
      expect(capture(style, 'p', (el) => el.style.removeProperty('margin'))).toEqual(['']);
    });

    // A declaration with no colon, or an empty half on either side, is not a
    // declaration. Kept, they would surface as a property with no value.
    it('ignores malformed declarations', () => {
      expect(capture('<p style="color red; :x; y:; ;">t</p>', 'p', (el) => el.style.length))
        .toEqual([0]);
    });

    it('reads an element with no style attribute as empty', () => {
      expect(capture('<p>t</p>', 'p', (el) => el.style.length)).toEqual([0]);
    });
  });

  describe('classList', () => {
    const classes = '<p class="one two">t</p>';

    it('reports length, value and membership', () => {
      expect(capture(classes, 'p', (el) => el.classList.length)).toEqual([2]);
      expect(capture(classes, 'p', (el) => el.classList.value)).toEqual(['one two']);
      expect(capture(classes, 'p', (el) => el.classList.contains('two'))).toEqual([true]);
      expect(capture(classes, 'p', (el) => el.classList.contains('three'))).toEqual([false]);
    });

    it('names a class by index and answers null past the end', () => {
      expect(capture(classes, 'p', (el) => el.classList.item(1))).toEqual(['two']);
      expect(capture(classes, 'p', (el) => el.classList.item(9))).toEqual([null]);
    });

    // Runs of whitespace between class names are separators, not names.
    it('reads a run of whitespace as one separator', () => {
      expect(capture('<p class="  one   two  ">t</p>', 'p', (el) => el.classList.length))
        .toEqual([2]);
    });
  });

  describe('facade writes reach the output', () => {
    const rewrite = (tag: string, act: (element: FacadeElement) => void): string => {
      const config = {
        [tag]: (element: FacadeElement) => {
          act(element);

          return { class: true, style: true };
        },
      } as unknown as SanitizerConfig;

      return sanitizeHtmlFragment(`<${tag} class="one" style="color: red">t</${tag}>`, config);
    };

    it('adds a class, and adding it twice does not repeat it', () => {
      expect(rewrite('p', (el) => {
        el.classList.add('two');
        el.classList.add('two');
      })).toContain('class="one two"');
    });

    it('removes a class, and removing an absent one changes nothing', () => {
      expect(rewrite('p', (el) => {
        el.classList.add('two');
        el.classList.remove('one');
        el.classList.remove('nope');
      })).toContain('class="two"');
    });

    // An emptied list drops the attribute rather than leaving class="".
    it('drops the class attribute once the last class goes', () => {
      expect(rewrite('p', (el) => el.classList.remove('one'))).not.toContain('class');
    });

    it('toggles a class off and on, reporting what it left behind', () => {
      const states: boolean[] = [];

      const html = rewrite('p', (el) => {
        states.push(el.classList.toggle('one'), el.classList.toggle('three'));
      });

      expect(states).toEqual([false, true]);
      expect(html).toContain('class="three"');
    });

    it('honours the forced argument of toggle over the current state', () => {
      const states: boolean[] = [];

      const html = rewrite('p', (el) => {
        states.push(el.classList.toggle('one', true), el.classList.toggle('four', false));
      });

      expect(states).toEqual([true, false]);
      expect(html).toContain('class="one"');
    });

    it('writes a removed style back to the attribute', () => {
      expect(rewrite('p', (el) => el.style.removeProperty('color'))).not.toContain('style');
    });

    it('replaces the children when a rule assigns textContent', () => {
      const config = {
        p: (element: FacadeElement) => {
          // eslint-disable-next-line no-param-reassign -- the facade's documented write path
          element.textContent = 'flat';

          return true;
        },
      } as unknown as SanitizerConfig;

      expect(sanitizeHtmlFragment('<p>a<b>bold</b>c</p>', config)).toBe('<p>flat</p>');
    });
  });
});

describe('view sanitizer entry paths', () => {
  // The fast path returns the input untouched when there is no markup to parse.
  // Without it, every plain-text field pays for a parse; with it inverted, none
  // of them are ever sanitized.
  describe('the no-markup fast path', () => {
    it('returns text carrying no markup characters byte-identical', () => {
      expect(sanitizeHtmlFragment('plain text, no markup', { p: true })).toBe('plain text, no markup');
    });

    it('returns an empty fragment as an empty string', () => {
      expect(sanitizeHtmlFragment('', { p: true })).toBe('');
    });

    // Each character in the trigger set has to keep triggering: a stray `&`,
    // a NBSP or a CR reach the parser and come back normalized, and skipping
    // them would hand the caller raw input the DOM sanitizer would have changed.
    it('still sanitizes text whose only markup character is an entity or a control', () => {
      expect(sanitizeHtmlFragment('a & b', { p: true })).toBe('a &amp; b');
      expect(sanitizeHtmlFragment('<b>x</b>', {})).toBe('x');
    });
  });

  describe('template content', () => {
    // parse5 serializes template.content, which html-janitor's TreeWalker cannot
    // even see. Left unsanitized, an allowed <template> smuggles arbitrary
    // markup through the whole allowlist.
    it('sanitizes inside a template, not just around it', () => {
      const html = '<template><p>keep</p><script>alert(1)</script><b>drop</b></template>';
      const out = sanitizeHtmlFragment(html, { template: true, p: true });

      expect(out).toContain('<p>keep</p>');
      expect(out).not.toContain('<script>');
      expect(out).not.toContain('<b>');
      expect(out).toContain('drop');
    });

    it('leaves a non-template element to the ordinary child walk', () => {
      expect(sanitizeHtmlFragment('<div><span>x</span><script>a</script></div>', { div: true, span: true }))
        .toBe('<div><span>x</span></div>');
    });
  });

  describe('the URL transform hook', () => {
    it('writes back a rewritten attribute value', () => {
      const out = sanitizeHtmlFragment(
        '<a href="/x">l</a>',
        { a: { href: true } },
        (url) => `https://cdn.example${url}`,
      );

      expect(out).toBe('<a href="https://cdn.example/x">l</a>');
    });

    it('leaves the attribute alone when the transform returns it unchanged', () => {
      const out = sanitizeHtmlFragment('<a href="/x">l</a>', { a: { href: true } }, (url) => url);

      expect(out).toBe('<a href="/x">l</a>');
    });

    // The transform runs BEFORE the scheme check, so a transform that produces
    // a script URL must still be refused — otherwise the hook is a bypass.
    it('drops an attribute the transform turned into a script URL', () => {
      const out = sanitizeHtmlFragment(
        '<a href="/x">l</a>',
        { a: { href: true } },
        () => 'javascript:alert(1)',
      );

      expect(out).toBe('<a>l</a>');
    });

    it('drops an attribute when the transform does not return a string', () => {
      const out = sanitizeHtmlFragment(
        '<a href="/x">l</a>',
        { a: { href: true } },
        (() => undefined) as unknown as (url: string, attr: 'href' | 'src') => string,
      );

      expect(out).toBe('<a>l</a>');
    });
  });

  // parse5 throws a RangeError on two adjacent low surrogates. One such field
  // must not cost the whole document, so the parse is retried on repaired input
  // — and any other error has to keep propagating rather than be swallowed.
  describe('unparseable input', () => {
    it('recovers from adjacent lone low surrogates instead of throwing', () => {
      const broken = `<p>a${'\uDC00'}${'\uDC00'}b</p>`;

      expect(() => sanitizeHtmlFragment(broken, { p: true })).not.toThrow();
      expect(sanitizeHtmlFragment(broken, { p: true })).toContain('<p>');
    });
  });
});

describe('view sanitizer edge inputs', () => {
  // An element with no class attribute has no classes. The fallback for the
  // missing attribute is an empty string, and any other fallback invents
  // classes out of nothing.
  it('reads an element with no class attribute as having none', () => {
    expect(capture('<p>t</p>', 'p', (el) => el.classList.length)).toEqual([0]);
    expect(capture('<p>t</p>', 'p', (el) => el.classList.value)).toEqual(['']);
  });

  // No markup character, so the fast path hands the input straight back. Parsing
  // it instead is not equivalent: two adjacent lone low surrogates make parse5
  // throw, and the recovery rewrites them.
  it('returns text parse5 could not have parsed, untouched', () => {
    const lone = `a${'\uDC00'}${'\uDC00'}b`;

    expect(sanitizeHtmlFragment(lone, { p: true })).toBe(lone);
  });

  it('strips comments, which carry no text to hoist', () => {
    expect(sanitizeHtmlFragment('<p>a<!-- secret -->b</p>', { p: true })).toBe('<p>ab</p>');
  });

  // removeProperty writes the surviving declarations back; a filter that drops
  // everything would empty the attribute instead of narrowing it.
  it('keeps the other declarations when one is removed', () => {
    const config = {
      p: (element: FacadeElement) => {
        element.style.removeProperty('color');

        return { style: true };
      },
    } as unknown as SanitizerConfig;

    expect(sanitizeHtmlFragment('<p style="color: red; font-weight: bold">t</p>', config))
      .toBe('<p style="font-weight: bold;">t</p>');
  });

  // Only href and src go through the URL policy. Every other attribute has to
  // pass untouched, or the policy silently eats unrelated markup.
  it('leaves attributes other than href and src to the allowlist alone', () => {
    const out = sanitizeHtmlFragment(
      '<a href="/x" title="t" data-id="7">l</a>',
      { a: { href: true, title: true, 'data-id': true } },
      (url) => url,
    );

    expect(out).toBe('<a href="/x" title="t" data-id="7">l</a>');
  });

  // A function rule returning an object keeps the tag and applies that object as
  // the attribute map, so an attribute missing from it is dropped.
  it('applies the map a function rule returns', () => {
    const config = {
      a: () => ({ href: true }),
    } as unknown as SanitizerConfig;

    expect(sanitizeHtmlFragment('<a href="/x" title="t">l</a>', config)).toBe('<a href="/x">l</a>');
  });

  it('keeps the tag and strips every attribute when a function rule returns null', () => {
    const config = {
      a: () => null,
    } as unknown as SanitizerConfig;

    expect(sanitizeHtmlFragment('<a href="/x" title="t">l</a>', config)).toBe('<a>l</a>');
  });
});
