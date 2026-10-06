import type { TabData } from './types';

/** What the tabs container needs from one of its tab children. */
export interface TabHandle {
  readonly data: TabData;
}

/** What a tab needs from its tabs container. */
export interface TabsHandle {
  activate(tabId: string): void;
  sync(): void;
}

// `BlockAPI.call` returns nothing, so container and tab find each other through
// their DOM. Keys are elements, not block ids: two editors on one page may load
// the same document and share every id.
const tabs = new WeakMap<Element, TabHandle>();
const containers = new WeakMap<Element, TabsHandle>();

/** Which tab each tabs block shows, per editor. UI state: never saved or undone. */
const activeTabs = new WeakMap<Element, Map<string, string>>();

export const tabRegistry = {
  /** @param panel - the element TabTool.render() returned */
  setTab: (panel: Element, handle: TabHandle): void => {
    tabs.set(panel, handle);
  },
  tab: (panel: Element | null | undefined): TabHandle | undefined => (panel ? tabs.get(panel) : undefined),
  /** @param root - the element TabsTool.render() returned */
  setContainer: (root: Element, handle: TabsHandle): void => {
    containers.set(root, handle);
  },
  container: (root: Element | null | undefined): TabsHandle | undefined => (root ? containers.get(root) : undefined),
  /**
   * @param editor - the editor wrapper the tabs block lives in
   * @param containerId - the tabs block id
   */
  activeTab: (editor: Element, containerId: string): string | undefined => activeTabs.get(editor)?.get(containerId),
  setActiveTab: (editor: Element, containerId: string, tabId: string): void => {
    const byBlock = activeTabs.get(editor) ?? new Map<string, string>();

    byBlock.set(containerId, tabId);
    activeTabs.set(editor, byBlock);
  },
};
