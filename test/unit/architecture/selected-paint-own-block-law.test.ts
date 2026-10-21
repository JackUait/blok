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

const WRAPPERS = new Set([ ':is', ':where', ':matches' ]);

/** Whether a compound selects a selected block, directly or through :is()/:where(). */
const isTrigger = (node: Node): boolean => {
  if (isSelectedHolder(node) || isSelectedContent(node)) {
    return true;
  }

  if (node.type !== 'pseudo' || !WRAPPERS.has(node.value)) {
    return false;
  }

  let found = false;

  node.walk((inner) => {
    found ||= isSelectedHolder(inner) || isSelectedContent(inner);
  });

  return found;
};

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
  const marks = parts.map((part) => part.nodes.some(isTrigger));
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

/** A rule's selector list with native nesting resolved against its parent rules. */
const fullSelectors = (rule: postcss.Rule): string[] => {
  let parent: postcss.Container | postcss.Document | undefined = rule.parent;

  while (parent !== undefined && parent.type !== 'rule' && parent.type !== 'root') {
    parent = parent.parent;
  }

  const own = postcss.list.comma(rule.selector);

  if (parent?.type !== 'rule') {
    return own;
  }

  return fullSelectors(parent as postcss.Rule).flatMap((outer) => own.map((inner) => (inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`)));
};

const cssOffenders = (css: string, name: string): string[] => {
  const root = postcss.parse(css, { from: name });
  const found: string[] = [];
  const rules: postcss.Rule[] = [];

  root.walkRules((rule) => {
    rules.push(rule);
  });

  rules.forEach((rule) => {
    fullSelectors(rule).filter((full) => /data-blok-selected|bg-selection/.test(full)).forEach((full) => {
      selectorParser((selectors) => {
        selectors.each((selector) => {
          const why = leak(selector);

          found.push(...(why === null ? [] : [ `${name}:${rule.source?.start?.line ?? 0} ${selector.toString().trim()} — ${why}` ]));
        });
      }).processSync(full);
    });
  });

  return found;
};

/**
 * A Tailwind variant keyed on the selected attribute (`group-data-[blok-selected=true]:`,
 * `in-data-[…]:`, `[[data-blok-selected=true]_&]:`) compiles to a descendant step from
 * the holder, so it styles every nested block too. None is allowed.
 */
const SELECTED_VARIANT = /[^\s'"`]*(?:data-\[blok-selected|\[data-blok-selected)[^\s'"`]*\]:[^\s'"`]+/g;

const tsOffenders = (text: string, name: string): string[] => Array.from(text.matchAll(SELECTED_VARIANT), (match) => `${name} ${match[0]}`);

const SOURCE_ROOTS = [ SRC, resolve(__dirname, '../../../packages') ];

const listSources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);

  if (entry.isDirectory()) {
    return [ 'node_modules', 'dist' ].includes(entry.name) ? [] : listSources(full);
  }

  return /\.(ts|tsx|vue)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [ full ] : [];
});

const offenders = (): string[] => listCss(SRC).flatMap((file) => cssOffenders(readFileSync(file, 'utf8'), relative(SRC, file)));

describe('selected-state CSS styles only the selected block', () => {
  it('no rule reaches from a selected block into its nested blocks', () => {
    expect(offenders()).toEqual([]);
  });

  it('no class string uses a selected-keyed Tailwind variant', () => {
    const found = SOURCE_ROOTS.flatMap(listSources).flatMap((file) => tsOffenders(readFileSync(file, 'utf8'), relative(SRC, file)));

    expect(found).toEqual([]);
  });

  it('sees a trigger wrapped in :is() or :where()', () => {
    expect(cssOffenders(':where([data-blok-selected="true"]) [data-list-style] { color: red; }', 'x.css')).toHaveLength(1);
    expect(cssOffenders(':is([data-blok-selected="true"], .other) [data-blok-element-content] .y { color: red; }', 'x.css')).toHaveLength(1);
  });

  it('sees a leak written as a nested rule', () => {
    expect(cssOffenders('[data-blok-selected="true"] { & [data-list-style] { color: red; } }', 'x.css')).toHaveLength(1);
    expect(cssOffenders('[data-blok-selected="true"] { [data-list-style] { color: red; } }', 'x.css')).toHaveLength(1);
    expect(cssOffenders('[data-blok-selected="true"] { & > [data-blok-element-content] > [data-list-style] { color: red; } }', 'x.css')).toEqual([]);
  });

  it('sees a selected-keyed Tailwind variant in a class string', () => {
    expect(tsOffenders(`const c = 'group-data-[blok-selected=true]:bg-selection';`, 'x.ts')).toHaveLength(1);
    expect(tsOffenders(`const c = '[[data-blok-selected=true]_&]:opacity-50';`, 'x.ts')).toHaveLength(1);
    expect(tsOffenders(`const c = 'in-data-[blok-selected=true]:hidden';`, 'x.ts')).toHaveLength(1);
    expect(tsOffenders(`el.setAttribute('data-blok-selected', 'true');`, 'x.ts')).toEqual([]);
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
