import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../../../../src/components/block/input-manager';
import { Dom as $ } from '../../../../src/components/dom';
import { SelectionUtils } from '../../../../src/components/selection';

describe('InputManager', () => {
  let holder: HTMLElement;
  let onInputEvent: () => void;
  let inputManager: InputManager;

  beforeEach(() => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
    onInputEvent = vi.fn();
  });

  afterEach(() => {
    inputManager?.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const createInputManager = (): InputManager => {
    inputManager = new InputManager(holder, onInputEvent);

    return inputManager;
  };

  const createContentEditable = (): HTMLDivElement => {
    const el = document.createElement('div');

    el.setAttribute('contenteditable', 'true');

    return el;
  };

  const createNativeInput = (): HTMLInputElement => {
    return document.createElement('input');
  };

  const createTextarea = (): HTMLTextAreaElement => {
    return document.createElement('textarea');
  };

  describe('inputs getter', () => {
    it('returns empty array when holder has no editable elements', () => {
      createInputManager();

      expect(inputManager.inputs).toEqual([]);
    });

    it('finds contenteditable elements', () => {
      const contentEditable = createContentEditable();

      holder.appendChild(contentEditable);
      createInputManager();

      expect(inputManager.inputs).toContain(contentEditable);
      expect(inputManager.inputs).toHaveLength(1);
    });

    it('finds native input elements', () => {
      const input = createNativeInput();

      holder.appendChild(input);
      createInputManager();

      expect(inputManager.inputs).toContain(input);
    });

    it('finds textarea elements', () => {
      const textarea = createTextarea();

      holder.appendChild(textarea);
      createInputManager();

      expect(inputManager.inputs).toContain(textarea);
    });

    it('finds multiple editable elements', () => {
      const contentEditable = createContentEditable();
      const input = createNativeInput();
      const textarea = createTextarea();

      holder.appendChild(contentEditable);
      holder.appendChild(input);
      holder.appendChild(textarea);
      createInputManager();

      expect(inputManager.inputs).toHaveLength(3);
      expect(inputManager.inputs).toContain(contentEditable);
      expect(inputManager.inputs).toContain(input);
      expect(inputManager.inputs).toContain(textarea);
    });

    it('returns cached array on subsequent calls', () => {
      const contentEditable = createContentEditable();

      holder.appendChild(contentEditable);
      createInputManager();

      const firstCall = inputManager.inputs;
      const secondCall = inputManager.inputs;

      expect(firstCall).toBe(secondCall);
    });

    it('adjusts inputIndex when cache reveals fewer inputs than current index', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();
      const input3 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      holder.appendChild(input3);
      createInputManager();

      // Set current input to third element (index 2)
      inputManager.currentInput = input3;
      expect(inputManager.currentInputIndex).toBe(2);

      // Remove last two inputs and drop cache
      holder.removeChild(input2);
      holder.removeChild(input3);
      inputManager.dropCache();

      // Now there's only one input, index should be adjusted
      expect(inputManager.inputs).toHaveLength(1);
      expect(inputManager.currentInputIndex).toBe(0);
    });
  });

  describe('currentInput getter/setter', () => {
    it('returns undefined when no inputs exist', () => {
      createInputManager();

      expect(inputManager.currentInput).toBeUndefined();
    });

    it('returns first input by default (index 0)', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      expect(inputManager.currentInput).toBe(input1);
    });

    it('setting currentInput updates index to matching element', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      inputManager.currentInput = input2;

      expect(inputManager.currentInput).toBe(input2);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('setting currentInput to element containing child updates index', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();
      const child = document.createElement('span');

      input2.appendChild(child);
      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      // Set using the child element
      inputManager.currentInput = child;

      expect(inputManager.currentInput).toBe(input2);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('setting undefined does nothing', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      inputManager.currentInput = input2;
      inputManager.currentInput = undefined;

      // Should remain at index 1
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('setting non-matching element does nothing', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();
      const unrelated = document.createElement('div');

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      inputManager.currentInput = input2;
      inputManager.currentInput = unrelated;

      // Should remain at index 1
      expect(inputManager.currentInputIndex).toBe(1);
    });
  });

  describe('currentInputIndex getter', () => {
    it('returns 0 by default', () => {
      createInputManager();

      expect(inputManager.currentInputIndex).toBe(0);
    });

    it('returns updated index after setting currentInput', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();
      const input3 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      holder.appendChild(input3);
      createInputManager();

      inputManager.currentInput = input3;

      expect(inputManager.currentInputIndex).toBe(2);
    });
  });

  describe('navigation properties', () => {
    describe('firstInput', () => {
      it('returns first input', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        createInputManager();

        expect(inputManager.firstInput).toBe(input1);
      });

      it('returns undefined when no inputs', () => {
        createInputManager();

        expect(inputManager.firstInput).toBeUndefined();
      });
    });

    describe('lastInput', () => {
      it('returns last input', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();
        const input3 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        holder.appendChild(input3);
        createInputManager();

        expect(inputManager.lastInput).toBe(input3);
      });

      it('returns undefined when no inputs', () => {
        createInputManager();

        expect(inputManager.lastInput).toBeUndefined();
      });
    });

    describe('nextInput', () => {
      it('returns input at index+1', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();
        const input3 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        holder.appendChild(input3);
        createInputManager();

        expect(inputManager.nextInput).toBe(input2);

        inputManager.currentInput = input2;

        expect(inputManager.nextInput).toBe(input3);
      });

      it('returns undefined when at last input', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        createInputManager();

        inputManager.currentInput = input2;

        expect(inputManager.nextInput).toBeUndefined();
      });
    });

    describe('previousInput', () => {
      it('returns input at index-1', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();
        const input3 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        holder.appendChild(input3);
        createInputManager();

        inputManager.currentInput = input3;

        expect(inputManager.previousInput).toBe(input2);
      });

      it('returns undefined when at first input', () => {
        const input1 = createContentEditable();
        const input2 = createContentEditable();

        holder.appendChild(input1);
        holder.appendChild(input2);
        createInputManager();

        expect(inputManager.previousInput).toBeUndefined();
      });
    });
  });

  describe('updateCurrentInput', () => {
    it('updates index from native input activeElement', () => {
      const input1 = createContentEditable();
      const nativeInput = createNativeInput();

      holder.appendChild(input1);
      holder.appendChild(nativeInput);
      createInputManager();

      // Focus the native input
      nativeInput.focus();

      // Mock isNativeInput to return true for our input
      const isNativeInputSpy = vi.spyOn($, 'isNativeInput');

      isNativeInputSpy.mockImplementation((el) => el === nativeInput);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(nativeInput);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('updates index from selection anchorNode', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();
      const textNode = document.createTextNode('some text');

      input2.appendChild(textNode);
      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      // Mock the anchorNode to return our text node
      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(textNode);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(input2);
      expect(inputManager.currentInputIndex).toBe(1);
    });

    it('handles activeElement that is an input in our list', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      // Focus input2
      input2.focus();

      // Mock anchorNode to return null so it falls back to activeElement
      vi.spyOn(SelectionUtils, 'anchorNode', 'get').mockReturnValue(null);

      inputManager.updateCurrentInput();

      expect(inputManager.currentInput).toBe(input2);
    });
  });

  describe('dropCache', () => {
    it('clears cached inputs forcing re-discovery', () => {
      const input1 = createContentEditable();

      holder.appendChild(input1);
      createInputManager();

      const firstInputs = inputManager.inputs;

      // Add another input
      const input2 = createContentEditable();

      holder.appendChild(input2);

      // Without dropping cache, should return same array
      expect(inputManager.inputs).toBe(firstInputs);
      expect(inputManager.inputs).toHaveLength(1);

      // Drop cache and verify new input is discovered
      inputManager.dropCache();

      const newInputs = inputManager.inputs;

      expect(newInputs).not.toBe(firstInputs);
      expect(newInputs).toHaveLength(2);
      expect(newInputs).toContain(input2);
    });
  });

  describe('event handling', () => {
    it('addInputEvents adds focus listeners to all inputs', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      const addEventListenerSpy1 = vi.spyOn(input1, 'addEventListener');
      const addEventListenerSpy2 = vi.spyOn(input2, 'addEventListener');

      inputManager.addInputEvents();

      expect(addEventListenerSpy1).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(addEventListenerSpy2).toHaveBeenCalledWith('focus', expect.any(Function));
    });

    it('addInputEvents adds input listeners to native inputs only', () => {
      const contentEditable = createContentEditable();
      const nativeInput = createNativeInput();

      holder.appendChild(contentEditable);
      holder.appendChild(nativeInput);
      createInputManager();

      const contentEditableSpy = vi.spyOn(contentEditable, 'addEventListener');
      const nativeInputSpy = vi.spyOn(nativeInput, 'addEventListener');

      inputManager.addInputEvents();

      // contenteditable should only have focus listener
      expect(contentEditableSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(contentEditableSpy).not.toHaveBeenCalledWith('input', expect.any(Function));

      // native input should have both focus and input listeners
      expect(nativeInputSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(nativeInputSpy).toHaveBeenCalledWith('input', expect.any(Function));
    });

    it('removeInputEvents removes all added listeners', () => {
      const contentEditable = createContentEditable();
      const nativeInput = createNativeInput();

      holder.appendChild(contentEditable);
      holder.appendChild(nativeInput);
      createInputManager();

      inputManager.addInputEvents();

      const contentEditableSpy = vi.spyOn(contentEditable, 'removeEventListener');
      const nativeInputSpy = vi.spyOn(nativeInput, 'removeEventListener');

      inputManager.removeInputEvents();

      expect(contentEditableSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(nativeInputSpy).toHaveBeenCalledWith('focus', expect.any(Function));
      expect(nativeInputSpy).toHaveBeenCalledWith('input', expect.any(Function));
    });

    it('focus event triggers cache drop and updateCurrentInput', () => {
      const input1 = createContentEditable();
      const input2 = createContentEditable();

      holder.appendChild(input1);
      holder.appendChild(input2);
      createInputManager();

      inputManager.addInputEvents();

      // Verify initial state
      expect(inputManager.currentInput).toBe(input1);

      // Trigger focus on second input
      input2.focus();
      input2.dispatchEvent(new FocusEvent('focus'));

      // The focus handler should have been called
      // It drops cache and updates current input based on active element
      expect(inputManager.currentInput).toBe(input2);
    });

    it('native input change triggers onInputEvent callback', () => {
      const nativeInput = createNativeInput();

      holder.appendChild(nativeInput);
      createInputManager();

      inputManager.addInputEvents();

      // Trigger input event on native input
      nativeInput.dispatchEvent(new Event('input'));

      expect(onInputEvent).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes event listeners', () => {
      const input = createContentEditable();

      holder.appendChild(input);
      createInputManager();

      inputManager.addInputEvents();

      const removeEventListenerSpy = vi.spyOn(input, 'removeEventListener');

      inputManager.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    });

    it('clears the cached inputs array', () => {
      const input = createContentEditable();

      holder.appendChild(input);
      createInputManager();

      // Populate cache
      const cachedInputs = inputManager.inputs;

      expect(cachedInputs).toHaveLength(1);

      // Remove the input from DOM so re-discovery finds nothing
      holder.removeChild(input);

      // Before destroy, cache still holds old value
      expect(inputManager.inputs).toBe(cachedInputs);

      inputManager.destroy();

      // After destroy, cache is cleared and re-discovery finds nothing
      expect(inputManager.inputs).toHaveLength(0);
    });
  });
});
