import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RADIUS_PRIMITIVES,
  RADIUS_ROLES,
  innerRadius,
  renderRadiusGallery,
} from '../../../src/playground/radius-gallery';

const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const queryOne = <T extends Element>(root: ParentNode, selector: string): T => {
  const el = root.querySelector<T>(selector);

  if (el === null) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

const declaredRadiusTokens = (): string[] => [...colors.matchAll(/(--blok-radius-[\w-]+)\s*:/g)].map((m) => m[1]);

describe('radius gallery data', () => {
  it('lists every role colors.css declares, and no role it does not', () => {
    const roles = declaredRadiusTokens().filter((t) => !/^--blok-radius-(?:\d+|full)$/.test(t));

    expect(RADIUS_ROLES.map((r) => r.token).sort()).toEqual([...new Set(roles)].sort());
  });

  it('lists every primitive colors.css declares', () => {
    const primitives = declaredRadiusTokens().filter((t) => /^--blok-radius-(?:\d+|full)$/.test(t));

    expect(RADIUS_PRIMITIVES.map((p) => p.token).sort()).toEqual([...new Set(primitives)].sort());
  });
});

describe('innerRadius', () => {
  it('subtracts border and gap from the outer radius', () => {
    expect(innerRadius({ outer: 10, border: 0, gap: 4 })).toEqual({ value: 6, reason: 'derived' });
    expect(innerRadius({ outer: 12, border: 1, gap: 6 })).toEqual({ value: 5, reason: 'derived' });
  });

  it('never goes below the 4px floor', () => {
    expect(innerRadius({ outer: 10, border: 0, gap: 8 })).toEqual({ value: 4, reason: 'floor' });
  });

  it('lets the child keep its own role when its corner is outside the parent curve', () => {
    expect(innerRadius({ outer: 10, border: 1, gap: 12 })).toEqual({ value: null, reason: 'own-role' });
    expect(innerRadius({ outer: 10, border: 0, gap: 10 })).toEqual({ value: null, reason: 'own-role' });
  });
});

describe('renderRadiusGallery', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    renderRadiusGallery({ container });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('scopes itself so Blok radius tokens resolve inside it', () => {
    expect(container.querySelector('[data-blok-interface="radius-gallery"]')).not.toBeNull();
  });

  it('shows instead of tells: no text on the page runs past a few words', () => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const long: string[] = [];

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const words = (node.textContent ?? '').trim().split(/\s+/).filter(Boolean);

      if (words.length > 4) {
        long.push(node.textContent ?? '');
      }
    }

    expect(long).toEqual([]);
  });

  it('shows a specimen for every role, painted with the role token itself', () => {
    for (const role of RADIUS_ROLES) {
      const row = container.querySelector(`[data-radius-role="${role.token}"]`);

      expect(row, role.token).not.toBeNull();
      expect(row?.textContent).toContain(role.token.replace('--blok-radius-', ''));
      expect(row?.querySelector<HTMLElement>('[data-radius-preview]')?.style.borderRadius).toBe(`var(${role.token})`);
    }
  });

  it('updates the nesting demo when the padding changes', () => {
    const outer = queryOne<HTMLSelectElement>(container, '[data-radius-demo="outer"]');
    const gap = queryOne<HTMLInputElement>(container, '[data-radius-demo="gap"]');
    const readout = queryOne(container, '[data-radius-demo="readout"]');

    outer.value = '10';
    outer.dispatchEvent(new Event('change'));
    gap.value = '4';
    gap.dispatchEvent(new Event('input'));

    expect(readout.textContent).toContain('6px');

    gap.value = '12';
    gap.dispatchEvent(new Event('input'));

    expect(readout.textContent).toContain('own');
  });
});
