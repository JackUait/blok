import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyChildDecoration,
  createChildDecorationLedger,
  type ChildDecorationLedger,
} from '../../../src/tools/child-decoration';

/**
 * A child block's real DOM shape: holder → (tune wrappers) → content wrapper →
 * tool root. `wrapDepth` inserts tune wrappers so the content node is NOT a
 * direct child of the holder — core's `tunesManager.wrapContent` does exactly
 * that, so a lookup relying on `firstElementChild` would miss it.
 */
const makeChild = (
  id: string,
  { wrapDepth = 0, withContent = true }: { wrapDepth?: number; withContent?: boolean } = {}
): { id: string; holder: HTMLElement } => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  if (withContent) {
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');

    const chain = Array.from({ length: wrapDepth }, () => document.createElement('div'));
    const outermost = chain.reduce<HTMLElement>((inner, wrapper) => {
      wrapper.appendChild(inner);

      return wrapper;
    }, content);

    holder.appendChild(outermost);
  }

  return { id, holder };
};

const contentOf = (child: { holder: HTMLElement }): HTMLElement | null =>
  child.holder.querySelector('[data-blok-element-content]');

describe('applyChildDecoration', () => {
  let ledger: ChildDecorationLedger;

  beforeEach(() => {
    ledger = createChildDecorationLedger();
  });

  it('writes holder hooks on the holder and content hooks on the content wrapper', () => {
    const children = [makeChild('a'), makeChild('b')];

    applyChildDecoration(ledger, children, {
      childAttributes: (_child, index) => ({ 'data-step-index': index }),
      childContentAttributes: (_child, index) => ({ 'data-step-body': index }),
    });

    expect(children[0].holder.getAttribute('data-step-index')).toBe('0');
    expect(contentOf(children[0])?.getAttribute('data-step-body')).toBe('0');
    expect(children[1].holder.getAttribute('data-step-index')).toBe('1');
    expect(contentOf(children[1])?.getAttribute('data-step-body')).toBe('1');

    // The levels must stay distinct, or the law's two hooks collapse into one.
    expect(children[0].holder.hasAttribute('data-step-body')).toBe(false);
    expect(contentOf(children[0])?.hasAttribute('data-step-index')).toBe(false);
  });

  it('finds the content wrapper through tune wrappers, not just a direct child', () => {
    const children = [makeChild('a', { wrapDepth: 2 })];

    applyChildDecoration(ledger, children, {
      childContentAttributes: () => ({ 'data-tone': 'warn' }),
    });

    expect(contentOf(children[0])?.getAttribute('data-tone')).toBe('warn');
  });

  it("never writes onto a DESCENDANT block's content wrapper", () => {
    // A container's child may itself contain blocks; only the child's OWN
    // wrapper (first in document order) is this container's business.
    const child = makeChild('a');
    const grandchild = makeChild('a-1');

    contentOf(child)?.appendChild(grandchild.holder);

    applyChildDecoration(ledger, [child], {
      childContentAttributes: () => ({ 'data-tone': 'warn' }),
    });

    expect(contentOf(child)?.getAttribute('data-tone')).toBe('warn');
    expect(contentOf(grandchild)?.hasAttribute('data-tone')).toBe(false);
  });

  it('removes hooks the decorator stopped producing, at BOTH levels', () => {
    const children = [makeChild('a')];

    applyChildDecoration(ledger, children, {
      childAttributes: () => ({ 'data-active': true, 'data-legacy': 'x' }),
      childContentAttributes: () => ({ 'data-tone': 'warn', 'data-old': 'y' }),
    });

    applyChildDecoration(ledger, children, {
      childAttributes: () => ({ 'data-active': false }),
      childContentAttributes: () => ({ 'data-tone': 'ok' }),
    });

    // `false` is written, not dropped — CSS can select on it.
    expect(children[0].holder.getAttribute('data-active')).toBe('false');
    expect(children[0].holder.hasAttribute('data-legacy')).toBe(false);
    expect(contentOf(children[0])?.getAttribute('data-tone')).toBe('ok');
    expect(contentOf(children[0])?.hasAttribute('data-old')).toBe(false);
  });

  it('cleans up a child that has LEFT the container', () => {
    // Otherwise a reordered-out child keeps a dead index forever.
    const staying = makeChild('a');
    const leaving = makeChild('b');

    applyChildDecoration(ledger, [staying, leaving], {
      childAttributes: (_child, index) => ({ 'data-step-index': index }),
      childContentAttributes: (_child, index) => ({ 'data-step-body': index }),
    });

    applyChildDecoration(ledger, [staying], {
      childAttributes: (_child, index) => ({ 'data-step-index': index }),
      childContentAttributes: (_child, index) => ({ 'data-step-body': index }),
    });

    expect(leaving.holder.hasAttribute('data-step-index')).toBe(false);
    expect(contentOf(leaving)?.hasAttribute('data-step-body')).toBe(false);
    expect(staying.holder.getAttribute('data-step-index')).toBe('0');
  });

  it('removes a hook whose value became null', () => {
    const children = [makeChild('a')];

    applyChildDecoration(ledger, children, {
      childContentAttributes: () => ({ 'data-tone': 'warn' }),
    });
    applyChildDecoration(ledger, children, {
      childContentAttributes: () => ({ 'data-tone': null }),
    });

    expect(contentOf(children[0])?.hasAttribute('data-tone')).toBe(false);
  });

  it('skips a child whose content wrapper has not committed yet', () => {
    // A portal-rendered child's DOM lands a frame after core inserts it.
    const pending = makeChild('a', { withContent: false });

    expect(() =>
      applyChildDecoration(ledger, [pending], {
        childAttributes: () => ({ 'data-step-index': 0 }),
        childContentAttributes: () => ({ 'data-tone': 'warn' }),
      })
    ).not.toThrow();

    // The holder half still landed; the content half must not have fallen back
    // onto the holder.
    expect(pending.holder.getAttribute('data-step-index')).toBe('0');
    expect(pending.holder.hasAttribute('data-tone')).toBe(false);
  });

  it('stamps a late-committing wrapper on the next pass', () => {
    const child = makeChild('a', { withContent: false });
    const decorators = { childContentAttributes: () => ({ 'data-tone': 'warn' }) };

    applyChildDecoration(ledger, [child], decorators);

    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    child.holder.appendChild(content);

    applyChildDecoration(ledger, [child], decorators);

    expect(content.getAttribute('data-tone')).toBe('warn');
  });

  it('introduces no elements — decoration is attributes only', () => {
    const child = makeChild('a');
    const slot = document.createElement('div');

    slot.appendChild(child.holder);

    applyChildDecoration(ledger, [child], {
      childAttributes: () => ({ 'data-step-index': 0 }),
      childContentAttributes: () => ({ 'data-tone': 'warn' }),
    });

    // Core's reparenting and caret sibling checks compare holder.parentElement
    // by identity, so a wrapper element would corrupt both.
    expect(child.holder.parentElement).toBe(slot);
    expect(slot.children.length).toBe(1);
  });
});
