import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';

/**
 * One comment on a database row. A thread is a `database-comment` child of
 * the row; its replies are `database-comment` children of the thread.
 */
export interface DatabaseCommentData extends BlockToolData {
  /** Plain text, not HTML. */
  text: string;
  /** Epoch ms when it was written. */
  createdAt: number;
  /** The writer, as the host's `people` directory knows them. */
  authorId?: string;
  /** The writer's display name when it was written. Absent for an anonymous writer. */
  authorName?: string;
  /** Set on a thread about one cell: that property's id. */
  propertyId?: string;
  /** Epoch ms of the last edit. */
  editedAt?: number;
  /** Set on a resolved thread. */
  resolved?: boolean;
}

export type DatabaseCommentConstructorOptions = BlockToolConstructorOptions<DatabaseCommentData>;

/**
 * DatabaseComment Tool for the Blok Editor.
 *
 * Register it as `database-comment` next to `database` and `database-row` to
 * get built-in comments on rows. It is not page content: Blok hides it, and
 * the views and exports skip it. Without it, and without `comments` in the
 * database config, rows have no comments.
 */
export declare class DatabaseComment implements BlockTool {
  static isReadOnlySupported?: boolean;
  static isAnnotation?: boolean;
  static sanitize?: SanitizerConfig;

  constructor(options: DatabaseCommentConstructorOptions);

  render(): HTMLDivElement;

  save(): DatabaseCommentData;

  setData(data: DatabaseCommentData): boolean;

  validate(data: DatabaseCommentData): boolean;
}
