/**
 * Fired when blok mobile layout toggled
 */
export const BlokMobileLayoutToggled = 'blok mobile layout toggled';

/**
 * Payload that will be passed with the event
 */
export interface BlokMobileLayoutToggledPayload {
  /**
   * True, if mobile layout enabled
   */
  isEnabled: boolean;
}

