import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TableEventBroker } from '../../../../src/tools/table/ownership/table-event-broker';
import { TableOwnershipRegistry } from '../../../../src/tools/table/ownership/table-ownership-registry';

// ─── Tests ─────────────────────────────────────────────────────────

describe('TableEventBroker', () => {
  let registry: TableOwnershipRegistry;
  let broker: TableEventBroker;

  beforeEach(() => {
    registry = new TableOwnershipRegistry();
    broker = new TableEventBroker(registry);
  });

  describe('subscriber management', () => {
    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('allows subscribing a table handler', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // Verify subscription exists by routing an event
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      broker.routeBlockEvent('block-1', { type: 'block-added' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows unsubscribing a table handler', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);
      broker.unsubscribe('table-A');

      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      broker.routeBlockEvent('block-1', { type: 'block-added' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not throw when unsubscribing unknown table', () => {
      expect(() => broker.unsubscribe('unknown')).not.toThrow();
    });
  });

  describe('event routing', () => {
    it('routes block lifecycle event only to owning table subscriber', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });

      broker.routeBlockEvent('block-1', { type: 'block-added' });

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerA).toHaveBeenCalledWith('block-1', { type: 'block-added' });
      expect(handlerB).not.toHaveBeenCalled();
    });

    it('routes events to correct table with multiple tables', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-2', { tableId: 'table-B', row: 1, col: 1 });

      broker.routeBlockEvent('block-1', { type: 'block-changed' });
      broker.routeBlockEvent('block-2', { type: 'block-removed' });

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerA).toHaveBeenCalledWith('block-1', { type: 'block-changed' });
      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledWith('block-2', { type: 'block-removed' });
    });

    it('ignores unknown-owner events without heuristic claim', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // block-99 is not owned by any table
      broker.routeBlockEvent('block-99', { type: 'block-added' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores events when no subscriber exists for the owning table', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });

      // No subscriber for table-A
      expect(() => {
        broker.routeBlockEvent('block-1', { type: 'block-added' });
      }).not.toThrow();
    });

    it('passes event data through to the handler unchanged', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);
      registry.setOwner('block-1', { tableId: 'table-A', row: 2, col: 3 });

      const eventData = {
        type: 'block-changed' as const,
        detail: { reason: 'content-update' },
      };

      broker.routeBlockEvent('block-1', eventData);

      expect(handler).toHaveBeenCalledWith('block-1', eventData);
    });
  });

  describe('multi-table isolation', () => {
    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('two tables with own blocks receive only their own events', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      registry.setOwner('a1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('a2', { tableId: 'table-A', row: 0, col: 1 });
      registry.setOwner('b1', { tableId: 'table-B', row: 0, col: 0 });

      broker.routeBlockEvent('a1', { type: 'block-changed' });
      broker.routeBlockEvent('b1', { type: 'block-changed' });
      broker.routeBlockEvent('a2', { type: 'block-removed' });

      expect(handlerA).toHaveBeenCalledTimes(2);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });

    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('unsubscribing one table does not affect the other', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      broker.unsubscribe('table-A');

      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-2', { tableId: 'table-B', row: 0, col: 0 });

      broker.routeBlockEvent('block-1', { type: 'block-added' });
      broker.routeBlockEvent('block-2', { type: 'block-added' });

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe('pending block routing', () => {
    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('routes event for block that was just registered', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // Register ownership just before routing
      registry.setOwner('new-block', { tableId: 'table-A', row: 0, col: 0 });
      broker.routeBlockEvent('new-block', { type: 'block-added' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    // eslint-disable-next-line internal-unit-test/require-behavior-verification
    it('routes event to new table after ownership transfer', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      broker.routeBlockEvent('block-1', { type: 'block-changed' });

      // Transfer ownership
      registry.setOwner('block-1', { tableId: 'table-B', row: 0, col: 0 });
      broker.routeBlockEvent('block-1', { type: 'block-changed' });

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });
});
