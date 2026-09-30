import type { Media } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * Media API: tools report failed media; hosts ask before leaving.
 */
export class MediaAPI extends Module {
  /**
   * @returns the public `api.media` methods
   */
  public get methods(): Media {
    return {
      reportFailure: (failure) => this.Blok.MediaFailures.report(failure),
      clearFailure: (blockId, options) => this.Blok.MediaFailures.clear(blockId, options),
      confirmLeave: () => this.Blok.MediaFailures.confirmLeave(),
    };
  }
}
