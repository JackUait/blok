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
