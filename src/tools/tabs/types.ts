import type { BlockToolData } from '../../../types';

import type { LayoutDraft } from './draft';

/** A tabs block saves nothing itself: its tabs are its child blocks. A database's unapplied layout block carries a draft mark. */
export type TabsData = { draft?: LayoutDraft };

export interface TabData extends BlockToolData {
  /** Plain text label shown in the tab strip. */
  title: string;
  /** Optional emoji shown before the title. */
  icon?: string;
  /** A database's layout tab not applied yet. */
  draft?: LayoutDraft;
}
