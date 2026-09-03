/**
 * Who a peer is when they published no name.
 *
 * `collaboration.user` is optional, so an unnamed peer is the default room and
 * not an edge case. Google Docs answers that with an animal; Blok answers it
 * with a space silhouette and a localized label, drawn from the awareness
 * client id alone. Nothing new goes on the wire: every browser derives the
 * same silhouette for the same person the way `presenceColorFor` derives their
 * colour.
 */

/**
 * The silhouettes, in slot order.
 *
 * Three lists move together and must stay in step: this one, the
 * `[data-blok-presence-glyph]` rules in src/styles/presence.css, and the
 * labels in ANONYMOUS_LABEL_KEYS. Reordering it renames everyone currently in
 * a room, which is harmless but visible — append rather than insert.
 */
export const ANONYMOUS_GLYPHS = [
  'astronaut',
  'rocket',
  'comet',
  'satellite',
  'planet',
  'moon',
  'star',
  'sun',
  'telescope',
  'galaxy',
  'saucer',
  'asteroid',
] as const;

/** The silhouette for a peer the list could not name. */
export const UNKNOWN_GLYPH = 'unknown';

export type AnonymousGlyph = (typeof ANONYMOUS_GLYPHS)[number] | typeof UNKNOWN_GLYPH;

/**
 * The label each silhouette is drawn with.
 *
 * Whole phrases, one key per silhouette, NEVER an adjective composed with a
 * noun at runtime: "Anonymous Comet" agrees in gender in every language that
 * has one, and a template would make that agreement impossible to translate.
 * Written as literals so the i18n lifecycle scan classifies them.
 */
export const ANONYMOUS_LABEL_KEYS: Record<AnonymousGlyph, string> = {
  astronaut: 'presence.anonymous.astronaut',
  rocket: 'presence.anonymous.rocket',
  comet: 'presence.anonymous.comet',
  satellite: 'presence.anonymous.satellite',
  planet: 'presence.anonymous.planet',
  moon: 'presence.anonymous.moon',
  star: 'presence.anonymous.star',
  sun: 'presence.anonymous.sun',
  telescope: 'presence.anonymous.telescope',
  galaxy: 'presence.anonymous.galaxy',
  saucer: 'presence.anonymous.saucer',
  asteroid: 'presence.anonymous.asteroid',
  unknown: 'presence.anonymous.unknown',
};

/**
 * The slot a client id names on its own, before anyone contests it.
 *
 * Awareness client ids are random 32-bit numbers, so the modulo is already
 * uniform across the list. `abs` and `trunc` because the id reaches this from
 * an awareness map another browser can populate.
 * @param clientId - awareness client id
 */
const baseSlot = (clientId: number): number =>
  Math.abs(Math.trunc(clientId)) % ANONYMOUS_GLYPHS.length;

/**
 * Hand every anonymous peer a silhouette, with no two peers sharing one.
 *
 * A plain modulo would collide often — twelve silhouettes and five peers is a
 * coin flip — and two identical faces in one room name nobody. So a contested
 * slot goes to the LOWEST client id and everyone else steps to the next free
 * one, wrapping. The pass sorts first, which is what makes the result the same
 * in every browser: awareness map order is insertion order, and no two clients
 * see the room fill in the same order.
 *
 * Past the twelfth peer the list is spent and the rest share the unnamed
 * silhouette — a face that says "somebody" is still better than a duplicate
 * that says the wrong somebody.
 * @param clientIds - the anonymous peers this pass will draw
 */
export const assignAnonymousGlyphs = (clientIds: Iterable<number>): Map<number, AnonymousGlyph> => {
  const assigned = new Map<number, AnonymousGlyph>();
  const taken = new Set<number>();
  const ordered = [...clientIds].sort((left, right) => left - right);

  for (const clientId of ordered) {
    if (taken.size >= ANONYMOUS_GLYPHS.length) {
      assigned.set(clientId, UNKNOWN_GLYPH);

      continue;
    }

    const base = baseSlot(clientId);
    const slot = ANONYMOUS_GLYPHS
      .map((_, step) => (base + step) % ANONYMOUS_GLYPHS.length)
      .find(candidate => !taken.has(candidate));

    // Unreachable while the size check above holds; the guard keeps the type
    // honest rather than asserting one.
    if (slot === undefined) {
      assigned.set(clientId, UNKNOWN_GLYPH);

      continue;
    }

    taken.add(slot);
    assigned.set(clientId, ANONYMOUS_GLYPHS[slot]);
  }

  return assigned;
};
