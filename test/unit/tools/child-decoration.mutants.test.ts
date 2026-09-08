import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyChildDecoration,
  createChildDecorationLedger,
  type ChildDecorationLedger,
} from '../../../src/tools/child-decoration';

/**
 * Mutation-coverage tests for `src/tools/child-decoration.ts`.
 *
 * No mutants are left alive in this file.
 *
 * The `[]` seed of the per-child `names` list is only ever read back by the
 * cleanup loop, and removing an attribute nobody wrote is silent in the DOM - so
 * the seeded entry is invisible in the resulting markup. The removal call itself
 * is the observable, hence the spy on `removeAttribute`.
 */

/** A child block's real DOM shape: holder → tune wrapper → content wrapper. */
const makeChild = (id: string): { id: string; holder: HTMLElement } => {
  const holder = document.createElement('div');
  const tune = document.createElement('div');
  const content = document.createElement('div');

  content.setAttribute('data-blok-element-content', '');
  tune.appendChild(content);
  holder.appendChild(tune);

  return { id, holder };
};

const contentOf = (child: { holder: HTMLElement }): HTMLElement => {
  const content = child.holder.querySelector<HTMLElement>('[data-blok-element-content]');

  if (content === null) {
    throw new Error('fixture child has no content wrapper');
  }

  return content;
};

let ledger: ChildDecorationLedger;

beforeEach(() => {
  vi.clearAllMocks();
  ledger = createChildDecorationLedger();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyChildDecoration mutants - what a pass writes', () => {
  it('drops a hook whose value is undefined instead of stamping the word', () => {
    const child = makeChild('a');

    child.holder.setAttribute('data-step', 'stale');

    applyChildDecoration(ledger, [child], { childAttributes: () => ({ 'data-step': undefined }) });

    expect(child.holder.hasAttribute('data-step')).toBe(false);
  });

  it('drops a hook whose value is null', () => {
    const child = makeChild('a');

    child.holder.setAttribute('data-step', 'stale');

    applyChildDecoration(ledger, [child], { childAttributes: () => ({ 'data-step': null }) });

    expect(child.holder.getAttribute('data-step')).toBeNull();
  });

  it('drops a content hook whose value is null', () => {
    const child = makeChild('a');

    contentOf(child).setAttribute('data-rail', 'stale');

    applyChildDecoration(ledger, [child], { childContentAttributes: () => ({ 'data-rail': null }) });

    expect(contentOf(child).getAttribute('data-rail')).toBeNull();
  });

  it('keeps a false value as a selectable hook', () => {
    const child = makeChild('a');

    applyChildDecoration(ledger, [child], { childAttributes: () => ({ 'data-active': false }) });

    expect(child.holder.getAttribute('data-active')).toBe('false');
  });
});

describe('applyChildDecoration mutants - cleaning up after a departed child', () => {
  it('removes exactly the attributes the previous pass wrote', () => {
    const child = makeChild('a');

    applyChildDecoration(ledger, [child], { childAttributes: () => ({ 'data-step': '1' }) });

    const removals = vi.spyOn(child.holder, 'removeAttribute');

    applyChildDecoration(ledger, [], { childAttributes: () => ({ 'data-step': '1' }) });

    expect(removals.mock.calls.map((call) => call[0])).toEqual(['data-step']);
    expect(child.holder.hasAttribute('data-step')).toBe(false);
  });

  it('forgets a child that left, so a later pass cannot strip it again', () => {
    const [kept, gone] = [makeChild('a'), makeChild('b')];
    const decorate = { childAttributes: () => ({ 'data-step': '1' }) };

    applyChildDecoration(ledger, [kept, gone], decorate);
    applyChildDecoration(ledger, [kept], decorate);

    // Whoever owns the block now has written its own hook on that holder.
    gone.holder.setAttribute('data-step', 'owned-elsewhere');

    applyChildDecoration(ledger, [kept], decorate);

    expect(gone.holder.getAttribute('data-step')).toBe('owned-elsewhere');
  });

  it('keeps only the current children in the ledger', () => {
    const [kept, gone] = [makeChild('a'), makeChild('b')];
    const decorate = { childAttributes: () => ({ 'data-step': '1' }) };

    applyChildDecoration(ledger, [kept, gone], decorate);
    applyChildDecoration(ledger, [kept], decorate);

    expect([...ledger.holders.keys()]).toEqual(['a']);
  });
});
