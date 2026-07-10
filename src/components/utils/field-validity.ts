/**
 * Shared invalid-state convention for text inputs, adapted from shadcn/ui's
 * `Input` (`aria-invalid` + destructive ring) and its error-message wiring.
 *
 * A field's validity is surfaced to assistive tech through two attributes:
 * - `aria-invalid="true"` on the control while its value is rejected, and
 * - `aria-describedby` pointing at the visible error element so the message is
 *   announced when the field takes focus.
 *
 * The paired CSS rule keyed on `[aria-invalid="true"]` (in `media-empty.css`,
 * shipped globally) draws the destructive ring, so callers only own the state.
 *
 * @param input - the control whose validity changed
 * @param valid - `true` clears the invalid state, `false` marks it
 * @param errorId - id of the error element to link via `aria-describedby`
 */
export function setFieldValidity(input: HTMLElement, valid: boolean, errorId?: string): void {
  if (valid) {
    input.removeAttribute('aria-invalid');
  } else {
    input.setAttribute('aria-invalid', 'true');
  }

  if (errorId === undefined) {
    return;
  }

  const tokens = (input.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((token) => token !== '' && token !== errorId);

  if (!valid) {
    tokens.push(errorId);
  }

  if (tokens.length > 0) {
    input.setAttribute('aria-describedby', tokens.join(' '));
  } else {
    input.removeAttribute('aria-describedby');
  }
}
