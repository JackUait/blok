import type { BlockToolData } from '../../../types';

/** A tabs block saves nothing itself: its tabs are its child blocks. */
export type TabsData = Record<string, never>;

export interface TabData extends BlockToolData {
  /** Plain text label shown in the tab strip. */
  title: string;
  /** Optional emoji shown before the title. */
  icon?: string;
}
