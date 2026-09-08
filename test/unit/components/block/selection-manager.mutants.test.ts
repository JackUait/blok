/**
 * Mutant-killing tests for `src/components/block/selection-manager.ts`.
 *
 * The selection module is mocked so the four fake-cursor helpers can be driven
 * independently: whether the block holds the range and whether it already holds
 * a fake cursor are separate facts, and the setter only behaves correctly when
 * it keeps them apart.
 *
 * No equivalent mutants: every live mutant here is killed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SelectionManager } from '../../../../src/components/block/selection-manager';
import { SelectionUtils } from '../../../../src/components/selection';
import type { StyleManager } from '../../../../src/components/block/style-manager';
import type { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';

vi.mock('../../../../src/components/selection', () => ({
  SelectionUtils: {
    isRangeInsideContainer: vi.fn(() => false),
    isFakeCursorInsideContainer: vi.fn(() => false),
    addFakeCursor: vi.fn(),
    removeFakeCursor: vi.fn(),
  },
}));

type Fixture = {
  manager: SelectionManager;
  updateContentState: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

const setup = (options: { withEventBus?: boolean; withContentElement?: boolean } = {}): Fixture => {
  const holder = document.createElement('div');
  const contentElement = document.createElement('div');

  holder.appendChild(contentElement);

  const updateContentState = vi.fn();
  const emit = vi.fn();
  const styleManager = { updateContentState } as unknown as StyleManager;
  const eventBus = options.withEventBus === false
    ? null
    : ({ emit } as unknown as EventsDispatcher<BlokEventMap>);

  const manager = new SelectionManager(
    holder,
    () => (options.withContentElement === false ? null : contentElement),
    () => false,
    eventBus,
    styleManager
  );

  return { manager,
    updateContentState,
    emit };
};

/**
 * Both flags, every test: neither `clearAllMocks` nor `restoreAllMocks` drops a
 * `mockReturnValue` from a factory mock, so an unset flag would carry over from
 * whichever test ran last.
 */
const setSelectionState = (holdsRange: boolean, holdsFakeCursor: boolean): void => {
  vi.mocked(SelectionUtils.isRangeInsideContainer).mockReturnValue(holdsRange);
  vi.mocked(SelectionUtils.isFakeCursorInsideContainer).mockReturnValue(holdsFakeCursor);
};

describe('SelectionManager mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a fake cursor when selecting the block holding the range', () => {
    setSelectionState(true, false);

    const { manager } = setup();

    manager.selected = true;

    expect(SelectionUtils.addFakeCursor).toHaveBeenCalledTimes(1);
    expect(SelectionUtils.removeFakeCursor).not.toHaveBeenCalled();
  });

  it('removes the fake cursor when deselecting the block that carries one', () => {
    setSelectionState(false, true);

    const { manager } = setup();

    manager.selected = false;

    expect(SelectionUtils.removeFakeCursor).toHaveBeenCalledTimes(1);
    expect(SelectionUtils.addFakeCursor).not.toHaveBeenCalled();
  });

  it('leaves an existing fake cursor in place while selecting', () => {
    // Selecting never removes: only the deselect half of the toggle does.
    setSelectionState(false, true);

    const { manager, emit } = setup();

    manager.selected = true;

    expect(SelectionUtils.removeFakeCursor).not.toHaveBeenCalled();
    expect(SelectionUtils.addFakeCursor).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('toggles the fake cursor without an event bus', () => {
    setSelectionState(true, false);

    const { manager } = setup({ withEventBus: false });

    manager.selected = true;

    expect(SelectionUtils.addFakeCursor).toHaveBeenCalledTimes(1);
  });

  it('skips content styling for a block that has no content element', () => {
    setSelectionState(true, false);

    const { manager, updateContentState } = setup({ withContentElement: false });

    manager.selected = true;

    expect(updateContentState).not.toHaveBeenCalled();
  });
});
