/**
 * Mutant-killing tests for
 * `src/components/modules/drag/state/DragStateMachine.ts`.
 *
 * The reads (`getSourceBlocks`, `getSourceBlock`, `isMultiBlockDrag`) each
 * switch over every state, so a case label only shows itself when the machine
 * is actually parked in that state - hence one test per resting state rather
 * than one per method.
 *
 * No equivalent mutants: every live mutant here is killed.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { DragStateMachine } from '../../../../../../src/components/modules/drag/state/DragStateMachine';
import type { Block } from '../../../../../../src/components/block';

const makeBlock = (id: string): Block => ({ id } as Partial<Block> as Block);

describe('DragStateMachine mutants', () => {
  const first = makeBlock('block-1');
  const second = makeBlock('block-2');
  const target = makeBlock('block-3');
  let machine: DragStateMachine;

  beforeEach(() => {
    vi.clearAllMocks();
    machine = new DragStateMachine();
  });

  it('reports the source of a drag that is still tracking', () => {
    machine.startTracking(first, [ first, second ], 0, 0);

    expect(machine.getSourceBlock()).toBe(first);
  });

  it('reports the source of a drag in flight', () => {
    machine.startTracking(first, [ first, second ], 0, 0);
    machine.startDrag();

    expect(machine.getSourceBlocks()).toEqual([ first, second ]);
    expect(machine.getSourceBlock()).toBe(first);
    expect(machine.isMultiBlockDrag()).toBe(true);
  });

  it('reports the source of a drag that has been dropped', () => {
    machine.startTracking(first, [ first, second ], 0, 0);
    machine.startDrag();
    machine.updateTarget(target, 'top');
    machine.drop();

    expect(machine.getSourceBlocks()).toEqual([ first, second ]);
    expect(machine.getSourceBlock()).toBe(first);
    expect(machine.isMultiBlockDrag()).toBe(true);
  });

  it('reports the source of a cancelled drag, but no longer as multi-block', () => {
    machine.startTracking(first, [ first, second ], 0, 0);
    machine.cancel();

    expect(machine.getSourceBlocks()).toEqual([ first, second ]);
    expect(machine.getSourceBlock()).toBe(first);
    expect(machine.isMultiBlockDrag()).toBe(false);
  });

  it('refuses a drop that has a block but no edge', () => {
    machine.startTracking(first, [ first ], 0, 0);
    machine.startDrag();
    machine.updateTarget(target, null);

    expect(() => machine.drop()).toThrow('Cannot drop: no valid target');
  });

  it('refuses a drop that has an edge but no block', () => {
    machine.startTracking(first, [ first ], 0, 0);
    machine.startDrag();
    machine.updateTarget(null, 'bottom');

    expect(() => machine.drop()).toThrow('Cannot drop: no valid target');
  });
});
