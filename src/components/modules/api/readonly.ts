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
      set: (state): Promise<boolean> => this.set(state),
      get isEnabled(): boolean {
        return getIsEnabled();
      },
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
   * @returns {Promise<boolean>} the new read-only state
   */
  public set(state: boolean): Promise<boolean> {
    return this.Blok.ReadOnly.set(state);
  }

  /**
   * Returns current read-only state
   */
  public get isEnabled(): boolean {
    return this.Blok.ReadOnly.isEnabled;
  }
}
