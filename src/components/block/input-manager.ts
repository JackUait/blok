import { Dom as $ } from '../dom';
import { SelectionUtils } from '../selection/index';

/**
 * Manages input elements within a Block.
 * Handles input discovery, caching, navigation, and focus events.
 */
export class InputManager {
  /**
   * Cached inputs for performance
   */
  private cachedInputs: HTMLElement[] = [];

  /**
   * Current focused input index
   */
  private inputIndex = 0;

  /**
   * @param holder - Block's holder element to search for inputs within
   * @param onInputEvent - Callback fired on input focus or native input change
   */
  constructor(
    private readonly holder: HTMLElement,
    private readonly onInputEvent: () => void
  ) {}

  /**
   * Find and return all editable elements (contenteditable and native inputs) in the Tool HTML
   */
  public get inputs(): HTMLElement[] {
    if (this.cachedInputs.length !== 0) {
      return this.cachedInputs;
    }

    const inputs = $.findAllInputs(this.holder);

    if (inputs.length > 0 && this.inputIndex > inputs.length - 1) {
      this.inputIndex = inputs.length - 1;
    }

    this.cachedInputs = inputs;

    return inputs;
  }

  /**
   * Return current Tool's input.
   * If Block doesn't contain inputs, return undefined.
   */
  public get currentInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex];
  }

  /**
   * Set input index to the passed element
   * @param element - HTML Element to set as current input
   */
  public set currentInput(element: HTMLElement | undefined) {
    if (element === undefined) {
      return;
    }

    const index = this.inputs.findIndex((input) => input === element || input.contains(element));

    if (index !== -1) {
      this.inputIndex = index;
    }
  }

  /**
   * Returns the current input index (for caret restoration)
   */
  public get currentInputIndex(): number {
    return this.inputIndex;
  }

  /**
   * Return first Tool's input.
   * If Block doesn't contain inputs, return undefined.
   */
  public get firstInput(): HTMLElement | undefined {
    return this.inputs[0];
  }

  /**
   * Return last Tool's input.
   * If Block doesn't contain inputs, return undefined.
   */
  public get lastInput(): HTMLElement | undefined {
    const inputs = this.inputs;

    return inputs[inputs.length - 1];
  }

  /**
   * Return next Tool's input or undefined if it doesn't exist.
   * If Block doesn't contain inputs, return undefined.
   */
  public get nextInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex + 1];
  }

  /**
   * Return previous Tool's input or undefined if it doesn't exist.
   * If Block doesn't contain inputs, return undefined.
   */
  public get previousInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex - 1];
  }

  /**
   * Update current input index with selection anchor node
   */
  public updateCurrentInput(): void {
    const anchorNode = SelectionUtils.anchorNode;
    const activeElement = document.activeElement;

    const resolveInput = (node: Node | null): HTMLElement | undefined => {
      if (!node) {
        return undefined;
      }

      const element = node instanceof HTMLElement ? node : node.parentElement;

      if (element === null) {
        return undefined;
      }

      const directMatch = this.inputs.find((input) => input === element || input.contains(element));

      if (directMatch !== undefined) {
        return directMatch;
      }

      const closestEditable = element.closest($.allInputsSelector);

      if (!(closestEditable instanceof HTMLElement)) {
        return undefined;
      }

      return this.inputs.find((input) => input === closestEditable);
    };

    if ($.isNativeInput(activeElement)) {
      this.currentInput = activeElement;

      return;
    }

    const candidateInput = resolveInput(anchorNode) ?? (activeElement instanceof HTMLElement ? resolveInput(activeElement) : undefined);

    if (candidateInput !== undefined) {
      this.currentInput = candidateInput;

      return;
    }

    if (activeElement instanceof HTMLElement && this.inputs.includes(activeElement)) {
      this.currentInput = activeElement;
    }
  }

  /**
   * Clears inputs cached value
   */
  public dropCache(): void {
    this.cachedInputs = [];
  }

  /**
   * Adds focus event listeners to all inputs and contenteditable.
   * Also adds input listeners for native inputs.
   */
  public addInputEvents(): void {
    this.inputs.forEach(input => {
      input.addEventListener('focus', this.handleFocus);

      if ($.isNativeInput(input)) {
        input.addEventListener('input', this.onInputEvent);
      }
    });
  }

  /**
   * Removes focus event listeners from all inputs and contenteditable
   */
  public removeInputEvents(): void {
    this.inputs.forEach(input => {
      input.removeEventListener('focus', this.handleFocus);

      if ($.isNativeInput(input)) {
        input.removeEventListener('input', this.onInputEvent);
      }
    });
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.removeInputEvents();
    this.cachedInputs = [];
  }

  /**
   * Handler for input focus events
   */
  private readonly handleFocus = (): void => {
    this.dropCache();
    this.updateCurrentInput();
  };
}
