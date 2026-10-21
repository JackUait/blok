import type { BlokConfig } from '../../../../types';
import type { AgentActor } from '../../../../types/agent';
import type { PageConfig } from '../../../../types/tools/page';
import type { HostService } from '../../../../types/tools/tool-description';
import type { LinkMetadataService, PageBackendService, UploaderService } from '../../../shared/tool-actions/services';
import { createPageMapBackend } from '../../../shared/agent/document-session';
import { Bookmark } from '../../../tools/link/bookmark';
import { MetadataFetcher } from '../../../tools/link/metadata-fetcher';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { PageDocuments } from '../agent/page-documents';

const isRename = (value: unknown): value is NonNullable<PageConfig['rename']> =>
  typeof value === 'function';

const isSetIcon = (value: unknown): value is NonNullable<PageConfig['setIcon']> =>
  typeof value === 'function';

export const createEditorServices = (
  Blok: BlokModules,
  config: BlokConfig,
  actor: () => AgentActor = () => ({ id: 'agent', name: 'Agent', kind: 'agent' }),
  pages: PageDocuments | null = null
): Partial<Record<HostService, unknown>> => {
  const services: Partial<Record<HostService, unknown>> = {};
  const tools = Array.from(Blok.Tools.blockTools.values());
  const openPage = pages?.open ?? null;

  if (openPage !== null || tools.some(tool => {
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
    const readBlock = (blockId: string): { type: string; data: Record<string, unknown> } | undefined => {
      const block = Blok.BlockManager.getBlockById(blockId);

      return block === undefined ? undefined : { type: block.name, data: block.preservedData };
    };
    // The host's own hooks win; the page's document is the fallback.
    const viaDocument = (): PageBackendService | null =>
      openPage === null ? null : createPageMapBackend(openPage, actor(), readBlock);
    const pageBackend: PageBackendService = {
      rename: async ({ blockId, title }) => {
        const { pageId, settings } = pageTarget(blockId);
        const fallback = isRename(settings.rename) ? null : viaDocument();

        if (fallback !== null) {
          return fallback.rename({ blockId, title });
        }
        if (!isRename(settings.rename)) {
          throw new Error(`Block "${blockId}" has no rename hook.`);
        }
        await settings.rename(pageId, title);

        return { pageId, applied: true };
      },
      setIcon: async ({ blockId, icon }) => {
        const { pageId, settings } = pageTarget(blockId);
        const fallback = isSetIcon(settings.setIcon) ? null : viaDocument();

        if (fallback !== null) {
          return fallback.setIcon({ blockId, icon });
        }
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
