import {OutputData} from '../data-formats/output-data';

/**
 * Describes Blok`s saver API
 */
export interface Saver {
  /**
   * Saves Blok's data and returns promise with it
   *
   * @returns {Promise<OutputData>}
   */
  save(): Promise<OutputData>;
}
