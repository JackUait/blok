import React, { useRef, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import type { InlineTool as IInlineTool } from '../../../types';
import type { PopoverItemParams } from '../utils/popover';
import { PopoverItemType } from '../utils/popover';
import { PopoverInline } from '../utils/popover/popover-inline';
import SelectionUtils from '../selection';
import * as _ from '../utils';
import I18n from '../i18n';
import { I18nInternalNS } from '../i18n/namespace-internal';
import { DATA_INTERFACE_ATTRIBUTE, INLINE_TOOLBAR_INTERFACE_VALUE } from '../constants';
import { twMerge } from '../utils/tw';
import type InlineToolAdapter from '../tools/inline';

/**
 * Props for the InlineToolbarComponent
 */
export interface InlineToolbarComponentProps {
  /**
   * Map of tool adapters to their instances
   */
  toolsMap: Map<InlineToolAdapter, IInlineTool>;

  /**
   * Element to scope the popover to
   */
  scopeElement: HTMLElement;

  /**
   * Wrapper element offset for positioning calculations
   */
  wrapperOffset: DOMRect;

  /**
   * Content area rect for overflow prevention
   */
  contentRect: DOMRect;

  /**
   * Vertical margin for toolbar positioning
   */
  toolbarVerticalMargin: number;

  /**
   * Callback when toolbar should close
   */
  onClose: () => void;

  /**
   * Callback when popover is ready and can be interacted with
   */
  onReady?: () => void;

  /**
   * Function to get tool shortcut
   */
  getToolShortcut: (toolName: string) => string | undefined;
}

/**
 * Imperative handle exposed by InlineToolbarComponent
 */
export interface InlineToolbarComponentHandle {
  /**
   * Get the wrapper DOM element
   */
  getWrapperElement: () => HTMLDivElement | null;

  /**
   * Close the toolbar and cleanup
   */
  close: () => void;

  /**
   * Get the popover instance for external control
   */
  getPopover: () => PopoverInline | null;
}

/**
 * Process a single popover item and return the items to add
 */
const processPopoverItem = (
  item: PopoverItemParams | HTMLElement,
  toolName: string,
  toolTitle: string,
  shortcutBeautified: string | undefined,
  isFirstItem: boolean
): PopoverItemParams[] => {
  const result: PopoverItemParams[] = [];

  const commonPopoverItemParams = {
    name: toolName,
    hint: {
      title: toolTitle,
      description: shortcutBeautified,
    },
  } as PopoverItemParams;

  // Skip raw HTMLElement items (legacy)
  if (item instanceof HTMLElement) {
    return result;
  }

  if (item.type === PopoverItemType.Html) {
    result.push({
      ...commonPopoverItemParams,
      ...item,
      type: PopoverItemType.Html,
    });

    return result;
  }

  if (item.type === PopoverItemType.Separator) {
    result.push({
      type: PopoverItemType.Separator,
    });

    return result;
  }

  // Default item
  const popoverItem = {
    ...commonPopoverItemParams,
    ...item,
    type: PopoverItemType.Default,
  } as PopoverItemParams;

  result.push(popoverItem);

  // Append separator after first item with children
  if ('children' in popoverItem && isFirstItem) {
    result.push({
      type: PopoverItemType.Separator,
    });
  }

  return result;
};

/**
 * InlineToolbarComponent - React component for rendering the inline toolbar
 *
 * This component manages:
 * - Wrapper div with proper styling and data attributes
 * - PopoverInline instance lifecycle via useLayoutEffect
 * - Position calculation based on selection rect
 * - Imperative handle for vanilla module communication
 */
export const InlineToolbarComponent = forwardRef<InlineToolbarComponentHandle, InlineToolbarComponentProps>(
  (
    {
      toolsMap,
      scopeElement,
      wrapperOffset,
      contentRect,
      toolbarVerticalMargin,
      onClose,
      onReady,
      getToolShortcut,
    },
    ref
  ) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<PopoverInline | null>(null);

    /**
     * Ref to store the onReady callback to avoid dependency changes
     */
    const onReadyRef = useRef(onReady);

    onReadyRef.current = onReady;

    /**
     * Build popover items from tools map
     */
    const buildPopoverItems = useCallback(async (): Promise<PopoverItemParams[]> => {
      const popoverItems: PopoverItemParams[] = [];
      const toolsEntries = Array.from(toolsMap.entries());

      for (const [index, [tool, instance]] of toolsEntries.entries()) {
        const renderedTool = await instance.render();
        const shortcut = getToolShortcut(tool.name);
        const shortcutBeautified = shortcut !== undefined ? _.beautifyShortcut(shortcut) : undefined;

        const toolTitle = I18n.t(
          I18nInternalNS.toolNames,
          tool.title || _.capitalize(tool.name)
        );

        const items = Array.isArray(renderedTool) ? renderedTool : [renderedTool];
        const isFirstItem = index === 0;

        for (const item of items) {
          const processed = processPopoverItem(item, tool.name, toolTitle, shortcutBeautified, isFirstItem);

          popoverItems.push(...processed);
        }
      }

      return popoverItems;
    }, [toolsMap, getToolShortcut]);

    /**
     * Calculate and apply position to wrapper
     */
    const applyPosition = useCallback((popoverWidth: number): void => {
      if (!wrapperRef.current) {
        return;
      }

      const selectionRect = SelectionUtils.rect as DOMRect;
      const newCoords = {
        x: selectionRect.x - wrapperOffset.x,
        y: selectionRect.y +
          selectionRect.height -
          wrapperOffset.top +
          toolbarVerticalMargin,
      };

      const realRightCoord = newCoords.x + popoverWidth + wrapperOffset.x;

      // Prevent overflow on right side
      if (realRightCoord > contentRect.right) {
        newCoords.x = contentRect.right - popoverWidth - wrapperOffset.x;
      }

      wrapperRef.current.style.left = Math.floor(newCoords.x) + 'px';
      wrapperRef.current.style.top = Math.floor(newCoords.y) + 'px';
    }, [wrapperOffset, contentRect, toolbarVerticalMargin]);

    /**
     * Initialize popover and position on mount
     */
    useLayoutEffect(() => {
      const mountedRef = { current: true };

      const initPopover = async (): Promise<void> => {
        if (!wrapperRef.current || !mountedRef.current) {
          return;
        }

        // Cleanup existing popover
        if (popoverRef.current) {
          popoverRef.current.destroy();
          popoverRef.current = null;
        }

        const popoverItems = await buildPopoverItems();

        if (!mountedRef.current) {
          return;
        }

        const popover = new PopoverInline({
          items: popoverItems,
          scopeElement,
          messages: {
            nothingFound: I18n.ui(I18nInternalNS.ui.popover, 'Nothing found'),
            search: I18n.ui(I18nInternalNS.ui.popover, 'Filter'),
          },
        });

        popoverRef.current = popover;

        // Use the React root container (display: contents) to avoid detaching the rendered popover
        // from its root, which breaks React's cleanup and causes removeChild errors on unmount.
        const popoverMountElement = popover.getMountElement?.() ?? popover.getElement?.();
        const popoverElement = popover.getElement?.();
        const popoverWidth = popover.size?.width
          ?? popoverElement?.getBoundingClientRect().width
          ?? 0;

        applyPosition(popoverWidth);

        if (popoverMountElement && wrapperRef.current) {
          wrapperRef.current.appendChild(popoverMountElement);
        }

        popover.show?.();

        // Notify that popover is ready for interaction
        onReadyRef.current?.();
      };

      void initPopover();

      return () => {
        mountedRef.current = false;
        if (popoverRef.current) {
          popoverRef.current.hide?.();
          popoverRef.current.destroy?.();
          popoverRef.current = null;
        }
      };
    }, [buildPopoverItems, scopeElement, applyPosition]);

    /**
     * Expose imperative handle
     */
    useImperativeHandle(ref, () => ({
      getWrapperElement: () => wrapperRef.current,

      close: () => {
        if (popoverRef.current) {
          popoverRef.current.hide?.();
          popoverRef.current.destroy?.();
          popoverRef.current = null;
        }
        onClose();
      },

      getPopover: () => popoverRef.current,
    }), [onClose]);

    return (
      <div
        ref={wrapperRef}
        className={twMerge('absolute top-0 left-0 z-[3] opacity-100 visible transition-opacity duration-[250ms] ease-out will-change-[opacity,left,top] [&_[hidden]]:!hidden')}
        {...{ [DATA_INTERFACE_ATTRIBUTE]: INLINE_TOOLBAR_INTERFACE_VALUE }}
        data-blok-testid="inline-toolbar"
      />
    );
  }
);

InlineToolbarComponent.displayName = 'InlineToolbarComponent';
