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
    selected?: boolean;
    stretched?: boolean;
    listDepth?: number | null;
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
    holder,
    stretched: options.stretched ?? false,
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
    move: vi.fn(),
    insert: vi.fn(),
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
    transactMoves: vi.fn(),
  };

  const mergedState = {
    ...defaults,
    ...overrides,
    YjsManager: yjsManager as unknown as BlokModules["YjsManager"],
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
});
