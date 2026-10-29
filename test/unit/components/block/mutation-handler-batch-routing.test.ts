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
