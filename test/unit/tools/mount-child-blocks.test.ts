import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as toolsEntry from '../../../src/tools';
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

    mountChildBlocks(container, children);

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

  it('should claim a holder stranded in an ANCESTOR nested container (drag reparent into a column)', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    // The column_list row is itself a nested-blocks container; a column's own
    // child container is nested inside it. A drag reparent can leave the moved
    // holder directly in the row (the ancestor), where it renders as a rogue
    // new column. mountChildBlocks must pull it down into the column's container.
    const ancestorRow = createContainer();

    ancestorRow.setAttribute('data-blok-columns', '');
    const columnContainer = createContainer();

    ancestorRow.appendChild(columnContainer);
    const holder = createHolder('block-a');

    ancestorRow.appendChild(holder); // stranded in the ancestor row
    document.body.appendChild(ancestorRow);

    mountChildBlocks(columnContainer, [{ holder }] as { holder: HTMLElement }[]);

    expect(columnContainer.contains(holder)).toBe(true);
    expect(holder.parentElement).toBe(columnContainer);

    document.body.removeChild(ancestorRow);
  });

  it('should claim a holder stranded in a NON-column ancestor nested container', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    // Any container that ENCLOSES this one is an illegitimate home for THIS
    // container's own model children — the columns row was only the first case
    // to be noticed. A nested callout/toggle/adapter container hits the same
    // strand: core anchors a newly inserted first child as the container
    // block's DOM sibling, i.e. inside the enclosing nested container, and if
    // the destination slot has not committed yet nothing else ever heals it.
    const ancestor = createContainer();
    const container = createContainer();

    ancestor.appendChild(container);
    const holder = createHolder('block-a');

    ancestor.appendChild(holder); // stranded one level out
    document.body.appendChild(ancestor);

    try {
      mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

      expect(holder.parentElement).toBe(container);
    } finally {
      ancestor.remove();
    }
  });

  it('should reclaim a stranded MIDDLE child at its model position, not at the end', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    // Reclaim used to `appendChild`, which puts a stranded middle child LAST.
    // Masked while reclaim only ever fired for the columns row (a full column
    // strand), it becomes visible as soon as any ancestor can be reclaimed
    // from: children [A, B, C] with B stranded must render A, B, C.
    const ancestor = createContainer();
    const container = createContainer();

    ancestor.appendChild(container);
    const holderA = createHolder('block-a');
    const holderB = createHolder('block-b');
    const holderC = createHolder('block-c');

    container.appendChild(holderA);
    container.appendChild(holderC);
    ancestor.appendChild(holderB); // stranded one level out
    document.body.appendChild(ancestor);

    try {
      mountChildBlocks(container, [
        { holder: holderA },
        { holder: holderB },
        { holder: holderC },
      ] as { holder: HTMLElement }[]);

      expect(Array.from(container.children)).toEqual([holderA, holderB, holderC]);
    } finally {
      ancestor.remove();
    }
  });

  it('should mount a holder that is detached from the DOM', async () => {
    const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

    const container = createContainer();
    const holder = createHolder('block-a');

    // holder.parentElement is null (not in DOM)
    mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

    expect(container.contains(holder)).toBe(true);
  });

  it('is reachable from the public @bloklabs/core/tools entrypoint', () => {
    // Container tools written by third parties need the same reconciler the
    // first-party ones use. Without it on the tools entry, the only way to get
    // the reclaim policy is to vendor-patch the package (or import the
    // explicitly no-semver `/adapters` entry, which ships no declarations).
    expect(Object.keys(toolsEntry)).toContain('mountChildBlocks');
  });

  describe('adopting a live holder', () => {
    /**
     * Adoption used to run through a raw `container.appendChild(holder)`, which
     * performs the DOM removing steps: the focused contenteditable is unfocused
     * and every live Range with a boundary in the moved subtree is relocated out
     * of it. Typing into a freshly created child of a toggle / column / callout
     * (or of any framework container whose slot commits after core inserts the
     * child) therefore lost the caret to <body>.
     */
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as unknown as { moveBefore?: unknown }).moveBefore;
      document.body.innerHTML = '';
    });

    const createEditableHolder = (id: string): { holder: HTMLDivElement; editable: HTMLElement; text: Text } => {
      const holder = createHolder(id);
      const editable = document.createElement('div');
      const text = document.createTextNode('caret here');

      holder.textContent = '';
      editable.setAttribute('contenteditable', 'true');
      editable.appendChild(text);
      holder.appendChild(editable);

      return { holder, editable, text };
    };

    /**
     * Puts a collapsed caret inside `editable` and focuses it, mirroring a user
     * typing in the block that is about to be adopted.
     * @param editable - the contenteditable element to focus
     * @param text - the text node the caret sits in
     * @param offset - caret offset inside the text node
     */
    const placeCaret = (editable: HTMLElement, text: Text, offset: number): void => {
      editable.focus();

      const range = document.createRange();

      range.setStart(text, offset);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('uses the state-preserving move so the browser never detaches the holder', async () => {
      const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

      const moveBefore = vi.fn(function (this: Element, node: Node, ref: Node | null) {
        this.insertBefore(node, ref);
      });

      (Element.prototype as unknown as { moveBefore: typeof moveBefore }).moveBefore = moveBefore;

      const ancestor = createContainer();
      const container = createContainer();
      const holder = createHolder('block-a');

      ancestor.appendChild(container);
      ancestor.appendChild(holder); // stranded one level out
      document.body.appendChild(ancestor);

      mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

      expect(moveBefore).toHaveBeenCalledOnce();
      expect(holder.parentElement).toBe(container);
    });

    it('keeps focus and the caret inside a holder it adopts', async () => {
      const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

      const ancestor = createContainer();
      const container = createContainer();
      const { holder, editable, text } = createEditableHolder('block-a');

      ancestor.appendChild(container);
      ancestor.appendChild(holder); // stranded one level out
      document.body.appendChild(ancestor);

      placeCaret(editable, text, 4);

      mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

      const selection = window.getSelection();

      expect(holder.parentElement).toBe(container);
      expect(editable).toHaveFocus();
      expect(selection?.anchorNode).toBe(text);
      expect(selection?.anchorOffset).toBe(4);
    });

    it('leaves a selection that lives OUTSIDE the moved holder alone', async () => {
      const { mountChildBlocks } = await import('../../../src/tools/nested-blocks');

      const ancestor = createContainer();
      const container = createContainer();
      const holder = createHolder('block-a');
      const bystander = createEditableHolder('block-b');

      ancestor.appendChild(container);
      ancestor.appendChild(holder);
      document.body.appendChild(ancestor);
      document.body.appendChild(bystander.holder);

      placeCaret(bystander.editable, bystander.text, 2);

      mountChildBlocks(container, [{ holder }] as { holder: HTMLElement }[]);

      const selection = window.getSelection();

      expect(bystander.editable).toHaveFocus();
      expect(selection?.anchorNode).toBe(bystander.text);
      expect(selection?.anchorOffset).toBe(2);
    });
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
