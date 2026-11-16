import {createPageHistoryApi} from './page-history-api';
import type {createPageHistory} from './page-history';
import { createPagePresence } from './page-presence';
import {createMemberProfiles} from './member-profile';
import {profileDisplayName} from './profile-identity';
import { readAccountIdentity } from './account-profile';
import { watchLocalProfile } from './local-profile';
import { readSidebarLayout, saveSidebarLayout, subscribeSidebarLayout, initializeSidebarPresets } from './sidebar-preferences';
import { libraryUrl, libraryCategoryForHref, type LibraryCategory, pageDestination, pageIdForHref, publicPageUrl, legacyPageUrl, rememberPageLinks } from './page-urls';
import { createWorkspaceSaveStatus } from './workspace-save-status';
import './workspace-save-status.css';
import { navigationFavorites, navigationRecents } from './navigation-preferences';
import { commentAuthor } from './comment-author';
import { mountPageComments } from './page-comments';
import { CommentInlineTool } from './inline-comments';
import { createNotesDocument, readNotesCollection, rememberNotesCollection, addNote } from './notes-collection';
import { openPageLibrary, pageTimestamp } from './page-library';
import { openPageSearch, openPageCreation, openPageMove, type CreationDestination } from './navigation-dialogs';
import { customEmojiStore } from './custom-emojis';
import { createEmptyWorkspaceState } from './workspace-empty';
import { mountRemoteAssets } from './remote-assets';
import { Blok, allTools, type OutputData } from '@bloklabs/core/full';
import { Audio, Bookmark, File, Video, Callout, Code, Database, DatabaseComment, DatabaseRow, Divider, Image, Page, Quote, Table, TableOfContents, Toggle, type PageConfig } from '@bloklabs/core/tools';
import { createPageFrame, type PageFrame, type ShellPage, type SidebarAction, type SidebarTeamspace } from '@blok/sidebar';
import { type DesktopPage, type WorkspaceIndex } from './storage';
import { workspaceRepository } from './workspace-repository';
import { pageAccess } from './page-access';
import { moveDestinations } from './page-move';
import { openPageSharing } from './cloud/page-sharing';
import { sidebarSectionOf } from './page-section';
import { nextPageIcon } from './page-icon-sync';
import { brandedTitle } from './tab-identity';
import { describeAccessLoss } from './access-friction';
import { activeWorkspace, workspaceKey, type WorkspaceRef } from './workspace-registry';
import { createDesktopFooter, readAppearance } from './settings';
import {
  buildWelcomeDocuments,
  seedWelcomeDocuments,
  hasWelcomeSeeded,
  markWelcomeSeeded,
  shouldSeedWelcome,
  welcomePageId,
} from './welcome-seed';
import { COVER_GALLERY, readCoverFile, createAddCoverButton, createPageCover, isPageCover, trackPageHeaderHover, type PageCover } from './cover';
import { mountAgentAssistant, type AgentAssistantHandle } from '@blok/agent-assistant';
import { bindAssistantButton, createAssistantButton, createWorkspaceAssistant } from './assistant';
import { readAiPageSource } from './ai-page-source';
import { CloudClient } from './cloud/client';
import { nativeSessionAdapter } from './native-session';
import { teamspaceClient } from './cloud/teamspaces';
import { createPageToolbar, type PageBreadcrumbChoice, type PageBreadcrumbItem, type PageToolbar } from './page-toolbar';
import { bindTitleDateMention, titleDateLabel, type TitleDateMentionBinding } from './title-date-mention';
import { createFloatingToc, type FloatingToc } from './floating-toc';
import type { DateDisplayChange } from '@blok/date-editor';

const desktopTools = {
  ...allTools,
  comment: { class: CommentInlineTool },
  table: { class: Table },
  database: { class: Database },
  'database-row': { class: DatabaseRow },
  'database-comment': { class: DatabaseComment },
  // Writing about a codebase needs these: code carries Prism highlighting, line
  // numbers, language detection and mermaid; the rest are what an explanation is
  // built from — callouts for the "why", toggles for detail a reader can fold away.
  code: { class: Code },
  callout: { class: Callout, inlineToolbar: true },
  toggle: { class: Toggle, inlineToolbar: true },
  quote: { class: Quote, inlineToolbar: true },
  divider: { class: Divider },
  // A page about a UI needs to show it; an explanation long enough to scroll needs
  // its own map. Both ship in the core and were simply never named here.
  image: { class: Image },
  bookmark: { class: Bookmark },
  file: { class: File },
  audio: { class: Audio },
  video: { class: Video },
  table_of_contents: { class: TableOfContents },
};

export interface Workspace {
  element: HTMLElement;
  start(): Promise<void>;
  flush(): Promise<void>;
  destroy(): void;
  onRoute(): void;
  toggleSidebar(): void;
  createPage(parentId?: string | null): void;
}


function adoptRemoteFields(live: DesktopPage, remote: DesktopPage): void {
  const target = live as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    if (!(key in remote)) Reflect.deleteProperty(target, key);
  }
  Object.assign(live, remote);
}

export function createWorkspace(onLayout: (width: number) => void, onPageIcon: (id: string, icon: string) => void, options: { ref?: WorkspaceRef } = {}): Workspace {
  const ref = Object.freeze({... (options.ref ?? activeWorkspace())});
  const identity = { name: ref.name };
  const sidebarTeamspaces:SidebarTeamspace[]=[];
  const teamspacesState={refreshing:false,pending:0,error:'Chargement…' as string|null};
  const teamspacesApi=ref.kind==='remote' ? teamspaceClient(new CloudClient({origin:ref.server,...('__TAURI_INTERNALS__' in window ? {sessionAdapter:nativeSessionAdapter(ref.server)} : {})}),ref.workspaceId) : null;
  const memberProfiles=teamspacesApi ? createMemberProfiles({workspaceName:identity.name,members:signal=>teamspacesApi.workspaceMembers(signal)}) : null;
  const repository = workspaceRepository(ref);
  const favorites = navigationFavorites(ref);
  const recentPages = navigationRecents(ref);
  const library = { refreshQueued: false, dispose: null as ReturnType<typeof openPageLibrary> | null, category: null as LibraryCategory | null, recents: recentPages.ids, target: null as { pageId: string; blockId: string } | null };
  const initialHref=location.href;
  const routeLoad={pending:false};
  const pageUrl = (id:string):string => {
    const page=ws.index?.pages.find(item=>item.id===id);
    const publicId=ws.index?.access?.[id]?.publicId;
    if(ref.kind==='remote' && publicId)return publicPageUrl(ref.server,page?.title || 'Page',publicId);
    const fallback=new URL(legacyPageUrl(ref.kind==='remote' ? ref.server : location.href,id));
    if(ref.kind==='local')fallback.searchParams.set('local','1');
    return fallback.href;
  };
  const emojis = customEmojiStore(ref);
  const pageIcon = (value: string) => /^(https?:|data:image\/|\/files\/)/i.test(value) ? {type: 'image' as const, url: value} : {type: 'emoji' as const, value};
  if (ref.kind === 'remote' && '__TAURI_INTERNALS__' in window) mountRemoteAssets(ref.server, repository.assetUrl);
  // L'interface ne savait dire qu'une chose : cet espace est-il en lecture seule ?
  // Elle dit désormais : cette page-ci l'est-elle. Le niveau vient de l'index, et
  // se réévalue à chaque fois qu'il est reçu.
  const ws: {
    access: ReturnType<typeof pageAccess>;
    index: WorkspaceIndex | null;
    editor: Blok | null;
    remotePending: boolean;
    selection: number;
    frame: PageFrame;
    coverRowObserver: MutationObserver | null;
    assistant: AgentAssistantHandle;
    pageCanvas: HTMLElement;
    footer: HTMLElement;
    pageToolbar: PageToolbar | null;
    pageComments: { element: HTMLElement; destroy(): void } | null;
    refreshPagePresentation: (() => void) | null;
    titleDateMention: TitleDateMentionBinding | null;
    floatingToc: FloatingToc | null;
    currentId: string;
    generation: number;
    dateTimer: number | null;
    saveOrder: Promise<void>;
    pendingManifests: number;
    manifestFailed: boolean;
    refreshingManifest: boolean;
    metadataAction: boolean;
    closeSearch: (() => void) | undefined;
  } = {
    access: pageAccess(ref, undefined),
    index: null,
    editor: null,
    remotePending: false,
    selection: 0,
    frame: null as unknown as PageFrame,
    coverRowObserver: null,
    assistant: null as unknown as AgentAssistantHandle,
    pageCanvas: null as unknown as HTMLElement,
    footer: null as unknown as HTMLElement,
    pageToolbar: null,
    pageComments: null,
    refreshPagePresentation: null,
    titleDateMention: null,
    floatingToc: null,
    currentId: '',
    generation: 0,
    dateTimer: null,
    saveOrder: Promise.resolve(),
    pendingManifests: 0,
    manifestFailed: false,
    refreshingManifest: false,
    metadataAction: false,
    closeSearch: undefined,
  };
  // Keep at most two recent pages warm. Editors stay subscribed to their own
  // collaborative document; only the current page owns host UI and shortcuts.
  interface PageSession {
    id: string;
    page: DesktopPage;
    editor: Blok;
    permission: string;
    active: boolean;
    ready: boolean;
    destroyed: boolean;
    nodes: Node[];
    resume(): void;
    suspend(): void;
    destroy(): void;
    sourceUnchanged(): Promise<boolean>;
    flush(): Promise<void>;
  }
  const cachedPages = new Map<string, PageSession>();
  const sessions = { current: null as PageSession | null, disposed: false, reconnectTimer: undefined as number | undefined };
  const lifetime = new AbortController();
  const localMetadata = new Map<string, string>();
  const metadataOf = (page: DesktopPage): string => JSON.stringify({ ...page, createdAt: undefined, updatedAt: undefined });
  const adoptIndex = (value: WorkspaceIndex): WorkspaceIndex => {
    const livePages = new Map([...cachedPages.values(), ...(sessions.current ? [sessions.current] : [])].map(session => [session.id, session.page]));
    const pages = ref.kind === 'remote' ? value.pages.map(incoming => {
      const live = livePages.get(incoming.id);
      if (!live) return incoming;
      // Editor callbacks retain these objects, including on inactive pages.
      adoptRemoteFields(live, incoming);
      return live;
    }) : value.pages;
    if (ref.kind === 'local') for (const page of pages) localMetadata.set(page.id, metadataOf(page));
    const adopted = { ...value, pages };
    ws.index = adopted;
    ws.access = pageAccess(ref, adopted.access);
    return adopted;
  };
  /**
   * Étiquette chaque page racine avec sa section. La section est dérivée de
   * l'état de partage, jamais rangée dans la page : inviter quelqu'un fait
   * basculer la page tout seul, au prochain index reçu.
   */
  const withSections = (pages: DesktopPage[]): DesktopPage[] => {
    if(ref.kind==='remote')rememberPageLinks(location.origin,ref.server,pages.map(page=>({id:page.id,title:page.title,publicId:ws.index?.access?.[page.id]?.publicId})));
    const tagged = pages.map((page) => ({ ...page, favorite: favorites.has(page.id) }));
    if (ref.kind !== 'remote') return tagged;
    if (!ws.index?.access) return tagged.map((page) => ({ ...page, section: page.parentId ? undefined : 'workspace' }));
    return tagged.map(page=>page.parentId ? page : {...page,section:sidebarSectionOf(ws.index?.access?.[page.id])});
  };
  const readOnly = (pageId: string): boolean => !ws.access.canEdit(pageId);
  const canCreateUnder = (parentId: string | null): boolean =>
    parentId ? ws.access.canEdit(parentId) : !ws.access.readOnlyWorkspace;
  const pagePermission = (id: string): string => JSON.stringify([readOnly(id), ws.access.canShare(id), ws.index?.access?.[id] ?? null]);
  const clearPresentation = (): void => {
    ws.coverRowObserver?.disconnect(); ws.coverRowObserver = null;
    ws.floatingToc?.destroy(); ws.floatingToc = null;
    ws.titleDateMention?.destroy(); ws.titleDateMention = null;
    ws.pageComments?.destroy(); ws.pageComments = null;
    ws.refreshPagePresentation = null;
    ws.pageToolbar = null;
  };
  const dropCachedPage = (id: string): void => {
    const session = cachedPages.get(id);
    cachedPages.delete(id);
    session?.destroy();
  };
  const invalidateCachedPages = (): void => {
    for (const [id, session] of cachedPages) {
      if (!ws.index?.pages.some(page => page.id === id) || session.permission !== pagePermission(id)) dropCachedPage(id);
    }
  };
  const leavePage = (keep: boolean): void => {
    const session = sessions.current;
    const editor = ws.editor;
    ws.editor = null;
    if (!session) { clearPresentation(); editor?.destroy(); return; }
    session.suspend();
    sessions.current = null;
    if (!keep || !session.ready || session.destroyed || !ws.index?.pages.some(page => page.id === session.id)) {
      session.destroy(); return;
    }
    cachedPages.set(session.id, session);
    while (cachedPages.size > 2) {
      const oldest = cachedPages.keys().next().value;
      if (oldest !== undefined) dropCachedPage(oldest);
    }
  };
  // The add-cover button is re-appended whenever the core rebuilds the icon row, and
  // WebKit keeps `:hover` latched on a node moved under the cursor. See trackPageHeaderHover.
  trackPageHeaderHover(document);
  const pageListeners = new Map<string, Set<() => void>>();
  const saveStatus = createWorkspaceSaveStatus(ref.kind === 'remote');
  const status = saveStatus.element;
  const sync = { localWrites: 0, remoteConnection: 'connecting' };
  const updatePending = (): void => saveStatus.pending(ws.pendingManifests + sync.localWrites + teamspacesState.pending);

  const pageFromUrl = (): string | null => pageIdForHref(location.href);
  const navigate = (id: string, replace = false): void => {
    const url=ref.kind==='remote' && !('__TAURI_INTERNALS__' in window) ? new URL(pageUrl(id)) : new URL(location.href);
    if(ref.kind==='local' || '__TAURI_INTERNALS__' in window){url.pathname='/';url.searchParams.set('page',id);}
    url.searchParams.delete('library');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    onRoute();
  };
  const saveManifest = (): void => {
    if (!ws.index) return;
    if (ref.kind === 'local') ws.index.pages.forEach(candidate => {
      const page = candidate;
      const metadata = metadataOf(page);
      if (localMetadata.has(page.id) && localMetadata.get(page.id) !== metadata) page.updatedAt = new Date().toISOString();
      localMetadata.set(page.id, metadata);
    });
    const snapshot = JSON.stringify(ws.index);
    ws.pendingManifests++;
    updatePending();
    ws.saveOrder = ws.saveOrder.catch(() => undefined).then(async () => {
      await repository.saveIndex(JSON.parse(snapshot) as WorkspaceIndex);
      ws.manifestFailed = false;
      saveStatus.saved('manifest');
    }).catch((error) => { ws.manifestFailed = true; showError(error, 'manifest'); throw error; }).finally(() => { ws.pendingManifests--; updatePending(); });
    void ws.saveOrder.catch(() => undefined);
  };
  const refreshRemoteManifest = async (): Promise<void> => {
    if (sessions.disposed || ref.kind !== 'remote' || !ws.index || ws.pendingManifests > 0 || ws.manifestFailed || ws.refreshingManifest || ws.metadataAction) return;
    ws.refreshingManifest = true;
    const original = ws.index;
    try {
      const updated = await repository.refreshIndex(() => !sessions.disposed && ws.pendingManifests === 0 && !ws.manifestFailed && !ws.metadataAction && ws.index === original);
      if (sessions.disposed || !updated) return;
      updated.activeId = updated.pages.some((page) => page.id === ws.currentId) ? ws.currentId : updated.activeId;
      adoptIndex(updated);
      invalidateCachedPages();
      if (sessions.current && sessions.current.permission !== pagePermission(sessions.current.id)) {
        leavePage(false); ws.currentId = ''; onRoute();
      }
      saveStatus.saved('refresh');
      ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.index.activeId);
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
      for (const id of new Set([...original.pages.map((page) => page.id), ...ws.index.pages.map((page) => page.id)])) notifyPage(id);
      ws.refreshPagePresentation?.();
      if (!ws.index.pages.some((page) => page.id === ws.currentId)) onRoute();
    } catch (error) { showError(error, 'refresh'); }
    finally { ws.refreshingManifest = false; }
  };
  const refreshDateTitles = (): void => {
    if (sessions.disposed || !ws.index || ref.kind === 'remote') return;
    const dateState = { changed: false };
    for (const page of ws.index.pages) {
      if (!page.titleDate) continue;
      const display = titleDateLabel(page.titleDate, new Date(), page.titleDateDisplay);
      const label = display === null ? null : `@${display}${page.titleDateSuffix ?? ''}`;
      if (label === null || label === page.title) continue;
      page.title = label;
      dateState.changed = true;
      notifyPage(page.id);
    }
    if (!dateState.changed) return;
    ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.index.activeId);
    ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
    const active = ws.index.pages.find((page) => page.id === ws.currentId);
    if (active?.titleDate && ws.editor) {
      ws.editor.title.set(active.title, { record: false });
      ws.titleDateMention?.refresh();
      document.title = active.title;
    }
    saveManifest();
  };
  const scheduleDateRefresh = (): void => {
    if (ws.dateTimer !== null) window.clearTimeout(ws.dateTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    ws.dateTimer = window.setTimeout(() => {
      ws.dateTimer = null;
      refreshDateTitles();
      scheduleDateRefresh();
    }, midnight.getTime() - now.getTime() + 50);
  };
  const refreshLibrary = (): void => {
    if (!library.dispose || library.refreshQueued) return;
    library.refreshQueued = true;
    queueMicrotask(() => { library.refreshQueued = false; library.dispose?.refresh(); });
  };
  const notifyPage = (id: string): void => { pageListeners.get(id)?.forEach((listener) => listener()); refreshLibrary(); };
  const breadcrumbMenuHeading = (parentId: string | null | undefined, byId: Map<string, ShellPage>): string => {
    if (parentId) return byId.get(parentId)?.title ?? 'Pages';
    return ref.kind === 'remote' ? identity.name : 'Pages locales';
  };
  const breadcrumbs = (pageId: string): PageBreadcrumbItem[] => {
    if (!ws.index) return [];
    const pages = ws.index.pages;
    const byId = new Map(pages.map((page) => [page.id, page]));
    const seen = new Set<string>();
    const trail: ShellPage[] = [];
    const trailState = { page: byId.get(pageId) };

    while (trailState.page && !seen.has(trailState.page.id)) {
      trail.unshift(trailState.page);
      seen.add(trailState.page.id);
      trailState.page = trailState.page.parentId ? byId.get(trailState.page.parentId) : undefined;
    }
    const choicesFor = (parentId: string | null, selectedId: string, visited: Set<string> = new Set()): PageBreadcrumbChoice[] =>
      pages.filter((candidate) => candidate.parentId === parentId && !visited.has(candidate.id)).map((candidate) => {
        const children = choicesFor(candidate.id, pageId, new Set([...visited, candidate.id]));

        return {
          id: candidate.id, title: candidate.title, icon: candidate.icon,
          current: candidate.id === selectedId || candidate.id === pageId,
          ...(children.length ? { children } : {}),
          onOpen: () => navigate(candidate.id),
        };
      });
    return trail.map((item, position) => ({
      id: item.id, title: item.title, icon: item.icon,
      ...(position < trail.length - 1 ? { onOpen: () => navigate(item.id) } : {}),
      menuHeading: breadcrumbMenuHeading(item.parentId, byId),
      menu: choicesFor(item.parentId, item.id),
    }));
  };
  const showError = (error: unknown, source = 'operation'): void => {
    // Un retrait d'accès ferme la session en moins de cinq secondes côté
    // serveur. Le présenter comme une panne d'enregistrement laisserait croire
    // à un incident, et pousserait à réessayer pour rien.
    const refusal = describeAccessLoss(error);
    saveStatus.error(error, refusal, source);
  };
  const iconValue = (icon: ReturnType<Blok['title']['icon']['get']>): string | undefined => {
    if (icon?.type === 'emoji') return icon.value;
    if (icon?.type === 'image') return icon.url;
    return undefined;
  };
  const syncPageIcon = (
    page: ShellPage,
    icon: ReturnType<Blok['title']['icon']['get']>,
    persist = true,
    adoptOnly = false,
  ): void => {
    if (!ws.index) return;
    const target = page;
    const next = nextPageIcon(target.icon, iconValue(icon), { adoptOnly });
    if (target.icon !== next) {
      target.icon = next;
      ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.index.activeId);
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
      if (persist) saveManifest();
      notifyPage(target.id);
    }
    if (target.id === ws.currentId) onPageIcon(target.id, next ?? '');
  };
  const pageConfig: PageConfig = {
    createFromMention: true,
    todayMention: { label: 'Aujourd’hui', heading: 'Date', locale: 'fr' },
    databasePages: true,
    search: async (query) => {
      if (!ws.index) return [];
      const needle = query.trim().toLocaleLowerCase();
      return ws.index.pages.filter((page) => page.title.toLocaleLowerCase().includes(needle)).slice(0, 40)
        .map((page) => ({ pageId: page.id, title: page.title,
          ...(page.icon ? { icon: pageIcon(page.icon) } : {}) }));
    },
    resolve: (id) => {
      const page = ws.index?.pages.find((item) => item.id === id);
      return page ? { title: page.title, ...(page.icon ? { icon: pageIcon(page.icon) } : {}) } : null;
    },
    subscribe: (id, listener) => {
      const listeners = pageListeners.get(id) ?? new Set<() => void>();
      listeners.add(listener);
      pageListeners.set(id, listeners);
      return () => { listeners.delete(listener); if (listeners.size === 0) pageListeners.delete(id); };
    },
    href: (id) => ref.kind==='remote' && !('__TAURI_INTERNALS__' in window) ? pageUrl(id) : `?page=${encodeURIComponent(id)}`,
    pageIdFromHref: (href) => {
      const url = new URL(href);
      return url.origin === location.origin ? pageIdForHref(url.href) : null;
    },
    open: (id) => { if (ws.index?.pages.some((page) => page.id === id)) navigate(id); },
    create: async ({ pageId, title, parentId, document: initialDocument }) => {
      if (!ws.index || !canCreateUnder(parentId ?? ws.currentId ?? null)) throw new Error('Espace indisponible ou en lecture seule');
      if (ws.index.pages.some((page) => page.id === pageId)) throw new Error('Cette page existe déjà');
      const page: DesktopPage = { ...(ref.kind === 'local' ? { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : {}), id: pageId, title: title?.trim() || 'Nouvelle page', parentId: parentId ?? ws.currentId };
      if (initialDocument && ref.kind === 'local') await repository.writePage(pageId, JSON.stringify(initialDocument));
      ws.index.pages.push(page);
      ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.index.activeId);
      saveManifest();
      await ws.saveOrder;
      if (initialDocument && ref.kind === 'remote') await repository.seedPage(pageId, initialDocument);
      notifyPage(pageId);
    },
  };
  const select = async (id: string): Promise<void> => {
    if (sessions.disposed || !ws.index) return;
    refreshDateTitles();
    const page = ws.index.pages.find((item) => item.id === id);
    if (!page) return;
    const selectedPage = page;
    const request = ++ws.selection;
    const previous = sessions.current;
    if (ws.currentId !== id && previous) {
      await previous.editor.isReady;
      if (sessions.disposed || ws.selection !== request) return;
      await previous.flush();
    }
    if (sessions.disposed || ws.selection !== request) return;
    ws.index.activeId = id;
    if (ref.kind === 'local') saveManifest();
    ws.frame.setActiveShortcut(null);
    ws.frame.setPages(withSections(ws.index.pages), id);
    onPageIcon(id, page.icon ?? '');
    if (ws.currentId === id) {
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(id));
      return;
    }
    library.dispose?.(); library.dispose = null; library.category = null;
    ws.frame.element.removeAttribute('data-desktop-library');
    const cached = cachedPages.get(id);
    if (cached && (cached.permission !== pagePermission(id) || !await cached.sourceUnchanged())) dropCachedPage(id);
    if (sessions.disposed || ws.selection !== request) return;
    const warm = cachedPages.get(id);
    if (warm) cachedPages.delete(id);
    leavePage(true);
    ws.currentId = id;
    ws.frame.element.toggleAttribute('data-desktop-read-only', readOnly(id));
    ++ws.generation;
    if (warm) {
      sessions.current = warm;
      warm.resume();
      return;
    }
    const life = { active: true, ready: false, destroyed: false };
    const historyView = {value:null as ReturnType<typeof createPageHistory> | null, opening:false, actors:new Map<string,string>()};
    const openHistory = async (): Promise<void> => {
      if (ref.kind !== 'remote' || historyView.opening) return;
      historyView.opening = true;
      try {
        await instance.isReady;
        await instance.saver.flush();
        const {createPageHistory} = await import('./page-history');
        if (life.destroyed || !life.active) return;
        historyView.value ??= createPageHistory({
          returnFocus:()=>toolbar.element.querySelector<HTMLButtonElement>('[data-desktop-page-more]'),
          api:createPageHistoryApi({server:`${ref.server}/api/blok`,doc:id,ticket:()=>repository.ticket(id)}),
          title:()=>page.title, actorName:actor=>actor===ref.accountId?readAccountIdentity(ref).name:historyView.actors.get(actor) ?? 'Autre contributeur',
          canRestore:()=>life.active && !readOnly(id) && sync.remoteConnection === 'connected' && !ws.remotePending, onRestored:()=>refreshRemoteManifest(),
        });
        void teamspacesApi?.workspaceMembers().then(({members})=>{
          if(life.destroyed)return;
          for(const member of members)historyView.actors.set(member.id,member.email);
          historyView.value?.refreshActors();
        }).catch(()=>undefined);
        await historyView.value.open();
      } finally { historyView.opening = false; }
    };
    sync.remoteConnection = 'connecting';
    saveStatus.resetPage();
    const article = document.createElement('article');
    article.setAttribute('data-desktop-document', '');
    const applyFullWidth = (): void => {
      const enabled = page.fullWidth === true;
      ws.pageCanvas.toggleAttribute('data-full-width', enabled);
      article.toggleAttribute('data-full-width', enabled);
      ws.editor?.width.set(enabled ? 'full' : 'narrow');
    };
    const toolbar = createPageToolbar(breadcrumbs(id), page.fullWidth === true, (enabled) => {
      if (readOnly(id)) return;
      page.fullWidth = enabled;
      applyFullWidth();
      saveManifest();
    }, '__TAURI_INTERNALS__' in window ? undefined : () => {
      ws.frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    }, ref.kind === 'remote' ? (anchor) => openPageSharing(ref, id, page.title, anchor, refreshRemoteManifest, pageUrl(id)) : undefined, {
      workspaceName: identity.name,
      workspacePages: () => {
        const pages = withSections(ws.index?.pages ?? []);
        const choice = (page: DesktopPage): PageBreadcrumbChoice => ({
          id: page.id, title: page.title, icon: page.icon, current: page.id === ws.currentId,
          onOpen: () => navigate(page.id),
          children: pages.filter((child) => child.parentId === page.id).map(choice),
        });
        return pages.filter((page) => !page.parentId && (ref.kind === 'local' || page.section === 'workspace')).map(choice);
      },
      pageUrl,
      favorite: favorites.has(id),
      onFavorite: (value) => {
        favorites.set(id, value);
      refreshLibrary();
        if (ws.index) ws.frame.setPages(withSections(ws.index.pages), ws.currentId);
      },
      readOnly: readOnly(id),
      onRename: () => {
        const title = holder.querySelector<HTMLElement>('[data-blok-title] h1, h1[contenteditable="true"]');
        title?.focus();
        if (title) { const range = document.createRange(); range.selectNodeContents(title); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
      },
      onMove: ref.kind === 'local' || ws.access.canShare(id) ? () => { void action({ id, type: 'move' }).catch(showError); } : undefined,
      onHistory: ref.kind === 'remote' ? () => { void openHistory().catch(showError); } : undefined,
      onDuplicate: () => { void action({ id, type: 'duplicate' }).catch(showError); },
      onDelete: () => { void action({ id, type: 'delete' }).catch(showError); },
    });
    const pagePresence = ref.kind === 'remote' ? createPagePresence({
      self: () => ({ id: ref.accountId, ...readAccountIdentity(ref) }),
      onLocate: blockId => instance.blocks.getById(blockId)?.holder.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      onProfile: userId => { void memberProfiles?.open(userId); },
    }) : null;
    if (pagePresence) toolbar.element.querySelector('[data-desktop-page-actions]')?.prepend(pagePresence.element);
    const unwatchProfile = pagePresence ? watchLocalProfile(() => pagePresence.refresh()) : () => undefined;
    ws.pageToolbar = toolbar;
    toolbar.element.insertBefore(status, toolbar.element.querySelector('[data-desktop-page-actions]'));
    applyFullWidth();
    const holder = document.createElement('div');
    article.append(holder);
    const cover = { node: null as HTMLElement | null, rendered: undefined as PageCover | undefined, position: undefined as number | undefined, button: null as HTMLButtonElement | null };
    function changeCover(cover: PageCover | undefined): void {
      if (readOnly(id)) return;
      selectedPage.cover = cover;
      if (cover === undefined) selectedPage.coverPosition = undefined;
      if (life.active && !life.destroyed) renderCover();
      saveManifest();
    }
    const attachCoverAction = (): void => {
      if (readOnly(id)) return;
      if (isPageCover(page.cover)) return;
      const row = holder.querySelector<HTMLElement>('[data-blok-page-icon-row]');
      if (!row) return;
      cover.button ??= createAddCoverButton(changeCover);
      if (cover.button.parentElement !== row) row.append(cover.button);
      if (ws.coverRowObserver === null) {
        ws.coverRowObserver = new MutationObserver(() => {
          if (life.active && !life.destroyed) attachCoverAction();
        });
        ws.coverRowObserver.observe(row, { childList: true });
      }
    };
    const renderCover = (): void => {
      article.toggleAttribute('data-has-cover', isPageCover(page.cover));
      if (isPageCover(page.cover)) {
        cover.button?.remove();
        const position = typeof page.coverPosition === 'number' && Number.isFinite(page.coverPosition)
          ? Math.max(0, Math.min(100, page.coverPosition)) : 50;
        // Background metadata refreshes must preserve the open picker and its focus.
        if (cover.node && cover.rendered === page.cover && cover.position === position) return;
        cover.rendered = page.cover;
        cover.position = position;
        const next = createPageCover(page.cover, position, changeCover, (value) => {
          if (readOnly(id)) return;
          page.coverPosition = value;
          cover.position = value;
          saveManifest();
        }, { upload: repository.uploadImage, resolveUrl: repository.assetUrl, readOnly: readOnly(id) });
        if (cover.node) cover.node.replaceWith(next);
        else ws.pageCanvas.insertBefore(next, article);
        cover.node = next;
      } else {
        cover.node?.remove();
        cover.node = null;
        attachCoverAction();
      }
    };
    const createdProperty = document.createElement('div');
    createdProperty.setAttribute('data-desktop-page-created', '');
    const renderCreatedProperty = (): void => {
      const value = pageTimestamp(page.createdAt);
      createdProperty.replaceChildren();
      if (!value) { createdProperty.remove(); return; }
      const label = document.createElement('span'); label.textContent = 'Date de création';
      const time = document.createElement('time'); time.dateTime = page.createdAt ?? ''; time.textContent = value;
      createdProperty.append(label, time);
      holder.querySelector('[data-blok-page-title]')?.after(createdProperty);
    };
    const refreshPresentation = (): void => { applyFullWidth(); renderCover(); renderCreatedProperty(); ws.titleDateMention?.refresh(); };
    ws.refreshPagePresentation = refreshPresentation;
    ws.pageCanvas.replaceChildren(toolbar.element, article);
    renderCover();
    const persisted = { content: null as string | null };
    const contentSignature = (data: OutputData): string => JSON.stringify({ ...data, time: undefined, version: undefined });
    const saveLocalData = async (data: OutputData): Promise<void> => {
      sync.localWrites++;
      updatePending();
      try {
        await repository.writePage(id, JSON.stringify(data));
        const signature = contentSignature(data);
        if (persisted.content !== signature) {
          page.updatedAt = new Date().toISOString();
          saveManifest();
        }
        persisted.content = signature;
        if (life.active) saveStatus.saved('document');
      } finally { sync.localWrites--; updatePending(); }
    };
    const instance = new Blok({
      holder,
      readOnly: readOnly(id),
      tools: { ...desktopTools, database: {class: Database, config: {people: { me: () => commentAuthor(ref).authorId, ...(memberProfiles ? { openProfile: (userId: string) => { void memberProfiles.open(userId); } } : {}), list: async () => { if(memberProfiles)return (await memberProfiles.list()).map(member=>({id:member.id,name:profileDisplayName(member.name,member.email),...(member.avatarUrl ? {avatarUrl:member.avatarUrl} : {})})); const author = commentAuthor(ref); return [{ id: author.authorId, get name() { return commentAuthor(ref).authorName; }, get avatarUrl() { return commentAuthor(ref).avatarUrl; } }]; } }, customEmojis: () => emojis.list(), coverGallery: COVER_GALLERY, uploadCover: (file: globalThis.File) => readCoverFile(file).then(repository.uploadImage)}}, page: { class: Page, config: { ...pageConfig } } },
      ...(memberProfiles ? {resolveUser: async (userId: string) => { const member=await memberProfiles.list().then(members=>members.find(person=>person.id===userId)).catch(()=>undefined); return member ? {name:profileDisplayName(member.name,member.email)} : null; }} : {}),
      theme: readAppearance(),
      pageTitle: {
        customEmojis: () => emojis.list(),
        placeholder: 'Nouvelle page',
        onChange(title, change) {
          if (life.destroyed || !ws.index) return;
          const next = title.trim() || 'Nouvelle page';
          if (page.titleDate && change.source === 'user') {
            const label = titleDateLabel(page.titleDate, new Date(), page.titleDateDisplay);
            const prefix = label === null ? '' : `@${label}`;
            const token = holder.querySelector('[data-desktop-title-date-token]');
            if (token && next.startsWith(prefix)) page.titleDateSuffix = next.slice(prefix.length);
            else {
              page.titleDate = undefined;
              page.titleDateDisplay = undefined;
              page.titleDateSuffix = undefined;
            }
          }
          page.title = next;
          holder.querySelector<HTMLElement>('[data-blok-page-title]')?.toggleAttribute('data-desktop-title-date', !!page.titleDate);
          toolbar.setBreadcrumbs(breadcrumbs(id));
          notifyPage(id);
          if (life.active) document.title = next;
          ws.frame.setPages(withSections(ws.index.pages), ws.currentId);
          if (ref.kind === 'local' || change.source !== 'remote') saveManifest();
        },
        onIconChange(icon, change) {
          if (life.destroyed || !ws.index) return;
          syncPageIcon(page, icon, ref.kind === 'local' || change.source !== 'remote');
        },
      },
      documentId: ref.kind === 'local' && ref.id === 'default' ? id : `${workspaceKey(ref)}:${id}`,
      ...(ref.kind === 'remote' ? {
        server: `${ref.server}/api/blok`,
        ticket: ({ doc }: { doc?: string; forceRefresh?: boolean }) => repository.ticket(doc ?? id),
        user: { id: ref.accountId },
        collaboration: {
          doc: id,
          user: { get name() { return readAccountIdentity(ref).name; } },
          offline: true,
          offlineScope: workspaceKey(ref),
        },
      } : { persistence: {
        async load() {
          const raw = await repository.readPage(id);
          const data = raw ? JSON.parse(raw) as OutputData : null;
          persisted.content = data ? contentSignature(data) : null;
          return data;
        },
        save: saveLocalData,
        onError: (error) => showError(error, 'document'),
      } }),
    });
    ws.editor = instance;
    ws.remotePending = false;
    instance.width.set(page.fullWidth === true ? 'full' : 'narrow');
    const mountPresentation = (): void => {
      if (!life.active || life.destroyed) return;
      ws.pageComments = mountPageComments({ holder, editor: instance, author: () => commentAuthor(ref), canComment: () => !readOnly(id) && ws.editor === instance });
      const discussions = ws.pageComments.element.querySelector('[data-inline-comments-open]');
      if (discussions) toolbar.element.querySelector('[data-desktop-page-actions]')?.prepend(discussions);


      const redactor = holder.querySelector<HTMLElement>('[data-blok-redactor]');
      if (redactor) ws.floatingToc = createFloatingToc(ws.pageCanvas, redactor);
      attachCoverAction();
      if (ref.kind === 'local' && (!instance.title.get() || page.titleDate)) instance.title.set(page.title, { record: false });
      renderCreatedProperty();
      const title = holder.querySelector<HTMLElement>('[data-blok-page-title]');
      if (title) {
        const updateDateTitle = (): void => {
          const label = page.titleDate ? titleDateLabel(page.titleDate, new Date(), page.titleDateDisplay) : null;
          const next = label === null ? 'Nouvelle page' : `@${label}${page.titleDateSuffix ?? ''}`;
          page.title = next;
          instance.title.set(next);
          if (page.titleDate) title.setAttribute('data-desktop-title-date', page.titleDate);
          else title.removeAttribute('data-desktop-title-date');
          saveManifest();
        };
        ws.titleDateMention = bindTitleDateMention(title, {
          getDate: () => page.titleDate,
          getDisplay: () => page.titleDateDisplay ?? {},
          setDate: (value) => {
            if (!page.titleDate || value === null) page.titleDateSuffix = undefined;
            page.titleDate = value ?? undefined;
            if (value === null) page.titleDateDisplay = undefined;
            updateDateTitle();
          },
          setDisplay: (change: DateDisplayChange) => {
            const display = { ...page.titleDateDisplay };
            if ('dateFormat' in change) display.dateFormat = change.dateFormat;
            if ('timeFormat' in change) display.timeFormat = change.timeFormat;
            if ('timeZone' in change) {
              if (change.timeZone === null) delete display.timeZone;
              else display.timeZone = change.timeZone;
            }
            page.titleDateDisplay = display;
            updateDateTitle();
          },
          i18n: instance.i18n,
        });
      }
      // Load-time read only: on a remote page the document — and its icon —
      // lands after the editor is ready, so this must never clear (flash).
      syncPageIcon(page, instance.title.icon.get(), ref.kind === 'local', true);
      toolbar.setBreadcrumbs(breadcrumbs(id));
      document.title = page.title;
      saveStatus.ready();
      if (connectionState.value && ref.kind === 'remote') saveStatus.connection(connectionState.value);
      if (connectionState.value) pagePresence?.update(connectionState.value);
      pagePresence?.refresh();
      // Run after the outgoing save and the incoming mount, including cached pages.
      ws.pageCanvas.scrollTop = 0;
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const target = library.target;
      if (target?.pageId === id) {
        instance.blocks.getById(target.blockId)?.holder.scrollIntoView({ block: 'start', behavior: 'smooth' });
        library.target = null;
      }
    };
    const connectionState = { value: undefined as Parameters<typeof saveStatus.connection>[0] | undefined };
    const session: PageSession = {
      id, page, editor: instance, permission: pagePermission(id),
      get active() { return life.active; }, set active(value) { life.active = value; },
      get ready() { return life.ready; }, set ready(value) { life.ready = value; },
      get destroyed() { return life.destroyed; }, set destroyed(value) { life.destroyed = value; },
      nodes: [],
      suspend() {
        historyView.value?.destroy(); historyView.value = null;
        pagePresence?.close();
        if (article.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        const selection = window.getSelection();
        if (selection?.anchorNode && article.contains(selection.anchorNode)) selection.removeAllRanges();
        instance.toolbar.close(); instance.inlineToolbar.close(); instance.toolbar.toggleBlockSettings(false); instance.toolbar.toggleToolbox(false);
        article.setAttribute('inert', '');
        life.active = false;
        clearPresentation();
        session.nodes = Array.from(ws.pageCanvas.childNodes);
      },
      resume() {
        life.active = true;
        ws.editor = instance; ws.pageToolbar = toolbar;
        ws.refreshPagePresentation = refreshPresentation;
        saveStatus.resetPage();
        ws.remotePending = (connectionState.value?.save?.pendingOperations ?? 0) > 0 || (connectionState.value?.save?.pendingBytes ?? 0) > 0;
        sync.remoteConnection = connectionState.value?.status ?? 'connecting';
        ws.pageCanvas.replaceChildren(...session.nodes);
        article.removeAttribute('inert');
        toolbar.element.insertBefore(status, toolbar.element.querySelector('[data-desktop-page-actions]'));
        toolbar.setWorkspaceName(identity.name);
        instance.theme.set(readAppearance());
        refreshPresentation();
        if (ref.kind === 'local' && page.titleDate) instance.title.set(page.title, { record: false });
        mountPresentation();
      },
      destroy() {
        if (life.destroyed) return;
        life.destroyed = true; life.active = false;
        historyView.value?.destroy();
        unwatchProfile(); pagePresence?.destroy();
        toolbar.destroy(); instance.destroy();
        session.nodes = [];
      },
      async flush() {
        await instance.saver.flush();
        if (ref.kind === 'local' && !readOnly(id)) await saveLocalData(await instance.save());
      },
      async sourceUnchanged() {
        if (ref.kind === 'remote') return true;
        const raw = await repository.readPage(id);
        return (raw ? contentSignature(JSON.parse(raw) as OutputData) : null) === persisted.content;
      },
    };
    sessions.current = session;
    void instance.isReady.then(() => {
      if (life.destroyed) return;
      life.ready = true;
      instance.on('collaboration:status', (raw) => {
        if (life.destroyed) return;
        // An emission with no payload must fall back to "not pending", not throw
        // inside the listener and kill the rest of the handler.
        const event = (raw ?? {}) as NonNullable<Parameters<typeof saveStatus.connection>[0]>;
        connectionState.value = event;
        pagePresence?.update(event);
        if (!life.active) return;
        const pendingOps = event?.save?.pendingOperations ?? 0;
        const pendingBytes = event?.save?.pendingBytes ?? 0;
        ws.remotePending = pendingOps > 0 || pendingBytes > 0;
        if (ref.kind === 'remote') {
          const reconnected = event?.status === 'connected' && sync.remoteConnection !== 'connected';
          if (event?.status) sync.remoteConnection = event.status;
          if (reconnected && navigator.onLine && ws.manifestFailed && ws.pendingManifests === 0) saveManifest();
          saveStatus.connection(event);
          historyView.value?.refreshAccess();
        }
      });
      mountPresentation();
    }).catch(error => { const active = life.active; session.destroy(); if (active) showError(error); });
  };

  const duplicatePage = async (page: DesktopPage): Promise<'navigated' | 'pending'> => {
    if (ref.kind === 'remote') {
      const copy = {id: crypto.randomUUID(), title: `${page.title} (copie)`, parentId: page.parentId};
      if (ws.editor) { await ws.editor.isReady; await ws.editor.saver.flush(); }
      await ws.saveOrder;
      await repository.duplicatePage(page.id, copy);
      const refreshed = adoptIndex(await repository.loadIndex());
      ws.frame.setPages(withSections(refreshed.pages), refreshed.activeId);
      navigate(copy.id);
      return 'navigated';
    }
    if (!ws.index) return 'navigated';
    const copy: DesktopPage = { ...page, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), id: crypto.randomUUID(), title: `${page.title} (copie)`, titleDate: undefined, titleDateDisplay: undefined, titleDateSuffix: undefined };
    ws.index.pages.push(copy);
    saveManifest();
    void repository.readPage(page.id).then(async (raw) => {
      if (raw) {
        const data = JSON.parse(raw) as OutputData;
        await repository.writePage(copy.id, JSON.stringify({ ...data, id: copy.id, title: copy.title }));
      }
      navigate(copy.id);
    }).catch(showError);
    return 'pending';
  };

  const deletePage = (page: DesktopPage): void => {
    if (!ws.index || ws.index.pages.length === 1) return;
    const removed = new Set([page.id]);
    const removeState = { previous: -1 };
    while (removeState.previous !== removed.size) {
      removeState.previous = removed.size;
      ws.index.pages.forEach((item) => { if (item.parentId && removed.has(item.parentId)) removed.add(item.id); });
    }
    if (removed.size === ws.index.pages.length) return;
    ws.index.trash = [...(ws.index.trash ?? []), ...ws.index.pages.filter((item) => removed.has(item.id))];
    ws.index.pages = ws.index.pages.filter((item) => !removed.has(item.id));
    removed.forEach(dropCachedPage);
    removed.forEach(notifyPage);
    const fallback = ws.index.pages[0];
    if (removed.has(ws.currentId) && fallback) navigate(fallback.id, true);
  };

  const openPageTab = (page: DesktopPage): void => {
    if ('__TAURI_INTERNALS__' in window) {
      window.dispatchEvent(new Event('blok:desktop-new-tab'));
      navigate(page.id, true);
      return;
    }
    window.open(pageUrl(page.id), '_blank', 'noopener,noreferrer');
  };

  const renamePage = (page: DesktopPage, title: string): void => {
    const target = page;
    target.title = title;
    target.titleDate = undefined;
    target.titleDateDisplay = undefined;
    target.titleDateSuffix = undefined;
    notifyPage(target.id);
    if (ws.currentId === target.id) ws.editor?.title.set(title);
    else ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
  };

  const flushRemoteBeforeAction = async (command: SidebarAction): Promise<void> => {
    if (ref.kind !== 'remote' || !ws.editor || command.type === 'open-tab') return;
    await ws.editor.isReady;
    await ws.editor.saver.flush();
    await ws.saveOrder;
  };

  const destinationsFor = (id: string) => {
    const teamspaceId = ws.index?.access?.[id]?.teamspaceId ?? null;
    const rootLabel = sidebarTeamspaces.find(team => team.id === teamspaceId)?.name ?? identity.name;
    return moveDestinations({ pages: ws.index?.pages ?? [], sourceId: id, rootLabel,
      canEdit: pageId => ws.access.canEdit(pageId),
      canMove: pageId => ref.kind === 'local' || ws.access.canShare(pageId),
      isSharedRoot: pageId => ws.access.isSharedRoot(pageId),
      teamspaceOf: pageId => ws.index?.access?.[pageId]?.teamspaceId ?? null,
    });
  };
  const moveLocalPage = async (id: string, parentId: string | null): Promise<void> => {
    if (!ws.index) return;
    const page = ws.index.pages.find(item => item.id === id);
    if (!page) throw new Error('Cette page n’est plus disponible.');
    const previousParent = page.parentId;
    const previousUpdatedAt = page.updatedAt;
    page.parentId = parentId;
    saveManifest();
    try { await ws.saveOrder; }
    catch (error) {
      page.parentId = previousParent;
      page.updatedAt = previousUpdatedAt;
      localMetadata.set(page.id, metadataOf(page));
      throw error;
    }
  };
  const movePage = async (id: string, parentId: string | null): Promise<void> => {
    if (!ws.index || ws.metadataAction || !destinationsFor(id).some(item => item.parentId === parentId)) throw new Error('Cette destination n’est plus autorisée.');
    const wasInert = ws.frame.element.inert;
    ws.frame.element.inert = true;
    ws.metadataAction = true;
    try {
      await flushRemoteBeforeAction({ id, type: 'move' });
      if (ref.kind === 'remote') {
        await repository.movePage(id, parentId);
        const refreshed = await repository.loadIndex();
        refreshed.activeId = refreshed.pages.some(page => page.id === ws.currentId) ? ws.currentId : refreshed.activeId;
        adoptIndex(refreshed);
      } else await moveLocalPage(id, parentId);
      if (!ws.index) return;
      ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.currentId);
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
      ws.refreshPagePresentation?.();
      refreshLibrary();
      if (!ws.index.pages.some(page => page.id === ws.currentId)) onRoute();
    } finally { ws.frame.element.inert = wasInert; ws.metadataAction = false; }
  };
  const action = async (command: SidebarAction): Promise<void> => {
    if (command.type === 'move') {
      if (!ws.index || readOnly(command.id)) return;
      const page = ws.index.pages.find(item => item.id === command.id);
      if (!page) return;
      openPageMove({ title: page.title, destinations: () => destinationsFor(page.id), onMove: parentId => movePage(page.id, parentId) });
      return;
    }
    if (command.type !== 'open-tab' && readOnly(command.id)) return;
    const wasInert = ws.frame.element.inert;
    if (ref.kind === 'remote') { ws.frame.element.inert = true; ws.metadataAction = true; }
    try {
      await flushRemoteBeforeAction(command);
      if (!ws.index) return;
      const page = ws.index.pages.find((item) => item.id === command.id);
      if (!page) return;
      if (command.type === 'rename') renamePage(page, command.title);
      else if (command.type === 'duplicate') { await duplicatePage(page); return; }
      else if (command.type === 'delete') deletePage(page);
      else if (command.type === 'open-tab') { openPageTab(page); return; }
      else return;
      ws.frame.setPages(withSections(ws.index.pages), library.dispose ? '' : ws.index.activeId);
      saveManifest();
    } finally { ws.frame.element.inert = wasInert; ws.metadataAction = false; }
  };

  const refreshTeamspaces = async ():Promise<void> => {
    if(!teamspacesApi || teamspacesState.refreshing)return;
    teamspacesState.refreshing=true;
    try {
      const result=await teamspacesApi.list();
      teamspacesState.error=null;
      sidebarTeamspaces.splice(0,sidebarTeamspaces.length,...result.teamspaces.filter(team=>!!team.myRole && !team.archived).map(team=>({id:team.id,name:team.name,icon:team.icon,canCreate:ref.kind==='remote' && ref.role!=='viewer'})));
      if(ws.index)ws.frame.setPages(withSections(ws.index.pages),ws.currentId);
    }catch(error){
      teamspacesState.error=`Espaces d’équipe indisponibles : ${error instanceof Error ? error.message : 'réessayez depuis les paramètres'}`;
      if(ws.index)ws.frame.setPages(withSections(ws.index.pages),ws.currentId);
    }
    finally{teamspacesState.refreshing=false;}
  };
  ws.frame = createPageFrame({
    sidebarLayout: readSidebarLayout(ref),
    onSidebarLayoutChange: layout => saveSidebarLayout(ref, layout),
    onCustomizeSidebar: () => ws.footer.dispatchEvent(new Event('blok:desktop-customize-sidebar')),
    onAssistant: () => ws.assistant.open(),
    ...(ref.kind==='remote' ? {teamspaces:sidebarTeamspaces,teamspaceStatus:()=>teamspacesState.error} : {}),
    pages: [], activeId: '',
    recentIds: recentPages.ids,
    onRecentsChange: (ids) => { library.recents = ids; recentPages.save(ids); refreshLibrary(); },
    onCreateNote: canCreateUnder(null) ? () => { void createNote().catch(showError); } : undefined,
    onLibrary: () => navigateLibrary('all'),
    onOpen: (id) => navigate(id),
    onCreate: (parentId) => chooseNewPage(parentId),
    onCreatePrivate: ref.kind === 'remote' ? () => chooseNewPage(null, true) : undefined,
    onSearch: (recentIds) => {
      ws.closeSearch?.();
      ws.closeSearch = openPageSearch({ workspaceName: identity.name, pages: () => ws.index?.pages ?? [], onOpen: navigate, recentIds });
    },
    onManageTeamspaces: ref.kind==='remote' ? ()=>ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-teamspace',{detail:{}})) : undefined,
    onCreateTeamspacePage: (id)=>chooseNewPage(null,false,id),
    onTeamspaceMenu: (_anchor,id)=>{if(id)ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-teamspace',{detail:{id}}));},
    onAction: (command) => { void action(command).catch(showError); },
    pageUrl,
    availableActions: ['rename', 'duplicate', 'move', 'delete', 'open-tab'],
    canEdit: (id) => !readOnly(id),
    canCreate: canCreateUnder,
    onFavorite: (id, value) => {
      favorites.set(id, value);
      refreshLibrary();
      if (ws.currentId === id) ws.pageToolbar?.setFavorite(value);
    },
  });
  const unsubscribeSidebar = subscribeSidebarLayout(ref, layout => {
    ws.frame.setSidebarLayout(layout);
    onLayout(ws.frame.element.querySelector('[data-blok-sidebar]')?.getBoundingClientRect().width ?? layout.width);
  });
  ws.frame.element.append(status);
  const getAiSource = () => {
    const editor=ws.editor, id=ws.currentId;
    return readAiPageSource(editor ? {id,editor} : null, () => ws.editor===editor && ws.currentId===id && !!ws.index?.pages.some(page=>page.id===id));
  };
  const workspaceAssistant = createWorkspaceAssistant(ref);
  ws.assistant = mountAgentAssistant({
    getPageText: async () => {
      if(!ws.editor)return '';
      const source=await getAiSource();
      if(!source)throw new Error('La page a changé ou son accès a été retiré. Réessayez depuis la page ouverte.');
      return source.text.slice(0,100_000);
    },
    openSettings: () => ws.footer.dispatchEvent(new Event('blok:desktop-open-ai-settings')),
    ...workspaceAssistant,
  });
  ws.pageCanvas = ws.assistant.editorSlot;
  ws.frame.canvas.append(ws.assistant.element);
  const sidebar = ws.frame.element.querySelector('[data-blok-sidebar]') as HTMLElement;
  const panel = ws.assistant.element.querySelector<HTMLElement>('[data-blok-agent-panel]');
  const assistantButton = createAssistantButton(() => {
    if (!panel || panel.hidden) ws.assistant.open();
    else ws.assistant.close();
  });
  ws.frame.canvas.append(assistantButton);
  if (panel) bindAssistantButton(assistantButton, panel);
  ws.footer = createDesktopFooter((mode) => ws.editor?.theme.set(mode));
  ws.footer.addEventListener('blok:desktop-open-page', (event) => {
    const detail = (event as CustomEvent<{ pageId: string; seedWelcome?: boolean }>).detail;
    if (!detail?.pageId) return;
    const open = async (): Promise<void> => {
      if (ws.index?.pages.some((page) => page.id === detail.pageId)) {
        navigate(detail.pageId);
        return;
      }
      if (detail.seedWelcome) {
        const id = await seedWelcomeWorkspace();
        if (!id) return;
        const target = ws.index?.pages.some((page) => page.id === detail.pageId) ? detail.pageId : id;
        navigate(target);
      }
    };
    void open().catch(() => undefined);
  });
  ws.footer.addEventListener('blok:desktop-teamspaces-changed',()=>{void refreshTeamspaces().then(()=>refreshRemoteManifest());});
  sidebar.insertBefore(ws.footer, sidebar.querySelector('[data-blok-sidebar-edge]'));
  ws.frame.element.addEventListener('blok:desktop-workspace-renamed', (event) => {
    const detail = (event as CustomEvent<{key: string; name: string}>).detail;
    if (detail?.key !== workspaceKey(ref) || !detail.name) return;
    identity.name = detail.name;
    if (ws.index) ws.frame.setPages(withSections(ws.index.pages), ws.currentId);
    ws.pageToolbar?.setWorkspaceName(identity.name);
    ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
    if (!ws.currentId) document.title = brandedTitle(identity.name);
  });
  const observer = new ResizeObserver(() => onLayout(sidebar.getBoundingClientRect().width));
  observer.observe(sidebar);
  ws.frame.element.setAttribute('data-desktop-workspace', '');
  ws.frame.element.toggleAttribute('data-desktop-read-only', ws.access.readOnlyWorkspace);

  async function seedWelcomeWorkspace(): Promise<string | null> {
    if (!ws.index || ws.access.readOnlyWorkspace) return null;
    const workspaceId = ref.kind === 'remote' ? ref.workspaceId : ref.id;
    const key = workspaceKey(ref);
    const existing = ws.index.pages.find((page) => page.id === welcomePageId(workspaceId));
    if (existing) {
      markWelcomeSeeded(key);
      return existing.id;
    }
    const docs = buildWelcomeDocuments(workspaceId);
    const welcomePage = docs.pages[0];
    if (!welcomePage) return null;
    // Captured so the callbacks below keep the non-null narrowing from the guard.
    const index = ws.index;
    const seeded = await seedWelcomeDocuments({
      docs,
      publishPages: (selectId) => {
        for (const page of docs.pages) {
          if (!index.pages.some((item) => item.id === page.id)) index.pages.push(page);
        }
        ws.frame.setPages(withSections(index.pages), selectId ?? index.activeId);
        saveManifest();
      },
      flushOrder: () => ws.saveOrder,
      seedDocument: async (pageId, document) => {
        if (ref.kind === 'remote') await repository.seedPage(pageId, document);
        else await repository.writePage(pageId, JSON.stringify(document));
      },
    });
    if (seeded) {
      markWelcomeSeeded(key);
      return welcomePage.id;
    }
    index.pages = index.pages.filter((page) => !docs.pages.some((item) => item.id === page.id));
    ws.frame.setPages(withSections(index.pages), index.activeId);
    saveManifest();
    try { await ws.saveOrder; } catch { /* keep empty */ }
    return null;
  }

  async function showEmptyWorkspace(): Promise<void> {
    if (ws.editor) {
      await ws.editor.isReady;
      if (ref.kind === 'remote') await ws.editor.saver.flush();
    }
    if (ws.index?.pages.length) { onRoute(); return; }
    const key = workspaceKey(ref);
    if (shouldSeedWelcome({
      empty: true,
      seeded: hasWelcomeSeeded(key),
      viewer: ws.access.readOnlyWorkspace,
      remote: ref.kind === 'remote',
    })) {
      const seededId = await seedWelcomeWorkspace();
      if (seededId) {
        navigate(seededId);
        return;
      }
    }
    ws.generation++;
    ws.selection++;
    leavePage(false);
    for (const id of cachedPages.keys()) dropCachedPage(id);
    ws.currentId = '';
    ws.frame.element.append(status);
    saveStatus.resetPage();
    ws.pageCanvas.replaceChildren(createEmptyWorkspaceState(ws.access.readOnlyWorkspace, () => createPage(), {
      onTemplate: () => chooseNewPage(),
      onInvite: () => {
        ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-settings', { detail: 'invites' }));
      },
      onImport: () => chooseNewPage(),
      onGettingStarted: () => {
        void (async () => {
          const id = await seedWelcomeWorkspace();
          if (id) navigate(id);
        })().catch(() => undefined);
      },
    }));
    const url = new URL(location.href);
    if (url.searchParams.has('page')) { url.searchParams.delete('page'); history.replaceState(null, '', url); }
    document.title = brandedTitle(identity.name);
  }

  function navigateLibrary(category: LibraryCategory): void {
    const url = new URL(libraryUrl(location.href, category));
    if (ref.kind === 'local') url.searchParams.set('local', '1');
    if (url.href !== location.href) history.pushState(null, '', url);
    onRoute();
  }

  async function showLibrary(category: LibraryCategory): Promise<void> {
    if (!ws.index) return;
    const request = ++ws.selection;
    if (library.dispose && library.category === category) { library.dispose.refresh(); return; }
    const session = sessions.current;
    if (session) {
      await session.editor.isReady;
      if (sessions.disposed || ws.selection !== request) return;
      await session.flush();
    }
    if (ws.selection !== request) return;
    ws.closeSearch?.(); ws.closeSearch = undefined;
    ws.generation++;
    leavePage(true); ws.currentId = '';
    ws.remotePending = false;
    saveStatus.resetPage();
    ws.frame.element.append(status);
    ws.frame.element.setAttribute('data-desktop-library', '');
    ws.frame.setActiveShortcut('library');
    ws.frame.element.toggleAttribute('data-desktop-read-only', ws.access.readOnlyWorkspace);
    ws.frame.setPages(withSections(ws.index.pages), '');
    ws.pageCanvas.removeAttribute('data-full-width');
    library.dispose?.(); ws.pageCanvas.replaceChildren();
    library.category = category;
    library.dispose = openPageLibrary({
      container: ws.pageCanvas, category, local: ref.kind === 'local',
      onCategoryChange: value => {
        library.category = value;
        const url = libraryUrl(location.href, value);
        if (url !== location.href) history.pushState(null, '', url);
      },
      onToggleSidebar: () => { ws.frame.toggleSidebar(); onLayout(sidebar.getBoundingClientRect().width); },
      pages: () => ws.index?.pages ?? [], access: () => ws.index?.access,
      recentIds: () => library.recents, isFavorite: favorites.has,
      loadChildren: pageId => repository.readPageOutline(pageId),
      onOpenBlock: (pageId, blockId) => { library.target = { pageId, blockId }; navigate(pageId); },
      canCreate: canCreateUnder(null), onOpen: navigate,
      onCreateNote: () => { void createNote().catch(showError); }, onCreate: () => chooseNewPage(null),
    });
    document.title = brandedTitle('Bibliothèque');
    ws.pageCanvas.scrollTop = 0;
  }

  const reloadRemoteRoute = (): void => {
    if(routeLoad.pending)return;
    routeLoad.pending=true;const destination=location.href;ws.pageCanvas.setAttribute('aria-busy','true');
    void (async()=>{
      if(ws.editor){await ws.editor.isReady;await ws.editor.saver.flush();}
      await ws.saveOrder;
      if(location.href===destination)location.reload();
    })().catch(showError).finally(()=>{routeLoad.pending=false;ws.pageCanvas.removeAttribute('aria-busy');});
  };

  function onRoute(): void {
    if (sessions.disposed || !ws.index) return;
    const category = libraryCategoryForHref(location.href);
    if (category !== null) {
      void showLibrary(category).catch(error => {
        if (ws.currentId && libraryCategoryForHref(location.href) !== null) navigate(ws.currentId, true);
        showError(error);
      });
      return;
    }
    const requested=pageDestination(location.href);
    const id=pageFromUrl();
    const explicit=requested.kind!=='none';
    const found=ws.index.pages.find(page=>page.id===id);
    if(explicit && !found){
      if(ref.kind==='remote' && location.href!==initialHref && !('__TAURI_INTERNALS__' in window)){
        reloadRemoteRoute(); return;
      }
      library.dispose?.(); library.dispose = null; library.category = null;
      ws.frame.element.removeAttribute('data-desktop-library');
      ws.frame.setActiveShortcut(null);
      ws.generation++;ws.selection++;leavePage(false);ws.currentId='';
      const section=document.createElement('section');section.setAttribute('data-page-unavailable','');section.style.padding='48px';
      const heading=document.createElement('h1');heading.textContent='Page indisponible';
      const message=document.createElement('p');message.textContent='Cette page est introuvable ou vous n’y avez plus accès.';
      section.append(heading,message);ws.pageCanvas.replaceChildren(section);document.title=brandedTitle('Page indisponible');return;
    }
    if(!ws.index.pages.length){void showEmptyWorkspace().catch(showError);return;}
    const target=found?.id ?? ws.index.activeId;
    if (id !== target) {
      navigate(target, true);
      return;
    }
    void select(target).catch((error) => {
      if (ws.currentId && pageFromUrl() !== ws.currentId) {
        const url = new URL(ref.kind==='remote' && !('__TAURI_INTERNALS__' in window) ? pageUrl(ws.currentId) : location.href); if(ref.kind==='local' || '__TAURI_INTERNALS__' in window)url.searchParams.set('page', ws.currentId);
        history.replaceState(null, '', url);
      }
      showError(error);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || !ws.frame.element.isConnected || document.querySelector('[aria-modal="true"]')) return;
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    ws.closeSearch?.();
    ws.closeSearch = openPageSearch({ workspaceName: identity.name, pages: () => ws.index?.pages ?? [], onOpen: navigate });
  }, { signal: lifetime.signal });
  const notesAction = { busy: false };
  async function initializeNotesCollection(identity: { pageId: string; databaseId: string }): Promise<void> {
    if (!ws.index) throw new Error('Espace indisponible.');
    const timestamp = new Date().toISOString();
    const page: DesktopPage = { id: identity.pageId, title: 'Notes', parentId: null, ...(ref.kind === 'remote' ? { initialVisibility: 'private' as const } : { createdAt: timestamp, updatedAt: timestamp }) };
    ws.index.pages.push(page); saveManifest(); await ws.saveOrder;
    if (ws.manifestFailed) throw new Error('La collection Notes n’a pas pu être enregistrée.');
    rememberNotesCollection(ref, identity);
    const document = createNotesDocument(identity.databaseId);
    if (ref.kind === 'remote') await repository.seedPage(page.id, document);
    else await repository.writePage(page.id, JSON.stringify(document));
    if (ref.kind === 'remote') await refreshRemoteManifest();
  }
  async function createNote(): Promise<void> {
    if (notesAction.busy || !ws.index || !canCreateUnder(null)) return;
    notesAction.busy = true;
    try {
      const registered = readNotesCollection(ref);
      const identity = registered ?? { pageId: crypto.randomUUID(), databaseId: crypto.randomUUID() };
      if (registered && (!ws.index.pages.some(page => page.id === registered.pageId) || readOnly(registered.pageId))) throw new Error('La collection Notes est indisponible ou en lecture seule.');
      if (!registered) await initializeNotesCollection(identity);
      await select(identity.pageId);
      const editor = ws.editor;
      if (!editor || ws.currentId !== identity.pageId || readOnly(identity.pageId)) throw new Error('La collection Notes est indisponible.');
      navigate(identity.pageId);
      await addNote(editor, identity.databaseId, () => ws.editor === editor && ws.currentId === identity.pageId && !readOnly(identity.pageId));
      await editor.saver.flush();
    } finally { notesAction.busy = false; }
  }

  function chooseNewPage(parentId: string | null = null, privatePage = false, teamspaceId?:string): void {
    if (!ws.index || !canCreateUnder(parentId)) return;
    const destinations: CreationDestination[] = [];
    if (canCreateUnder(null)) {
      destinations.push({ value: 'workspace', label: 'Pages communes du Workspace', parentId: null });
      if (ref.kind === 'remote') destinations.push({ value: 'private', label: 'Privé · Vous uniquement', parentId: null, privatePage: true });
    }
    destinations.push(...sidebarTeamspaces.filter(team=>team.canCreate).map(team=>({value:`teamspace:${team.id}`,label:`${team.icon || ''} ${team.name}`,parentId:null,teamspaceId:team.id})));
    destinations.push(...ws.index.pages.filter((page) => canCreateUnder(page.id)).map((page) => ({ value: page.id, label: page.title, parentId: page.id })));
    openPageCreation({ destinations, destination: teamspaceId ? `teamspace:${teamspaceId}` : parentId ?? (ref.kind==='remote' || privatePage ? 'private' : 'workspace'),
      onCreate: (target, database) => createPage(target.parentId, target.privatePage, database, target.teamspaceId),
    });
  }

  function createPage(parentId: string | null = null, privatePage = false, database = false, teamspaceId?:string): void {
    if (!ws.index || ws.metadataAction || !canCreateUnder(parentId)) return;
    if(teamspaceId && teamspacesApi){
      if(!sidebarTeamspaces.some(team=>team.id===teamspaceId && team.canCreate))return;
      ws.metadataAction=true;
      const wasInert=ws.frame.element.inert;ws.frame.element.inert=true;
      teamspacesState.pending++;updatePending();
      void (async()=>{
        try{
          // Flush pending index work before the dedicated route advances its revision.
          await ws.saveOrder;
          if(ws.manifestFailed)return;
          const created=await teamspacesApi.createPage(teamspaceId,database ? 'Nouvelle base de données' : 'Nouvelle page');
          if(database)await repository.seedPage(created.id,{title:created.title,blocks:[{type:'database',data:{initialView:'table',fullPage:true}}]});
          ws.metadataAction=false;
          await refreshRemoteManifest();navigate(created.id);
        }catch(error){showError(error);}finally{ws.metadataAction=false;ws.frame.element.inert=wasInert;teamspacesState.pending--;updatePending();}
      })();return;
    }
    const page: DesktopPage = { ...(ref.kind === 'local' ? { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : {}), id: crypto.randomUUID(), title: database ? 'Nouvelle base de données' : 'Nouvelle page', parentId, ...(privatePage ? { initialVisibility: 'private' as const } : {}) };
    ws.index.pages.push(page);
    saveManifest();
    void ws.saveOrder.then(async () => {
      if (ws.manifestFailed) return;
      if (database) {
        const document = { title: page.title, blocks: [{ id: crypto.randomUUID(), type: 'database', data: { initialView: 'table', fullPage: true } }] };
        if (ref.kind === 'remote') await repository.seedPage(page.id, document);
        else await repository.writePage(page.id, JSON.stringify(document));
      }
      if (ref.kind==='remote') await refreshRemoteManifest();
      navigate(page.id);
    }).catch(showError);
  }

  return {
    element: ws.frame.element,
    async start() {
      try {
        if (ref.kind === 'remote') {
          const client = new CloudClient({origin:ref.server, ...('__TAURI_INTERNALS__' in window ? {sessionAdapter:nativeSessionAdapter(ref.server)} : {})});
          void initializeSidebarPresets(ref, client).catch(() => undefined);
        }
        const loaded = adoptIndex(await repository.loadIndex());
        if (sessions.disposed) return;
        await refreshTeamspaces();
        if (sessions.disposed) return;
        refreshDateTitles();
        ws.frame.setPages(withSections(loaded.pages), loaded.activeId);
        onRoute();
        scheduleDateRefresh();
        window.addEventListener('focus', refreshDateTitles, { signal: lifetime.signal });
        if (ref.kind === 'remote') {
          const reconnect = (): void => {
            if (sessions.disposed) return;
            saveStatus.online(navigator.onLine);
            if (!navigator.onLine) return;
            if (ws.manifestFailed && ws.pendingManifests === 0) saveManifest();
            else void refreshTeamspaces().then(()=>refreshRemoteManifest());
          };
          window.addEventListener('offline', () => saveStatus.online(false), { signal: lifetime.signal });
          window.addEventListener('online', reconnect, { signal: lifetime.signal });
          window.addEventListener('focus', reconnect, { signal: lifetime.signal });
          sessions.reconnectTimer = window.setInterval(reconnect, 15_000);
          window.addEventListener('beforeunload', (event) => { if (ws.pendingManifests > 0 || ws.manifestFailed) event.preventDefault(); }, { signal: lifetime.signal });
        }
      } catch (error) { showError(error); }
    },
    async flush() {
      const wasInert = ws.frame.element.inert;
      ws.frame.element.inert = true;
      try {
        const session = sessions.current;
        if (session) { await session.editor.isReady; await session.flush(); }
        for (const cached of ref.kind === 'remote' ? cachedPages.values() : []) await cached.flush();
        await ws.saveOrder;
      } finally { ws.frame.element.inert = wasInert; }
    },
    destroy() {
      if (sessions.disposed) return;
      lifetime.abort(); unsubscribeSidebar(); memberProfiles?.destroy();
      if (sessions.reconnectTimer !== undefined) window.clearInterval(sessions.reconnectTimer);
      ws.closeSearch?.(); ws.assistant.destroy();
      sessions.disposed = true; ws.selection++; ws.generation++;
      leavePage(false);
      for (const id of cachedPages.keys()) dropCachedPage(id);
      library.dispose?.(); library.dispose = null;
      observer.disconnect();
      if (ws.dateTimer !== null) window.clearTimeout(ws.dateTimer);
    },
    onRoute,
    toggleSidebar() {
      ws.frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    },
    createPage,
  };
}
