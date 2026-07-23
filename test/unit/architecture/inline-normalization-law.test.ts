/**
 * Architectural enforcement: the Inline Normalization Law.
 *
 * Every source that describes formatting does so run by run — Google Docs
 * writes a styled `<span>` per text run, Notion and Word do the same, and the
 * mark engine splits wrappers at selection boundaries. Each conversion is
 * correct locally and each leaves redundant markup behind: runs of identical
 * adjacent wrappers, wrappers around a lone `<br>` or space, wrappers nested
 * inside an identical parent.
 *
 * Left unnormalized this compounds silently. A real document (a Google Docs
 * knowledge-base article pasted into Blok) stored roughly 15x more markup than
 * text, because every render/save round trip carried the fragmentation
 * forward and `migrateMarkColors` then inflated each duplicated colour value
 * from a 7-character hex to a 27-character `var()` reference.
 *
 * This law pins the three things that keep it fixed:
 *
 * 1. BOTH sanitizer entry points emit collapsed markup — the DOM pipeline
 *    (`sanitizeBlocks`, which every save and render passes through) and the
 *    DOM-free view renderer (`sanitizeHtmlFragment`). A path that normalized
 *    on only one side would make a document serialize differently depending on
 *    which renderer touched it last.
 * 2. The two agree byte for byte on the same input.
 * 3. Neither re-implements the decision rules. Both must consume the shared
 *    policy module, because two copies of "which tags are interchangeable"
 *    drift the moment someone extends one of them.
 *
 * If this test fails on your change: route the new HTML-producing path through
 * `normalizeInlineMarkupHtml` (DOM) or `normalizeInlineMarkupFragment` (view),
 * and put any new rule in `src/shared/inline-normalization-policy.ts` rather
 * than in one of the implementations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  areInterchangeable,
  decoratesNothing,
  duplicatesAncestor,
  type InlineElementView,
} from '../../../src/shared/inline-normalization-policy';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import type { SanitizerConfig } from '../../../types';

const CONFIG: SanitizerConfig = {
  p: {},
  br: {},
  b: {},
  i: {},
  s: {},
  u: {},
  code: {},
  mark: { style: true },
  a: { href: true },
  img: { src: true },
};

/**
 * Markup shaped like what clipboard converters and the mark engine actually
 * produce. Each entry must be collapsible — vacuity is asserted separately.
 */
const FRAGMENTED_CORPUS = [
  '<p><mark style="color: red;">a</mark><mark style="color: red;">b</mark><mark style="color: red;">c</mark></p>',
  '<p><mark style="color: red;">a</mark><mark style="color: red;"><br></mark><mark style="color: red;">b</mark></p>',
  '<p><mark style="color: red;">word</mark><mark style="color: red;"> </mark><mark style="color: red;">next</mark></p>',
  '<p><b>bold</b><b>er</b> plain</p>',
  '<p><b><b>doubly wrapped</b></b></p>',
  '<p>text<mark style="color: red;"></mark>more</p>',
  '<p><a href="/x">split</a><a href="/x"> link</a></p>',
  '<p><mark style="color: red; background-color: blue;">a</mark><mark style="background-color: blue; color: red;">b</mark></p>',
];

/**
 * Markup that must survive untouched — the collapse is only ever allowed to
 * change how many elements express the formatting, never the formatting.
 */
const MUST_SURVIVE_CORPUS = [
  '<p><mark style="color: red;">a</mark><mark style="color: blue;">b</mark></p>',
  '<p><mark style="background-color: yellow;"> </mark></p>',
  '<p><u> </u></p>',
  '<p><mark style="color: red;"><img src="/x.png"></mark></p>',
  '<p><a href="/x"></a></p>',
  '<p><mark style="color: red;">a</mark> <mark style="color: red;">b</mark></p>',
  '<p>plain <b>bold</b> and <a href="/x">a link</a></p>',
];

/**
 * The DOM pipeline as every save and render applies it to a tool field.
 * @param html - markup to run through the editor sanitizer
 */
const domPipeline = (html: string): string => {
  const [block] = sanitizeBlocks([{ tool: 'any', data: { text: html } }], { text: CONFIG }, {});

  return block.data.text as string;
};

/**
 * The DOM-free view renderer's pipeline.
 * @param html - markup to run through the view sanitizer
 */
const viewPipeline = (html: string): string => sanitizeHtmlFragment(html, CONFIG);

/**
 * Count directly adjacent sibling elements that express identical formatting,
 * plus decorative wrappers holding nothing they can affect. Deliberately
 * written independently of the production predicates so it cannot pass by
 * agreeing with a broken implementation.
 * @param html - markup to inspect
 */
const countRedundancies = (html: string): number => {
  const holder = document.createElement('div');

  holder.innerHTML = html;

  const fingerprint = (element: Element): string => {
    const attrs = Array.from(element.attributes)
      .map((attr) => `${attr.name}=${attr.value.split(';').map((d) => d.trim()).filter(Boolean).sort()
        .join(';')}`)
      .sort()
      .join('|');

    return `${element.tagName}|${attrs}`;
  };

  let redundancies = 0;

  for (const element of Array.from(holder.querySelectorAll('*'))) {
    const next = element.nextElementSibling;

    if (next !== null && element.nextSibling === next && fingerprint(element) === fingerprint(next)) {
      redundancies++;
    }

    const parent = element.parentElement;

    if (parent !== null && fingerprint(parent) === fingerprint(element)) {
      redundancies++;
    }

    /**
     * Purely decorative inline tags — an anchor is excluded (it carries a link
     * target), and block elements are not this pass's business.
     */
    const isDecorative = ['B', 'STRONG', 'I', 'EM', 'U', 'S', 'MARK', 'CODE', 'SPAN'].includes(element.tagName);

    if (isDecorative && (element.textContent ?? '') === '' && element.querySelector('img') === null && element.querySelector('br') === null) {
      redundancies++;
    }
  }

  return redundancies;
};

describe('Inline Normalization Law', () => {
  it('the corpus is genuinely fragmented (non-vacuity floor)', () => {
    for (const html of FRAGMENTED_CORPUS) {
      expect(countRedundancies(html), `corpus entry is already clean: ${html}`).toBeGreaterThan(0);
    }
  });

  it('the DOM sanitizer pipeline emits collapsed markup', () => {
    for (const html of FRAGMENTED_CORPUS) {
      expect(countRedundancies(domPipeline(html)), `not collapsed by the DOM path: ${html}`).toBe(0);
    }
  });

  it('the view renderer emits collapsed markup', () => {
    for (const html of FRAGMENTED_CORPUS) {
      expect(countRedundancies(viewPipeline(html)), `not collapsed by the view path: ${html}`).toBe(0);
    }
  });

  it('the two pipelines agree on every corpus entry', () => {
    for (const html of [...FRAGMENTED_CORPUS, ...MUST_SURVIVE_CORPUS]) {
      expect(viewPipeline(html), `pipelines disagree on: ${html}`).toBe(domPipeline(html));
    }
  });

  it('never changes the reader-visible text', () => {
    const read = (html: string): string => {
      const holder = document.createElement('div');

      holder.innerHTML = html;

      return holder.textContent ?? '';
    };

    for (const html of [...FRAGMENTED_CORPUS, ...MUST_SURVIVE_CORPUS]) {
      expect(read(domPipeline(html)), `text changed for: ${html}`).toBe(read(html));
    }
  });

  it('leaves markup that must survive untouched on both paths', () => {
    for (const html of MUST_SURVIVE_CORPUS) {
      expect(countRedundancies(domPipeline(html)), `wrongly collapsed: ${html}`).toBe(0);
      expect(domPipeline(html), `DOM path altered: ${html}`).toBe(html);
      expect(viewPipeline(html), `view path altered: ${html}`).toBe(html);
    }
  });

  it('is idempotent — a second pass is a no-op on both paths', () => {
    for (const html of [...FRAGMENTED_CORPUS, ...MUST_SURVIVE_CORPUS]) {
      expect(domPipeline(domPipeline(html)), `DOM path not idempotent: ${html}`).toBe(domPipeline(html));
      expect(viewPipeline(viewPipeline(html)), `view path not idempotent: ${html}`).toBe(viewPipeline(html));
    }
  });

  /**
   * Reading an element's text or scanning it for media walks its whole
   * subtree. Doing that eagerly for every element made normalizing a wide
   * table quadratic — a 99-column paste blew a 5s test budget. The rules must
   * therefore reach a verdict from the tag and attributes alone whenever they
   * can, and only pay for the subtree walk when a decorative wrapper's
   * emptiness is genuinely in question.
   */
  describe('laziness contract', () => {
    /**
     * @param tagName - tag to describe
     * @param onWalk - invoked whenever a subtree walk is requested
     */
    const viewSpy = (tagName: string, onWalk: () => void): InlineElementView => ({
      tagName,
      attributes: [],
      styleDeclarations: [],
      text: () => {
        onWalk();

        return 'text';
      },
      hasVoidContentDescendant: () => {
        onWalk();

        return false;
      },
    });

    it('never walks the subtree of a tag it does not own', () => {
      let walks = 0;

      const cell = viewSpy('TD', () => {
        walks++;
      });

      expect(decoratesNothing(cell)).toBe(false);
      expect(walks, 'a non-decorative tag must be rejected on its name alone').toBe(0);
    });

    it('never walks the subtree to decide a merge or a nesting duplicate', () => {
      let walks = 0;

      const left = viewSpy('MARK', () => {
        walks++;
      });
      const right = viewSpy('MARK', () => {
        walks++;
      });

      areInterchangeable(left, right);
      duplicatesAncestor(left, [right]);

      expect(walks, 'merge and nesting rules compare attributes, not content').toBe(0);
    });
  });

  describe('single source of truth', () => {
    const SRC_ROOT = resolve(__dirname, '../../../src');
    const POLICY_MODULE = join(SRC_ROOT, 'shared/inline-normalization-policy.ts');

    /**
     * Fingerprints of a re-implemented decision rule. These names belong to
     * the policy module; a second definition anywhere else is a fork waiting
     * to drift.
     */
    const RULE_DEFINITIONS = [
      /\bconst\s+decoratesNothing\s*=/,
      /\bconst\s+areInterchangeable\s*=/,
      /\bconst\s+wrapperSignature\s*=/,
      /\bconst\s+duplicatesAncestor\s*=/,
      /\bconst\s+MERGEABLE_TAGS\s*=/,
      /\bconst\s+DECORATIVE_TAGS\s*=/,
    ];

    /**
     * Every .ts file under src, recursively.
     * @param directory - directory to walk
     */
    const collectSourceFiles = (directory: string): string[] => {
      return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);

        if (statSync(path).isDirectory()) {
          return collectSourceFiles(path);
        }

        return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
      });
    };

    it('defines the normalization rules in exactly one module', () => {
      const offenders = collectSourceFiles(SRC_ROOT)
        .filter((path) => path !== POLICY_MODULE)
        .filter((path) => {
          const source = readFileSync(path, 'utf8');

          return RULE_DEFINITIONS.some((pattern) => pattern.test(source));
        });

      expect(offenders, 'these files re-define an inline-normalization rule instead of importing the shared policy').toEqual([]);
    });

    it('both implementations consume the shared policy', () => {
      const implementations = [
        join(SRC_ROOT, 'components/utils/inline-normalization.ts'),
        join(SRC_ROOT, 'view/sanitize.ts'),
      ];

      for (const path of implementations) {
        expect(readFileSync(path, 'utf8'), `${path} must import the shared policy`).toMatch(
          /inline-normalization-policy/
        );
      }
    });
  });
});
