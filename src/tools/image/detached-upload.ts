import type { API, BlockAPI, BlockToolData } from '../../../types';
import { logLabeled } from '../../components/utils/logger';

/**
 * The block that now carries `blockId`, or `null`.
 *
 * Deliberately NOT `api.blocks.getById`: that logs
 * `There is no block with id ...` at WARN on a miss (api/blocks.ts:131), and a
 * miss is the ORDINARY case on both of these paths — every delete of a media
 * block would print it and hosts report it as a bug. Walking the flat store by
 * index never warns, because every index below `getBlocksCount()` is in range.
 * @param api - the tool's editor API
 * @param blockId - id to look for
 */
const findLiveBlock = (api: API, blockId: string): BlockAPI | null => {
  const count = api.blocks.getBlocksCount();

  for (const index of Array(count).keys()) {
    const candidate = api.blocks.getBlockByIndex(index);

    if (candidate?.id === blockId) {
      return candidate;
    }
  }

  return null;
};

/**
 * Run `fn`'s block writes as data worked out from `from` keys of block
 * `blockId`: they join the undo step that wrote those values, add no step and
 * keep redo. See `api.blocks.transactWithoutCapture`.
 * @param api - the tool's editor API
 * @param blockId - the block the data comes from
 * @param from - keys of its data the writes were worked out from
 * @param fn - the writes
 */
export const writeDerived = (api: API, blockId: string, from: readonly string[], fn: () => void): void => {
  const scope = api.blocks.transactWithoutCapture;

  if (scope === undefined) {
    fn();

    return;
  }
  scope(fn, { derivedFrom: blockId, from });
};

/**
 * @param live - the block now carrying the upload's block id
 * @param startedFrom - values it must still hold; none means no check
 * @returns whether every value in `startedFrom` is still in the block's data
 */
const stillHolds = async (live: BlockAPI, startedFrom: Partial<BlockToolData> | undefined): Promise<boolean> => {
  if (startedFrom === undefined) {
    return true;
  }

  const saved = await live.save();
  const current: Partial<BlockToolData> = saved?.data ?? {};

  return Object.entries(startedFrom).every(([key, value]) => current[key] === value);
};

/**
 * Hand a finished upload to whatever block now carries `block.id`.
 *
 * A media block can be REBUILT under an in-flight upload. None of the media
 * tools implement `setData`, so a peer's edit cannot be applied in place
 * (`Block.setData`'s innerHTML fallback needs a contenteditable tool root and a
 * media root is a plain `<div>`); the reconciler therefore rematerialises the
 * block, and `Blocks.replace` calls `removed()` + `destroy()` on THIS instance.
 * `destroy()` clears the Block's event emitter, so every later
 * `block.dispatchChange()` reaches nobody: the file sits in the consumer's
 * storage with nothing in the document pointing at it, and the author just sees
 * the pre-upload state.
 *
 * Only the keys the upload produced are sent. The detached instance's `data`
 * predates the peer's edit, so writing all of it back would undo their change;
 * `api.blocks.update` merges the delta onto the live block's current data.
 *
 * Two cases get no write, because there is nothing to write to:
 * - the peer DELETED the block;
 * - the peer CONVERTED it. `BlockMutation.replace` keeps the block id across a
 *   conversion, so the id alone does not say the block is still this tool.
 *   Writing `{url, fileName}` into, say, a paragraph recomposes it — which
 *   costs the author their caret mid-typing — and the keys are pruned again by
 *   the next full save, so the write buys nothing.
 *
 * Neither is silent: the uploaded file is named in a warning, so an author or
 * host can still reach it. Nothing is resurrected — re-inserting a media block
 * the peer deliberately removed or converted would fight their edit, and every
 * peer running the same upload would insert its own copy.
 *
 * A third case gets no write either: with `startedFrom`, a block that no
 * longer holds those values (the pick that started the upload was undone, or
 * the block got another file) keeps what it has.
 *
 * The write is derived data (see {@link writeDerived}): it joins the undo step
 * that wrote the block's `from` values, never adds one, and keeps redo.
 * @param api - the tool's editor API
 * @param block - the block API this tool was constructed with
 * @param label - tool name used in the log line
 * @param data - only the fields the upload produced
 * @param startedFrom - values the block held when the upload started
 * @param from - keys of the block's data the upload was worked out from
 */
export const deliverToRebuiltBlock = (
  api: API,
  block: BlockAPI,
  label: string,
  data: Partial<BlockToolData>,
  startedFrom?: Partial<BlockToolData>,
  from: readonly string[] = []
): void => {
  try {
    const live = findLiveBlock(api, block.id);

    if (live === null) {
      logLabeled(
        `${label}: the block was removed while the upload was running, so the uploaded file is not referenced by the document`,
        'warn',
        data
      );

      return;
    }

    if (live.name !== block.name) {
      logLabeled(
        `${label}: the block became a "${live.name}" while the upload was running, so the uploaded file is not referenced by the document`,
        'warn',
        data
      );

      return;
    }

    void stillHolds(live, startedFrom)
      .then((holds) => {
        if (!holds) {
          logLabeled(
            `${label}: the edit that started the upload was undone or replaced, so the uploaded file is not referenced by the document`,
            'warn',
            data
          );

          return;
        }

        const written: { update?: Promise<unknown> } = {};

        writeDerived(api, block.id, from, () => {
          written.update = api.blocks.update(block.id, data);
        });

        return written.update;
      })
      .catch((error: unknown) => {
        logLabeled(`${label}: could not store the finished upload`, 'warn', error);
      });
  } catch (error) {
    logLabeled(`${label}: could not store the finished upload`, 'warn', error);
  }
};

/**
 * Free a `blob:` url the destroyed instance was rendering — but only once it is
 * clear the block is really gone.
 *
 * `removed()` fires for a REMATERIALISE as well as a delete, and a
 * rematerialised block renders the same `data.url`: with no uploader configured
 * that url is a live `URL.createObjectURL` handle (image/uploader.ts:91,
 * video/uploader.ts:69, audio/uploader.ts:89), so revoking it blanked an
 * un-uploaded local file on every peer edit.
 *
 * The answer is not available inside `removed()` — every caller of the REMOVED
 * hook (blocks.ts:246, :374, :473, :489) runs it BEFORE it touches the array.
 * All four then mutate the array in the same synchronous call, so one microtask
 * later the answer is in: a rematerialised id resolves to the NEW block, a
 * deleted one resolves to nothing. Measured, not assumed — see
 * `test/unit/tools/concurrent-async-tool-data-loss.test.ts`, "the blocks store
 * is updated synchronously".
 *
 * A CONVERTED block keeps the id, so its blob stays alive until the page goes
 * away. That is on purpose: a conversion can carry `data.url` into the new tool
 * (the file tool turns its own upload into an image or a video block), and
 * blanking a live local file is worse than holding one handle.
 * @param api - the tool's editor API
 * @param blockId - id of the block this instance rendered
 * @param url - the url the instance was rendering; ignored unless it is a blob
 */
export const releaseObjectUrl = (api: API, blockId: string, url: string | undefined): void => {
  if (url === undefined || !url.startsWith('blob:')) {
    return;
  }

  /**
   * Whether there is a document to ask at all. Deliberately NOT a
   * `findLiveBlock` probe: the answer here is only ever used to tell "no
   * editor" from "an editor", so walking the store for the block would throw
   * the walk away — and the walk allocates one `BlockAPI` per block visited
   * (api/blocks.ts:120), measured at ~1.7-3.2us each, so a 1000-block document
   * paid ~3ms per url for nothing (audio frees two urls per delete).
   */
  const hasDocument = (): boolean => {
    try {
      api.blocks.getBlocksCount();

      return true;
    } catch {
      return false;
    }
  };

  // Nothing to protect: no editor means no rebuilt block renders this url.
  if (!hasDocument()) {
    URL.revokeObjectURL(url);

    return;
  }

  queueMicrotask(() => {
    /** A torn-down editor answers nothing, and nothing renders this url either. */
    const stillInDocument = ((): boolean => {
      try {
        return findLiveBlock(api, blockId) !== null;
      } catch {
        return false;
      }
    })();

    if (!stillInDocument) {
      URL.revokeObjectURL(url);
    }
  });
};
