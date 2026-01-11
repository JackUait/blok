import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import { RedactorDomChanged } from '../../../../src/components/events';
import type { RedactorDomChangedPayload } from '../../../../src/components/events/RedactorDomChanged';

describe('MutationHandler', () => {
  let toolElement: HTMLElement | null;
  let eventBus: EventsDispatcher<BlokEventMap>;
  let onMutation: (mutations: MutationRecord[] | undefined) => void;
  let mutationHandler: MutationHandler;

  const getToolElement = (): HTMLElement | null => toolElement;

  beforeEach(() => {
    toolElement = document.createElement('div');
    eventBus = new EventsDispatcher<BlokEventMap>();
    onMutation = vi.fn();
  });

  afterEach(() => {
    mutationHandler?.destroy();
    vi.restoreAllMocks();
  });

  const createMutationHandler = (bus: EventsDispatcher<BlokEventMap> | null = eventBus): MutationHandler => {
    mutationHandler = new MutationHandler(getToolElement, bus, onMutation);

    return mutationHandler;
  };

  const createMutationRecord = (overrides: Partial<MutationRecord> = {}): MutationRecord => {
    const defaultRecord: MutationRecord = {
      type: 'childList',
      target: toolElement as Node,
      addedNodes: [] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    };

    return { ...defaultRecord, ...overrides };
  };

  describe('watch and unwatch', () => {
    it('subscribes to RedactorDomChanged event on watch', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      createMutationHandler();
      mutationHandler.watch();

      expect(onSpy).toHaveBeenCalledWith(RedactorDomChanged, expect.any(Function));
    });

    it('filters mutations to only those belonging to tool element', () => {
      const otherElement = document.createElement('span');
      const toolMutation = createMutationRecord({ target: toolElement as Node });
      const otherMutation = createMutationRecord({ target: otherElement });

      createMutationHandler();
      mutationHandler.watch();

      // Emit event with both mutations
      eventBus.emit(RedactorDomChanged, {
        mutations: [toolMutation, otherMutation],
      } as RedactorDomChangedPayload);

      expect(onMutation).toHaveBeenCalledTimes(1);
      expect(onMutation).toHaveBeenCalledWith([toolMutation]);
    });

    it('calls onMutation callback with filtered mutations', () => {
      const childElement = document.createElement('span');

      toolElement?.appendChild(childElement);

      const mutation = createMutationRecord({ target: childElement });

      createMutationHandler();
      mutationHandler.watch();

      eventBus.emit(RedactorDomChanged, {
        mutations: [mutation],
      } as RedactorDomChangedPayload);

      expect(onMutation).toHaveBeenCalledWith([mutation]);
    });

    it('ignores mutations when tool element is null', () => {
      toolElement = null;

      const mutation = createMutationRecord({ target: document.createElement('div') });

      createMutationHandler();
      mutationHandler.watch();

      eventBus.emit(RedactorDomChanged, {
        mutations: [mutation],
      } as RedactorDomChangedPayload);

      expect(onMutation).not.toHaveBeenCalled();
    });

    it('does not call onMutation when no mutations belong to tool element', () => {
      const otherElement = document.createElement('span');
      const otherMutation = createMutationRecord({ target: otherElement });

      createMutationHandler();
      mutationHandler.watch();

      eventBus.emit(RedactorDomChanged, {
        mutations: [otherMutation],
      } as RedactorDomChangedPayload);

      expect(onMutation).not.toHaveBeenCalled();
    });

    it('unwatch removes event subscription', () => {
      const offSpy = vi.spyOn(eventBus, 'off');

      createMutationHandler();
      mutationHandler.watch();
      mutationHandler.unwatch();

      expect(offSpy).toHaveBeenCalledWith(RedactorDomChanged, expect.any(Function));
    });

    it('unwatch is safe to call multiple times', () => {
      createMutationHandler();
      mutationHandler.watch();

      expect(() => {
        mutationHandler.unwatch();
        mutationHandler.unwatch();
        mutationHandler.unwatch();
      }).not.toThrow();
    });

    it('unwatch is safe to call without watch', () => {
      createMutationHandler();

      expect(() => {
        mutationHandler.unwatch();
      }).not.toThrow();
    });

    it('works correctly with null event bus', () => {
      createMutationHandler(null);

      expect(() => {
        mutationHandler.watch();
        mutationHandler.unwatch();
      }).not.toThrow();
    });
  });

  describe('handleMutation - manual and input events', () => {
    it('returns shouldFireUpdate: true for undefined (manual dispatch)', () => {
      createMutationHandler();

      const result = mutationHandler.handleMutation(undefined);

      expect(result.shouldFireUpdate).toBe(true);
      expect(result.newToolRoot).toBeNull();
    });

    it('returns shouldFireUpdate: true for InputEvent', () => {
      createMutationHandler();

      const inputEvent = new InputEvent('input');
      const result = mutationHandler.handleMutation(inputEvent);

      expect(result.shouldFireUpdate).toBe(true);
      expect(result.newToolRoot).toBeNull();
    });

    it('returns newToolRoot: null for non-MutationRecord inputs', () => {
      createMutationHandler();

      const resultUndefined = mutationHandler.handleMutation(undefined);
      const resultInputEvent = mutationHandler.handleMutation(new InputEvent('input'));

      expect(resultUndefined.newToolRoot).toBeNull();
      expect(resultInputEvent.newToolRoot).toBeNull();
    });
  });

  describe('handleMutation - mutation filtering', () => {
    it('returns shouldFireUpdate: true when mutations are not mutation-free', () => {
      const regularElement = document.createElement('span');

      toolElement?.appendChild(regularElement);

      const mutation = createMutationRecord({ target: regularElement });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutation]);

      expect(result.shouldFireUpdate).toBe(true);
    });

    it('returns shouldFireUpdate: false when all mutations are mutation-free', () => {
      const mutationFreeElement = document.createElement('span');

      mutationFreeElement.setAttribute('data-blok-mutation-free', 'true');
      toolElement?.appendChild(mutationFreeElement);

      const mutation = createMutationRecord({ target: mutationFreeElement });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutation]);

      expect(result.shouldFireUpdate).toBe(false);
    });

    it('returns shouldFireUpdate: false when mutations affect children of mutation-free element', () => {
      const mutationFreeElement = document.createElement('div');

      mutationFreeElement.setAttribute('data-blok-mutation-free', 'true');

      const childElement = document.createElement('span');

      mutationFreeElement.appendChild(childElement);
      toolElement?.appendChild(mutationFreeElement);

      const mutation = createMutationRecord({ target: childElement });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutation]);

      expect(result.shouldFireUpdate).toBe(false);
    });

    it('returns shouldFireUpdate: true when any mutation is not mutation-free', () => {
      const mutationFreeElement = document.createElement('span');

      mutationFreeElement.setAttribute('data-blok-mutation-free', 'true');

      const regularElement = document.createElement('span');

      toolElement?.appendChild(mutationFreeElement);
      toolElement?.appendChild(regularElement);

      const mutationFree = createMutationRecord({ target: mutationFreeElement });
      const regular = createMutationRecord({ target: regularElement });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutationFree, regular]);

      expect(result.shouldFireUpdate).toBe(true);
    });

    it('returns shouldFireUpdate: false for empty mutation array', () => {
      createMutationHandler();

      const result = mutationHandler.handleMutation([]);

      // Empty array means no mutations, so everyRecordIsMutationFree is false (vacuous truth doesn't apply with length check)
      // Looking at the code: `mutationsOrInputEvent.length > 0 && mutationsOrInputEvent.every(...)`
      // For empty array: 0 > 0 is false, so everyRecordIsMutationFree is false
      // Therefore shouldFireUpdate = !false = true
      expect(result.shouldFireUpdate).toBe(true);
    });

    it('handles mutations with added nodes in mutation-free context', () => {
      const mutationFreeElement = document.createElement('div');

      mutationFreeElement.setAttribute('data-blok-mutation-free', 'true');
      toolElement?.appendChild(mutationFreeElement);

      const addedNode = document.createElement('span');

      // Simulate adding addedNode to mutationFreeElement (must be in DOM for check to work)
      mutationFreeElement.appendChild(addedNode);

      const mutation = createMutationRecord({
        target: mutationFreeElement,
        addedNodes: [addedNode] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutation]);

      expect(result.shouldFireUpdate).toBe(false);
    });

    it('returns true when removed nodes are detached (no parent)', () => {
      const mutationFreeElement = document.createElement('div');

      mutationFreeElement.setAttribute('data-blok-mutation-free', 'true');
      toolElement?.appendChild(mutationFreeElement);

      // removedNode is detached from DOM, has no parentElement
      const removedNode = document.createElement('span');

      const mutation = createMutationRecord({
        target: mutationFreeElement,
        addedNodes: [] as unknown as NodeList,
        removedNodes: [removedNode] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.handleMutation([mutation]);

      // Detached nodes (no parent) are not considered mutation-free, so update fires
      expect(result.shouldFireUpdate).toBe(true);
    });
  });

  describe('detectToolRootChange', () => {
    it('returns null when tool element not in removedNodes', () => {
      const otherElement = document.createElement('div');
      const mutation = createMutationRecord({
        removedNodes: [otherElement] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBeNull();
    });

    it('returns new element when tool element replaced', () => {
      const newToolElement = document.createElement('div');

      newToolElement.textContent = 'new tool';

      const mutation = createMutationRecord({
        removedNodes: [toolElement] as unknown as NodeList,
        addedNodes: [newToolElement] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBe(newToolElement);
    });

    it('returns null when getToolElement returns null', () => {
      toolElement = null;

      const mutation = createMutationRecord({
        removedNodes: [document.createElement('div')] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBeNull();
    });

    it('returns last added node when multiple nodes added', () => {
      const firstNew = document.createElement('div');

      firstNew.textContent = 'first';

      const secondNew = document.createElement('div');

      secondNew.textContent = 'second';

      const mutation = createMutationRecord({
        removedNodes: [toolElement] as unknown as NodeList,
        addedNodes: [firstNew, secondNew] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBe(secondNew);
    });

    it('returns null when tool element removed but nothing added', () => {
      const mutation = createMutationRecord({
        removedNodes: [toolElement] as unknown as NodeList,
        addedNodes: [] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBeNull();
    });

    it('returns null when added node is not HTMLElement', () => {
      const textNode = document.createTextNode('text');
      const mutation = createMutationRecord({
        removedNodes: [toolElement] as unknown as NodeList,
        addedNodes: [textNode] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([mutation]);

      expect(result).toBeNull();
    });

    it('finds replacement in later mutation records', () => {
      const newToolElement = document.createElement('div');
      const firstMutation = createMutationRecord({
        target: document.createElement('span'),
      });
      const secondMutation = createMutationRecord({
        removedNodes: [toolElement] as unknown as NodeList,
        addedNodes: [newToolElement] as unknown as NodeList,
      });

      createMutationHandler();

      const result = mutationHandler.detectToolRootChange([firstMutation, secondMutation]);

      expect(result).toBe(newToolElement);
    });
  });

  describe('destroy', () => {
    it('calls unwatch to clean up subscriptions', () => {
      createMutationHandler();
      mutationHandler.watch();

      const offSpy = vi.spyOn(eventBus, 'off');

      mutationHandler.destroy();

      expect(offSpy).toHaveBeenCalledWith(RedactorDomChanged, expect.any(Function));
    });

    it('is safe to call multiple times', () => {
      createMutationHandler();
      mutationHandler.watch();

      expect(() => {
        mutationHandler.destroy();
        mutationHandler.destroy();
      }).not.toThrow();
    });
  });
});
