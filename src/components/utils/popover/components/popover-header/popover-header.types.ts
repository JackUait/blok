/**
 * Popover header params
 */
export interface PopoverHeaderParams {
  /**
   * Text to be displayed inside header
   */
  text: string;

  /**
   * Back button click handler
   */
  onBackButtonClick: () => void;

  /**
   * Accessible label for the icon-only back button (e.g. "Back"). When omitted
   * no `aria-label` is set.
   */
  backButtonLabel?: string;
}
