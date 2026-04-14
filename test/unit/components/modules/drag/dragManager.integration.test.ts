/**
 * Integration tests for DragManager sub-components
 * Tests interactions between AutoScroll, DropTargetDetector, and other components
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { DragController as DragManager } from "../../../../../src/components/modules/drag/DragController";
import { EventsDispatcher } from "../../../../../src/components/utils/events";
import type { BlokEventMap } from "../../../../../src/components/events";
import type { BlokModules } from "../../../../../src/types-internal/blok-modules";
import type { BlokConfig } from "../../../../../types";
import type { Block } from "../../../../../src/components/block";
import { DATA_ATTR } from "../../../../../src/components/constants";
import * as tooltip from "../../../../../src/components/utils/tooltip";
import * as announcer from "../../../../../src/components/utils/announcer";

/**
 * Store for original document.elementFromPoint
 */
let originalElementFromPoint: typeof document.elementFromPoint;

type DragManagerSetup = {
  dragManager: DragManager;
  modules: BlokModules;
  blocks: Block[];
  wrapper: HTMLDivElement;
};

type ModuleOverrides = Partial<BlokModules>;

/**
 * Creates a mock block for testing
 */
const createBlockStub = (
  options: {
    id?: string;
    name?: string;
    selected?: boolean;
    stretched?: boolean;
    listDepth?: number | null;
    contentIds?: string[];
    parentId?: string | null;
  } = {},
): Block => {
  const holder = document.createElement("div");

  holder.setAttribute("data-blok-element", "");

  // Create content element structure
  const contentElement = document.createElement("div");

  contentElement.setAttribute("data-blok-element-content", "");
  holder.appendChild(contentElement);

  // Add tool content
  const toolElement = document.createElement("div");

  toolElement.textContent = "Block content";
  contentElement.appendChild(toolElement);

  // Add list depth if provided
  if (options.listDepth !== undefined && options.listDepth !== null) {
    const listWrapper = document.createElement("div");

    listWrapper.setAttribute("data-list-depth", String(options.listDepth));
    contentElement.appendChild(listWrapper);
  }

  // Mock getBoundingClientRect
  holder.getBoundingClientRect = vi.fn(() => ({
    top: 0,
    bottom: 50,
    left: 0,
    right: 100,
    width: 100,
    height: 50,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  contentElement.getBoundingClientRect = vi.fn(() => ({
    top: 0,
    bottom: 50,
    left: 0,
    right: 100,
    width: 100,
    height: 50,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  let isSelected = options.selected ?? false;

  const block = {
    id: options.id ?? `block-${Math.random().toString(16).slice(2)}`,
    name: options.name ?? "paragraph",
    holder,
    stretched: options.stretched ?? false,
    contentIds: options.contentIds ?? [],
    parentId: options.parentId ?? null,
    call: vi.fn(),
  };

  Object.defineProperty(block, "selected", {
    configurable: true,
    enumerable: true,
    get: () => isSelected,
    set: (value: boolean) => {
      isSelected = value;
    },
  });

  return block as unknown as Block;
};

/**
 * Creates a DragManager instance with mocked dependencies
 */
const createDragManager = (
  overrides: ModuleOverrides = {},
): DragManagerSetup => {
  const wrapper = document.createElement("div");

  wrapper.setAttribute("data-blok-editor", "");

  const blocks = [
    createBlockStub({ id: "block-1" }),
    createBlockStub({ id: "block-2" }),
    createBlockStub({ id: "block-3" }),
    createBlockStub({ id: "block-4" }),
    createBlockStub({ id: "block-5" }),
  ];

  const blockManager = {
    blocks,
    getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
    move: vi.fn(),
    insert: vi.fn(),
    setBlockParent: vi.fn(),
  };

  const blockSelection = {
    selectedBlocks: [] as Block[],
    clearSelection: vi.fn(),
    selectBlock: vi.fn(),
  };

  const toolbar = {
    close: vi.fn(),
    moveAndOpen: vi.fn(),
    skipNextSettingsToggle: vi.fn(),
  };

  const ui = {
    nodes: {
      wrapper,
      redactor: document.createElement("div"),
      holder: document.createElement("div"),
    },
    contentRect: { left: 0 },
  };

  const i18n = {
    t: vi.fn((key: string, vars?: Record<string, unknown>) => {
      let text = key;

      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }

      return text;
    }),
    has: vi.fn(() => false),
  };

  const defaults: ModuleOverrides = {
    BlockManager: blockManager as unknown as BlokModules["BlockManager"],
    BlockSelection: blockSelection as unknown as BlokModules["BlockSelection"],
    Toolbar: toolbar as unknown as BlokModules["Toolbar"],
    UI: ui as unknown as BlokModules["UI"],
    I18n: i18n as unknown as BlokModules["I18n"],
  };

  const yjsManager = {
    transact: vi.fn((callback: () => void) => callback()),
    transactMoves: vi.fn((callback: () => void) => callback()),
  };

  const mergedState = {
    ...defaults,
    YjsManager: yjsManager as unknown as BlokModules["YjsManager"],
    ...overrides,
  } as BlokModules;
  const dragManager = new DragManager({
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  dragManager.state = mergedState;

  // Call prepare to initialize internal components
  void dragManager.prepare();

  return {
    dragManager,
    modules: mergedState,
    blocks,
    wrapper,
  };
};

/**
 * Simulates a mouse event
 */
const createMouseEvent = (
  type: string,
  options: Partial<MouseEventInit> = {},
): MouseEvent => {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...options,
  });
};

describe("DragManager - Component Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tooltip, "hide").mockImplementation(() => undefined);
    vi.spyOn(announcer, "announce").mockImplementation(() => undefined);

    // Mock document.elementFromPoint
    originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    // Use fake timers for throttled announcements
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.elementFromPoint = originalElementFromPoint;
    vi.useRealTimers();
  });

  describe("AutoScroll + DropTargetDetector integration", () => {
    it("should detect drop target during drag operation", () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      const targetBlock = blocks[3];
      vi.mocked(document.elementFromPoint).mockReturnValue(targetBlock.holder);
      (targetBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 200,
        bottom: 250,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      });

      // Move over target
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 225 }),
      );

      // Drop target should be detected
      expect(targetBlock.holder).toHaveAttribute("data-drop-indicator");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });
  });

  describe("DragStateMachine + DragOperations integration", () => {
    it("should not execute operation when state machine is cancelled", () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start tracking but cancel before threshold
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );

      // Cancel before passing threshold
      dragManager.cancelTracking();
      document.dispatchEvent(createMouseEvent("mouseup"));

      // No operation should have been executed
      expect(modules.BlockManager.move).not.toHaveBeenCalled();
      expect(modules.BlockManager.insert).not.toHaveBeenCalled();
    });

    it("should execute correct operation based on state at drop time", () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Set up target for drop
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);
      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 130 }),
      );

      // Drop without Alt key - should move
      document.dispatchEvent(createMouseEvent("mouseup", { altKey: false }));

      // Verify the move operation was called with correct parameters
      expect(modules.BlockManager.move).toHaveBeenCalledWith(
        expect.anything(), // dragged block
        expect.anything(), // target index
        expect.anything(), // options
      );

      // Verify drag state is cleaned up (observable behavior)
      expect(dragManager.isDragging).toBe(false);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
    });

    it("should abort handleDrop completely when target became stale mid-drag (Layer 13)", () => {
      // Regression: wrong-block-dropped family.
      //
      // After Layer 9, `DragOperations.moveBlocks` correctly returns an empty
      // result when the target block is no longer in the array. But
      // `DragController.handleDrop` continued running downstream code:
      //   - `resolveParentForDrop(staleTarget)` read stale parentId
      //   - the empty movedBlocks loop was a no-op (safe)
      //   - `getBlockByIndex(-1)` was called for a11y (guarded)
      //   - `Toolbar.moveAndOpen(sourceBlock)` opened on a potentially dead source
      //
      // This is defense-in-depth: when moveBlocks aborts, handleDrop must also
      // abort completely — no downstream side effects that could leak stale
      // state into the toolbar, parent resolution, or a11y layer.
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      const targetBlock = blocks[2];

      vi.mocked(document.elementFromPoint).mockReturnValue(targetBlock.holder);
      (targetBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 130 }),
      );

      // Simulate remote Yjs update / undo that removes the target AFTER drag
      // tracking captured it, BUT before mouseup fires.
      vi.mocked(modules.BlockManager.getBlockIndex).mockImplementation(
        (block: Block) => {
          if (block === targetBlock) return -1;

          return blocks.indexOf(block);
        },
      );

      document.dispatchEvent(createMouseEvent("mouseup", { altKey: false }));

      // No move ever happens
      expect(modules.BlockManager.move).not.toHaveBeenCalled();
      // No parent re-assignment — resolveParentForDrop must NOT leak side effects
      expect(modules.BlockManager.setBlockParent).not.toHaveBeenCalled();
      // handleDrop's own Toolbar.moveAndOpen must NOT fire. `cleanup()` still
      // calls it once post-drop to restore the toolbar on the source — so the
      // expected total is exactly 1, not 2 (the pre-Layer-13 count).
      expect(modules.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
      // Drag state still cleaned up
      expect(dragManager.isDragging).toBe(false);
    });
  });

  describe("DragPreview + DragA11y integration", () => {
    it("should announce drag start when preview is shown", () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Preview should be in DOM (visible)
      const preview = document.body.querySelector(
        '[class*="fixed"][class*="pointer-events-none"]',
      );
      expect(preview).not.toBeNull();

      // Announcement should have been made
      expect(announcer.announce).toHaveBeenCalledWith(
        expect.stringContaining("drag"),
        { politeness: "assertive" },
      );

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });

    it("should announce drop position when target changes", () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Clear previous calls
      vi.mocked(announcer.announce).mockClear();

      // Move over first target
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[1].holder);
      (blocks[1].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 75 }),
      );

      // Move over second target
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);
      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 125 }),
      );

      // Fast forward time to trigger throttled announcement
      vi.advanceTimersByTime(300);

      // Verify the announcement was made with correct message key (observable behavior: user feedback)
      expect(announcer.announce).toHaveBeenCalledWith("a11y.dropPosition", {
        politeness: "polite",
      });

      // Verify the drop indicator is shown on the final target block (observable DOM state)
      expect(blocks[2].holder).toHaveAttribute("data-drop-indicator");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });
  });

  describe("ListItemDescendants + DropTargetDetector integration", () => {
    it("should properly detect list item structure during drag", () => {
      const { dragManager, modules, wrapper } = createDragManager();

      // Create a list structure:
      // - parent (depth 0) <- being dragged
      //   - child (depth 1) <- should come along
      // - sibling (depth 0) <- valid target
      const parentBlock = createBlockStub({ id: "parent", listDepth: 0 });
      const childBlock = createBlockStub({ id: "child", listDepth: 1 });
      const siblingBlock = createBlockStub({ id: "sibling", listDepth: 0 });

      const allBlocks = [parentBlock, childBlock, siblingBlock];
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks =
        allBlocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation(
        (block: Block) => allBlocks.indexOf(block),
      );
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation(
        (index: number) => allBlocks[index],
      );

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, parentBlock);

      // Start drag (parent with its descendant child)
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Verify multi-block dragging is set (because descendants are included)
      expect(wrapper).toHaveAttribute(DATA_ATTR.draggingMulti, "true");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });

    it("should allow dropping on sibling (not descendant)", () => {
      const { dragManager, modules, wrapper } = createDragManager();

      const parentBlock = createBlockStub({ id: "parent", listDepth: 0 });
      const childBlock = createBlockStub({ id: "child", listDepth: 1 });
      const siblingBlock = createBlockStub({ id: "sibling", listDepth: 0 });

      const allBlocks = [parentBlock, childBlock, siblingBlock];
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks =
        allBlocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation(
        (block: Block) => allBlocks.indexOf(block),
      );
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation(
        (index: number) => allBlocks[index],
      );

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, parentBlock);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Try to drop on sibling (should work)
      vi.mocked(document.elementFromPoint).mockReturnValue(siblingBlock.holder);
      (siblingBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 200,
        bottom: 250,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: 225 }),
      );

      // Sibling should have drop indicator
      expect(siblingBlock.holder).toHaveAttribute("data-drop-indicator");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });
  });

  describe("Hierarchy descendants (toggle/parent-child blocks)", () => {
    it("should include toggle children (via contentIds) in the drag operation", () => {
      const { dragManager, modules, wrapper } = createDragManager();

      // Create a toggle structure using the parentId/contentIds hierarchy model:
      // - toggleBlock (contentIds: ['child-1', 'child-2'])
      //   - child1 (parentId: 'toggle')
      //   - child2 (parentId: 'toggle')
      // - unrelated (no parent)
      const toggleBlock = createBlockStub({
        id: "toggle",
        contentIds: ["child-1", "child-2"],
      });
      const child1 = createBlockStub({
        id: "child-1",
        parentId: "toggle",
      });
      const child2 = createBlockStub({
        id: "child-2",
        parentId: "toggle",
      });
      const unrelatedBlock = createBlockStub({ id: "unrelated" });

      const allBlocks = [toggleBlock, child1, child2, unrelatedBlock];
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks =
        allBlocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation(
        (block: Block) => allBlocks.indexOf(block),
      );
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation(
        (index: number) => allBlocks[index],
      );
      (modules.BlockManager.getBlockById as Mock).mockImplementation(
        (id: string) => allBlocks.find((b) => b.id === id),
      );

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, toggleBlock);

      // Start drag (toggle with its children)
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Verify multi-block dragging is set (because toggle children are included)
      expect(wrapper).toHaveAttribute(DATA_ATTR.draggingMulti, "true");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });

    it("should include nested hierarchy descendants recursively", () => {
      const { dragManager, modules, wrapper } = createDragManager();

      // Create a nested toggle structure:
      // - toggleBlock (contentIds: ['child-1'])
      //   - child1 (parentId: 'toggle', contentIds: ['grandchild-1'])
      //     - grandchild1 (parentId: 'child-1')
      const toggleBlock = createBlockStub({
        id: "toggle",
        contentIds: ["child-1"],
      });
      const child1 = createBlockStub({
        id: "child-1",
        parentId: "toggle",
        contentIds: ["grandchild-1"],
      });
      const grandchild1 = createBlockStub({
        id: "grandchild-1",
        parentId: "child-1",
      });

      const allBlocks = [toggleBlock, child1, grandchild1];
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks =
        allBlocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation(
        (block: Block) => allBlocks.indexOf(block),
      );
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation(
        (index: number) => allBlocks[index],
      );
      (modules.BlockManager.getBlockById as Mock).mockImplementation(
        (id: string) => allBlocks.find((b) => b.id === id),
      );

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, toggleBlock);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Should be multi-block (toggle + child + grandchild = 3 blocks)
      expect(wrapper).toHaveAttribute(DATA_ATTR.draggingMulti, "true");

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });

    it("should not include hierarchy children for selected block drags", () => {
      const { dragManager, modules, wrapper } = createDragManager();

      // Toggle with children, but block is selected (multi-selection drag)
      const toggleBlock = createBlockStub({
        id: "toggle",
        selected: true,
        contentIds: ["child-1"],
      });
      const child1 = createBlockStub({
        id: "child-1",
        parentId: "toggle",
      });

      const allBlocks = [toggleBlock, child1];
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks =
        allBlocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation(
        (block: Block) => allBlocks.indexOf(block),
      );
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation(
        (index: number) => allBlocks[index],
      );
      (modules.BlockManager.getBlockById as Mock).mockImplementation(
        (id: string) => allBlocks.find((b) => b.id === id),
      );

      // Set up block selection to return the toggle as selected
      (
        modules.BlockSelection as unknown as { selectedBlocks: Block[] }
      ).selectedBlocks = [toggleBlock];

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, toggleBlock);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Should NOT be multi-block because selected blocks use selection, not hierarchy
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.draggingMulti);

      // Cleanup
      document.dispatchEvent(createMouseEvent("mouseup"));
    });
  });

  describe("component cleanup coordination", () => {
    it("should clean up all components after drag completes", () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach((block) => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(true);

      // Set up target for drop - use the second block as a valid target
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[1].holder);
      (blocks[1].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });

      // Drop immediately without additional mousemove after setting target
      document.dispatchEvent(createMouseEvent("mouseup", { altKey: false }));

      // Verify cleanup - all attributes removed
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.draggingMulti);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.duplicating);

      // Preview removed
      const preview = document.body.querySelector(
        '[class*="fixed"][class*="pointer-events-none"]',
      );
      expect(preview).toBeNull();
    });

    it("should prevent drag from starting when cancelled during tracking phase", () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement("div");
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start tracking but don't pass drag threshold
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );

      expect(dragManager.isDragging).toBe(false);

      // Cancel via public API during tracking phase (simulates external cancellation like menu opening)
      dragManager.cancelTracking();

      // Move mouse enough that would normally trigger drag
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Drag should not have started
      expect(dragManager.isDragging).toBe(false);

      // No drag attributes should be set
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.draggingMulti);

      // No operations should have been executed
      expect(modules.BlockManager.move).not.toHaveBeenCalled();
      expect(modules.BlockManager.insert).not.toHaveBeenCalled();
    });
  });

  describe("Drop parent-child relationship updates", () => {
    /**
     * Helper to perform a full drag-drop operation.
     * Sets up the drag from sourceBlock, positions cursor over targetBlock,
     * and releases the mouse to trigger handleDrop.
     */
    const performDragDrop = (
      dragManager: DragManager,
      wrapper: HTMLDivElement,
      sourceBlock: Block,
      targetBlock: Block,
      edge: "top" | "bottom",
    ): void => {
      const dragHandle = document.createElement("div");

      dragManager.setupDragHandle(dragHandle, sourceBlock);

      // Start drag from source
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Position cursor over target block
      vi.mocked(document.elementFromPoint).mockReturnValue(
        targetBlock.holder,
      );

      const targetY = edge === "top" ? 105 : 140;

      (targetBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: targetY }),
      );

      // Drop
      document.dispatchEvent(createMouseEvent("mouseup", { altKey: false }));
    };

    /**
     * Creates a BlockManager mock that actually reorders its blocks array on move,
     * so that DragOperations.moveSingleBlock can retrieve the correct moved block.
     */
    const createBlockManagerMock = (
      allBlocks: Block[],
    ): BlokModules["BlockManager"] => {
      const blocks = [...allBlocks];

      return {
        blocks,
        getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
        getBlockByIndex: vi.fn((index: number) => blocks[index]),
        getBlockById: vi.fn((id: string) =>
          blocks.find((b) => b.id === id),
        ),
        move: vi.fn((toIndex: number, fromIndex: number) => {
          const [block] = blocks.splice(fromIndex, 1);

          blocks.splice(toIndex, 0, block);
        }),
        insert: vi.fn(),
        setBlockParent: vi.fn(),
      } as unknown as BlokModules["BlockManager"];
    };

    it("should set parent to toggle id when dropping on bottom of a toggle block", () => {
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
      });

      // Add the toggle-open DOM attribute that toggle tools set
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, toggleBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        paragraphBlock,
        toggleBlock,
        "bottom",
      );

      // setBlockParent should be called with the dragged block and the toggle's id
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "paragraph-1" }),
        "toggle-1",
      );
    });

    it("should set parent to target's parent when dropping on bottom of a child block", () => {
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-1"],
      });
      const childBlock = createBlockStub({
        id: "child-1",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const looseBlock = createBlockStub({
        id: "loose-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [looseBlock, toggleBlock, childBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        looseBlock,
        childBlock,
        "bottom",
      );

      // setBlockParent should be called with the toggle's id (the child's parent)
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "loose-1" }),
        "toggle-1",
      );
    });

    it("should set parent to null when dropping on bottom of a root-level non-toggle block", () => {
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["nested-1"],
      });
      const nestedBlock = createBlockStub({
        id: "nested-1",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const rootBlock = createBlockStub({
        id: "root-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [toggleBlock, nestedBlock, rootBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        nestedBlock,
        rootBlock,
        "bottom",
      );

      // setBlockParent should be called with null (root level)
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "nested-1" }),
        null,
      );
    });

    it("should set parent to toggle heading id when dropping on bottom of a toggle heading", () => {
      // Bug 1: Toggle headings (header with data-blok-toggle-open) were ignored
      // because resolveParentForDrop only checked block.name === 'toggle'
      const toggleHeading = createBlockStub({
        id: "toggle-heading-1",
        name: "header",
        parentId: null,
      });

      // Add the toggle-open DOM attribute that toggle headings have
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleHeading.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, toggleHeading];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        paragraphBlock,
        toggleHeading,
        "bottom",
      );

      // setBlockParent should be called with the toggle heading's id
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "paragraph-1" }),
        "toggle-heading-1",
      );
    });

    it("should set parent to nested toggle id when dropping on bottom of a nested toggle", () => {
      // Bug 5: Nested toggles (parentId !== null) couldn't accept children
      // because resolveParentForDrop required parentId === null
      const outerToggle = createBlockStub({
        id: "outer-toggle",
        name: "toggle",
        parentId: null,
        contentIds: ["inner-toggle"],
      });

      // Add toggle-open attribute to outer toggle
      const outerToggleWrapper = document.createElement("div");

      outerToggleWrapper.setAttribute("data-blok-toggle-open", "true");
      outerToggle.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(outerToggleWrapper);

      const innerToggle = createBlockStub({
        id: "inner-toggle",
        name: "toggle",
        parentId: "outer-toggle",
      });

      // Add toggle-open attribute to inner toggle
      const innerToggleWrapper = document.createElement("div");

      innerToggleWrapper.setAttribute("data-blok-toggle-open", "true");
      innerToggle.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(innerToggleWrapper);

      const looseBlock = createBlockStub({
        id: "loose-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [looseBlock, outerToggle, innerToggle];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        looseBlock,
        innerToggle,
        "bottom",
      );

      // setBlockParent should be called with the INNER toggle's id (not the outer toggle)
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "loose-1" }),
        "inner-toggle",
      );
    });

    it("should preserve internal hierarchy when dragging a toggle with children", () => {
      // Bug 3: When dragging a toggle with auto-collected children,
      // handleDrop applied the same newParentId to ALL moved blocks,
      // orphaning the children from their toggle parent
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-a", "child-b"],
      });

      // Add toggle-open attribute
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const childA = createBlockStub({
        id: "child-a",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const childB = createBlockStub({
        id: "child-b",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const targetBlock = createBlockStub({
        id: "target-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [toggleBlock, childA, childB, targetBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        toggleBlock,
        targetBlock,
        "bottom",
      );

      // setBlockParent SHOULD be called for child-a and child-b with their existing parentId
      // to restore their DOM placement inside the toggle container (which move() displaces).
      // The logical parent relationship is unchanged — only the DOM is being fixed.
      const setBlockParentCalls = vi.mocked(
        modules.BlockManager.setBlockParent,
      ).mock.calls;

      const child_a_call = setBlockParentCalls.find(
        ([block]) => (block as unknown as Block).id === "child-a",
      );
      const child_b_call = setBlockParentCalls.find(
        ([block]) => (block as unknown as Block).id === "child-b",
      );

      // Called with their own parentId (toggle-1), not with the new drop parentId
      expect(child_a_call).toBeDefined();
      expect(child_a_call?.[1]).toBe("toggle-1");
      expect(child_b_call).toBeDefined();
      expect(child_b_call?.[1]).toBe("toggle-1");
    });

    it("should NOT hide block and NOT reparent when dropping onto bottom edge of a collapsed toggle", () => {
      // Previously (buggy): dropping on a closed toggle reparented the block as a
      // hidden child. Now the block should stay at root level and remain visible,
      // because the drop indicator showed root level for a closed toggle.
      const collapsedToggle = createBlockStub({
        id: "collapsed-toggle",
        name: "toggle",
        parentId: null,
      });

      // Add toggle-open attribute set to "false" (collapsed)
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "false");
      collapsedToggle.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, collapsedToggle];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        paragraphBlock,
        collapsedToggle,
        "bottom",
      );

      // setBlockParent should NOT be called with "collapsed-toggle" — the block
      // must not become a child of the closed toggle
      expect(modules.BlockManager.setBlockParent).not.toHaveBeenCalledWith(
        expect.anything(),
        "collapsed-toggle",
      );
      // The block should NOT be hidden (it stays at root level, not a child)
      expect(paragraphBlock.holder.classList.contains("hidden")).toBe(false);
    });

    it("should call setBlockParent when reordering between toggle children (same parent)", () => {
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-1", "child-2"],
      });
      const child1 = createBlockStub({
        id: "child-1",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const child2 = createBlockStub({
        id: "child-2",
        name: "paragraph",
        parentId: "toggle-1",
      });

      const allBlocks = [toggleBlock, child1, child2];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      // Drag child-2 to bottom of child-1 (both are already children of toggle-1)
      performDragDrop(dragManager, wrapper, child2, child1, "bottom");

      // setBlockParent MUST be called even though child-2 already has toggle-1 as parent,
      // so that the DOM order within [data-blok-toggle-children] is synced to match the flat array
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "child-2" }),
        "toggle-1",
      );
    });

    it("should call rendered() on affected parent blocks after reparenting", () => {
      // After dropping a block into a toggle, the toggle tool needs its rendered()
      // lifecycle called so it can update body placeholder visibility.
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
      });

      // Add the toggle-open DOM attribute
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, toggleBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        paragraphBlock,
        toggleBlock,
        "bottom",
      );

      // The toggle (new parent) should have call('rendered') invoked
      expect(toggleBlock.call).toHaveBeenCalledWith("rendered");
    });

    it("should call rendered() on old parent when dragging last child out of a toggle", () => {
      // When the last child is dragged out, the old parent toggle needs
      // rendered() called so it can show the body placeholder again.
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-1"],
      });

      // Add toggle-open attribute
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const childBlock = createBlockStub({
        id: "child-1",
        name: "paragraph",
        parentId: "toggle-1",
      });

      const rootTarget = createBlockStub({
        id: "root-target",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [toggleBlock, childBlock, rootTarget];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      // Drag child out of toggle to below root-target
      performDragDrop(dragManager, wrapper, childBlock, rootTarget, "bottom");

      // The old parent toggle should have call('rendered') invoked
      expect(toggleBlock.call).toHaveBeenCalledWith("rendered");
    });

    it("should set parentId to null (root level) when dropping a toggle child onto its own toggle parent with bottom edge", () => {
      // Bug: when a child block is dragged onto the bottom edge of its own toggle
      // parent, resolveParentForDrop blindly returns the toggle's id (keeping it a
      // child) instead of allowing the block to escape to root level.
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-1"],
      });

      // Add toggle-open DOM attribute so isToggleableBlock returns true
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const childBlock = createBlockStub({
        id: "child-1",
        name: "paragraph",
        parentId: "toggle-1",
      });

      const allBlocks = [toggleBlock, childBlock];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      // Drag the child onto the bottom edge of its own toggle parent
      performDragDrop(dragManager, wrapper, childBlock, toggleBlock, "bottom");

      // setBlockParent should be called with null (root level), NOT "toggle-1"
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "child-1" }),
        null,
      );
    });

    it("should set parentId to null (root level) when dropping onto bottom edge of a CLOSED toggle", () => {
      // Bug: resolveParentForDrop uses isToggleableBlock which returns true for both
      // open AND closed toggles. DropTargetDetector only shows "entering toggle"
      // indicator for OPEN toggles, so for a closed toggle the indicator shows root
      // level — but the block was being reparented as a hidden child. The fix is to
      // only reparent when the toggle is open.
      const closedToggle = createBlockStub({
        id: "closed-toggle",
        name: "toggle",
        parentId: null,
      });

      // Add the toggle-open DOM attribute set to "false" (closed toggle)
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "false");
      closedToggle.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, closedToggle];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(
        dragManager,
        wrapper,
        paragraphBlock,
        closedToggle,
        "bottom",
      );

      // setBlockParent should NOT be called with "closed-toggle" — the block
      // must remain at root level (no reparenting to the closed toggle).
      // Note: since the block is already at root (parentId === null), setBlockParent
      // is skipped entirely rather than being called with null.
      expect(modules.BlockManager.setBlockParent).not.toHaveBeenCalledWith(
        expect.anything(),
        "closed-toggle",
      );
      // The block should NOT be hidden since it stays at root level
      expect(paragraphBlock.holder.classList.contains("hidden")).toBe(false);
    });

    it("should call setBlockParent when reordering a toggle child within the same toggle", () => {
      // Bug: reordering within a toggle was silently skipped because
      // movedBlock.parentId === newParentId, so setBlockParent was never called
      // and the DOM order in [data-blok-toggle-children] was never synced.
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-a", "child-b"],
      });

      // Add the toggle-open DOM attribute
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const childA = createBlockStub({
        id: "child-a",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const childB = createBlockStub({
        id: "child-b",
        name: "paragraph",
        parentId: "toggle-1",
      });

      const allBlocks = [toggleBlock, childA, childB];
      const blockManagerMock = createBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      // Drag childA (first child) onto the bottom half of childB (second child)
      // This should reorder them to [childB, childA] within the toggle
      performDragDrop(dragManager, wrapper, childA, childB, "bottom");

      // setBlockParent must be called to sync the DOM order within the toggle container,
      // even though childA's parentId (toggle-1) hasn't changed
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "child-a" }),
        "toggle-1",
      );
    });
  });

  describe("Duplicate parent-child relationship updates", () => {
    /**
     * Creates a block stub with a `save()` method for duplication tests.
     */
    const createDuplicableBlock = (
      options: Parameters<typeof createBlockStub>[0] & {
        saveData?: Record<string, unknown>;
      } = {},
    ): Block => {
      const block = createBlockStub(options);
      const saveData = options.saveData ?? { text: "duplicated content" };

      (block as unknown as { save: () => Promise<{ data: Record<string, unknown>; tunes: Record<string, unknown> }> }).save =
        vi.fn().mockResolvedValue({ data: saveData, tunes: {} });

      return block;
    };

    /**
     * Creates a BlockManager mock that supports both move and insert (for duplication).
     * `insert` returns a new block stub so that handleDuplicate gets valid duplicated blocks.
     */
    const createDuplicateBlockManagerMock = (
      allBlocks: Block[],
    ): BlokModules["BlockManager"] => {
      const blocks = [...allBlocks];
      let insertCounter = 0;

      return {
        blocks,
        getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
        getBlockByIndex: vi.fn((index: number) => blocks[index]),
        getBlockById: vi.fn((id: string) =>
          blocks.find((b) => b.id === id),
        ),
        move: vi.fn((toIndex: number, fromIndex: number) => {
          const [block] = blocks.splice(fromIndex, 1);

          blocks.splice(toIndex, 0, block);
        }),
        insert: vi.fn((config: { tool: string; data: Record<string, unknown>; index: number }) => {
          insertCounter++;
          const newBlock = createBlockStub({
            id: `duplicated-${insertCounter}`,
            name: config.tool,
            parentId: null,
          });

          blocks.splice(config.index, 0, newBlock);

          return newBlock;
        }),
        setBlockParent: vi.fn(),
      } as unknown as BlokModules["BlockManager"];
    };

    /**
     * Helper to perform a full Alt+drag duplicate operation.
     * Sets up the drag from sourceBlock, positions cursor over targetBlock,
     * and releases the mouse with Alt key held to trigger handleDuplicate.
     */
    const performAltDragDuplicate = async (
      dragManager: DragManager,
      wrapper: HTMLDivElement,
      sourceBlock: Block,
      targetBlock: Block,
      edge: "top" | "bottom",
    ): Promise<void> => {
      const dragHandle = document.createElement("div");

      dragManager.setupDragHandle(dragHandle, sourceBlock);

      // Start drag from source
      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      // Position cursor over target block
      vi.mocked(document.elementFromPoint).mockReturnValue(
        targetBlock.holder,
      );

      const targetY = edge === "top" ? 105 : 140;

      (targetBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: targetY }),
      );

      // Drop with Alt key held → triggers handleDuplicate
      document.dispatchEvent(createMouseEvent("mouseup", { altKey: true }));

      // handleDuplicate is async, flush microtasks
      await vi.runAllTimersAsync();
    };

    it("should set parent to toggle id when alt+drag duplicating to bottom of a toggle block", async () => {
      const toggleBlock = createDuplicableBlock({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
      });

      // Add toggle-open attribute so resolveParentForDrop detects it as a toggle
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const paragraphBlock = createDuplicableBlock({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphBlock, toggleBlock];
      const blockManagerMock = createDuplicateBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      await performAltDragDuplicate(
        dragManager,
        wrapper,
        paragraphBlock,
        toggleBlock,
        "bottom",
      );

      // setBlockParent should be called on the duplicated block with toggle's id
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "duplicated-1" }),
        "toggle-1",
      );
    });

    it("should set parent to target's parent when alt+drag duplicating to bottom of a child block", async () => {
      const toggleBlock = createDuplicableBlock({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
        contentIds: ["child-1"],
      });

      // Add toggle-open attribute
      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const childBlock = createDuplicableBlock({
        id: "child-1",
        name: "paragraph",
        parentId: "toggle-1",
      });
      const looseBlock = createDuplicableBlock({
        id: "loose-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [looseBlock, toggleBlock, childBlock];
      const blockManagerMock = createDuplicateBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      await performAltDragDuplicate(
        dragManager,
        wrapper,
        looseBlock,
        childBlock,
        "bottom",
      );

      // setBlockParent should be called with the toggle's id (child's parent)
      expect(modules.BlockManager.setBlockParent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "duplicated-1" }),
        "toggle-1",
      );
    });

    it("should not call setBlockParent when alt+drag duplicating to root level", async () => {
      const rootParagraph = createDuplicableBlock({
        id: "root-paragraph",
        name: "paragraph",
        parentId: null,
      });
      const anotherBlock = createDuplicableBlock({
        id: "another-1",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [rootParagraph, anotherBlock];
      const blockManagerMock = createDuplicateBlockManagerMock(allBlocks);

      const { dragManager, modules, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      await performAltDragDuplicate(
        dragManager,
        wrapper,
        rootParagraph,
        anotherBlock,
        "bottom",
      );

      // setBlockParent should NOT be called since both blocks are at root level
      // and the duplicated block also goes to root level (parentId already null)
      expect(modules.BlockManager.setBlockParent).not.toHaveBeenCalled();
    });
  });

  /**
   * History integration — the bug:
   *
   * A drag-reparent currently produces TWO independent undo entries on two
   * separate stacks:
   *   1) `BlockManager.move` → `YjsManager.moveBlock` → `UndoHistory.recordMove`
   *      → custom `moveUndoStack` entry
   *   2) `BlockManager.setBlockParent` → `YjsManager.transact('local')`
   *      → `Y.UndoManager` entry (captures `parentId` + parent `contentIds`)
   *
   * `UndoHistory.undo()` pops `moveUndoStack` FIRST and returns. It never
   * touches the Yjs UndoManager entry. So the first Cmd+Z restores the
   * block's flat-array position but leaves `parentId` pointing at the new
   * parent — an invariant-broken intermediate state. A second Cmd+Z finally
   * pops the parentId change. Net: a single user drag requires two undos.
   *
   * The fix (and the assertion this test locks in): wrap the entire drop
   * operation — the `move` AND every subsequent `setBlockParent` — in a
   * single `YjsManager.transactMoves` group, so the two writes land in the
   * same undo entry.
   */
  describe("handleDrop history integration", () => {
    const performDragDrop = (
      dragManager: DragManager,
      sourceBlock: Block,
      targetBlock: Block,
      edge: "top" | "bottom",
    ): void => {
      const dragHandle = document.createElement("div");

      dragManager.setupDragHandle(dragHandle, sourceBlock);

      dragHandle.dispatchEvent(
        createMouseEvent("mousedown", { clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 110, clientY: 100 }),
      );

      vi.mocked(document.elementFromPoint).mockReturnValue(targetBlock.holder);

      const targetY = edge === "top" ? 105 : 140;

      (targetBlock.holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.dispatchEvent(
        createMouseEvent("mousemove", { clientX: 50, clientY: targetY }),
      );

      document.dispatchEvent(createMouseEvent("mouseup", { altKey: false }));
    };

    it("wraps a drag-reparent (root → container) in a single transactMoves group so one Cmd+Z reverses it", () => {
      // Source paragraph at root level.
      const paragraph = createBlockStub({
        id: "paragraph-1",
        name: "paragraph",
        parentId: null,
      });

      // Target toggle that will receive the reparent.
      const toggleBlock = createBlockStub({
        id: "toggle-1",
        name: "toggle",
        parentId: null,
      });

      const toggleWrapper = document.createElement("div");

      toggleWrapper.setAttribute("data-blok-toggle-open", "true");
      toggleBlock.holder
        .querySelector("[data-blok-element-content]")!
        .appendChild(toggleWrapper);

      const allBlocks = [paragraph, toggleBlock];
      const blocks = [...allBlocks];

      // Track the order of BlockManager calls WRT the transactMoves window so we
      // can assert that move AND setBlockParent both happened INSIDE it.
      const callLog: string[] = [];

      const blockManagerMock = {
        blocks,
        getBlockIndex: vi.fn((b: Block) => blocks.indexOf(b)),
        getBlockByIndex: vi.fn((i: number) => blocks[i]),
        getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
        move: vi.fn((toIndex: number, fromIndex: number) => {
          callLog.push("move");
          const [block] = blocks.splice(fromIndex, 1);

          blocks.splice(toIndex, 0, block);
        }),
        insert: vi.fn(),
        setBlockParent: vi.fn(() => {
          callLog.push("setBlockParent");
        }),
      } as unknown as BlokModules["BlockManager"];

      let insideTransactMoves = false;
      const transactMovesCalls: string[][] = [];

      const yjsManagerMock = {
        transact: vi.fn((callback: () => void) => callback()),
        transactMoves: vi.fn((callback: () => void) => {
          insideTransactMoves = true;
          const before = callLog.length;

          callback();
          transactMovesCalls.push(callLog.slice(before));
          insideTransactMoves = false;
        }),
      };

      const { dragManager, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
        YjsManager: yjsManagerMock as unknown as BlokModules["YjsManager"],
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      performDragDrop(dragManager, paragraph, toggleBlock, "bottom");

      // 1. transactMoves must be called exactly once for the full drop.
      expect(yjsManagerMock.transactMoves).toHaveBeenCalledTimes(1);

      // 2. Both the array move AND the reparent must have happened INSIDE the
      //    single transactMoves group. If either leaks out, we get two
      //    separate undo stack entries → the two-Cmd-Z bug.
      expect(transactMovesCalls).toHaveLength(1);
      expect(transactMovesCalls[0]).toContain("move");
      expect(transactMovesCalls[0]).toContain("setBlockParent");

      // Sanity: the outer flag should have been reset.
      expect(insideTransactMoves).toBe(false);
    });

    it("wraps a root → root reorder (no parent change) in transactMoves", () => {
      // Even a plain root reorder emits a setBlockParent(null) write alongside
      // the array move. That write lands on Y.UndoManager as a separate stack
      // item, so without grouping one drag still needs two undos.
      const paragraphA = createBlockStub({
        id: "p-a",
        name: "paragraph",
        parentId: null,
      });
      const paragraphB = createBlockStub({
        id: "p-b",
        name: "paragraph",
        parentId: null,
      });
      const paragraphC = createBlockStub({
        id: "p-c",
        name: "paragraph",
        parentId: null,
      });

      const allBlocks = [paragraphA, paragraphB, paragraphC];
      const blocks = [...allBlocks];

      const blockManagerMock = {
        blocks,
        getBlockIndex: vi.fn((b: Block) => blocks.indexOf(b)),
        getBlockByIndex: vi.fn((i: number) => blocks[i]),
        getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
        move: vi.fn((toIndex: number, fromIndex: number) => {
          const [block] = blocks.splice(fromIndex, 1);

          blocks.splice(toIndex, 0, block);
        }),
        insert: vi.fn(),
        setBlockParent: vi.fn(),
      } as unknown as BlokModules["BlockManager"];

      const yjsManagerMock = {
        transact: vi.fn((callback: () => void) => callback()),
        transactMoves: vi.fn((callback: () => void) => callback()),
      };

      const { dragManager, wrapper } = createDragManager({
        BlockManager: blockManagerMock,
        YjsManager: yjsManagerMock as unknown as BlokModules["YjsManager"],
      });

      document.body.appendChild(wrapper);
      allBlocks.forEach((block) => wrapper.appendChild(block.holder));

      // Drag paragraphB below paragraphC.
      performDragDrop(dragManager, paragraphB, paragraphC, "bottom");

      // Observable behavior: the flat-array order must land as [A, C, B].
      expect(blocks.map((b) => b.id)).toEqual(["p-a", "p-c", "p-b"]);

      // And the entire operation must have been wrapped in a single
      // transactMoves group — otherwise undo would split across stacks.
      expect(yjsManagerMock.transactMoves).toHaveBeenCalledTimes(1);
    });
  });
});
