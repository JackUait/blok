import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import type { AtRule, Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

import { blocksToHtml } from '../../../src/view';
import type { LooseOutputBlockData } from '../../../types';
import { LIST_INDENT_PER_LEVEL, ORDERED_LIST_INDENT_PER_LEVEL } from '../../../src/shared/tool-classes/list';

/**
 * The documented view setup (view.css header): `root`, `classes` and
 * `toolAttributes`. Under it the preflight's `list-style: none` reaches every
 * `<ul>`/`<ol>`, and the classed item row carries no marker element, so the
 * stylesheet itself must paint the markers.
 */
const css = readFileSync(resolve(__dirname, '../../../view.css'), 'utf-8');

const insideLayer = (rule: Rule): boolean => {
  const layered = (node: Rule['parent']): boolean =>
    node !== undefined && node.type !== 'root' && ((node.type === 'atrule' && (node as AtRule).name === 'layer') || layered(node.parent));

  return layered(rule.parent);
};

/** Unlayered rules: they beat the `@layer base` reset whatever their specificity. */
const unlayered: Rule[] = [];

postcss.parse(css).walkRules((rule) => {
  if (!insideLayer(rule)) {
    unlayered.push(rule);
  }
});

const render = (blocks: LooseOutputBlockData[]): HTMLElement => {
  const host = document.createElement('div');

  host.innerHTML = blocksToHtml({ blocks }, { root: true, classes: true, toolAttributes: true });
  document.body.replaceChildren(host);

  return host;
};

/** jsdom's selector engine throws on some modern selectors in the sheet; those never match a list. */
const matches = (element: Element, selector: string): boolean => {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
};

/**
 * Rough specificity: attributes, classes and pseudo-classes, then type
 * selectors. Enough to order this sheet's list rules, which differ only in
 * how many `[data-list-style]` ancestors they name.
 */
const specificity = (selector: string): number => {
  const attributes = (selector.match(/\[|\.[a-zA-Z_-]|:(?!:)(?!not\(|is\(|where\()[a-z-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~])[a-z][a-z0-9]*/g) ?? []).length;

  return attributes * 100 + types;
};

/** The winning unlayered declaration of `prop` for `element`: highest specificity, then the later rule. */
const declared = (element: Element, prop: string): string | undefined => {
  const candidates = unlayered.flatMap((rule, order) => {
    const best = Math.max(-1, ...rule.selectors.filter((selector) => matches(element, selector)).map(specificity));
    const value = rule.nodes.filter((node) => node.type === 'decl' && node.prop === prop).map((node) => (node.type === 'decl' ? node.value : '')).at(-1);

    return best < 0 || value === undefined ? [] : [{ best, order, value }];
  });

  candidates.sort((a, b) => a.best - b.best || a.order - b.order);

  return candidates.at(-1)?.value;
};

const item = (id: string, style: string, depth = 0): LooseOutputBlockData =>
  ({ id, type: 'list', data: { text: id, style, depth } });

describe('view.css list markers', () => {
  it('paints the editor bullets, by depth, on classed unordered lists', () => {
    const host = render([item('a', 'unordered'), item('b', 'unordered', 1), item('c', 'unordered', 2), item('d', 'unordered', 3)]);
    const lists = Array.from(host.querySelectorAll('ul'));

    expect(lists.map((list) => declared(list, 'list-style-type'))).toEqual(['disc', 'circle', 'square', 'disc']);
  });

  it('numbers ordered lists the way the editor does: 1., a., i.', () => {
    const host = render([item('a', 'ordered'), item('b', 'ordered', 1), item('c', 'ordered', 2)]);
    const lists = Array.from(host.querySelectorAll('ol'));

    expect(lists.map((list) => declared(list, 'list-style-type'))).toEqual(['decimal', 'lower-alpha', 'lower-roman']);
  });

  // Outside markers need room, and the preflight zeroes list padding.
  it('gives each list the editor indent per level', () => {
    const host = render([item('a', 'unordered'), item('b', 'ordered')]);

    expect(declared(host.querySelector('ul') ?? host, 'padding-inline-start')).toBe(`${LIST_INDENT_PER_LEVEL}px`);
    expect(declared(host.querySelector('ol') ?? host, 'padding-inline-start')).toBe(`${ORDERED_LIST_INDENT_PER_LEVEL}px`);
  });

  it('leaves checklists to their own checkbox', () => {
    const host = render([item('a', 'checklist')]);

    expect(declared(host.querySelector('ul') ?? host, 'list-style-type')).toBeUndefined();
  });

  it('never reaches the editor or classless output', () => {
    const markerRules = unlayered.filter((rule) => rule.nodes.some((node) => node.type === 'decl' && node.prop === 'list-style-type'));

    expect(markerRules.length).toBeGreaterThan(0);
    markerRules.forEach((rule) => expect(rule.selector).toContain('[data-blok-interface=view]'));
  });
});
