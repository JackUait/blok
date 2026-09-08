import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import type { BlokEventMap } from '../../../../src/components/events';
import { RedactorDomChanged } from '../../../../src/components/events/RedactorDomChanged';
import { EventsDispatcher } from '../../../../src/components/utils/events';

/**
 * Mutant-killing coverage for `MutationHandler`.
 *
 * Proven-equivalent mutants (no input can distinguish them):
 *
 * - `mutationFreeAncestor !== null` replaced by `true` in the `shouldFireUpdate`
 *   return chain. The chain is `ancestor !== null AND tool !== null AND
 *   tool.contains(ancestor)`. Four cases: with a non-null ancestor both forms are
 *   the identical expression; with a null ancestor and a null tool element both
 *   yield false at the second conjunct; with a null ancestor and a real tool
 *   element the original is false and the mutant reduces to
 *   `toolElement.contains(null)`, which DOM defines as false because null is not
 *   an inclusive descendant of anything. `closest()` can only return an Element
 *   or null, so no third value reaches the call. Probed in jsdom 29.1.1:
 *   `element.contains(null)` returns false and does not throw.
 */
describe('MutationHandler mutants', () => {
  let root: HTMLElement;
  let freeZone: HTMLElement;
  let freeChild: HTMLElement;
  let freeText: Text;
  let plainZone: HTMLElement;
  let plainText: Text;
  let toolElementValue: HTMLElement | null;
  let eventBus: EventsDispatcher<BlokEventMap>;
  let handler: MutationHandler | null;

  const getToolElement = (): HTMLElement | null => toolElementValue;
  const onMutation: (mutations: MutationRecord[] | undefined) => void = vi.fn();

  /**
   * MutationRecord node lists are read with `Array.from` and by index, so a
   * plain array stands in for the live NodeList the browser would hand over.
   */
  const asNodeList = (nodes: Node[]): NodeList => nodes as unknown as NodeList;

  interface RecordParts {
    target?: Node;
    addedNodes?: Node[];
    removedNodes?: Node[];
  }

  const createRecord = (parts: RecordParts = {}): MutationRecord => ({
    type: 'childList',
    target: parts.target ?? root,
    addedNodes: asNodeList(parts.addedNodes ?? []),
    removedNodes: asNodeList(parts.removedNodes ?? []),
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  });

  const createHandler = (bus: EventsDispatcher<BlokEventMap> | null = eventBus): MutationHandler => {
    handler = new MutationHandler(getToolElement, bus, onMutation);

    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    root = document.createElement('div');
    freeZone = document.createElement('div');
    freeZone.setAttribute('data-blok-mutation-free', 'true');
    freeChild = document.createElement('span');
    freeText = document.createTextNode('inside the free zone');
    plainZone = document.createElement('div');
    plainText = document.createTextNode('outside the free zone');

    freeZone.append(freeChild, freeText);
    plainZone.append(plainText);
    root.append(freeZone, plainZone);
    document.body.append(root);

    toolElementValue = root;
    eventBus = new EventsDispatcher<BlokEventMap>();
    handler = null;
  });

  afterEach(() => {
    handler?.destroy();
    root.remove();
    vi.restoreAllMocks();
  });

  describe('unwatch', () => {
    it('leaves the bus untouched when watch was never called', () => {
      const off = vi.spyOn(eventBus, 'off');

      createHandler().unwatch();

      expect(off).not.toHaveBeenCalled();
    });

    it('removes exactly the subscription watch added', () => {
      const off = vi.spyOn(eventBus, 'off');
      const subject = createHandler();

      subject.watch();
      subject.unwatch();

      expect(off).toHaveBeenCalledTimes(1);
      expect(off).toHaveBeenCalledWith(RedactorDomChanged, expect.any(Function));
    });
  });

  describe('handleMutation branch selection', () => {
    it('reports the replacement tool root when given mutation records', () => {
      const replacement = document.createElement('div');
      const record = createRecord({ removedNodes: [root], addedNodes: [replacement] });

      const result = createHandler().handleMutation([record]);

      expect(result.newToolRoot).toBe(replacement);
    });

    it('skips root detection for a manual dispatch and for an input event', () => {
      const subject = createHandler();

      expect(subject.handleMutation(undefined).newToolRoot).toBeNull();
      expect(subject.handleMutation(new InputEvent('input')).newToolRoot).toBeNull();
    });
  });

  describe('detectToolRootChange', () => {
    it('does not read the records at all when there is no tool element', () => {
      const record = createRecord();
      let removedNodesReads = 0;

      Object.defineProperty(record, 'removedNodes', {
        get: () => {
          removedNodesReads += 1;

          return asNodeList([]);
        },
      });

      toolElementValue = null;

      const result = createHandler().detectToolRootChange([record]);

      expect(removedNodesReads).toBe(0);
      expect(result).toBeNull();
    });

    it('ignores added nodes of a record that did not remove the tool root', () => {
      const stray = document.createElement('section');
      const record = createRecord({ addedNodes: [stray], removedNodes: [] });

      expect(createHandler().detectToolRootChange([record])).toBeNull();
    });
  });

  describe('mutation-free resolution', () => {
    it('resolves a text node to its parent element', () => {
      const record = createRecord({ target: freeZone, addedNodes: [freeText] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(false);
    });

    it('prefers a text node own parent over the mutation target', () => {
      const record = createRecord({ target: freeZone, addedNodes: [plainText] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(true);
    });

    it('resolves a connected element to itself, not to the mutation target', () => {
      const record = createRecord({ target: freeZone, addedNodes: [plainZone] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(true);
    });

    it('requires every changed node to be mutation free, not just one', () => {
      const record = createRecord({ target: root, addedNodes: [freeChild] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(true);
    });

    it('fires an update when nothing in the record resolves to an element', () => {
      const detachedTarget = document.createTextNode('detached target');
      const detachedElement = document.createElement('div');
      const record = createRecord({ target: detachedTarget, addedNodes: [detachedElement] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(true);
    });

    it('fires an update when the block has no tool element to own the free zone', () => {
      toolElementValue = null;

      const record = createRecord({ target: freeZone, addedNodes: [freeChild] });

      expect(createHandler().handleMutation([record]).shouldFireUpdate).toBe(true);
    });
  });
});
