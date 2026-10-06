import type { BaseToolConstructable } from '../../../types/tools';
import { TabTool } from '../tab';
import { TabsTool } from '../tabs';

/**
 * Registration handle for the tabs feature. Registering `Tabs` under a single
 * tool key (e.g. `tabs`) expands to the two real block tools: `tabs` (the
 * strip container) and `tab` (one tab and its content).
 *
 * Saved JSON contains `tabs` and `tab` blocks, never a block of the
 * registration key's type.
 */
export class Tabs {
  public static get provides(): { [blockType: string]: BaseToolConstructable } {
    return {
      tabs: TabsTool as unknown as BaseToolConstructable,
      tab: TabTool,
    };
  }
}
