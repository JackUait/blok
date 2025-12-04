import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  type RefObject,
} from 'react';
import * as _ from '../../utils';
import Dom from '../../dom';
import SelectionUtils from '../../selection';
import type Flipper from '../../flipper';

/**
 * Directions for keyboard navigation
 */
const DIRECTIONS = {
  RIGHT: 'right',
  LEFT: 'left',
} as const;

type Direction = typeof DIRECTIONS[keyof typeof DIRECTIONS];

/**
 * Options for FlipperProvider configuration
 */
export interface FlipperProviderOptions {
  /**
   * CSS class applied to focused items
   */
  focusedItemClass?: string;

  /**
   * Allow handling keyboard events from contenteditable elements
   */
  handleContentEditableTargets?: boolean;

  /**
   * List of allowed key codes for navigation
   * If not specified, all navigation keys are enabled
   */
  allowedKeys?: number[];

  /**
   * Callback when an item is activated (Enter pressed)
   */
  onActivate?: (item: HTMLElement) => void;

  /**
   * External vanilla Flipper instance to bridge.
   * When provided, the context delegates all operations to this instance
   * instead of managing its own state.
   */
  externalFlipper?: Flipper;
}

/**
 * Context value exposed by FlipperProvider
 * @internal
 */
export interface FlipperContextValue {
  /**
   * Activate keyboard navigation with optional items and cursor position
   */
  activate: (items?: HTMLElement[], cursorPosition?: number) => void;

  /**
   * Deactivate keyboard navigation
   */
  deactivate: () => void;

  /**
   * Focus the first item
   */
  focusFirst: () => void;

  /**
   * Focus item at specified position
   * @param position - index to focus, negative value clears focus
   */
  focusItem: (position: number) => void;

  /**
   * Navigate to previous item
   */
  flipLeft: () => void;

  /**
   * Navigate to next item
   */
  flipRight: () => void;

  /**
   * Check if any item has focus
   */
  hasFocus: () => boolean;

  /**
   * Register a callback to execute on each flip
   */
  onFlip: (callback: () => void) => void;

  /**
   * Unregister a flip callback
   */
  removeOnFlip: (callback: () => void) => void;

  /**
   * Whether flipper is currently activated
   */
  isActivated: boolean;

  /**
   * Currently focused item element
   */
  currentItem: HTMLElement | null;

  /**
   * Enable/disable handling of contenteditable targets
   */
  setHandleContentEditableTargets: (value: boolean) => void;

  /**
   * Handle external keydown event
   */
  handleExternalKeydown: (event: KeyboardEvent) => void;

  /**
   * Register an element as flippable
   */
  registerElement: (element: HTMLElement) => void;

  /**
   * Unregister a flippable element
   */
  unregisterElement: (element: HTMLElement) => void;

  /**
   * Update the items list
   */
  setItems: (items: HTMLElement[]) => void;
}

/**
 * React context for keyboard navigation
 * @internal
 */
export const FlipperContext = createContext<FlipperContextValue | null>(null);

/**
 * Hook to access FlipperContext
 * @throws Error if used outside FlipperProvider
 * @internal
 */
export const useFlipperContext = (): FlipperContextValue => {
  const context = useContext(FlipperContext);

  if (context === null) {
    throw new Error('useFlipperContext must be used within a FlipperProvider');
  }

  return context;
};

/**
 * Props for FlipperProvider component
 * @internal
 */
export interface FlipperProviderProps {
  /**
   * Configuration options
   */
  options?: FlipperProviderOptions;

  /**
   * Child components
   */
  children: ReactNode;
}

/**
 * Array of key codes handled by Flipper
 */
const USED_KEYS = [
  _.keyCodes.TAB,
  _.keyCodes.LEFT,
  _.keyCodes.RIGHT,
  _.keyCodes.ENTER,
  _.keyCodes.UP,
  _.keyCodes.DOWN,
];

/**
 * Map keyboard event.key to keyCode for backward compatibility
 */
const KEY_TO_CODE_MAP: Record<string, number> = {
  'Tab': _.keyCodes.TAB,
  'Enter': _.keyCodes.ENTER,
  'ArrowLeft': _.keyCodes.LEFT,
  'ArrowRight': _.keyCodes.RIGHT,
  'ArrowUp': _.keyCodes.UP,
  'ArrowDown': _.keyCodes.DOWN,
};

/**
 * Default options for FlipperProvider to avoid unstable default prop
 */
const DEFAULT_OPTIONS: FlipperProviderOptions = {};

/**
 * FlipperProvider component
 *
 * Provides keyboard navigation context for popover items and other
 * navigable elements. Replaces vanilla Flipper + DomIterator classes.
 *
 * When an externalFlipper is provided, all operations are delegated to it,
 * allowing vanilla Flipper instances (like BlockSettings.flipperInstance)
 * to control keyboard navigation inside React-rendered popovers.
 *
 * @internal
 */
export const FlipperProvider = ({
  options = DEFAULT_OPTIONS,
  children,
}: FlipperProviderProps): React.ReactElement => {
  const {
    focusedItemClass = '',
    handleContentEditableTargets: initialHandleContentEditable = false,
    allowedKeys = USED_KEYS,
    onActivate,
    externalFlipper,
  } = options;

  // State (only used when no external flipper)
  const [isActivated, setIsActivated] = useState(false);
  const [cursor, setCursor] = useState(-1);

  // Refs
  const itemsRef = useRef<HTMLElement[]>([]);
  const flipCallbacksRef = useRef<Array<() => void>>([]);
  const handleContentEditableRef = useRef(initialHandleContentEditable);
  const skipNextTabFocusRef = useRef(false);
  const allowedKeysRef = useRef(allowedKeys);
  const onActivateRef = useRef(onActivate);
  const focusedItemClassRef = useRef(focusedItemClass);
  const externalFlipperRef = useRef(externalFlipper);

  // Keep refs in sync with props
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    allowedKeysRef.current = allowedKeys;
  }, [allowedKeys]);

  useEffect(() => {
    focusedItemClassRef.current = focusedItemClass;
  }, [focusedItemClass]);

  useEffect(() => {
    externalFlipperRef.current = externalFlipper;
  }, [externalFlipper]);

  /**
   * Get current item based on cursor position
   */
  const currentItem = useMemo(() => {
    if (cursor === -1 || cursor >= itemsRef.current.length) {
      return null;
    }

    return itemsRef.current[cursor];
  }, [cursor]);

  /**
   * Apply focus styling to item at index
   */
  const applyFocusStyle = useCallback((index: number) => {
    const item = itemsRef.current[index];

    if (!item) {
      return;
    }

    if (focusedItemClassRef.current) {
      item.classList.add(focusedItemClassRef.current);
    }
    item.setAttribute('data-blok-focused', 'true');
  }, []);

  /**
   * Remove focus styling from item at index
   */
  const removeFocusStyle = useCallback((index: number) => {
    const item = itemsRef.current[index];

    if (!item) {
      return;
    }

    if (focusedItemClassRef.current) {
      item.classList.remove(focusedItemClassRef.current);
    }
    item.removeAttribute('data-blok-focused');
  }, []);

  /**
   * Drop cursor to default position
   */
  const dropCursor = useCallback(() => {
    if (cursor !== -1) {
      removeFocusStyle(cursor);
    }
    setCursor(-1);
  }, [cursor, removeFocusStyle]);

  /**
   * Calculate next index based on direction (circular navigation)
   */
  const calculateNextIndex = useCallback((direction: Direction): number => {
    const items = itemsRef.current;

    if (items.length === 0) {
      return -1;
    }

    const currentCursor = cursor;
    const defaultIndex = direction === DIRECTIONS.RIGHT ? -1 : 0;
    const startingIndex = currentCursor === -1 ? defaultIndex : currentCursor;

    if (direction === DIRECTIONS.RIGHT) {
      return (startingIndex + 1) % items.length;
    }

    // LEFT direction - handle negative modulo
    return (items.length + startingIndex - 1) % items.length;
  }, [cursor]);

  /**
   * Navigate in specified direction
   */
  const flip = useCallback((direction: Direction) => {
    const items = itemsRef.current;

    if (items.length === 0) {
      return;
    }

    // Remove styling from current item
    if (cursor !== -1) {
      removeFocusStyle(cursor);
    }

    const nextIndex = calculateNextIndex(direction);

    // Apply focus to new item
    applyFocusStyle(nextIndex);

    // Handle input focus
    const nextItem = items[nextIndex];

    if (nextItem && Dom.canSetCaret(nextItem)) {
      _.delay(() => SelectionUtils.setCursor(nextItem), 50)();
    }

    // Scroll into view if needed
    const scrollMethod = (nextItem as HTMLElement & { scrollIntoViewIfNeeded?: () => void })?.scrollIntoViewIfNeeded;

    if (scrollMethod) {
      scrollMethod.call(nextItem);
    }

    setCursor(nextIndex);

    // Execute flip callbacks
    flipCallbacksRef.current.forEach(cb => cb());
  }, [cursor, calculateNextIndex, applyFocusStyle, removeFocusStyle]);

  /**
   * Navigate to next item
   */
  const flipRight = useCallback(() => {
    flip(DIRECTIONS.RIGHT);
  }, [flip]);

  /**
   * Navigate to previous item
   */
  const flipLeft = useCallback(() => {
    flip(DIRECTIONS.LEFT);
  }, [flip]);

  /**
   * Focus the first item
   */
  const focusFirst = useCallback(() => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.focusFirst();

      return;
    }
    dropCursor();
    flipRight();
  }, [dropCursor, flipRight]);

  /**
   * Focus item at specific position
   */
  const focusItem = useCallback((position: number) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.focusItem(position);

      return;
    }

    const items = itemsRef.current;

    if (items.length === 0) {
      return;
    }

    if (position < 0) {
      dropCursor();

      return;
    }

    if (cursor === -1 && position === 0) {
      skipNextTabFocusRef.current = true;
    }

    if (position >= items.length) {
      return;
    }

    // Remove styling from current item
    if (cursor !== -1) {
      removeFocusStyle(cursor);
    }

    // Apply styling to new item
    applyFocusStyle(position);
    setCursor(position);
  }, [cursor, dropCursor, applyFocusStyle, removeFocusStyle]);

  /**
   * Check if any item has focus
   */
  const hasFocus = useCallback((): boolean => {
    if (externalFlipperRef.current) {
      return externalFlipperRef.current.hasFocus();
    }

    return cursor !== -1;
  }, [cursor]);

  /**
   * Register flip callback
   */
  const onFlip = useCallback((callback: () => void) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.onFlip(callback);

      return;
    }
    flipCallbacksRef.current.push(callback);
  }, []);

  /**
   * Unregister flip callback
   */
  const removeOnFlip = useCallback((callback: () => void) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.removeOnFlip(callback);

      return;
    }
    flipCallbacksRef.current = flipCallbacksRef.current.filter(fn => fn !== callback);
  }, []);

  /**
   * Set items list
   */
  const setItems = useCallback((items: HTMLElement[]) => {
    itemsRef.current = items;
  }, []);

  /**
   * Register element as flippable
   */
  const registerElement = useCallback((element: HTMLElement) => {
    if (!itemsRef.current.includes(element)) {
      itemsRef.current.push(element);
    }
  }, []);

  /**
   * Unregister flippable element
   */
  const unregisterElement = useCallback((element: HTMLElement) => {
    const index = itemsRef.current.indexOf(element);

    if (index === -1) {
      return;
    }

    itemsRef.current.splice(index, 1);
    // Adjust cursor if needed
    if (cursor >= itemsRef.current.length) {
      setCursor(itemsRef.current.length - 1);
    }
  }, [cursor]);

  /**
   * Set handleContentEditableTargets
   */
  const setHandleContentEditableTargets = useCallback((value: boolean) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.setHandleContentEditableTargets(value);

      return;
    }
    handleContentEditableRef.current = value;
  }, []);

  /**
   * Check if target should be skipped
   */
  const shouldSkipTarget = useCallback((target: HTMLElement | null, event: KeyboardEvent): boolean => {
    if (!target) {
      return false;
    }

    const isNativeInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const isNavigationKey = event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const shouldHandleNativeInput = target.getAttribute('data-blok-flipper-navigation-target') === 'true' && isNavigationKey;
    const isContentEditable = target.isContentEditable;
    const isInlineToolInput = target.closest('[data-blok-link-tool-input-opened="true"]') !== null;

    const shouldSkipContentEditable = isContentEditable && !handleContentEditableRef.current;

    return (isNativeInput && !shouldHandleNativeInput) || shouldSkipContentEditable || isInlineToolInput;
  }, []);

  /**
   * Get keyCode from keyboard event
   */
  const getKeyCode = useCallback((event: KeyboardEvent): number | null => {
    return KEY_TO_CODE_MAP[event.key] ?? null;
  }, []);

  /**
   * Check if event is ready for handling
   */
  const isEventReadyForHandling = useCallback((event: KeyboardEvent, activated: boolean): boolean => {
    const keyCode = getKeyCode(event);

    return activated && keyCode !== null && allowedKeysRef.current.includes(keyCode);
  }, [getKeyCode]);

  /**
   * Handle Tab press
   */
  const handleTabPress = useCallback((event: KeyboardEvent) => {
    const direction = event.shiftKey ? DIRECTIONS.LEFT : DIRECTIONS.RIGHT;

    if (skipNextTabFocusRef.current) {
      skipNextTabFocusRef.current = false;

      return;
    }

    if (direction === DIRECTIONS.RIGHT) {
      flipRight();
    } else {
      flipLeft();
    }
  }, [flipLeft, flipRight]);

  /**
   * Handle Enter press
   */
  const handleEnterPress = useCallback((event: KeyboardEvent) => {
    const item = itemsRef.current[cursor];

    if (!item) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    item.click();
    onActivateRef.current?.(item);
  }, [cursor]);

  /**
   * Main keydown handler
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (shouldSkipTarget(target, event)) {
      return;
    }

    const keyCode = getKeyCode(event);
    const isDirectionalArrow = keyCode === _.keyCodes.LEFT
      || keyCode === _.keyCodes.RIGHT
      || keyCode === _.keyCodes.UP
      || keyCode === _.keyCodes.DOWN;

    // Allow text selection with Shift+Arrow
    if (event.shiftKey && isDirectionalArrow) {
      return;
    }

    if (!isEventReadyForHandling(event, isActivated)) {
      return;
    }

    // For Enter, only handle if there's a focused item
    if (keyCode === _.keyCodes.ENTER && cursor === -1) {
      return;
    }

    event.stopPropagation();
    event.stopImmediatePropagation();

    if (keyCode !== null && USED_KEYS.includes(keyCode)) {
      event.preventDefault();
    }

    switch (keyCode) {
      case _.keyCodes.TAB:
        handleTabPress(event);
        break;
      case _.keyCodes.LEFT:
      case _.keyCodes.UP:
        flipLeft();
        break;
      case _.keyCodes.RIGHT:
      case _.keyCodes.DOWN:
        flipRight();
        break;
      case _.keyCodes.ENTER:
        handleEnterPress(event);
        break;
    }
  }, [
    shouldSkipTarget,
    getKeyCode,
    isEventReadyForHandling,
    isActivated,
    cursor,
    handleTabPress,
    flipLeft,
    flipRight,
    handleEnterPress,
  ]);

  /**
   * Handle external keydown (for delegation)
   */
  const handleExternalKeydown = useCallback((event: KeyboardEvent) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.handleExternalKeydown(event);

      return;
    }
    handleKeyDown(event);
  }, [handleKeyDown]);

  /**
   * Activate keyboard navigation
   */
  const activate = useCallback((items?: HTMLElement[], cursorPosition?: number) => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.activate(items, cursorPosition);

      return;
    }

    if (items) {
      itemsRef.current = items;
    }

    if (cursorPosition === undefined) {
      setIsActivated(true);

      return;
    }

    // cursorPosition is defined - handle focus style updates
    if (cursor !== -1) {
      removeFocusStyle(cursor);
    }

    if (cursorPosition >= 0 && cursorPosition < itemsRef.current.length) {
      applyFocusStyle(cursorPosition);
    }

    setCursor(cursorPosition);
    setIsActivated(true);
  }, [cursor, applyFocusStyle, removeFocusStyle]);

  /**
   * Deactivate keyboard navigation
   */
  const deactivate = useCallback(() => {
    if (externalFlipperRef.current) {
      externalFlipperRef.current.deactivate();

      return;
    }
    setIsActivated(false);
    dropCursor();
    skipNextTabFocusRef.current = false;
  }, [dropCursor]);

  /**
   * Attach/detach keydown listeners based on activation state
   */
  useEffect(() => {
    if (isActivated) {
      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('keydown', handleKeyDown, true);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isActivated, handleKeyDown]);

  /**
   * Whether flipper is currently activated (checks external flipper if provided)
   */
  const isFlipperActivated = useMemo(() => {
    if (externalFlipperRef.current) {
      return externalFlipperRef.current.isActivated;
    }

    return isActivated;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- externalFlipper triggers re-check when it changes
  }, [isActivated, externalFlipper]);

  /**
   * Context value
   */
  const contextValue = useMemo<FlipperContextValue>(() => ({
    activate,
    deactivate,
    focusFirst,
    focusItem,
    flipLeft,
    flipRight,
    hasFocus,
    onFlip,
    removeOnFlip,
    isActivated: isFlipperActivated,
    currentItem,
    setHandleContentEditableTargets,
    handleExternalKeydown,
    registerElement,
    unregisterElement,
    setItems,
  }), [
    activate,
    deactivate,
    focusFirst,
    focusItem,
    flipLeft,
    flipRight,
    hasFocus,
    onFlip,
    removeOnFlip,
    isFlipperActivated,
    currentItem,
    setHandleContentEditableTargets,
    handleExternalKeydown,
    registerElement,
    unregisterElement,
    setItems,
  ]);

  return (
    <FlipperContext.Provider value={contextValue}>
      {children}
    </FlipperContext.Provider>
  );
};

/**
 * Hook to register an element as flippable
 * Automatically registers on mount and unregisters on unmount
 * @param ref - React ref to the element
 * @internal
 */
export const useFlippableElement = (ref: RefObject<HTMLElement | null>): void => {
  const { registerElement, unregisterElement } = useFlipperContext();

  useLayoutEffect(() => {
    const element = ref.current;

    if (element) {
      registerElement(element);
    }

    return () => {
      if (element) {
        unregisterElement(element);
      }
    };
  }, [ref, registerElement, unregisterElement]);
};

/**
 * Static property exposing used key codes
 * Matches vanilla Flipper.usedKeys for compatibility
 * @internal
 */
export const FlipperUsedKeys = USED_KEYS;
