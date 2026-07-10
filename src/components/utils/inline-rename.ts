/**
 * Shared "edit-in-place" rename primitive.
 *
 * Swaps a display element (a title div/span) for a text input, commits on
 * Enter/blur with a single-commit guard, cancels on Escape (restoring the
 * original value) and — critically — restores focus to the element that is
 * swapped back in instead of dropping it to `<body>` (which is what happens
 * when `replaceWith` runs on the currently focused input).
 *
 * Consolidates three previously divergent copies in the database tool
 * (column header, view tab and board card rename).
 */
export interface StartInlineRenameParams {
  /** The display element to swap out for the input. */
  target: HTMLElement;
  /** The current value used to seed the input. */
  currentValue: string;
  /** Accessible name for the input (required — becomes `aria-label`). */
  label: string;
  /**
   * Called once when the rename is committed (Enter or blur). Receives the
   * resolved value (trimmed input, falling back to `currentValue` when empty).
   * Callers decide whether the value actually changed.
   */
  onCommit: (value: string) => void;
  /** Called once when the rename is cancelled via Escape. */
  onCancel?: () => void;
  /** Called on every keystroke with the raw input value. */
  onInput?: (value: string) => void;
  /**
   * Builds the element to swap back in once the rename ends. Receives the
   * resolved value on commit or the original value on cancel.
   */
  buildRestored: (value: string) => HTMLElement;
  /** Hook to further configure the created input (extra attributes/styles). */
  configureInput?: (input: HTMLInputElement) => void;
}

const NATIVELY_FOCUSABLE = new Set(['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);

const isNativelyFocusable = (element: HTMLElement): boolean => {
  if (NATIVELY_FOCUSABLE.has(element.tagName)) {
    return true;
  }

  return element.tagName === 'A' && element.hasAttribute('href');
};

export function startInlineRename(params: StartInlineRenameParams): void {
  const { target, currentValue, label, onCommit, onCancel, onInput, buildRestored, configureInput } = params;

  const input = document.createElement('input');

  input.type = 'text';
  input.value = currentValue;
  input.setAttribute('aria-label', label);
  configureInput?.(input);

  if (onInput !== undefined) {
    input.addEventListener('input', () => {
      onInput(input.value);
    });
  }

  const guard = { done: false };

  const swapBack = (value: string): void => {
    const restored = buildRestored(value);
    // Capture focus ownership BEFORE the swap: only pull focus back to the
    // restored element when the input still owns it (Enter / programmatic
    // commit). If focus already moved elsewhere (blur onto another control),
    // leave it there.
    const shouldRestoreFocus = document.activeElement === input;

    input.replaceWith(restored);

    if (shouldRestoreFocus) {
      if (!restored.hasAttribute('tabindex') && !isNativelyFocusable(restored)) {
        restored.setAttribute('tabindex', '-1');
      }
      restored.focus();
    }
  };

  const commit = (): void => {
    if (guard.done) {
      return;
    }
    guard.done = true;

    const resolved = input.value.trim() || currentValue;

    swapBack(resolved);
    onCommit(resolved);
  };

  const cancel = (): void => {
    if (guard.done) {
      return;
    }
    guard.done = true;

    swapBack(currentValue);
    onCancel?.();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      commit();
    } else if (event.key === 'Escape') {
      input.removeEventListener('blur', commit);
      cancel();
    }
  });

  target.replaceWith(input);
  input.focus();
  input.select();
}
