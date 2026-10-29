import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Block } from '../../../../../src/components/block';
import { hideUnderCollapsedParent } from '../../../../../src/components/modules/blockManager/new-block-placement';

interface FakeBlock {
  id: string;
  parentId: string | null;
  contentIds: string[];
  holder: HTMLElement;
  tool: { isLayout: boolean };
}

const block = (id: string, parentId: string | null, { hidden = false, layout = false } = {}): FakeBlock => {
  const holder = document.createElement('div');

  if (hidden) {
    holder.classList.add('hidden');
  }

  return { id, parentId, contentIds: [], holder, tool: { isLayout: layout } };
};

type GetBlock = Mock<(id: string) => Block | undefined>;

const family = (children: FakeBlock[]): { child: FakeBlock; getBlock: GetBlock } => {
  const parent = block('parent', null);
  const child = block('new', 'parent');
  const all = new Map([parent, child, ...children].map(item => [item.id, item]));

  parent.contentIds = [...children.map(item => item.id), child.id];
  children.forEach(item => parent.holder.appendChild(item.holder));

  return { child, getBlock: vi.fn<(id: string) => Block | undefined>((id: string) => all.get(id) as unknown as Block | undefined) };
};

const run = (child: FakeBlock, getBlock: GetBlock): boolean => {
  hideUnderCollapsedParent(child as unknown as Block, getBlock);

  return child.holder.classList.contains('hidden');
};

describe('hideUnderCollapsedParent', () => {
  it('hides a new child when every other child is hidden', () => {
    const { child, getBlock } = family([block('a', 'parent', { hidden: true }), block('b', 'parent', { hidden: true })]);

    expect(run(child, getBlock)).toBe(true);
  });

  it('ignores hidden layout children when deciding', () => {
    const { child, getBlock } = family([block('tab', 'parent', { hidden: true, layout: true })]);

    expect(run(child, getBlock)).toBe(false);
  });

  it('leaves a new child visible when another child is visible', () => {
    const { child, getBlock } = family([block('a', 'parent', { hidden: true }), block('b', 'parent')]);

    expect(run(child, getBlock)).toBe(false);
  });

  it('hides a new child under a closed toggle marker', () => {
    const { child, getBlock } = family([block('a', 'parent')]);
    const parent = getBlock('parent') as unknown as FakeBlock;
    const marker = document.createElement('div');

    marker.setAttribute('data-blok-toggle-open', 'false');
    parent.holder.appendChild(marker);

    expect(run(child, getBlock)).toBe(true);
  });

  it('looks up a fixed number of siblings however many the parent has', () => {
    const lookups = (count: number): number => {
      const { child, getBlock } = family(Array.from({ length: count }, (_, i) => block(`c${i}`, 'parent')));

      run(child, getBlock);

      return getBlock.mock.calls.length;
    };

    expect(lookups(500)).toBe(lookups(2));
  });
});
