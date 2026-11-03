import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokEventMap } from '../../../../src/components/events';
import { RedactorDomChanged } from '../../../../src/components/events';
import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { isMutationBelongsToElement } from '../../../../src/components/utils/mutations';

const record = (fields: Partial<MutationRecord> & Pick<MutationRecord, 'type' | 'target'>): MutationRecord => ({
  addedNodes: [] as unknown as NodeList,
  removedNodes: [] as unknown as NodeList,
  previousSibling: null,
  nextSibling: null,
  attributeName: null,
  attributeNamespace: null,
  oldValue: null,
  ...fields,
});

const nodes = (...list: Node[]): NodeList => list as unknown as NodeList;

/**
 * Every block watches every DOM batch. A table adds a row of cell blocks per
 * drag step, so the batch must not be re-scanned once per block in the editor.
 */
describe('MutationHandler — one batch, many blocks', () => {
  let bus: EventsDispatcher<BlokEventMap>;
  let handlers: MutationHandler[];

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventsDispatcher<BlokEventMap>();
    handlers = [];
  });

  afterEach(() => {
    handlers.forEach(handler => handler.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const watch = (tool: Element): ReturnType<typeof vi.fn> => {
    const onMutation = vi.fn();
    const handler = new MutationHandler(() => tool as HTMLElement, bus, onMutation);

    handler.watch();
    handlers.push(handler);

    return onMutation;
  };

  it('hands each block exactly the records that belong to it, in order', () => {
    const table = document.createElement('div');
    const cellA = document.createElement('div');
    const cellB = document.createElement('div');
    const holderB = document.createElement('div');
    const text = document.createTextNode('hi');
    const removedTool = document.createElement('div');
    const outside = document.createElement('div');

    cellA.appendChild(text);
    holderB.appendChild(cellB);
    table.append(cellA, holderB);
    document.body.append(table, outside);

    const tools = [table, cellA, cellB, removedTool, outside];
    const mutations = [
      record({ type: 'characterData', target: text }),
      record({ type: 'attributes', target: cellB, attributeName: 'data-blok-empty' }),
      record({ type: 'attributes', target: cellB, attributeName: 'class' }),
      record({ type: 'childList', target: table, addedNodes: nodes(holderB) }),
      record({ type: 'childList', target: outside, removedNodes: nodes(removedTool) }),
      record({ type: 'childList', target: cellA, addedNodes: nodes(cellA) }),
      record({ type: 'attributes', target: document.body, attributeName: 'style' }),
    ];
    const spies = tools.map(watch);

    bus.emit(RedactorDomChanged, { mutations });

    tools.forEach((tool, index) => {
      const expected = mutations.filter(mutation => isMutationBelongsToElement(mutation, tool));

      if (expected.length === 0) {
        expect(spies[index]).not.toHaveBeenCalled();
      } else {
        expect(spies[index]).toHaveBeenCalledExactlyOnceWith(expected);
      }
    });
  });

  it('reads a record a fixed number of times however many blocks watch', () => {
    const readsFor = (blocks: number): number => {
      const tools = Array.from({ length: blocks }, () => document.body.appendChild(document.createElement('div')));
      const target = tools[0].appendChild(document.createElement('span'));
      const reads = { count: 0 };
      const counted = record({ type: 'childList', target });

      Object.defineProperty(counted, 'target', {
        get: () => {
          reads.count++;

          return target;
        },
      });

      tools.forEach(watch);
      bus.emit(RedactorDomChanged, { mutations: [counted] });
      handlers.forEach(handler => handler.destroy());
      handlers = [];

      return reads.count;
    };

    expect(readsFor(100)).toBe(readsFor(1));
  });
});

/**
 * A 100x100 table resize mounts ~10k cell blocks in one batch with ~1M
 * records. Routing must cost about one step per distinct node, not one
 * ancestor walk per record.
 */
describe('MutationHandler — routing cost of a big batch', () => {
  let bus: EventsDispatcher<BlokEventMap>;
  let handlers: MutationHandler[];

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventsDispatcher<BlokEventMap>();
    handlers = [];
  });

  afterEach(() => {
    handlers.forEach(handler => handler.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const watch = (getTool: () => HTMLElement): ReturnType<typeof vi.fn> => {
    const onMutation = vi.fn();
    const handler = new MutationHandler(getTool, bus, onMutation);

    handler.watch();
    handlers.push(handler);

    return onMutation;
  };

  it('walks each ancestor once per batch, not once per record', () => {
    const depth = 30;
    const top = Array.from({ length: depth }).reduce<HTMLElement>((parent) => {
      return parent.appendChild(document.createElement('div'));
    }, document.body);
    const table = top.appendChild(document.createElement('div'));
    const cells = Array.from({ length: 100 }, () => table.appendChild(document.createElement('div')));
    const mutations = cells.flatMap(cell => Array.from({ length: 50 }, () => record({ type: 'attributes', target: cell, attributeName: 'data-x' })));
    const tableSpy = watch(() => table);

    cells.forEach(cell => watch(() => cell));

    const parentReads = vi.spyOn(Node.prototype, 'parentNode', 'get');

    bus.emit(RedactorDomChanged, { mutations });

    // 100 cells + table + the chain above it + body/html/document.
    expect(parentReads.mock.calls.length).toBeLessThan(cells.length + depth + 10);
    expect(tableSpy).toHaveBeenCalledExactlyOnceWith(mutations);
  });

  it('still routes a record to a tool element an earlier block swapped during the same batch', () => {
    const toolA = document.body.appendChild(document.createElement('div'));
    const oldB = document.body.appendChild(document.createElement('div'));
    const newB = document.body.appendChild(document.createElement('div'));
    const state = { toolB: oldB };
    const editA = record({ type: 'attributes', target: toolA, attributeName: 'class' });
    const editB = record({ type: 'characterData', target: newB.appendChild(document.createTextNode('x')) });

    watch(() => toolA).mockImplementation(() => {
      state.toolB = newB;
    });
    const spyB = watch(() => state.toolB);

    bus.emit(RedactorDomChanged, { mutations: [editA, editB] });

    expect(spyB).toHaveBeenCalledExactlyOnceWith([editB]);
  });

  it('looks for a replaced tool root only in records that removed nodes', () => {
    const tool = document.body.appendChild(document.createElement('div'));
    const reads = { count: 0 };
    const attributeRecords = Array.from({ length: 1000 }, () => {
      const counted = record({ type: 'attributes', target: tool, attributeName: 'data-x' });

      Object.defineProperty(counted, 'removedNodes', {
        get: () => {
          reads.count++;

          return nodes();
        },
      });

      return counted;
    });
    const replacement = document.createElement('div');
    const swap = record({ type: 'childList', target: document.body, removedNodes: nodes(tool), addedNodes: nodes(replacement) });
    const handler = new MutationHandler(() => tool, null, vi.fn());

    expect(handler.detectToolRootChange([...attributeRecords, swap])).toBe(replacement);
    expect(reads.count).toBe(0);
  });
});

describe('MutationHandler — placeholder writes are not edits', () => {
  let bus: EventsDispatcher<BlokEventMap>;
  let handlers: MutationHandler[];

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventsDispatcher<BlokEventMap>();
    handlers = [];
  });

  afterEach(() => {
    handlers.forEach(handler => handler.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each(['data-blok-placeholder-active', 'data-blok-placeholder-visible'])('a container stripping %s from new cell blocks fires no block change', (attributeName) => {
    const tools = Array.from({ length: 20 }, () => document.body.appendChild(document.createElement('div')));
    const spies = tools.map((tool) => {
      const onMutation = vi.fn();
      const handler = new MutationHandler(() => tool, bus, onMutation);

      handler.watch();
      handlers.push(handler);

      return onMutation;
    });

    bus.emit(RedactorDomChanged, { mutations: tools.map(target => record({ type: 'attributes', target, attributeName })) });

    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });
});
