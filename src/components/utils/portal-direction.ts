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
 * Portals synced from a live source, so a runtime direction flip can re-read
 * them. Closed (disconnected) portals are dropped on every sync, which keeps
 * this bounded by the portals open at once.
 */
const syncedPortals = new Map<HTMLElement, Element>();

const rememberPortal = (target: HTMLElement, options: PortalDirectionOptions): void => {
  syncedPortals.forEach((_source, portal) => {
    if (portal !== target && !portal.isConnected) {
      syncedPortals.delete(portal);
    }
  });

  if (options.direction === undefined && options.source !== null && options.source !== undefined) {
    syncedPortals.set(target, options.source);
  } else {
    syncedPortals.delete(target);
  }
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
  rememberPortal(target, options);

  const resolvedDirection = options.direction ?? resolveSourceDirection(options.source);

  if (resolvedDirection === undefined) {
    return undefined;
  }

  target.setAttribute('dir', resolvedDirection);
  target.style.setProperty('direction', resolvedDirection, 'important');

  return resolvedDirection;
};

/**
 * Re-reads the direction of every open portal whose source lives in `root`.
 * Called when an editor flips direction at runtime; portals of other editors
 * are left alone. Placement is not recomputed here.
 */
export const resyncPortalDirections = (root: Element): void => {
  syncedPortals.forEach((source, portal) => {
    if (portal.isConnected && source.isConnected && root.contains(source)) {
      syncPortalDirection(portal, { source });
    }
  });
};
