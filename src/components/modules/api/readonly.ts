import type { ReadOnly } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * @class ReadOnlyAPI
 * @classdesc ReadOnly API
 */
export class ReadOnlyAPI extends Module {
  /**
   * Available methods
   */
  public get methods(): ReadOnly {
    const getIsEnabled = (): boolean => this.isEnabled;


    return {
      toggle: (state): Promise<boolean> => this.toggle(state),
      set: (state, options): Promise<boolean> => this.set(state, options),
      get isEnabled(): boolean {
        return getIsEnabled();
      },
      togglesInPlace: true,
    };
  }

  /**
   * Set or toggle read-only state
   * @param {boolean|undefined} state - set or toggle state
   * @returns {boolean} current value
   */
  public toggle(state?: boolean): Promise<boolean> {
    return this.Blok.ReadOnly.toggle(state);
  }

  /**
   * Set read-only mode to the specified boolean state
   * @param {boolean} state - read-only state to set
   * @param options - optional read-only mode options
   * @param options.hideControls - hide all editor controls while read-only is active
   * @returns {Promise<boolean>} the new read-only state
   */
  public set(state: boolean, options?: { hideControls?: boolean }): Promise<boolean> {
    return this.Blok.ReadOnly.set(state, options);
  }

  /**
   * Returns current read-only state
   */
  public get isEnabled(): boolean {
    return this.Blok.ReadOnly.isEnabled;
  }
}
