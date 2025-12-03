import { createContext, useContext, useSyncExternalStore, useCallback } from 'react';
import type { BlokModules } from '../../types-internal/blok-modules';
import type { BlokConfig } from '../../../types';
import type EventsDispatcher from '../utils/events';
import type { BlokEventMap } from '../events';

/**
 * Shape of the editor context value
 */
export interface EditorContextValue {
  /**
   * All Blok module instances
   */
  modules: BlokModules;

  /**
   * Blok configuration
   */
  config: BlokConfig;

  /**
   * Internal event dispatcher for subscribing to editor events
   */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;

  /**
   * Whether the editor is in read-only mode
   */
  readOnly: boolean;

  /**
   * Whether the editor is on a mobile device
   */
  isMobile: boolean;
}

/**
 * React context for accessing Blok editor internals
 * Used by React components to interact with vanilla modules
 */
export const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Hook to access the editor context
 * Throws if used outside of EditorProvider
 */
export const useEditor = (): EditorContextValue => {
  const context = useContext(EditorContext);

  if (context === null) {
    throw new Error('useEditor must be used within an EditorProvider');
  }

  return context;
};

/**
 * Hook to access a specific module from the editor
 * @param moduleName - Name of the module to access
 */
export const useModule = <K extends keyof BlokModules>(moduleName: K): BlokModules[K] => {
  const { modules } = useEditor();

  return modules[moduleName];
};

/**
 * Hook to subscribe to editor events with automatic cleanup
 * @param eventName - Name of the event to subscribe to
 * @param handler - Event handler function
 */
export const useEditorEvent = <K extends keyof BlokEventMap>(
  eventName: K,
  handler: (data: BlokEventMap[K]) => void
): void => {
  const { eventsDispatcher } = useEditor();

  // Use useCallback to stabilize the handler reference
  const stableHandler = useCallback(handler, [handler]);

  // Subscribe on mount, unsubscribe on unmount
  useSyncExternalStore(
    (_onStoreChange) => {
      eventsDispatcher.on(eventName, stableHandler);

      return () => {
        eventsDispatcher.off(eventName, stableHandler);
      };
    },
    () => null, // getSnapshot - events don't have a snapshot
    () => null  // getServerSnapshot
  );
};

/**
 * Hook to get editor configuration
 */
export const useConfig = (): BlokConfig => {
  const { config } = useEditor();

  return config;
};

/**
 * Hook to check if editor is in read-only mode
 */
export const useReadOnly = (): boolean => {
  const { readOnly } = useEditor();

  return readOnly;
};

/**
 * Hook to check if editor is on mobile
 */
export const useIsMobile = (): boolean => {
  const { isMobile } = useEditor();

  return isMobile;
};
