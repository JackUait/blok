import type { BlokConfig, OutputData } from '../../../types';

/**
 * The expanded `persistence` block a candidate set belongs to. It is the key
 * rather than a bare object so the two sides that look a set up — the queue
 * that builds the block and the uploader that reads it off the config — cannot
 * drift onto different handles.
 */
type SweepOwner = NonNullable<BlokConfig['persistence']>;

/** Deletes one stored asset. Rejecting is how a host says it did not happen. */
type RemoveAsset = (url: string) => Promise<void>;

/** One remembered upload, with what the sweep needs to decide about it. */
type Candidate = {
  remove: RemoveAsset;
  /** Which recording this was, so a save only sweeps what predates it. */
  recordedAt: number;
  /** Removals already refused for this URL — see {@link MAX_REMOVE_ATTEMPTS}. */
  attempts: number;
};

/**
 * How many times a refused removal is offered again, in all.
 *
 * A refused delete leaves the asset there and still ours, so retrying it on the
 * next save is right for a blip. It is wrong forever: an endpoint answering 403
 * or 404 refuses every time, and an uncapped candidate is re-issued on every
 * save for the rest of the session. Giving up leaks one stored file, which is a
 * bill; the other direction is a request per save that can never succeed.
 */
const MAX_REMOVE_ATTEMPTS = 3;

/**
 * Tracks the assets THIS editing session uploaded, and deletes the ones a
 * saved document no longer references.
 *
 * Two failure modes rule out the obvious designs. Deleting when a block is
 * removed breaks undo — the block comes back pointing at a deleted file.
 * Deleting whatever the document stopped referencing breaks copy-paste between
 * documents — the same URL may still live in a document this editor cannot
 * see. Session provenance is what makes both safe: an undone deletion puts the
 * URL back before the next save, and a pasted-in URL was never a candidate
 * because this session did not upload it.
 */
export interface OrphanSweep {
  /**
   * Remember an asset this session uploaded, so a later save may find it
   * abandoned.
   * @param url - the public URL the uploader returned
   * @param remove - deletes that asset through the uploader that stored it
   */
  record(url: string, remove: RemoveAsset): void;

  /**
   * Take the high-water mark of what has been recorded so far, to hand back to
   * `sweep` when the save that is about to leave lands.
   */
  beginSave(): number;

  /**
   * Delete every recorded asset the just-saved document no longer references.
   *
   * Only a save that LANDED may drive this: a rejected save says nothing about
   * what the stored document holds, so sweeping on one would delete assets a
   * live document still uses.
   * @param savedDocument - the document the store just accepted
   * @param recordedBefore - the mark `beginSave` returned for THIS save;
   * candidates recorded after it are not this save's business
   */
  sweep(savedDocument: OutputData, recordedBefore?: number): Promise<void>;
}

/**
 * The entities an HTML serializer emits. `sanitizeBlocks` cleans a string by
 * parsing it and reading `innerHTML` back, so a stored URL is the escaped form
 * of the one the uploader returned — and every signed CDN URL is full of `&`.
 */
const SERIALIZER_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  // The serializer emits this for U+00A0, never for a plain space.
  '&nbsp;': '\u00a0',
};

const SERIALIZER_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp);/g;

/**
 * Undo that escaping. One pass, so `&amp;lt;` decodes to `&lt;` and not to `<`.
 * @param value - a string that may carry escaped characters
 */
function decodeSerializerEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }

  return value.replace(SERIALIZER_ENTITY_PATTERN, (entity) => SERIALIZER_ENTITIES[entity]);
}

/**
 * A URL only a string can be. `UploadedAsset` comes from host code, so a
 * JavaScript uploader may offer anything — `{ url: response.headers.get(
 * 'Location') }` with no such header offers `undefined`.
 * @param value - what a host handed over as a URL
 */
function isUrl(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Collect every string the saved document holds, each decoded.
 *
 * Serializing the document instead would put JSON's own escaping between a
 * candidate and its match: `JSON.stringify` writes `"` as `\"` and `\` as
 * `\\`, so a URL carrying either is absent from the blob, is called an orphan,
 * and the file a visible block points at is deleted with no undo. A
 * `Content-Disposition` filename is enough to produce such a URL.
 * @param value - a document node, or anything a tool nested inside one
 * @param into - the strings found so far
 * @param seen - objects already walked, so a self-referencing payload ends
 */
function collectStrings(value: unknown, into: string[], seen: Set<unknown>): void {
  if (typeof value === 'string') {
    into.push(decodeSerializerEntities(value));

    return;
  }

  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const nested of value) {
      collectStrings(nested, into, seen);
    }

    return;
  }

  // Keys count as referenced text: a tool may key its data BY url
  // (`{ [url]: meta }`), and missing that deletes a file the document still
  // points at.
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    into.push(decodeSerializerEntities(key));
    collectStrings(nested, into, seen);
  }
}

/**
 * Build a candidate set for one editing session.
 */
export function createOrphanSweep(): OrphanSweep {
  const candidates = new Map<string, Candidate>();
  /**
   * Counts recordings, so a save can tell which candidates already existed when
   * it left. An upload that resolves mid-save records its URL ~400ms before the
   * change pipeline delivers a payload naming it, and the queue is empty in
   * that gap — so without this the landing save calls the brand-new asset an
   * orphan and deletes the file the document is about to reference.
   */
  const counter = { recordings: 0 };

  return {
    record(url: string, remove: RemoveAsset): void {
      // A poisoned key would reject every later sweep, so orphan cleanup would
      // be dead for the rest of the session and a genuine orphan beside it
      // would never be deleted.
      if (!isUrl(url)) {
        return;
      }

      counter.recordings += 1;
      candidates.set(url, {
        remove,
        recordedAt: counter.recordings,
        attempts: 0,
      });
    },

    beginSave(): number {
      return counter.recordings;
    },

    async sweep(savedDocument: OutputData, recordedBefore?: number): Promise<void> {
      if (candidates.size === 0) {
        return;
      }

      // Presence is a substring test against the strings the document holds
      // rather than a walk of block data per tool: a per-tool rule would be
      // wrong the day a tool nests a URL, and audio cover art already does. The
      // test matches WITHIN a string because a URL may sit inside a larger one
      // — an `<img src>` in a block's text. The candidate set is a handful of
      // session uploads, so the cost is irrelevant.
      //
      // Both sides are decoded because the saved document does not hold the URL
      // byte-for-byte: the sanitizer parses strings and reads the markup back,
      // so `?a=1&b=2` is stored as `?a=1&amp;b=2`. Comparing raw would call a
      // referenced asset an orphan and DELETE the file a visible block points
      // at. Decoding can only widen the match, and a false "still referenced"
      // leaks a file where a false "orphan" loses one.
      const referenced: string[] = [];

      collectStrings(savedDocument, referenced, new Set());

      const orphans = Array.from(candidates)
        .filter(([, { recordedAt }]) => recordedBefore === undefined || recordedAt <= recordedBefore)
        .filter(([url]) => {
          // Reading a non-string key as a URL is what used to reject the whole
          // pass, which killed cleanup for the rest of the session. `record`
          // no longer admits one, so no single entry can take the pass down.
          if (!isUrl(url)) {
            return false;
          }

          const decoded = decodeSerializerEntities(url);

          return !referenced.some((value) => value.includes(decoded));
        });

      // Dropped as the decision is made, not when the delete answers: the save
      // queue issues these removals DETACHED, so the next save's sweep runs
      // while they are still open — and a candidate still listed there would be
      // deleted a second time. A refused removal is put back below.
      orphans.forEach(([url]) => {
        candidates.delete(url);
      });

      await Promise.all(orphans.map(async ([url, candidate]) => {
        try {
          await candidate.remove(url);
        } catch {
          // The host refused, so the asset is still there and still ours: it
          // goes back for the next save to retry rather than leaking silently.
          // A failed cleanup must never look like a failed save.
          //
          // `has` guards a re-upload that claimed this URL while the delete was
          // open — that record is newer, and putting the stale one back over it
          // would sweep a file the live document points at.
          const attempts = candidate.attempts + 1;

          if (attempts < MAX_REMOVE_ATTEMPTS && !candidates.has(url)) {
            candidates.set(url, {
              ...candidate,
              attempts,
            });
          }
        }
      }));
    },
  };
}

/**
 * One candidate set per editor, keyed by the `persistence` block the expansion
 * built for it.
 *
 * A set held by the module would be shared by every editor on the page, and
 * the editor that saves would delete assets the OTHER one just uploaded —
 * leaving a live document pointing at a file that is gone. Session provenance
 * means nothing if "session" means "page".
 *
 * The key is the expanded `persistence` object because it is the one handle
 * both sides reach: the queue creates it, and the config carrying it is the
 * config every module receives. It also encodes the rule that only a
 * `persistence` save may sweep — no `persistence`, no set, so nothing is ever
 * recorded, let alone deleted.
 */
const sweeps = new WeakMap<SweepOwner, OrphanSweep>();

/**
 * Give an editor's `persistence` block its candidate set.
 * @param owner - the expanded `persistence` object
 * @param sweep - the set the queue will sweep
 */
export function attachOrphanSweep(owner: SweepOwner, sweep: OrphanSweep): void {
  sweeps.set(owner, sweep);
}

/**
 * The candidate set for an editor, or undefined when it saves through
 * something other than `persistence` — nothing may be recorded then, because
 * no signal would ever say the document was written.
 * @param owner - the editor's `persistence` block, if it has one
 */
export function orphanSweepFor(owner: SweepOwner | undefined): OrphanSweep | undefined {
  return owner === undefined ? undefined : sweeps.get(owner);
}
