/**
 * React integration exports for Blok
 *
 * This module provides React components and hooks for building
 * React-based UI within Blok's editor infrastructure.
 */

export { EditorContext, useEditor, useModule, useEditorEvent, useConfig, useReadOnly, useIsMobile } from './EditorContext';
export type { EditorContextValue } from './EditorContext';

export { EditorProvider } from './EditorProvider';
export type { EditorProviderProps } from './EditorProvider';

export { InlineToolbarComponent } from './InlineToolbarComponent';
export type { InlineToolbarComponentProps, InlineToolbarComponentHandle } from './InlineToolbarComponent';

// Flipper context (keyboard navigation)
export {
  FlipperContext,
  FlipperProvider,
  useFlipperContext,
  useFlippableElement,
  FlipperUsedKeys,
} from './contexts';
export type {
  FlipperContextValue,
  FlipperProviderProps,
  FlipperProviderOptions,
} from './contexts';

// Hooks
export { usePopoverSearch, usePopoverPosition, useHistory } from './hooks';
export type {
  UsePopoverSearchReturn,
  UsePopoverSearchOptions,
  PopoverPosition,
  UsePopoverPositionOptions,
  UsePopoverPositionReturn,
  UseHistoryReturn,
} from './hooks';

// Search input component
export { SearchInputComponent } from './SearchInputComponent';
export type { SearchInputComponentProps, SearchInputComponentHandle } from './SearchInputComponent';

// Popover components
export { PopoverDesktopComponent } from './PopoverDesktopComponent';
export type { PopoverDesktopComponentProps, PopoverDesktopComponentHandle } from './PopoverDesktopComponent';

export { PopoverInlineComponent } from './PopoverInlineComponent';
export type { PopoverInlineComponentProps, PopoverInlineComponentHandle } from './PopoverInlineComponent';

