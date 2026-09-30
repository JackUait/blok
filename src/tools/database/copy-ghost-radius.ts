/**
 * A drag ghost is mounted on document.body, outside every root that defines
 * Blok's radius tokens, so it copies the corners its source actually has.
 * Longhands, so this does not depend on how an engine serializes the
 * computed shorthand.
 */
export const copyGhostRadius = (source: Element, ghost: HTMLElement): void => {
  const computed = getComputedStyle(source);
  const style = ghost.style;

  style.borderTopLeftRadius = computed.borderTopLeftRadius;
  style.borderTopRightRadius = computed.borderTopRightRadius;
  style.borderBottomRightRadius = computed.borderBottomRightRadius;
  style.borderBottomLeftRadius = computed.borderBottomLeftRadius;
};
