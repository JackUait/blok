import type { Title, TitleChange } from '../../types/api/title';
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
  editor: TitleEditor,
  { pageId, created, record }: {
    pageId: string | null;
    created: ReadonlySet<string>;
    record(): { title: string; icon?: string } | undefined;
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
  };
};
