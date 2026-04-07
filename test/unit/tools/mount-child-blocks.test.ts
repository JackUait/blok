import { describe, it, expect } from 'vitest';
import { DATA_ATTR } from '../../../src/components/constants/data-attributes';

/**
 * Tests for the shared mountChildBlocks utility that encapsulates
 * the guard logic for mounting child block holders into a container.
 */
describe('mountChildBlocks', () => {
  const createHolder = (id: string): HTMLDivElement => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    holder.textContent = `Content of ${id}`;

    return holder;
  };

  const createContainer = (): HTMLDivElement => {
    const container = document.createElement('div');

    container.setAttribute(DATA_ATTR.nestedBlocks, '');

    return container;
  };

  it('should mount child holders into the container', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const container = createContainer();
    const holderA = createHolder('block-a');
    const holderB = createHolder('block-b');

    const children = [
      { holder: holderA },
      { holder: holderB },
    ];

    mountChildBlocks(container, children as { holder: HTMLElement }[]);

    expect(container.children).toHaveLength(2);
    expect(container.contains(holderA)).toBe(true);
    expect(container.contains(holderB)).toBe(true);
  });

  it('should skip children already mounted in the same container', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const container = createContainer();
    const holder = createHolder('block-a');

    // Pre-mount the holder
    container.appendChild(holder);

    mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

    // Must still have exactly 1 child, not 2
    expect(container.children).toHaveLength(1);
  });

  it('should not steal a holder already claimed by another nested container', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const otherContainer = createContainer();
    const targetContainer = createContainer();
    const holder = createHolder('block-a');

    // Pre-mount in the OTHER container
    otherContainer.appendChild(holder);
    // Attach to DOM so closest() can traverse
    document.body.appendChild(otherContainer);

    mountChildBlocks(targetContainer, [{ holder }] as { holder: HTMLElement }[]);

    // Holder must stay in the other container
    expect(otherContainer.contains(holder)).toBe(true);
    expect(targetContainer.children).toHaveLength(0);

    document.body.removeChild(otherContainer);
  });

  it('should mount a holder that is detached from the DOM', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const container = createContainer();
    const holder = createHolder('block-a');

    // holder.parentElement is null (not in DOM)
    mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

    expect(container.contains(holder)).toBe(true);
  });

  it('should be idempotent when called multiple times', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const container = createContainer();
    const holderA = createHolder('block-a');
    const holderB = createHolder('block-b');

    const children = [
      { holder: holderA },
      { holder: holderB },
    ] as { holder: HTMLElement }[];

    mountChildBlocks(container, children);
    mountChildBlocks(container, children);

    expect(container.children).toHaveLength(2);
  });
});
