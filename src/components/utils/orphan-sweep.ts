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
 * Build a candidate set for one editing session.
 */
export function createOrphanSweep(): OrphanSweep {
  const candidates = new Map<string, { remove: RemoveAsset; recordedAt: number }>();
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
      counter.recordings += 1;
      candidates.set(url, { remove, recordedAt: counter.recordings });
    },

    beginSave(): number {
      return counter.recordings;
    },

    async sweep(savedDocument: OutputData, recordedBefore?: number): Promise<void> {
      if (candidates.size === 0) {
        return;
      }

      // Presence is a substring test against the serialized document rather
      // than a walk of block data per tool: a per-tool rule would be wrong the
      // day a tool nests a URL, and audio cover art already does. The candidate
      // set is a handful of session uploads, so the cost is irrelevant.
      //
      // Both sides are decoded because the saved document does not hold the URL
      // byte-for-byte: the sanitizer parses strings and reads the markup back,
      // so `?a=1&b=2` is stored as `?a=1&amp;b=2`. Comparing raw would call a
      // referenced asset an orphan and DELETE the file a visible block points
      // at. Decoding can only widen the match, and a false "still referenced"
      // leaks a file where a false "orphan" loses one.
      const serialized = decodeSerializerEntities(JSON.stringify(savedDocument));
      const orphans = Array.from(candidates)
        .filter(([, { recordedAt }]) => recordedBefore === undefined || recordedAt <= recordedBefore)
        .filter(([url]) => !serialized.includes(decodeSerializerEntities(url)));

      await Promise.all(orphans.map(async ([url, { remove }]) => {
        try {
          await remove(url);
          candidates.delete(url);
        } catch {
          // The host refused, so the asset is still there and still ours: it
          // stays a candidate for the next save rather than leaking silently.
          // A failed cleanup must never look like a failed save.
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
