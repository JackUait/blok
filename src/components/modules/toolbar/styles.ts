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
      // Logical sides: docks in the inline-start gutter, so RTL mirrors for free.
      'absolute flex opacity-0 pe-[5px]',
      'end-full',
      // Mobile styles
      'mobile:end-auto'
    ),
    actionsOpened: 'opacity-100',
    settingsTogglerHidden: 'hidden',
  };
}
