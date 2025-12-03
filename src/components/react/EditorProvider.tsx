import React, { useMemo, useState, useEffect } from 'react';
import { EditorContext, type EditorContextValue } from './EditorContext';
import type { BlokModules } from '../../types-internal/blok-modules';
import type { BlokConfig } from '../../../types';
import type EventsDispatcher from '../utils/events';
import type { BlokEventMap } from '../events';
import { BlokMobileLayoutToggled } from '../events';

/**
 * Props for the EditorProvider component
 */
export interface EditorProviderProps {
  /**
   * All Blok module instances
   */
  modules: BlokModules;

  /**
   * Blok configuration
   */
  config: BlokConfig;

  /**
   * Internal event dispatcher
   */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;

  /**
   * Child React components
   */
  children?: React.ReactNode;
}

/**
 * EditorProvider component
 *
 * Wraps React components with editor context, providing access to
 * vanilla Blok modules and configuration.
 *
 * This is the bridge between vanilla TypeScript modules and React components.
 */
export const EditorProvider = ({
  modules,
  config,
  eventsDispatcher,
  children,
}: EditorProviderProps): React.ReactElement => {
  // Track read-only state reactively
  const [readOnly, setReadOnly] = useState(config.readOnly ?? false);

  // Track mobile state reactively
  const [isMobile, setIsMobile] = useState(modules.UI?.isMobile ?? false);

  // Subscribe to read-only changes
  useEffect(() => {
    // Initial sync
    if (modules.ReadOnly) {
      setReadOnly(modules.ReadOnly.isEnabled);
    }

    // The ReadOnly module doesn't emit events, but we can poll or use a different mechanism
    // For now, we'll rely on the initial value and manual updates via the adapter
    return () => {
      // Cleanup if needed
    };
  }, [modules.ReadOnly]);

  // Subscribe to mobile layout changes
  useEffect(() => {
    const handleMobileChange = (data: { isEnabled: boolean }): void => {
      setIsMobile(data.isEnabled);
    };

    eventsDispatcher.on(BlokMobileLayoutToggled, handleMobileChange);

    return () => {
      eventsDispatcher.off(BlokMobileLayoutToggled, handleMobileChange);
    };
  }, [eventsDispatcher]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<EditorContextValue>(() => ({
    modules,
    config,
    eventsDispatcher,
    readOnly,
    isMobile,
  }), [modules, config, eventsDispatcher, readOnly, isMobile]);

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};
