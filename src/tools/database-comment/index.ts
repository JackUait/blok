import { describeDatabaseComment } from '../../shared/tool-descriptions/database-comment';
import { databaseCommentSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { BlockTool, BlockToolConstructorOptions, SanitizerConfig } from '../../../types';
import type { DatabaseCommentData } from './types';
import { overrideStatic } from '../../components/utils/override-static';

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const normalize = (data: Partial<DatabaseCommentData> | undefined): DatabaseCommentData => {
  const authorId = text(data?.authorId);
  const authorName = text(data?.authorName);
  const propertyId = text(data?.propertyId);
  const editedAt = time(data?.editedAt);

  return {
    text: text(data?.text) ?? '',
    createdAt: time(data?.createdAt) ?? 0,
    ...(authorId === undefined || authorId === '' ? {} : { authorId }),
    ...(authorName === undefined || authorName === '' ? {} : { authorName }),
    ...(propertyId === undefined || propertyId === '' ? {} : { propertyId }),
    ...(editedAt === undefined ? {} : { editedAt }),
    ...(data?.resolved === true ? { resolved: true } : {}),
  };
};

/**
 * One comment on a database row: a thread under the row, or a reply under a
 * thread. Not page content: core hides the holder, and the database draws the
 * thread itself from {@link DatabaseCommentTool.readData}.
 */
export class DatabaseCommentTool implements BlockTool {
  public static get describe(): typeof describeDatabaseComment {
    return describeDatabaseComment;
  }

  public static set describe(value: typeof describeDatabaseComment) {
    overrideStatic(this, 'describe', value);
  }

  private data: DatabaseCommentData;

  constructor({ data }: BlockToolConstructorOptions<DatabaseCommentData>) {
    this.data = normalize(data);
  }

  public render(): HTMLDivElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-tool', 'database-comment');

    return el;
  }

  public save(): DatabaseCommentData {
    return structuredClone(this.data);
  }

  /** Undo, redo and a peer's edit land here; there is no DOM to rebuild. */
  public setData(data: DatabaseCommentData): boolean {
    this.data = normalize(data);

    return true;
  }

  /** An edit or a resolve. The database saves it with `dispatchChange({ derived: true })`, so it is not an undo step. */
  public updateComment(param: { text?: string; editedAt?: number; resolved?: boolean }): void {
    this.data = normalize({
      ...this.data,
      ...(param.text === undefined ? {} : { text: param.text }),
      ...(param.editedAt === undefined ? {} : { editedAt: param.editedAt }),
      ...(param.resolved === undefined ? {} : { resolved: param.resolved }),
    });
  }

  public readData(param: { receive: (data: DatabaseCommentData) => void }): void {
    param.receive(structuredClone(this.data));
  }

  public validate(data: DatabaseCommentData): boolean {
    return typeof data.text === 'string' && typeof data.createdAt === 'number';
  }

  public static get sanitize(): SanitizerConfig {
    return databaseCommentSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Nothing to wire: the holder is hidden and the database draws the thread.
   * Must exist, or every read-only toggle re-renders the whole document.
   */
  public setReadOnly(_state: boolean): void {}

  /** A thread is drawn by its database, never as page content. */
  public static get isAnnotation(): boolean {
    return true;
  }

  /** Replies hang off their thread, and nothing else does. */
  public static get childTools(): { allow: string[] } {
    return { allow: ['database-comment'] };
  }

  /** Deleting a thread deletes its replies. */
  public static get deletesChildren(): boolean {
    return true;
  }
}

export type { DatabaseCommentData };
