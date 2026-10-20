import type { Media } from '../../../../types/api';
import { Module } from '../../__module';
import { askLeave } from '../../utils/leave-guards';

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
      // Open drafts (the layout builder) ask first; the image banner only once they let go.
      confirmLeave: async () => (await askLeave(this.Blok.UI.nodes.wrapper)) && this.Blok.MediaFailures.confirmLeave(),
    };
  }
}
