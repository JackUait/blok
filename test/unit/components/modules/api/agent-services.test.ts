import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Core } from '../../../../../src/components/core';
import { createEditorServices } from '../../../../../src/components/modules/api/agent-services';
import type {
  LinkMetadataService,
  PageBackendService,
  UploaderService,
} from '../../../../../src/shared/tool-actions/services';
import { ImageTool } from '../../../../../src/tools/image';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { PageTool } from '../../../../../src/tools/page';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Agent, API, BlokConfig, BlockTool, BlockToolConstructorOptions } from '../../../../../types';
import type { BlokUploader, UploadedAsset, UploadContext } from '../../../../../types/configs/uploader';
import type { BookmarkMeta } from '../../../../../types/tools/bookmark';
import type { ImageUploader } from '../../../../../types/tools/image';
import type { PageConfig, PageIcon } from '../../../../../types/tools/page';
import type { BlockToolDescription, HostService, ToolActionImpl } from '../../../../../types/tools/tool-description';

type EditorServices = Partial<Record<HostService, unknown>>;
type UrlUploader = Required<UploaderService>;
type PageMethod = 'rename' | 'setIcon';
type PublicEditorApi = {
  agent: Pick<Agent, 'tools' | 'begin'>;
  blocks: Pick<API['blocks'], 'render'>;
  saver: Pick<API['saver'], 'save'>;
};
type Booted = { api: PublicEditorApi; modules: BlokModules; config: BlokConfig };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPublicEditorApi = (value: unknown): value is PublicEditorApi =>
  isRecord(value)
  && isRecord(value.agent) && typeof value.agent.tools === 'function' && typeof value.agent.begin === 'function'
  && isRecord(value.blocks) && typeof value.blocks.render === 'function'
  && isRecord(value.saver) && typeof value.saver.save === 'function';

const isPageBackend = (value: unknown): value is PageBackendService =>
  isRecord(value) && typeof value.rename === 'function' && typeof value.setIcon === 'function';

const isLinkMetadata = (value: unknown): value is LinkMetadataService =>
  isRecord(value) && typeof value.fetch === 'function';

const isUrlUploader = (value: unknown): value is UrlUploader =>
  isRecord(value) && typeof value.uploadByUrl === 'function';

const pageBackendOf = (services: EditorServices): PageBackendService => {
  if (!isPageBackend(services.pageBackend)) {
    throw new Error('The configured pageBackend service is missing.');
  }

  return services.pageBackend;
};

const linkMetadataOf = (services: EditorServices): LinkMetadataService => {
  if (!isLinkMetadata(services.linkMetadata)) {
    throw new Error('The configured linkMetadata service is missing.');
  }

  return services.linkMetadata;
};

const uploaderOf = (services: EditorServices): UrlUploader => {
  if (!isUrlUploader(services.uploader)) {
    throw new Error('The configured uploader service is missing.');
  }

  return services.uploader;
};

const editors: Blok[] = [];
const serviceSnapshots: EditorServices[] = [];

class BootedEditor extends Blok {
  public booted: Booted | undefined;

  public override exportAPI(core: Core): void {
    super.exportAPI(core);
    if (!isPublicEditorApi(this)) {
      throw new Error('Blok did not export the required public agent, blocks and saver methods.');
    }

    this.booted = {
      api: { agent: this.agent, blocks: this.blocks, saver: this.saver },
      modules: core.moduleInstances,
      config: core.configuration,
    };
  }
}

const boot = async (options: BlokConfig = {}): Promise<Booted> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    ...options,
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, ...options.tools },
    data: options.data ?? {
      blocks: [{ id: 'note', type: 'paragraph', data: { text: [{ text: 'Seed' }] } }],
    },
  });

  editors.push(editor);
  await editor.isReady;
  const ready = editor.booted;

  if (ready === undefined) {
    throw new Error('The ready editor did not export its public API.');
  }

  return ready;
};

// PageTool normalizes malformed ids; this real custom tool preserves the rejection fixtures.
class PointerFixture implements BlockTool {
  public static isReadOnlySupported = true;

  private readonly data: Record<string, unknown>;

  public constructor({ data }: BlockToolConstructorOptions<Record<string, unknown>, Record<string, unknown>>) {
    this.data = { ...data };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = 'Pointer fixture';

    return element;
  }

  public save(): Record<string, unknown> {
    return { ...this.data };
  }
}

class ServiceFixtureParagraph extends Paragraph {
  public static override describe = (): BlockToolDescription => ({
    ...Paragraph.describe(),
    summary: 'A fixture that writes host service results into text.',
    actions: [{
      name: 'resolve',
      summary: 'Resolve the configured host services.',
      target: 'block',
      effects: 'host',
      requires: ['pageBackend', 'linkMetadata', 'uploader'],
      args: {
        type: 'object',
        required: ['pageBlockId', 'url', 'title'],
        additionalProperties: false,
        properties: {
          pageBlockId: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
        },
      },
    }],
  });

  public static actionHandlers: Readonly<Record<string, ToolActionImpl>> = {
    resolve: {
      prepare: async ({ services }, args) => {
        if (!isRecord(args) || typeof args.pageBlockId !== 'string'
          || typeof args.url !== 'string' || typeof args.title !== 'string') {
          throw new Error('Expected pageBlockId, url and title.');
        }

        serviceSnapshots.push(services);
        const page = await pageBackendOf(services).rename({ blockId: args.pageBlockId, title: args.title });
        const metadata = await linkMetadataOf(services).fetch(args.url);
        const upload = await uploaderOf(services).uploadByUrl(args.url, { kind: 'image', tool: 'servicefixture' });

        return { page, metadata, upload };
      },
      run: (ctx, _args, prepared) => {
        if (ctx.block === undefined || !isRecord(prepared)
          || !isRecord(prepared.metadata) || typeof prepared.metadata.title !== 'string'
          || !isRecord(prepared.upload) || typeof prepared.upload.url !== 'string') {
          return ctx.fail('INVALID_ARGS', 'Expected prepared metadata and upload results.');
        }

        ctx.setRichText(ctx.block.id, 'text', [{
          text: `${prepared.metadata.title}: ${prepared.upload.url}`,
        }]);

        return prepared;
      },
    },
  };
}

const callPage = (backend: PageBackendService, method: PageMethod, blockId: string): Promise<unknown> =>
  method === 'rename'
    ? backend.rename({ blockId, title: 'Roadmap' })
    : backend.setIcon({ blockId, icon: null });

const METADATA: BookmarkMeta = {
  url: 'https://site.example/canonical',
  title: 'Fetched title',
  description: 'Fetched description',
  image: 'https://site.example/cover.png',
  favicon: 'https://site.example/favicon.ico',
  domain: 'site.example',
};

const metadataResponse = (): Response => new Response(JSON.stringify({
  success: 1,
  link: METADATA.url,
  meta: {
    title: METADATA.title,
    description: METADATA.description,
    image: { url: METADATA.image },
    favicon: METADATA.favicon,
    domain: METADATA.domain,
  },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  serviceSnapshots.splice(0);
  localStorage.clear();
});

afterEach(() => {
  const errors: unknown[] = [];

  try {
    editors.splice(0).forEach(editor => {
      try {
        editor.destroy();
      } catch (error) {
        errors.push(error);
      }
    });
  } finally {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Test editor cleanup failed.');
  }
});

describe('createEditorServices with booted modules', () => {
  it('offers no services when the host configured none', async () => {
    const { modules, config } = await boot({
      tools: { page: PageTool, bookmark: Bookmark, image: ImageTool },
    });

    expect(Object.keys(createEditorServices(modules, config))).toEqual([]);
  });

  it('does not treat non-function page hooks as a configured backend', async () => {
    const { modules, config } = await boot({
      tools: { page: { class: PageTool, rename: 'not-a-hook', setIcon: 17 } },
    });

    expect(createEditorServices(modules, config)).not.toHaveProperty('pageBackend');
  });

  it.each(['rename', 'setIcon'] satisfies PageMethod[])(
    'offers pageBackend for %s alone and rejects the absent counterpart',
    async method => {
      const rename = vi.fn<NonNullable<PageConfig['rename']>>();
      const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
      const { modules, config } = await boot({
        tools: { page: { class: PageTool, ...(method === 'rename' ? { rename } : { setIcon }) } },
        data: { blocks: [{ id: 'source-page', type: 'page', data: { pageId: 'pg-source' } }] },
      });
      const backend = pageBackendOf(createEditorServices(modules, config));
      const absentMethod = method === 'rename' ? 'setIcon' : 'rename';

      await expect(callPage(backend, absentMethod, 'source-page')).rejects.toThrow(/source-page/);
      expect(rename).not.toHaveBeenCalled();
      expect(setIcon).not.toHaveBeenCalled();
      await expect(callPage(backend, method, 'source-page')).resolves.toEqual({
        pageId: 'pg-source', applied: true,
      });
      if (method === 'rename') {
        expect(rename).toHaveBeenCalledExactlyOnceWith('pg-source', 'Roadmap');
      } else {
        expect(setIcon).toHaveBeenCalledExactlyOnceWith('pg-source', null);
      }
    }
  );

  it('reads the replacement source block and routes its preserved pageId to its own hooks', async () => {
    const oldRename = vi.fn<NonNullable<PageConfig['rename']>>();
    const oldSetIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
    const rename = vi.fn<NonNullable<PageConfig['rename']>>();
    const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
    const { api, modules, config } = await boot({
      tools: {
        page: { class: PageTool, rename: oldRename, setIcon: oldSetIcon },
        otherPage: { class: PageTool, rename, setIcon },
      },
      data: { blocks: [{ id: 'source-page', type: 'page', data: { pageId: 'pg-old' } }] },
    });
    const backend = pageBackendOf(createEditorServices(modules, config));

    await api.blocks.render({
      blocks: [{ id: 'source-page', type: 'otherPage', data: { pageId: 'pg-current' } }],
    });
    const icon: PageIcon = { type: 'image', url: 'https://cdn.example/icon.png' };

    await expect(backend.rename({ blockId: 'source-page', title: 'Current title' })).resolves.toEqual({
      pageId: 'pg-current', applied: true,
    });
    await expect(backend.setIcon({ blockId: 'source-page', icon })).resolves.toEqual({
      pageId: 'pg-current', applied: true,
    });
    expect(rename).toHaveBeenCalledExactlyOnceWith('pg-current', 'Current title');
    expect(setIcon).toHaveBeenCalledExactlyOnceWith('pg-current', icon);
    expect(setIcon.mock.calls[0]?.[1]).toBe(icon);
    expect(oldRename).not.toHaveBeenCalled();
    expect(oldSetIcon).not.toHaveBeenCalled();
  });

  it.each(['rename', 'setIcon'] satisfies PageMethod[])(
    '%s rejects a missing block and names it',
    async method => {
      const rename = vi.fn<NonNullable<PageConfig['rename']>>();
      const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
      const { modules, config } = await boot({
        tools: { page: { class: PageTool, rename, setIcon } },
      });
      const backend = pageBackendOf(createEditorServices(modules, config));

      await expect(callPage(backend, method, 'missing-block')).rejects.toThrow(/missing-block/);
      expect(rename).not.toHaveBeenCalled();
      expect(setIcon).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'missing pageId', data: {}, method: 'rename' },
    { label: 'non-string pageId', data: { pageId: 17 }, method: 'rename' },
    { label: 'missing pageId', data: {}, method: 'setIcon' },
    { label: 'non-string pageId', data: { pageId: 17 }, method: 'setIcon' },
  ] satisfies Array<{ label: string; data: Record<string, unknown>; method: PageMethod }>)(
    '$method rejects $label and names the source block',
    async ({ data, method }) => {
      const rename = vi.fn<NonNullable<PageConfig['rename']>>();
      const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
      const { modules, config } = await boot({
        tools: { pointer: { class: PointerFixture, rename, setIcon } },
        data: { blocks: [{ id: 'invalid-pointer', type: 'pointer', data }] },
      });
      const block = modules.BlockManager.getBlockById('invalid-pointer');
      const pageId: unknown = block?.preservedData.pageId;

      if (block === undefined || !Object.is(pageId, data.pageId)) {
        throw new Error('The malformed pointer fixture was not preserved.');
      }
      const backend = pageBackendOf(createEditorServices(modules, config));

      await expect(callPage(backend, method, 'invalid-pointer')).rejects.toThrow(/invalid-pointer/);
      expect(rename).not.toHaveBeenCalled();
      expect(setIcon).not.toHaveBeenCalled();
    }
  );

  it.each(['rename', 'setIcon'] satisfies PageMethod[])(
    '%s rejects when only another tool has that hook',
    async method => {
      const rename = vi.fn<NonNullable<PageConfig['rename']>>();
      const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>();
      const { modules, config } = await boot({
        tools: {
          page: { class: PageTool, rename, setIcon },
          noHooks: { class: PageTool },
        },
        data: { blocks: [{ id: 'hookless-page', type: 'noHooks', data: { pageId: 'pg-hookless' } }] },
      });
      const backend = pageBackendOf(createEditorServices(modules, config));

      await expect(callPage(backend, method, 'hookless-page')).rejects.toThrow(/hookless-page/);
      expect(rename).not.toHaveBeenCalled();
      expect(setIcon).not.toHaveBeenCalled();
    }
  );

  it.each(['rename', 'setIcon'] satisfies PageMethod[])(
    '%s propagates its own host hook rejection',
    async method => {
      const failure = new Error('The host refused the write.');
      const rename = vi.fn<NonNullable<PageConfig['rename']>>().mockRejectedValue(failure);
      const setIcon = vi.fn<NonNullable<PageConfig['setIcon']>>().mockRejectedValue(failure);
      const { modules, config } = await boot({
        tools: { page: { class: PageTool, rename, setIcon } },
        data: { blocks: [{ id: 'source-page', type: 'page', data: { pageId: 'pg-source' } }] },
      });
      const backend = pageBackendOf(createEditorServices(modules, config));

      await expect(callPage(backend, method, 'source-page')).rejects.toBe(failure);
    }
  );

  it.each([undefined, '', 17])(
    'does not offer linkMetadata for a Bookmark with endpoint %s',
    async endpoint => {
      const { modules, config } = await boot({
        tools: { bookmark: { class: Bookmark, endpoint } },
      });

      expect(createEditorServices(modules, config)).not.toHaveProperty('linkMetadata');
    }
  );

  it('does not mistake an endpoint on a non-Bookmark class for linkMetadata', async () => {
    const { modules, config } = await boot({
      tools: { bookmark: { class: Paragraph, endpoint: 'https://wrong.example/unfurl' } },
    });

    expect(createEditorServices(modules, config)).not.toHaveProperty('linkMetadata');
  });

  it('does not offer linkMetadata for a Bookmark subclass with a nonempty endpoint', async () => {
    class CustomBookmark extends Bookmark {}

    const { modules, config } = await boot({
      tools: { bookmark: { class: CustomBookmark, endpoint: 'https://subclass.example/unfurl' } },
    });

    expect(createEditorServices(modules, config)).not.toHaveProperty('linkMetadata');
  });

  it('uses the actual Bookmark class under an alias and preserves MetadataFetcher output', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(metadataResponse());
    const headers = { Authorization: 'Bearer fixture' };
    const { modules, config } = await boot({
      tools: {
        bookmark: { class: Paragraph, endpoint: 'https://wrong.example/unfurl' },
        linkCard: { class: Bookmark, endpoint: 'https://metadata.example/unfurl', headers },
      },
    });
    const service = linkMetadataOf(createEditorServices(modules, config));

    await expect(service.fetch('https://site.example/article?q=a b&x=1')).resolves.toEqual(METADATA);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://metadata.example/unfurl?url=https%3A%2F%2Fsite.example%2Farticle%3Fq%3Da%20b%26x%3D1',
      { headers }
    );
  });

  it('does not use a tool-level URL uploader or an editor-level file-only uploader', async () => {
    const toolUpload = vi.fn<NonNullable<ImageUploader['uploadByUrl']>>()
      .mockResolvedValue({ url: 'https://tool.example/image.png' });
    const uploadByFile = vi.fn<NonNullable<BlokUploader['uploadByFile']>>()
      .mockResolvedValue({ url: 'https://cdn.example/file.png' });
    const { modules, config } = await boot({
      tools: { image: { class: ImageTool, uploader: { uploadByUrl: toolUpload } } },
      uploader: { uploadByFile },
    });

    expect(createEditorServices(modules, config)).not.toHaveProperty('uploader');
    expect(toolUpload).not.toHaveBeenCalled();
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('uses only the editor-level URL uploader and preserves context and result identity', async () => {
    const result: UploadedAsset = { url: 'https://cdn.example/image.png', fileName: 'host-name.png' };
    const uploadByUrl = vi.fn<UrlUploader['uploadByUrl']>().mockResolvedValue(result);
    const toolUpload = vi.fn<NonNullable<ImageUploader['uploadByUrl']>>()
      .mockResolvedValue({ url: 'https://tool.example/image.png' });
    const { modules, config } = await boot({
      tools: { image: { class: ImageTool, uploader: { uploadByUrl: toolUpload } } },
      uploader: { uploadByUrl },
    });
    const service = uploaderOf(createEditorServices(modules, config));
    const context: UploadContext = {
      kind: 'image',
      tool: 'audio',
      onProgress: vi.fn<(percent: number) => void>(),
      variant: { mimeType: 'image/webp', role: 'variant' },
    };

    await expect(service.uploadByUrl('https://source.example/image.png', context)).resolves.toBe(result);
    expect(uploadByUrl).toHaveBeenCalledExactlyOnceWith('https://source.example/image.png', context);
    expect(uploadByUrl.mock.calls[0]?.[1]).toBe(context);
    expect(toolUpload).not.toHaveBeenCalled();
  });
});

describe('editor.agent service wiring through its public API', () => {
  it('withholds a service-requiring action from tools and execution without configured services', async () => {
    const { api } = await boot({
      tools: { servicefixture: ServiceFixtureParagraph },
      data: {
        blocks: [{ id: 'fixture-note', type: 'servicefixture', data: { text: [{ text: 'Seed' }] } }],
      },
    });
    const tools = await api.agent.tools({ format: 'openai', schema: 'envelope' });
    const execute = tools.find(tool => tool.name === 'blok_execute');

    if (execute === undefined) {
      throw new Error('The public API did not render blok_execute.');
    }
    expect(execute.parameters).not.toMatchObject({
      properties: { commands: { items: { properties: {
        name: { enum: expect.arrayContaining(['servicefixture.resolve']) },
      } } } },
    });
    const turn = api.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(turn.describe({ command: 'servicefixture.resolve' })).toMatchObject({
      command: { name: 'servicefixture.resolve', available: false, unavailableReason: 'service' },
    });
    await expect(turn.execute({ commands: [{
      name: 'servicefixture.resolve',
      args: { id: 'fixture-note', pageBlockId: 'source-page', url: 'https://site.example/article', title: 'Title' },
    }] })).resolves.toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
    expect(serviceSnapshots).toEqual([]);
    turn.end();
  });

  it('advertises configured services and passes one cached map to every real session', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => metadataResponse());
    const rename = vi.fn<NonNullable<PageConfig['rename']>>();
    const upload: UploadedAsset = { url: 'https://cdn.example/image.png', fileName: 'host-name.png' };
    const uploadByUrl = vi.fn<UrlUploader['uploadByUrl']>().mockResolvedValue(upload);
    const { api } = await boot({
      tools: {
        page: { class: PageTool, rename },
        bookmark: { class: Bookmark, endpoint: 'https://metadata.example/unfurl' },
        servicefixture: ServiceFixtureParagraph,
      },
      uploader: { uploadByUrl },
      data: { blocks: [
        { id: 'source-page', type: 'page', data: { pageId: 'pg-source' } },
        { id: 'fixture-note', type: 'servicefixture', data: { text: [{ text: 'Seed' }] } },
      ] },
    });
    const tools = await api.agent.tools({ format: 'openai', schema: 'envelope' });
    const execute = tools.find(tool => tool.name === 'blok_execute');

    if (execute === undefined) {
      throw new Error('The public API did not render blok_execute.');
    }
    expect(execute.parameters).toMatchObject({
      properties: { commands: { items: { properties: {
        name: { enum: expect.arrayContaining(['servicefixture.resolve']) },
      } } } },
    });

    for (const title of ['First title', 'Second title']) {
      const turn = api.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

      expect(turn.describe({ command: 'servicefixture.resolve' })).toMatchObject({
        command: { name: 'servicefixture.resolve', available: true },
      });
      await expect(turn.execute({ commands: [{
        name: 'servicefixture.resolve',
        args: { id: 'fixture-note', pageBlockId: 'source-page', url: 'https://site.example/article', title },
      }] })).resolves.toMatchObject({
        ok: true,
        results: [{
          page: { pageId: 'pg-source', applied: true },
          metadata: METADATA,
          upload: { url: 'https://cdn.example/image.png', fileName: 'host-name.png' },
        }],
      });
      turn.end();
      await Promise.resolve();
    }

    const first = serviceSnapshots[0];

    if (first === undefined) {
      throw new Error('The action never received configured services.');
    }
    expect(serviceSnapshots[1]).toBe(first);
    expect(serviceSnapshots).toHaveLength(2);
    expect(Object.keys(first).sort()).toEqual(['linkMetadata', 'pageBackend', 'uploader']);
    expect(rename.mock.calls).toEqual([
      ['pg-source', 'First title'],
      ['pg-source', 'Second title'],
    ]);
    expect(uploadByUrl).toHaveBeenCalledTimes(2);
    expect(uploadByUrl).toHaveBeenLastCalledWith(
      'https://site.example/article', { kind: 'image', tool: 'servicefixture' }
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://metadata.example/unfurl?url=https%3A%2F%2Fsite.example%2Farticle',
      { headers: undefined }
    );
    const saved = await api.saver.save();

    expect(saved.blocks.find(block => block.id === 'fixture-note')).toMatchObject({
      data: { text: [{ text: 'Fetched title: https://cdn.example/image.png' }] },
    });
  }, 60_000);
});
