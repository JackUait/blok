import type { OutputData } from '../../../../types';
import type { AgentActor, AgentSession } from '../../../../types/agent';
import type { PageConfig } from '../../../../types/tools/page';
import { createDocumentAgentSession } from '../../../shared/agent/document-session';
import { failure } from '../../../shared/agent/errors';
import type { AgentPorts } from '../../../shared/agent/types';
import { deepEqual } from '../../../shared/deep-equal';
import { outputBlocksToCanonicalSegments, outputBlocksToSegments } from '../../../shared/rich-text/block-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';
import type { HostService } from '../../../../types/tools/tool-description';
import { liveContractSource, type ContractSource } from './editor-session';
import { createEditorPorts, editorRichTextFieldsFor } from './editor-ports';

export type OpenPageDocument = NonNullable<AgentPorts['openPageDocument']>;

type DocumentHooks = Required<Pick<PageConfig, 'loadDocument' | 'saveDocument'>>;

const documentHooks = (settings: Record<string, unknown>): DocumentHooks | null => {
  const { loadDocument, saveDocument } = settings;

  return typeof loadDocument === 'function' && typeof saveDocument === 'function'
    ? { loadDocument, saveDocument } as DocumentHooks
    : null;
};

export interface PageDocuments {
  /** `created`: the host's create just gave this id, so a missing document opens empty. */
  open(pageId: string, actor: AgentActor, options?: { created?: boolean }): Promise<AgentSession & { close(): void }>;
  /** Writes a whole document back, as Discard does with the one a run started from. */
  save(pageId: string, data: OutputData): Promise<void>;
  /** The document as the host has it now. Null when the host has none. */
  load(pageId: string): Promise<OutputData | null>;
  /** Same content, title and icon. HTML and segment text compare equal; time and version are ignored. */
  same(left: OutputData, right: OutputData): boolean;
}

export interface PageDocumentsOptions {
  /** Before each agent save: the document as this session loaded it, or as it last saved it. */
  beforeSave?(pageId: string, loaded: OutputData): void;
  /** Gets what the agent saved. */
  saved?(pageId: string, saved: OutputData): void;
  /** The main session's contract source, so a sub-page sees the same overrides and services. */
  contractSource?(): ContractSource;
  /** The main session's host services. Read at open: building them needs these page documents. */
  services?(): Partial<Record<HostService, unknown>>;
  /** A pageId an agent write left on a page block inside a sub-page. */
  onPagePointed?(pageId: string): void;
  /** True for a pageId an agent wrote. A page block inside a sub-page with one does not open. */
  isAgentPageId?(pageId: string): boolean;
}

const pagePointers = (data: OutputData): Map<string, string> => new Map(data.blocks.flatMap((block) =>
  block.type === 'page' && typeof block.id === 'string' && typeof block.data.pageId === 'string'
    ? [[block.id, block.data.pageId] as const]
    : []));

/**
 * Opens a sub-page's own document through the page tool's loadDocument and
 * saveDocument hooks. Null when no page tool has both.
 */
export const createPageDocuments = (
  Blok: BlokModules,
  ownDocumentId: string | undefined,
  options: PageDocumentsOptions = {}
): PageDocuments | null => {
  const hooks = [...Blok.Tools.blockTools.values()]
    .map((tool) => documentHooks(tool.settings))
    .find((found) => found !== null);

  if (hooks === undefined || hooks === null) {
    return null;
  }
  /** PageIds the page tool's create gave a sub-page insert: the host made them, so they are not agent pointers. */
  const created = new Set<string>();
  // The same hook a toolbox insert runs, so a page inserted in a sub-page gets a host document too.
  const createPageDocument: AgentPorts['createPageDocument'] = async () => {
    const data = await Blok.Tools.blockTools.get('page')?.prepareInsert();
    const pageId = data?.pageId;

    if (typeof pageId !== 'string') {
      throw failure('COMMAND_UNAVAILABLE', 'The page tool gave no pageId for the new page.', { details: { reason: 'runtime' } });
    }
    created.add(pageId);

    return { pageId };
  };

  const open = async (pageId: string, actor: AgentActor, openOptions: { created?: boolean } = {}): Promise<AgentSession & { close(): void }> => {
    // Two writers on one document: the editor and this session.
    if (pageId === ownDocumentId) {
      throw failure('INVALID_ARGS', 'This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead.', { details: { pageId } });
    }
    // A host without create, or one that stores the page later, has nothing to load yet.
    const loaded = await hooks.loadDocument(pageId) ?? (openOptions.created === true ? { blocks: [] } : null);

    if (loaded === null) {
      throw failure('BLOCK_NOT_FOUND', `The host has no document for page "${pageId}".`, { details: { pageId } });
    }
    const base = { data: structuredClone(loaded) };
    const fieldsFor = editorRichTextFieldsFor(Blok);
    // Host data is untrusted, as on render. An unregistered tool's block is left alone, as render
    // leaves a stub's: the next save writes it back to the host. Stored text may still be HTML;
    // the session works on segments.
    const sanitized = loaded.blocks.map((block) => Blok.Tools.blockTools.has(block.type) && typeof block.data === 'object' && block.data !== null
      ? { ...block, data: Blok.BlocksAPI.hostDataForTool(block.type, block.data) }
      : block);
    const document: OutputData = { ...loaded, blocks: outputBlocksToSegments(sanitized, fieldsFor, htmlToSegmentsDom) };
    const source = options.contractSource?.() ?? liveContractSource(Blok);
    const contract = source.contract();
    // The main pageBackend looks blocks up in this editor. A sub-page renames its own page blocks
    // through their documents instead, as MCP's page-map does. The version history is the main
    // document's, so a sub-page has none.
    const { pageBackend: _mainPageBackend, versionHistory: _mainHistory, ...services } = options.services?.() ?? {};
    const session = createDocumentAgentSession({
      document, tools: source.runtimes(contract), contract, actor, services,
      ports: { ...createEditorPorts(Blok), openPageDocument: openNested, createPageDocument },
      pageTitles: 'page-map',
    });

    return {
      ...session,
      execute: async (batch, runOptions) => {
        if (Blok.ReadOnly.isEnabled) {
          throw failure('READ_ONLY', 'The editor is read-only now. Reads still work.', { details: { pageId } });
        }
        const before = session.revision();
        const pointersBefore = pagePointers(session.output());
        const result = await session.execute(batch, runOptions);

        if (result.ok && result.revision !== before) {
          const output = session.output();

          [...pagePointers(output)]
            .filter(([blockId, pointed]) => pointersBefore.get(blockId) !== pointed && !created.has(pointed))
            .forEach(([, pointed]) => options.onPagePointed?.(pointed));
          options.beforeSave?.(pageId, base.data);
          await hooks.saveDocument(pageId, output);
          base.data = structuredClone(output);
          options.saved?.(pageId, base.data);
        }

        return result;
      },
    };
  };

  // The same rule as page blocks in this document: a pageId an agent wrote could name any document.
  const openNested: OpenPageDocument = (pageId, actor) => (options.isAgentPageId?.(pageId) === true
    ? Promise.reject(failure('INVALID_ARGS', 'This page block points at a page an agent set, not one the host created. It cannot be opened.', { details: { pageId } }))
    : open(pageId, actor, { created: created.has(pageId) }));

  const comparable = (data: OutputData): unknown => ({
    blocks: outputBlocksToCanonicalSegments(data.blocks, editorRichTextFieldsFor(Blok), htmlToSegmentsDom),
    title: data.title ?? null,
    icon: data.icon ?? null,
  });

  return {
    open,
    save: async (pageId, data) => hooks.saveDocument(pageId, data),
    load: async (pageId) => (await hooks.loadDocument(pageId)) ?? null,
    same: (left, right) => deepEqual(comparable(left), comparable(right)),
  };
};
