import type { I18n } from '../../types';
import type { StoredComment, StoredThread } from '../../src/tools/database/database-comments-store';

export interface CommentsPanel {
  element: HTMLElement;
  refresh(): void;
  focusComposer(): void;
  destroy(): void;
}
export interface CommentsPanelOptions {
  i18n: Pick<I18n, 't'>;
  locale: string;
  canComment: boolean;
  threads(): StoredThread[];
  nameOf(comment: StoredComment): string;
  isOwn(comment: StoredComment): boolean;
  onAdd(text: string): void;
  onReply(threadId: string, text: string): void;
  onEdit(id: string, text: string): void;
  onResolve(threadId: string): void;
  onDelete(id: string): Promise<void>;
  now?(): number;
  viewerName?(): string;
}
export function createCommentsPanel(options: CommentsPanelOptions): CommentsPanel;
export function openDatabaseConfirm(options: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  directionSource?: Element | null;
}): Promise<boolean>;
