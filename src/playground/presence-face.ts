/**
 * One face in the header's presence stack, built from a `collaboration:status`
 * row.
 *
 * This is HOST code: it reads the published participant shape and nothing
 * else, so it stays a working example of what a consumer can build. Blok ships
 * the data and no presence UI of its own outside the block gutter.
 *
 * The silhouette is a CSS mask that src/styles/presence.css keys off
 * `data-blok-presence-glyph`, so writing the event's glyph name into that
 * attribute IS the whole integration — the artwork is already on the page.
 */
import type { CollaborationParticipant } from '../../types/events/editor-events';

/** The attribute presence.css turns into a silhouette. */
const GLYPH_ATTR = 'data-blok-presence-glyph';

/** What an anonymous participant is called when no translator labelled them. */
const UNLABELLED = 'Anonymous';

/**
 * Draw one participant.
 * @param person - a row from `collaboration:status`
 * @param now - the clock the "last active" age is measured against
 */
export const buildPresenceFace = (
  person: CollaborationParticipant,
  now: number = Date.now()
): HTMLElement => {
  const face = document.createElement('span');
  const { name, color, glyph, label } = person.user;

  face.className = 'playground-presence-face';
  face.style.background = color;

  // A nameless participant wears the silhouette the editor picked for them.
  // A monogram here would be the initial of a name nobody published, which is
  // what drew a question mark on every anonymous face.
  if (glyph === null) {
    face.textContent = (Array.from(name)[0] ?? '').toUpperCase();
  } else {
    face.setAttribute(GLYPH_ATTR, glyph);
  }

  const who = name === '' ? label ?? UNLABELLED : name;

  face.title = person.lastActiveAt === null
    ? who
    : `${who} · ${Math.round((now - person.lastActiveAt) / 1000)}s ago`;

  return face;
};
