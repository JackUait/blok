/**
 * Spacer's static presentational classes — the single source of truth for both
 * `src/tools/spacer/index.ts` and the view emitter.
 *
 * `group/spacer` is deliberately EXCLUDED: it paints nothing, existing only to
 * enable `group-hover/spacer:` rules on the resize grips and px readout, none of
 * which a static view renders.
 *
 * The spacer's actual size is an INLINE height, not a class — never encode it
 * here.
 *
 * CAVEAT: the golden harness has no spacer fixture (a spacer carries no content
 * on either side, so there is nothing for its host-pairing to compare), which
 * means these classes are NOT covered by the class-parity gate. The
 * visual-regression spec is what verifies them.
 */
export const SPACER_WRAPPER_CLASSES: readonly string[] = ['relative', 'rounded-md'];
