import type { Uploader as UploaderAPIInterface } from '../../../../types/api';
import type { AssetKind } from '../../../../types/tools/block-tool';
import { Module } from '../../__module';
import {
  collectAssetUploaderSources,
  hasAssetUploader,
  uploadAssetFile,
  uploadAssetUrl,
  type AssetUploaderSources,
} from '../../utils/asset-uploader';

/**
 * Routes asset uploads by asset kind instead of by the tool that asked, so a
 * tool holding an asset outside its own media family (audio cover art) reaches
 * the pipeline that owns that kind.
 */
export class UploaderAPI extends Module {
  /**
   * Available methods
   */
  public get methods(): UploaderAPIInterface {
    return {
      uploadByFile: (file, ctx) => uploadAssetFile(file, ctx, this.sources),
      uploadByUrl: (url, ctx) => uploadAssetUrl(url, ctx, this.sources),
      isConfigured: (kind: AssetKind, method) => hasAssetUploader(kind, this.sources, method),
    };
  }

  /**
   * Uploaders currently registered, recomputed per call so a runtime
   * `tools.update()` that swaps an uploader takes effect immediately.
   */
  private get sources(): AssetUploaderSources {
    return collectAssetUploaderSources(this.Blok.Tools.blockTools.values(), this.config.uploader);
  }
}
