/**
 * The inline annotation ("Hint") mark: a phrase that carries a plain-text note
 * and an optional subtitle. The data layer is core, so a hint survives in an
 * editor that never registered the annotation tool.
 */

/** Attribute holding the hint text. A span without a non-blank value is not an annotation. */
export const ANNOTATION_ATTR = 'data-blok-annotation';

/** Attribute holding the optional subtitle. */
export const ANNOTATION_SUBTITLE_ATTR = 'data-blok-annotation-subtitle';
