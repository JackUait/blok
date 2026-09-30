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
      'relative mx-auto max-w-blok-content'
    ),
    actions: twJoin(
      'absolute flex opacity-0 pr-[5px]',
      'right-full',
      // Mobile styles
      'mobile:right-auto',
      // RTL styles
      'group-data-[blok-rtl=true]:right-auto group-data-[blok-rtl=true]:left-[calc(-1*(var(--spacing-toolbox-btn)))]',
      'mobile:group-data-[blok-rtl=true]:ml-0 mobile:group-data-[blok-rtl=true]:mr-auto mobile:group-data-[blok-rtl=true]:pr-0 mobile:group-data-[blok-rtl=true]:pl-[10px]'
    ),
    actionsOpened: 'opacity-100',
    settingsTogglerHidden: 'hidden',
  };
}
