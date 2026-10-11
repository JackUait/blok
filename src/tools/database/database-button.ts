import type { ButtonAction, ButtonBlock, ButtonCallbackAction, PropertyValue } from './types';
import { resolveDynamicValue } from './dynamic-values';

/** What a button's actions do, as the database tool does them. */
export interface ButtonHost {
  /** One undo step. */
  oneStep: (fn: () => void) => void;
  writeValues: (rowId: string, changes: Record<string, PropertyValue>) => void;
  /** Appends to the row's page body. */
  insertBlocks: (rowId: string, blocks: ButtonBlock[]) => void;
  openRow: (rowId: string) => void;
  openUrl: (url: string) => void;
  callback: (action: ButtonCallbackAction) => void;
  me: () => string | null;
  now: () => Date;
}

/**
 * Runs a button's actions in order. Every write lands in one transact, so
 * one undo takes the whole click back. Opening a page and the host callback
 * run after it: they are not document edits, and a page opened mid-step
 * would show the row before the rest of the writes.
 */
export const runButtonActions = (actions: readonly ButtonAction[], rowId: string, host: ButtonHost): void => {
  const writes = actions.filter((action) => action.type === 'editProperty' || action.type === 'insertBlocks');
  const ctx = { me: host.me(), now: host.now() };

  if (writes.length > 0) {
    host.oneStep(() => {
      for (const action of writes) {
        if (action.type === 'editProperty') {
          host.writeValues(rowId, { [action.propertyId]: resolveDynamicValue(action.value, ctx) });
        } else if (action.type === 'insertBlocks' && action.blocks.length > 0) {
          host.insertBlocks(rowId, action.blocks);
        }
      }
    });
  }
  for (const action of actions) {
    if (action.type === 'openPage' && (action.url === undefined || action.url === '')) {
      host.openRow(rowId);
    } else if (action.type === 'openPage') {
      host.openUrl(action.url ?? '');
    } else if (action.type === 'callback') {
      host.callback(action);
    }
  }
};
