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
  /** Flush pending editor writes and, during collaboration, wait for the server's
   * durable acknowledgement. Rejects on timeout or lost/quarantined work.
   * Local mode flushes the document only; host persistence remains its owner's job. */
  flush(timeoutMs?: number): Promise<void>;
}
