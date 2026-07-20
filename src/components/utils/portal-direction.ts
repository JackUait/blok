export type TextDirection = 'ltr' | 'rtl';

interface PortalDirectionOptions {
  /**
   * Editor direction already resolved from configuration. When present, this
   * wins over the source element (locale direction can be explicitly
   * overridden by consumers).
   */
  direction?: TextDirection;

  /**
   * Live element that owns the detached UI root.
   */
  source?: Element | null;
}

const isTextDirection = (value: string | null | undefined): value is TextDirection =>
  value === 'ltr' || value === 'rtl';

const resolveSemanticDirection = (element: Element | null): TextDirection | undefined => {
  if (element === null) {
    return undefined;
  }

  const semanticDirection = element.getAttribute('dir');

  return isTextDirection(semanticDirection)
    ? semanticDirection
    : resolveSemanticDirection(element.parentElement);
};

/**
 * Reads the effective direction of an editor-owned element.
 *
 * Computed style is authoritative because it includes the editor's configured
 * direction override. The `dir` walk is a fallback for detached DOM and test
 * environments that do not fully resolve inherited presentation hints.
 */
const resolveSourceDirection = (source: Element | null | undefined): TextDirection | undefined => {
  if (source === null || source === undefined) {
    return undefined;
  }

  const computedDirection = window.getComputedStyle(source).direction;

  if (isTextDirection(computedDirection)) {
    return computedDirection;
  }

  return resolveSemanticDirection(source);
};

/**
 * Carries an editor's effective direction onto a root that is detached from
 * the editor ancestry (body portal, CSS Top Layer, or reset nested popover).
 *
 * Both forms are intentional:
 * - `dir` supplies semantic base direction to descendants and assistive tech;
 * - inline `direction: … !important` beats Blok's isolation reset, whose
 *   author-level `direction: initial !important` would otherwise force LTR.
 *
 * The helper is safe to call for every open. If no owner can be resolved it
 * leaves the target untouched rather than guessing from the host document.
 */
export const syncPortalDirection = (
  target: HTMLElement,
  options: PortalDirectionOptions = {}
): TextDirection | undefined => {
  const resolvedDirection = options.direction ?? resolveSourceDirection(options.source);

  if (resolvedDirection === undefined) {
    return undefined;
  }

  target.setAttribute('dir', resolvedDirection);
  target.style.setProperty('direction', resolvedDirection, 'important');

  return resolvedDirection;
};
