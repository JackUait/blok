/**
 * Copies the corners the source actually has onto the ghost. Longhands, so
 * this does not depend on how an engine serializes the computed shorthand.
 */
export const copyGhostRadius = (source: Element, ghost: HTMLElement): void => {
  const computed = getComputedStyle(source);
  const style = ghost.style;

  style.borderTopLeftRadius = computed.borderTopLeftRadius;
  style.borderTopRightRadius = computed.borderTopRightRadius;
  style.borderBottomRightRadius = computed.borderBottomRightRadius;
  style.borderBottomLeftRadius = computed.borderBottomLeftRadius;
};

/**
 * Mounts a drag ghost in the source's editor wrapper. Blok's tokens, font and
 * attribute rules resolve only inside it: on document.body a clone renders as
 * bare text in the host page font. The wrapper sits outside the redactor the
 * editor watches, so the ghost never counts as a block change.
 */
export const mountGhost = (source: Element, ghost: HTMLElement): void => {
  (source.closest<HTMLElement>('[data-blok-interface=blok]') ?? document.body).appendChild(ghost);
};

/**
 * Carries what a ghost loses by leaving its view: custom properties the
 * board or column sets (read from the source, which inherits them), and the
 * view's attributes. database.css repeats each attribute rule on the ghost.
 */
export const copyGhostContext = (
  source: Element,
  view: Element | null,
  ghost: HTMLElement,
  context: { properties?: string[]; attributes?: string[] }
): void => {
  const computed = getComputedStyle(source);

  for (const name of context.properties ?? []) {
    const value = computed.getPropertyValue(name);

    if (value !== '') {
      ghost.style.setProperty(name, value);
    }
  }
  for (const name of context.attributes ?? []) {
    const value = view?.getAttribute(name);

    if (value !== null && value !== undefined) {
      ghost.setAttribute(name, value);
    }
  }
};
