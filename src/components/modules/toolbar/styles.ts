import { twJoin } from '../../utils/tw';

/**
 * CSS styles for toolbar elements
 * @deprecated Use data attributes via constants instead
 */
export const getToolbarStyles = (): { [name: string]: string } => {
  return {
    toolbar: twJoin(
      'absolute left-0 right-0 top-0 h-toolbox-btn transition-opacity duration-100 ease-linear will-change-[opacity,top]',
      // Don't intercept pointer events - let them pass through to the block
      'pointer-events-none'
    ),
    toolbarOpened: 'block',
    toolbarClosed: 'hidden',
    content: twJoin(
      'relative mx-auto max-w-content'
    ),
    actions: twJoin(
      'absolute flex opacity-0 pr-[5px]',
      'right-full',
      // Re-enable pointer events for interactive elements
      'pointer-events-auto',
      // Mobile styles
      'mobile:right-auto',
      // RTL styles
      'group-data-[blok-rtl=true]:right-auto group-data-[blok-rtl=true]:left-[calc(-1*(var(--width-toolbox-btn)))]',
      'mobile:group-data-[blok-rtl=true]:ml-0 mobile:group-data-[blok-rtl=true]:mr-auto mobile:group-data-[blok-rtl=true]:pr-0 mobile:group-data-[blok-rtl=true]:pl-[10px]'
    ),
    actionsOpened: 'opacity-100',

    plusButton: twJoin(
      // Base toolbox-button styles
      'text-dark cursor-pointer w-toolbox-btn h-toolbox-btn rounded-[7px] inline-flex justify-center items-center select-none',
      'shrink-0',
      // SVG sizing
      '[&_svg]:h-6 [&_svg]:w-6',
      // Hover (can-hover)
      'can-hover:hover:bg-bg-light',
      // Keep hover background when toolbox is opened
      'group-data-[blok-toolbox-opened=true]:bg-bg-light',
      // Mobile styles (static positioning with overlay-pane appearance)
      'mobile:bg-white mobile:border mobile:border-[#e8e8eb] mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-2',
      'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
      // RTL styles
      'group-data-[blok-rtl=true]:right-[calc(-1*(var(--width-toolbox-btn)))] group-data-[blok-rtl=true]:left-auto',
      // Narrow mode (not-mobile)
      'not-mobile:group-data-[blok-narrow=true]:left-[5px]',
      // Narrow mode RTL (not-mobile)
      'not-mobile:group-data-[blok-rtl=true]:group-data-[blok-narrow=true]:left-0 not-mobile:group-data-[blok-rtl=true]:group-data-[blok-narrow=true]:right-[5px]'
    ),
    plusButtonShortcutKey: 'text-white',
    /**
     * Data attribute selector used for SortableJS for drag handle
     */
    settingsToggler: twJoin(
      // Base toolbox-button styles
      'text-dark cursor-pointer w-toolbox-btn h-toolbox-btn rounded-[7px] inline-flex justify-center items-center select-none',
      'cursor-pointer select-none',
      // SVG sizing
      '[&_svg]:h-6 [&_svg]:w-6',
      // Active state
      'active:cursor-grabbing',
      // Hover (can-hover)
      'can-hover:hover:bg-bg-light can-hover:hover:cursor-grab',
      // When toolbox is opened, use pointer cursor on hover
      'can-hover:hover:group-data-[blok-toolbox-opened=true]:cursor-pointer',
      // When block settings is opened, show hover background and pointer cursor
      'group-data-[blok-block-settings-opened=true]:bg-bg-light',
      'can-hover:hover:group-data-[blok-block-settings-opened=true]:cursor-pointer',
      // Mobile styles (static positioning with overlay-pane appearance)
      'mobile:bg-white mobile:border mobile:border-[#e8e8eb] mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-2',
      'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
      // Not-mobile styles
      'not-mobile:w-6'
    ),
    settingsTogglerHidden: 'hidden',
  };
}
