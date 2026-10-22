import type { Title, TitleChange } from '../../types/api/title';
import type { OutputBlockData, OutputData } from '../../types';
import type { Blocks } from '../../types/api/blocks';
import type { History } from '../../types/api/history';
import type { PageIcon } from '../../types/tools/page';
import { DATA_ATTR } from '../components/constants/data-attributes';
import type { PageRegistry } from './page-host';

/** The registry keeps an emoji string; the built-in title keeps a PageIcon. */
export const toPageIcon = (icon: string | undefined): PageIcon | undefined =>
  icon === undefined || icon === '' ? undefined : { type: 'emoji', value: icon };

/** Never '': a stored '' would come back out of `info()` as an empty emoji icon. */
export const fromPageIcon = (icon: PageIcon | null): string | undefined =>
  icon?.type === 'emoji' && icon.value !== '' ? icon.value : undefined;

/**
 * The title and icon a page's editor starts with.
 * Reads `get`, not `info`: remote mode overrides only `get` with the host's answer.
 */
export const titleData = (pages: Pick<PageRegistry, 'get' | 'root'>, pageId: string | null): { title: string; icon?: PageIcon } => {
  const page = pageId === null ? pages.root() : pages.get(pageId);
  const icon = toPageIcon(page?.icon);

  return { title: page?.title ?? '', ...(icon !== undefined && { icon }) };
};

/**
 * Agent writes to sub-pages under collaboration. A page's body lives in its
 * room there, so a write can land only in a page this tab created whose room
 * is not open yet: the write waits here and the first connect seeds it.
 */
export interface HeldDocuments {
  writable(pageId: string): boolean;
  hold(pageId: string, blocks: OutputBlockData[]): void;
  /** The held blocks, once. After this the room is open and takes no more writes. */
  take(pageId: string): OutputBlockData[] | undefined;
}

export const createHeldDocuments = (created: ReadonlySet<string>): HeldDocuments => {
  const held = new Map<string, OutputBlockData[]>();
  const opened = new Set<string>();

  return {
    writable: (pageId) => created.has(pageId) && !opened.has(pageId),
    hold: (pageId, blocks) => {
      held.set(pageId, blocks);
    },
    take: (pageId) => {
      opened.add(pageId);
      const blocks = held.get(pageId);

      held.delete(pageId);

      return blocks;
    },
  };
};

/**
 * The page tool's loadDocument / saveDocument over the registry, which keeps blocks, title and icon apart.
 * @param held - set under collaboration. A page it refuses loads as null, so the agent gets an error, not a write that lands nowhere.
 */
export const pageDocumentHooks = (pages: Pick<PageRegistry, 'get' | 'root' | 'setBlocks' | 'setTitle' | 'setIcon'>, held?: HeldDocuments): {
  loadDocument(pageId: string): OutputData | null;
  saveDocument(pageId: string, data: OutputData): void;
} => ({
  loadDocument: (pageId) => {
    const page = pages.get(pageId);

    return page === undefined || held?.writable(pageId) === false ? null : { blocks: page.blocks, ...titleData(pages, pageId) };
  },
  saveDocument: (pageId, data) => {
    pages.setBlocks(pageId, data.blocks);
    pages.setTitle(pageId, data.title ?? '');
    pages.setIcon(pageId, fromPageIcon(data.icon ?? null));
    // The registry copy is not enough: opening the page overwrites it with the room's.
    held?.hold(pageId, data.blocks);
  },
});

/** A `collaboration:status` listener that keeps an editor's last status. Returns nothing: a returned value would replace the payload for every later listener. */
export const statusRecorder = <Editor extends WeakKey>(statuses: WeakMap<Editor, string>, editor: Editor) =>
  ({ status }: { status: string }): void => {
    statuses.set(editor, status);
  };

/** True for the built-in title's own unrecorded set: its value came from the registry or the host. */
export const isUnrecordedSet = (change: TitleChange): boolean => change.source === 'api' && change.record === false;

/**
 * `pageTitle.onChange` / `onIconChange` for one editor, built when the editor
 * is. The page id is read once, here: `goToPage` moves the current page before
 * the old editor dies, and its late undo or remote change must not land on the next page.
 */
export const titleCallbacks = ({ pages, currentPageId, changed, routed }: {
  pages: Pick<PageRegistry, 'setTitle' | 'setIcon'>;
  currentPageId(): string | null;
  changed(): void;
  /** Every title change, with this editor's page id (remote mode passes it to the host). */
  routed?(pageId: string | null, title: string, change: TitleChange): void;
}): {
  onChange(title: string, change: TitleChange): void;
  onIconChange(icon: PageIcon | null, change: TitleChange): void;
} => {
  const pageId = currentPageId();

  return {
    onChange: (title, change) => {
      if (!isUnrecordedSet(change)) {
        pages.setTitle(pageId, title);
      }
      changed();
      routed?.(pageId, title, change);
    },
    onIconChange: (icon, change) => {
      if (!isUnrecordedSet(change)) {
        pages.setIcon(pageId, fromPageIcon(icon));
      }
      changed();
    },
  };
};

/** What `pushRecord` needs from the editor. */
export interface TitleEditor {
  title: Pick<Title, 'get' | 'set'> & { icon: Pick<Title['icon'], 'get' | 'set'> };
}

/** What seeding a held body needs from the editor. */
export interface BodyEditor {
  blocks: Pick<Blocks, 'getBlocksCount' | 'getBlockByIndex' | 'getBlockIndex' | 'insertMany' | 'delete'>;
  history: Pick<History, 'clear'>;
}

/** Puts held blocks into an empty room, in place of its placeholder paragraph, with no undo step. */
const seedBody = async (editor: BodyEditor, blocks: OutputBlockData[]): Promise<void> => {
  const count = editor.blocks.getBlocksCount();
  const placeholder = editor.blocks.getBlockByIndex(0);

  if (blocks.length === 0 || count > 1 || (count === 1 && placeholder?.isEmpty !== true)) {
    return;
  }
  editor.blocks.insertMany(blocks, 0);

  const index = placeholder === undefined ? undefined : editor.blocks.getBlockIndex(placeholder.id);

  if (index !== undefined && index >= 0) {
    await editor.blocks.delete(index);
  }
  editor.history.clear();
};

/**
 * Puts another tab's registry record into the open editor, with no undo step.
 * A title being typed in is left alone.
 */
export const pushRecord = (editor: TitleEditor, record: { title: string; icon?: string }): void => {
  if (document.activeElement?.hasAttribute(DATA_ATTR.pageTitle) === true) {
    return;
  }
  if (editor.title.get() !== record.title) {
    editor.title.set(record.title, { record: false });
  }

  const icon = toPageIcon(record.icon) ?? null;

  if (JSON.stringify(editor.title.icon.get()) !== JSON.stringify(icon)) {
    editor.title.icon.set(icon, { record: false });
  }
};

/**
 * A `collaboration:status` listener that puts this profile's title and icon
 * into a page it created this session, once its room is synced and still
 * empty. Never for a page that exists elsewhere: its stale local title would
 * bring back one a peer cleared. Once only: 'connected' fires on every reconnect.
 */
export const createdPageSeed = (
  editor: TitleEditor & Partial<BodyEditor>,
  { pageId, created, record, held }: {
    pageId: string | null;
    created: ReadonlySet<string>;
    record(): { title: string; icon?: string } | undefined;
    held?: Pick<HeldDocuments, 'take'>;
  }
): ((event: { status: string }) => void) => {
  const state = { done: pageId === null || !created.has(pageId) };

  return ({ status }) => {
    // 'connected' is reported after the first sync, so an empty title means an empty room.
    if (state.done || status !== 'connected') {
      return;
    }
    state.done = true;

    const page = record();
    const icon = toPageIcon(page?.icon);

    if (page !== undefined && page.title !== '' && editor.title.get() === '') {
      editor.title.set(page.title, { record: false });
    }
    if (icon !== undefined && editor.title.icon.get() === null) {
      editor.title.icon.set(icon, { record: false });
    }

    const blocks = pageId === null ? undefined : held?.take(pageId);

    if (blocks !== undefined && editor.blocks !== undefined && editor.history !== undefined) {
      void seedBody({ blocks: editor.blocks, history: editor.history }, blocks);
    }
  };
};

/**
 * Attaches {@link createdPageSeed}. Blok has no public collaboration status
 * getter, so `isConnected` is the host's own record of the last status it
 * heard. Core also replays the current status once, in a task after
 * `isReady` (collaboration/index.ts, `readyReplay`): a listener attached
 * later than that would miss it, which the immediate check covers.
 */
export const attachCreatedPageSeed = (
  editor: TitleEditor & { on(name: 'collaboration:status', listener: (event: { status: string }) => void): void },
  options: Parameters<typeof createdPageSeed>[1],
  isConnected: () => boolean
): void => {
  const onStatus = createdPageSeed(editor, options);

  if (isConnected()) {
    onStatus({ status: 'connected' });
  }
  editor.on('collaboration:status', onStatus);
};
