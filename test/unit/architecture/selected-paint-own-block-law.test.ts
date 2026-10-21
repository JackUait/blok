import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { describe, expect, it } from 'vitest';

/**
 * A rule keyed on a block's selected state must style THAT block only. Blocks
 * nest (a toggle's children live inside its holder), so a descendant step from
 * the selected holder — or a `:has()` without `>` — also matches every nested
 * block. That cleared a selected toggle's fill whenever a list sat anywhere
 * inside it, and painted the nested list a second time.
 *
 * The law: after a `[data-blok-selected="true"]` holder or a `.bg-selection`
 * content wrapper, the selector reaches the block's own tool root through `>`
 * only (holder > content > tool root), and every `:has()` on that path starts
 * with `>`. Past the tool root anything goes.
 */

const SRC = resolve(__dirname, '../../../src');

const listCss = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);

  if (entry.isDirectory()) {
    return listCss(full);
  }

  return entry.name.endsWith('.css') ? [ full ] : [];
});

type Node = selectorParser.Node;

const isSelectedHolder = (node: Node): boolean => node.type === 'attribute' && node.attribute === 'data-blok-selected';
const isSelectedContent = (node: Node): boolean => node.type === 'class' && node.value === 'bg-selection';
const isContent = (node: Node): boolean => node.type === 'attribute' && node.attribute === 'data-blok-element-content';
const isToolRoot = (node: Node): boolean => node.type === 'attribute' && (node.attribute === 'data-blok-tool' || node.attribute === 'data-list-style');

/** Splits a selector into compounds and the combinators between them. */
const compounds = (selector: selectorParser.Selector): { nodes: Node[]; combinator: string | null }[] => {
  const out: { nodes: Node[]; combinator: string | null }[] = [ { nodes: [], combinator: null } ];

  selector.each((node) => {
    if (node.type === 'combinator') {
      out.push({ nodes: [], combinator: node.value.trim() === '' ? ' ' : node.value.trim() });

      return;
    }
    out[out.length - 1].nodes.push(node);
  });

  return out;
};

/** `:has()` arguments in a compound that do not start with a child combinator. */
const looseHas = (compound: Node[]): string[] => compound
  .filter((node): node is selectorParser.Pseudo => node.type === 'pseudo' && node.value === ':has')
  .flatMap((pseudo) => pseudo.nodes)
  .filter((arg) => {
    const first = arg.nodes[0];

    return !(first?.type === 'combinator' && [ '>', '+', '~' ].includes(first.value.trim()));
  })
  .map(String);

/** Why the selector leaks into nested blocks, or null when it stays on its own block. */
const leak = (selector: selectorParser.Selector): string | null => {
  const parts = compounds(selector);
  // The last selected compound is the block being styled; earlier ones are its ancestors or siblings.
  const marks = parts.map((part) => part.nodes.some((node) => isSelectedHolder(node) || isSelectedContent(node)));
  const start = marks.lastIndexOf(true);

  if (start === -1) {
    return null;
  }

  for (let i = start; i < parts.length; i++) {
    const part = parts[i];

    if (i > start && part.combinator !== '>') {
      return `"${part.combinator}" step before the tool root`;
    }

    const loose = looseHas(part.nodes);

    if (loose.length > 0) {
      return `:has(${loose[0].trim()}) reaches nested blocks`;
    }

    if (part.nodes.some(isToolRoot)) {
      return null;
    }

    if (i > start && !part.nodes.some(isContent)) {
      return 'child step that is not the content wrapper or the tool root';
    }
  }

  return null;
};

const offenders = (): string[] => listCss(SRC).flatMap((file) => {
  const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
  const found: string[] = [];
  const rules: postcss.Rule[] = [];

  root.walkRules((rule) => {
    rules.push(rule);
  });

  rules.filter((rule) => /data-blok-selected|bg-selection/.test(rule.selector)).forEach((rule) => {
    selectorParser((selectors) => {
      selectors.each((selector) => {
        const why = leak(selector);

        found.push(...(why === null ? [] : [ `${relative(SRC, file)}:${rule.source?.start?.line ?? 0} ${selector.toString().trim()} — ${why}` ]));
      });
    }).processSync(rule.selector);
  });

  return found;
});

describe('selected-state CSS styles only the selected block', () => {
  it('no rule reaches from a selected block into its nested blocks', () => {
    expect(offenders()).toEqual([]);
  });

  it('flags the leaks it exists to catch', () => {
    const check = (css: string): string | null => {
      let why: string | null = null;

      selectorParser((selectors) => {
        why = leak(selectors.first);
      }).processSync(css);

      return why;
    };

    expect(check('[data-blok-selected="true"] [data-blok-element-content]:has([data-list-style])')).not.toBeNull();
    expect(check('[data-blok-selected="true"] [data-list-style] [role="listitem"]')).not.toBeNull();
    expect(check('[data-blok-element-content].bg-selection:has([data-blok-tool="image"])')).not.toBeNull();
    expect(check('[data-blok-selected="true"] > [data-blok-element-content] [data-blok-tool="image"] .x')).not.toBeNull();

    expect(check('[data-blok-selected="true"] > [data-blok-element-content]:has(> [data-list-style])')).toBeNull();
    expect(check('[data-blok-selected="true"] > [data-blok-element-content] > [data-list-style] [role="listitem"]')).toBeNull();
    expect(check('[data-blok-element-content].bg-selection > [data-blok-tool="image"] .blok-image-inner')).toBeNull();
    expect(check('[data-blok-dragging-multi="true"] [data-blok-selected="true"]')).toBeNull();
    expect(check('[data-blok-table-cell] [data-blok-selected="true"]:has(+ [data-blok-selected="true"]) > [data-blok-element-content]')).toBeNull();
  });
});
