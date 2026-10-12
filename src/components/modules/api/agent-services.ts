import type { BlokConfig } from '../../../../types';
import type { PageConfig } from '../../../../types/tools/page';
import type { HostService } from '../../../../types/tools/tool-description';
import type { LinkMetadataService, PageBackendService, UploaderService } from '../../../shared/tool-actions/services';
import { Bookmark } from '../../../tools/link/bookmark';
import { MetadataFetcher } from '../../../tools/link/metadata-fetcher';
import type { BlokModules } from '../../../types-internal/blok-modules';

const isRename = (value: unknown): value is NonNullable<PageConfig['rename']> =>
  typeof value === 'function';

const isSetIcon = (value: unknown): value is NonNullable<PageConfig['setIcon']> =>
  typeof value === 'function';

export const createEditorServices = (
  Blok: BlokModules,
  config: BlokConfig
): Partial<Record<HostService, unknown>> => {
  const services: Partial<Record<HostService, unknown>> = {};
  const tools = Array.from(Blok.Tools.blockTools.values());

  if (tools.some(tool => {
    const settings = tool.settings;

    return isRename(settings.rename) || isSetIcon(settings.setIcon);
  })) {
    const pageTarget = (blockId: string) => {
      const block = Blok.BlockManager.getBlockById(blockId);

      if (block === undefined) {
        throw new Error(`Page block "${blockId}" is missing.`);
      }
      const pageId = block.preservedData.pageId;

      if (typeof pageId !== 'string') {
        throw new Error(`Block "${blockId}" has no string pageId.`);
      }

      return { pageId, settings: block.tool.settings };
    };
    const pageBackend: PageBackendService = {
      rename: async ({ blockId, title }) => {
        const { pageId, settings } = pageTarget(blockId);

        if (!isRename(settings.rename)) {
          throw new Error(`Block "${blockId}" has no rename hook.`);
        }
        await settings.rename(pageId, title);

        return { pageId, applied: true };
      },
      setIcon: async ({ blockId, icon }) => {
        const { pageId, settings } = pageTarget(blockId);

        if (!isSetIcon(settings.setIcon)) {
          throw new Error(`Block "${blockId}" has no setIcon hook.`);
        }
        await settings.setIcon(pageId, icon);

        return { pageId, applied: true };
      },
    };

    services.pageBackend = pageBackend;
  }

  for (const tool of tools) {
    const settings = tool.settings;
    const endpoint = settings.endpoint;

    if (tool.toolClass !== Bookmark || typeof endpoint !== 'string' || endpoint === '') {
      continue;
    }
    const fetcher = new MetadataFetcher({ ...settings, endpoint });
    const linkMetadata: LinkMetadataService = { fetch: url => fetcher.fetch(url) };

    services.linkMetadata = linkMetadata;
    break;
  }

  const uploader = config.uploader;
  const uploadByUrl = uploader?.uploadByUrl;

  if (typeof uploadByUrl === 'function') {
    const uploaderService: UploaderService = {
      uploadByUrl: (url, context) => uploadByUrl.call(uploader, url, context),
    };

    services.uploader = uploaderService;
  }

  return services;
};
