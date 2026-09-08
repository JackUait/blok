import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import type {
  AnnouncerAdapter,
  BlockManagerAdapter,
  I18nAdapter,
} from '../../../../../../src/components/modules/drag/a11y/DragA11y';
import { DragA11y } from '../../../../../../src/components/modules/drag/a11y/DragA11y';

/**
 * Mutant-killing coverage for `DragA11y`.
 *
 * Proven-equivalent mutants (no input can distinguish them):
 *
 * 1. The two operation labels in `const operation = isDuplicate ? "duplicate" :
 *    "move"` replaced by the empty string, one at a time. `operation` is read in
 *    exactly one place: the dedupe key template. Announcements are only ever
 *    compared to each other for equality, so a relabelling is unobservable as
 *    long as it stays injective over the whole key space. It does: the labels
 *    become the sets "" / "move" and "duplicate" / "" respectively, both still
 *    distinct, and neither empty-prefixed key can equal a "column-left" or
 *    "column-right" key. Two announcements therefore collide under the mutant
 *    exactly when they collide in the original.
 *
 * 2. Every mutant of `if (pendingKey === null or pendingMessage === null)` in
 *    the throttle callback - the condition forced to false, either operand
 *    forced to false, the OR turned into an AND, and the body emptied. That
 *    condition is already false on every reachable run, so all five leave
 *    behaviour untouched. Proof: a timer only exists because scheduleAnnouncement
 *    reached the setTimeout call, and the two lines directly above it assign both
 *    fields non-null values. Only three places write null to them. The dedupe
 *    branch runs solely when announcementTimeoutId is null, so no timer is in
 *    flight and it returns without creating one. The callback itself writes null
 *    after copying both fields into the locals the guard reads. reset() writes
 *    null but also clears the timer, so the callback never runs. And
 *    announcementTimeoutId stays non-null for the whole life of a timer, so the
 *    early return above the dedupe branch keeps a second timer from existing.
 */
describe('DragA11y mutants', () => {
  const throttleMs = 300;

  let announcer: { announce: ReturnType<typeof vi.fn> };
  let i18n: I18nAdapter;

  const createBlock = (id: string): Block => ({
    id,
    name: 'paragraph',
    parentId: null,
    holder: document.createElement('div'),
  } as unknown as Block);

  interface ManagerProbe {
    manager: BlockManagerAdapter;
    blocksReads: () => number;
  }

  const createBlockManager = (order: Block[]): ManagerProbe => {
    let reads = 0;

    const manager: BlockManagerAdapter = {
      getBlockIndex: (block: Block) => order.indexOf(block),
      get blocks(): Block[] {
        reads += 1;

        return order;
      },
    };

    return {
      manager,
      blocksReads: () => reads,
    };
  };

  const createA11y = (order: Block[]): { a11y: DragA11y; probe: ManagerProbe } => {
    const probe = createBlockManager(order);

    return {
      a11y: new DragA11y(probe.manager, i18n, announcer as unknown as AnnouncerAdapter),
      probe,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    announcer = { announce: vi.fn() };
    i18n = {
      t: (key: string, params?: Record<string, number | string>): string =>
        `${key}:${JSON.stringify(params ?? {})}`,
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('announceDropPosition', () => {
    it('gives a left column drop a different dedupe key than a right one', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'left');
      vi.advanceTimersByTime(throttleMs);
      a11y.announceDropPosition(target, 'right');
      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).toHaveBeenCalledTimes(2);
    });

    it('does not consult the move resolver when there are no source blocks', () => {
      const target = createBlock('T');
      const { a11y, probe } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'bottom');

      // The only legitimate read is the one that computes the announced total.
      expect(probe.blocksReads()).toBe(1);
    });

    it('stays silent when the drop target is itself being dragged', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'bottom', [target]);
      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).not.toHaveBeenCalled();
    });

    it('announces the resolved position once the throttle elapses', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'top');
      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":2,"total":2}',
        { politeness: 'polite' }
      );
      expect(a11y.getLastAnnouncedIndex()).toBe(1);
    });
  });

  describe('throttling', () => {
    it('keeps a single timer in flight while announcements keep arriving', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'top');
      a11y.announceDropPosition(target, 'bottom');

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).toHaveBeenCalledTimes(1);
    });

    it('schedules nothing when the position repeats what was just announced', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'top');
      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).toHaveBeenCalledTimes(1);

      a11y.announceDropPosition(target, 'top');

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('reset', () => {
    it('cancels a pending announcement timer', () => {
      const target = createBlock('T');
      const { a11y } = createA11y([createBlock('A'), target]);

      a11y.announceDropPosition(target, 'top');

      expect(vi.getTimerCount()).toBe(1);

      a11y.reset();

      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(throttleMs);

      expect(announcer.announce).not.toHaveBeenCalled();
    });

    it('does not touch the timer queue when nothing is scheduled', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { a11y } = createA11y([createBlock('A')]);

      a11y.reset();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });
  });
});
