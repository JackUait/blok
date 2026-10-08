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
 * `pageTitle.onChange` / `onIconChange` for one editor. `pageId` is fixed at
 * build time: a late undo or remote change from a dying editor must not land
 * on the page the playground moved to.
 */
export const titleCallbacks = ({ pages, pageId, changed }: {
  pages: Pick<PageRegistry, 'setTitle' | 'setIcon'>;
  pageId: string | null;
  changed(): void;
}): {
  onChange(title: string, change: TitleChange): void;
  onIconChange(icon: PageIcon | null, change: TitleChange): void;
} => ({
  onChange: (title, change) => {
    if (!isUnrecordedSet(change)) {
      pages.setTitle(pageId, title);
    }
    changed();
  },
  onIconChange: (icon, change) => {
    if (!isUnrecordedSet(change)) {
      pages.setIcon(pageId, fromPageIcon(icon));
    }
    changed();
  },
});

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
