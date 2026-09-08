import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../../../../src/components/block/input-manager';
import { SelectionUtils } from '../../../../src/components/selection';

/**
 * Mutation-hardening suite for InputManager.
 *
 * Two facts drive every equivalence claim below.
 *
 * FACT 1 — the direct match already covers every ancestor.
 * `resolveInput` first runs `inputs.find((i) => i === el || i.contains(el))`.
 * `Node.contains` is inclusive, so that predicate matches EVERY inclusive
 * ancestor of `el` that is in the list. Both later lookups can only ever name
 * an inclusive ancestor of `el`: `el.closest(sel)` walks up from `el`, and
 * `inputs.includes(activeElement)` needs the element itself. So if either of
 * them could produce a hit, the first find already produced one. Both `find`
 * calls read the same array: the `inputs` getter caches, and when the cache is
 * empty the recomputed list is empty too, so both finds return undefined.
 * Therefore lines 136-142 (the `closest` fallback) and lines 159-161 (the
 * `activeElement` fallback) can never change the outcome — dead code.
 *
 * FACT 2 — `inputIndex` is a plain private field, no accessor. Assigning it a
 * value it already holds is a no-op with no side effect.
 *
 * PROVEN EQUIVALENT, nothing at all differs (6 mutants)
 * - L38 `this.inputIndex >= inputs.length - 1`: the two operators differ only
 *   when `inputIndex === inputs.length - 1`, and there the mutated branch
 *   assigns that same value back (FACT 2).
 * - L64 and L130 `input === element` -> `false`: `element.contains(element)` is
 *   true, so the remaining arm still matches the identity case (FACT 1).
 * - L142 `find` arrow -> `() => undefined`, and its predicate -> `false`: the
 *   fallback already returns undefined for every input (FACT 1).
 * - L159 block -> `{}`: the block is unreachable (FACT 1).
 *
 * EQUIVALENT IN BEHAVIOUR (7 mutants), distinguishable only by counting how
 * many times the dead paths read the `inputs` getter. That read re-calls
 * `Dom.findAllInputs` only while the block has zero inputs — with any input at
 * all the earlier direct-match read has already filled the cache — and it then
 * returns the same empty array, so no state and no return value differs:
 * - L132 `if (directMatch !== undefined)` -> `true`
 * - L138 all four mutants of the `closestEditable instanceof HTMLElement` guard
 * - L153 `if (candidateInput !== undefined)` -> `true`
 * - L159 condition -> `false`
 */
describe('InputManager mutants', () => {
  let holder: HTMLElement;
  let onInputEvent: () => void;
  let manager: InputManager | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    onInputEvent = vi.fn();
  });

  afterEach(() => {
    manager?.destroy();
    manager = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const createManager = (): InputManager => {
    manager = new InputManager(holder, onInputEvent);

    return manager;
  };

  const createContentEditable = (text = ''): HTMLDivElement => {
    const element = document.createElement('div');

    element.setAttribute('contenteditable', 'true');
    element.textContent = text;

    return element;
  };

  /**
   * A contenteditable holding block children: `findAllInputs` then reports the
   * deepest block elements, so the wrapper itself is NOT one of the inputs even
   * though it is the only node matching the editable selector.
   */
  const createNestedInputs = (): {
    wrapper: HTMLDivElement;
    first: HTMLDivElement;
    second: HTMLDivElement;
    span: HTMLSpanElement;
    textNode: Text;
  } => {
    const wrapper = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    const span = document.createElement('span');
    const textNode = document.createTextNode('second');

    wrapper.setAttribute('contenteditable', 'true');
    first.textContent = 'first';
    span.appendChild(textNode);
    second.appendChild(span);
    wrapper.append(first, second);
    holder.appendChild(wrapper);

    return {
      wrapper,
      first,
      second,
      span,
      textNode,
    };
  };

  describe('inputs getter', () => {
    it('keeps the index at zero when re-discovery finds nothing', () => {
      const editable = createContentEditable('a');

      holder.appendChild(editable);

      const inputManager = createManager();

      expect(inputManager.inputs).toHaveLength(1);

      editable.remove();
      inputManager.dropCache();

      expect(inputManager.inputs).toEqual([]);
      expect(inputManager.currentInputIndex).toBe(0);
    });
  });

  describe('currentInput setter', () => {
    it('assigning undefined never re-reads the inputs', () => {
      const first = createContentEditable('1');
      const second = createContentEditable('2');
      const third = createContentEditable('3');

      holder.append(first, second, third);

      const inputManager = createManager();

      inputManager.currentInput = third;
      expect(inputManager.currentInputIndex).toBe(2);

      second.remove();
      third.remove();
      inputManager.dropCache();

      inputManager.currentInput = undefined;

      expect(inputManager.currentInputIndex).toBe(2);
    });

    it('assigning a descendant selects the input that holds it', () => {
      const first = createContentEditable('1');
      const second = createContentEditable();
      const child = document.createElement('span');

      second.appendChild(child);
      holder.append(first, second);

      const inputManager = createManager();

      inputManager.currentInput = child;

      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('contains() reports an element as its own descendant', () => {
      const element = document.createElement('div');

      expect(element.contains(element)).toBe(true);
    });
  });

  describe('updateCurrentInput', () => {
    it('survives a selection anchor with no parent element', () => {
      const first = createContentEditable('1');
      const second = createContentEditable('2');

      holder.append(first, second);

      const inputManager = createManager();

      second.focus();
      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(document.createTextNode('orphan'));

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(second);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('resolves a nested span to the deepest block input containing it', () => {
      const { first, second, textNode } = createNestedInputs();
      const inputManager = createManager();

      expect(inputManager.inputs).toEqual([first, second]);

      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(textNode);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(second);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('keeps the current input when the anchor is the wrapper above the inputs', () => {
      const { wrapper, second } = createNestedInputs();
      const inputManager = createManager();

      inputManager.currentInput = second;
      expect(inputManager.currentInputIndex).toBe(1);

      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(wrapper);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInputIndex).toBe(1);
      expect(inputManager.currentInput).toBe(second);
    });

    it('prefers a focused native input over the selection anchor', () => {
      const editable = createContentEditable();
      const textNode = document.createTextNode('text');
      const nativeInput = document.createElement('input');

      editable.appendChild(textNode);
      holder.append(editable, nativeInput);

      const inputManager = createManager();

      expect(inputManager.inputs).toEqual([editable, nativeInput]);

      nativeInput.focus();
      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(textNode);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(nativeInput);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('leaves a stale index alone when nothing is focused', () => {
      const first = createContentEditable('1');
      const second = createContentEditable('2');
      const third = createContentEditable('3');

      holder.append(first, second, third);

      const inputManager = createManager();

      inputManager.currentInput = third;
      expect(inputManager.currentInputIndex).toBe(2);

      second.remove();
      third.remove();
      inputManager.dropCache();

      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(null);
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
      expect(document.activeElement).toBeNull();

      inputManager.updateCurrentInput();

      expect(inputManager.currentInputIndex).toBe(2);
    });
  });

  describe('removeInputEvents', () => {
    it('does not remove an input listener from a contenteditable', () => {
      const editable = createContentEditable('1');
      const nativeInput = document.createElement('input');

      holder.append(editable, nativeInput);

      const inputManager = createManager();

      inputManager.addInputEvents();

      const editableSpy = vi.spyOn(editable, 'removeEventListener');

      inputManager.removeInputEvents();

      expect(editableSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(editableSpy).not.toHaveBeenCalledWith('input', expect.any(Function));
    });
  });

  describe('focus handler', () => {
    it('drops the cache so a detached input leaves the list', () => {
      const first = createContentEditable('1');
      const second = createContentEditable('2');

      holder.append(first, second);

      const inputManager = createManager();

      inputManager.addInputEvents();
      expect(inputManager.inputs).toEqual([first, second]);

      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(null);
      first.remove();
      second.focus();

      expect(inputManager.inputs).not.toContain(first);
      expect(inputManager.currentInputIndex).toBe(0);
    });
  });
});
