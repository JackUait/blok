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
 * Registering `database` registers it as `database-comment` (see
 * `Database.companionTools`), so built-in comments work with no extra entry.
 * It is not page content: Blok hides it, and the views and exports skip it.
 * A host `comments` hook in the database config replaces it.
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
