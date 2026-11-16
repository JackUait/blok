import { readSidebarLayout, saveSidebarLayout, subscribeSidebarLayout, initializeSidebarPresets } from './sidebar-preferences';
import { libraryUrl, libraryCategoryForHref, type LibraryCategory, pageDestination, pageIdForHref, publicPageUrl, legacyPageUrl, rememberPageLinks } from './page-urls';
import { createWorkspaceSaveStatus } from './workspace-save-status';
import './workspace-save-status.css';
import { navigationFavorites, navigationRecents } from './navigation-preferences';
import { commentAuthor } from './comment-author';
import { mountPageComments } from './page-comments';
import { createNotesDocument, readNotesCollection, rememberNotesCollection, addNote } from './notes-collection';
import { openPageLibrary, pageTimestamp } from './page-library';
import { openPageSearch, openPageCreation, type CreationDestination } from './navigation-dialogs';
import { customEmojiStore } from './custom-emojis';
import { createEmptyWorkspaceState } from './workspace-empty';
import { mountRemoteAssets } from './remote-assets';
import { Blok, defaultTools, type OutputData } from '@bloklabs/core/full';
import { Audio, Bookmark, File, Video, Callout, Code, Database, DatabaseComment, DatabaseRow, Divider, Image, Page, Quote, Table, TableOfContents, Toggle, type PageConfig } from '@bloklabs/core/tools';
import { createPageFrame, type PageFrame, type ShellPage, type SidebarAction, type SidebarTeamspace } from '@blok/sidebar';
import { type DesktopPage, type WorkspaceIndex } from './storage';
import { workspaceRepository } from './workspace-repository';
import { pageAccess } from './page-access';
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
import { openAiSummary, appendSummaryBlocks } from './ai-summary';
import { CloudClient } from './cloud/client';
import { nativeSessionAdapter } from './native-session';
import { teamspaceClient } from './cloud/teamspaces';
import { createPageToolbar, type PageBreadcrumbChoice, type PageBreadcrumbItem, type PageToolbar } from './page-toolbar';
import { bindTitleDateMention, titleDateLabel, type TitleDateMentionBinding } from './title-date-mention';
import { createFloatingToc, type FloatingToc } from './floating-toc';
import type { DateDisplayChange } from '@blok/date-editor';

const desktopTools = {
  ...defaultTools,
  table: { class: Table },
  database: { class: Database },
  'database-row': { class: DatabaseRow },
  'database-comment': { class: DatabaseComment },
  // Writing about a codebase needs these: code carries Prism highlighting, line
  // numbers, language detection and mermaid; the rest are what an explanation is
  // built from — callouts for the "why", toggles for detail a reader can fold away.
  code: { class: Code },
  callout: { class: Callout },
  toggle: { class: Toggle },
  quote: { class: Quote },
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
  let workspaceName = ref.name;
  const sidebarTeamspaces:SidebarTeamspace[]=[];
  const teamspacesState={refreshing:false,pending:0,error:'Chargement…' as string|null};
  const teamspacesApi=ref.kind==='remote' ? teamspaceClient(new CloudClient({origin:ref.server,...('__TAURI_INTERNALS__' in window ? {sessionAdapter:nativeSessionAdapter(ref.server)} : {})}),ref.workspaceId) : null;
  const repository = workspaceRepository(ref);
  const favorites = navigationFavorites(ref);
  const recentPages = navigationRecents(ref);
  const library = { dispose: null as ReturnType<typeof openPageLibrary> | null, category: null as LibraryCategory | null, recents: recentPages.ids, target: null as { pageId: string; blockId: string } | null };
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
  const localMetadata = new Map<string, string>();
  const metadataOf = (page: DesktopPage): string => JSON.stringify({ ...page, createdAt: undefined, updatedAt: undefined });
  const adoptIndex = (value: WorkspaceIndex): WorkspaceIndex => {
    if (ref.kind === 'local') for (const page of value.pages) localMetadata.set(page.id, metadataOf(page));
    ws.index = value;
    ws.access = pageAccess(ref, value.access);
    return value;
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
  // The add-cover button is re-appended whenever the core rebuilds the icon row, and
  // WebKit keeps `:hover` latched on a node moved under the cursor. See trackPageHeaderHover.
  trackPageHeaderHover(document);
  const pageListeners = new Map<string, Set<() => void>>();
  const saveStatus = createWorkspaceSaveStatus(ref.kind === 'remote');
  const status = saveStatus.element;
  let localWrites = 0;
  let remoteConnection = 'connecting';
  const updatePending = (): void => saveStatus.pending(ws.pendingManifests + localWrites + teamspacesState.pending);

  const pageFromUrl = (): string | null => pageIdForHref(location.href);
  const navigate = (id: string, replace = false): void => {
    const from=pageFromUrl();
    const url=ref.kind==='remote' && !('__TAURI_INTERNALS__' in window) ? new URL(pageUrl(id)) : new URL(location.href);
    if(ref.kind==='local' || '__TAURI_INTERNALS__' in window){url.pathname='/';url.searchParams.set('page',id);}
    url.searchParams.delete('library');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    onRoute();
    // Notion ouvre une autre page à son début. Seul un vrai changement de page
    // remonte : corriger l'URL de la page courante laisse le lecteur où il est,
    // et la position par onglet, restaurée par shell.ts, n'est pas concernée.
    if (from !== id) window.scrollTo(0, 0);
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
    if (ref.kind !== 'remote' || !ws.index || ws.pendingManifests > 0 || ws.manifestFailed || ws.refreshingManifest || ws.metadataAction) return;
    ws.refreshingManifest = true;
    const original = ws.index;
    try {
      const updated = await repository.refreshIndex(() => ws.pendingManifests === 0 && !ws.manifestFailed && !ws.metadataAction && ws.index === original);
      if (!updated) return;
      updated.activeId = updated.pages.some((page) => page.id === ws.currentId) ? ws.currentId : updated.activeId;
      // Retain the live page object: title/cover callbacks close over it.
      const live = original.pages.find((page) => page.id === ws.currentId);
      const remotePage = updated.pages.find((page) => page.id === ws.currentId);
      if (live && remotePage) {
        adoptRemoteFields(live, remotePage);
        updated.pages = updated.pages.map((page) => page.id === ws.currentId ? live : page);
      }
      adoptIndex(updated);
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
    if (!ws.index || ref.kind === 'remote') return;
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
  let libraryRefreshQueued = false;
  const refreshLibrary = (): void => {
    if (!library.dispose || libraryRefreshQueued) return;
    libraryRefreshQueued = true;
    queueMicrotask(() => { libraryRefreshQueued = false; library.dispose?.refresh(); });
  };
  const notifyPage = (id: string): void => { pageListeners.get(id)?.forEach((listener) => listener()); refreshLibrary(); };
  const breadcrumbMenuHeading = (parentId: string | null | undefined, byId: Map<string, ShellPage>): string => {
    if (parentId) return byId.get(parentId)?.title ?? 'Pages';
    return ref.kind === 'remote' ? workspaceName : 'Pages locales';
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
    onPageIcon(target.id, next ?? '');
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
    if (!ws.index) return;
    refreshDateTitles();
    const page = ws.index.pages.find((item) => item.id === id);
    if (!page) return;
    const selectedPage = page;
    const request = ++ws.selection;
    if (ws.currentId !== id && ws.editor && ref.kind === 'remote') { await ws.editor.isReady; await ws.editor.saver.flush(); }
    if (ws.selection !== request) return;
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
    ws.currentId = id;
    ws.frame.element.toggleAttribute('data-desktop-read-only', readOnly(id));
    const turn = ++ws.generation;
    ws.coverRowObserver?.disconnect();
    ws.coverRowObserver = null;
    ws.pageToolbar?.destroy();
    ws.floatingToc?.destroy();
    ws.floatingToc = null;
    ws.titleDateMention?.destroy();
    ws.titleDateMention = null;
    ws.pageComments?.destroy(); ws.pageComments = null;
    ws.editor?.destroy();
    ws.editor = null;
    remoteConnection = 'connecting';
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
      workspaceName,
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
      onDuplicate: () => { void action({ id, type: 'duplicate' }).catch(showError); },
      onDelete: () => { void action({ id, type: 'delete' }).catch(showError); },
    });
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
      if (ws.generation === turn) renderCover();
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
          if (ws.generation === turn) attachCoverAction();
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
    ws.refreshPagePresentation = () => { applyFullWidth(); renderCover(); renderCreatedProperty(); ws.titleDateMention?.refresh(); };
    ws.pageCanvas.replaceChildren(toolbar.element, article);
    renderCover();
    const persisted = { content: null as string | null };
    const contentSignature = (data: OutputData): string => JSON.stringify({ ...data, time: undefined, version: undefined });
    const instance = new Blok({
      holder,
      readOnly: readOnly(id),
      tools: { ...desktopTools, database: {class: Database, config: {people: { me: () => commentAuthor(ref).authorId, list: async () => { const author = commentAuthor(ref); return [{ id: author.authorId, name: author.authorName }]; } }, customEmojis: () => emojis.list(), coverGallery: COVER_GALLERY, uploadCover: (file: globalThis.File) => readCoverFile(file).then(repository.uploadImage)}}, page: { class: Page, config: { ...pageConfig } } },
      theme: readAppearance(),
      pageTitle: {
        customEmojis: () => emojis.list(),
        placeholder: 'Nouvelle page',
        onChange(title, change) {
          if (ws.generation !== turn || !ws.index) return;
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
          document.title = next;
          ws.frame.setPages(withSections(ws.index.pages), id);
          if (ref.kind === 'local' || change.source !== 'remote') saveManifest();
        },
        onIconChange(icon, change) {
          if (ws.generation !== turn || !ws.index) return;
          syncPageIcon(page, icon, ref.kind === 'local' || change.source !== 'remote');
        },
      },
      documentId: ref.kind === 'local' && ref.id === 'default' ? id : `${workspaceKey(ref)}:${id}`,
      ...(ref.kind === 'remote' ? {
        server: `${ref.server}/api/blok`,
        ticket: ({ doc }: { doc?: string; forceRefresh?: boolean }) => repository.ticket(doc ?? id),
        user: { id: ref.accountId },
        collaboration: { doc: id, user: { name: ref.userName ?? ref.accountId }, offline: false },
      } : { persistence: {
        async load() {
          const raw = await repository.readPage(id);
          const data = raw ? JSON.parse(raw) as OutputData : null;
          persisted.content = data ? contentSignature(data) : null;
          return data;
        },
        async save(data) {
          localWrites++;
          updatePending();
          try {
            await repository.writePage(id, JSON.stringify(data));
            const signature = contentSignature(data);
            if (persisted.content !== signature) {
              page.updatedAt = new Date().toISOString();
              saveManifest();
            }
            persisted.content = signature;
            saveStatus.saved('document');
          } finally { localWrites--; updatePending(); }
        },
        onError: (error) => showError(error, 'document'),
      } }),
    });
    ws.editor = instance;
    void instance.isReady.then(() => {
      const target = library.target;
      if (ws.editor !== instance || target?.pageId !== id) return;
      instance.blocks.getById(target.blockId)?.holder.scrollIntoView({ block: 'start', behavior: 'smooth' });
      library.target = null;
    });
    ws.remotePending = false;
    instance.width.set(page.fullWidth === true ? 'full' : 'narrow');
    void instance.isReady.then(() => {
      if (ws.generation !== turn) return;
      ws.pageComments = mountPageComments({ editor: instance, author: () => commentAuthor(ref), canComment: () => !readOnly(id) && ws.editor === instance });
      article.append(ws.pageComments.element);
      instance.on('collaboration:status', (raw) => {
        if (ws.generation !== turn) return;
        // An emission with no payload must fall back to "not pending", not throw
        // inside the listener and kill the rest of the handler.
        const event = (raw ?? {}) as Parameters<typeof saveStatus.connection>[0];
        const pendingOps = event?.save?.pendingOperations ?? 0;
        const pendingBytes = event?.save?.pendingBytes ?? 0;
        ws.remotePending = pendingOps > 0 || pendingBytes > 0;
        if (ref.kind === 'remote') {
          const reconnected = event?.status === 'connected' && remoteConnection !== 'connected';
          if (event?.status) remoteConnection = event.status;
          if (reconnected && navigator.onLine && ws.manifestFailed && ws.pendingManifests === 0) saveManifest();
          saveStatus.connection(event);
        }
      });

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
    }).catch(showError);
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

  const action = async (command: SidebarAction): Promise<void> => {
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
      ws.closeSearch = openPageSearch({ workspaceName, pages: () => ws.index?.pages ?? [], onOpen: navigate, recentIds });
    },
    onManageTeamspaces: ref.kind==='remote' ? ()=>ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-teamspace',{detail:{}})) : undefined,
    onCreateTeamspacePage: (id)=>chooseNewPage(null,false,id),
    onTeamspaceMenu: (_anchor,id)=>{if(id)ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-teamspace',{detail:{id}}));},
    onAction: (command) => { void action(command).catch(showError); },
    pageUrl,
    availableActions: ['rename', 'duplicate', 'delete', 'open-tab'],
    canEdit: (id) => !readOnly(id),
    canCreate: canCreateUnder,
    onFavorite: (id, value) => {
      favorites.set(id, value);
      refreshLibrary();
      if (ws.currentId === id) ws.pageToolbar?.setFavorite(value);
    },
  });
  subscribeSidebarLayout(ref, layout => {
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
  const summaryButton = document.createElement('button');
  summaryButton.type = 'button';
  summaryButton.textContent = 'Résumer et structurer';
  summaryButton.setAttribute('data-ai-summary-trigger', '');
  summaryButton.addEventListener('click', () => openAiSummary({
    ...createWorkspaceAssistant(ref),
    remote: ref.kind === 'remote',
    openSettings: () => ws.footer.dispatchEvent(new Event('blok:desktop-open-ai-settings')),
    getSource: getAiSource,
    targetId: ws.currentId,
    append: async (sourceId, blocks) => {
      appendSummaryBlocks({editor:ws.editor?.blocks ?? null,currentId:ws.currentId,sourceId,editable:!readOnly(sourceId)},blocks);
    },
  }));
  ws.frame.canvas.append(summaryButton);
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
    workspaceName = detail.name;
    if (ws.index) ws.frame.setPages(withSections(ws.index.pages), ws.currentId);
    ws.pageToolbar?.setWorkspaceName(workspaceName);
    ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
    if (!ws.currentId) document.title = brandedTitle(workspaceName);
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
    ws.coverRowObserver?.disconnect(); ws.coverRowObserver = null;
    ws.pageToolbar?.destroy(); ws.pageToolbar = null;
    ws.floatingToc?.destroy(); ws.floatingToc = null;
    ws.titleDateMention?.destroy(); ws.titleDateMention = null;
    ws.refreshPagePresentation = null;
    ws.pageComments?.destroy(); ws.pageComments = null;
    ws.editor?.destroy(); ws.editor = null;
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
    document.title = brandedTitle(workspaceName);
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
    const editor = ws.editor;
    const pageId = ws.currentId;
    if (editor) {
      await editor.isReady;
      if (ws.selection !== request) return;
      if (ref.kind === 'remote') await editor.saver.flush();
      else if (!readOnly(pageId)) await repository.writePage(pageId, JSON.stringify(await editor.save()));
    }
    if (ws.selection !== request) return;
    ws.closeSearch?.(); ws.closeSearch = undefined;
    ws.generation++;
    ws.coverRowObserver?.disconnect(); ws.coverRowObserver = null;
    ws.pageToolbar?.destroy(); ws.pageToolbar = null;
    ws.floatingToc?.destroy(); ws.floatingToc = null;
    ws.titleDateMention?.destroy(); ws.titleDateMention = null;
    ws.pageComments?.destroy(); ws.pageComments = null;
    ws.refreshPagePresentation = null;
    ws.editor?.destroy(); ws.editor = null; ws.currentId = '';
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

  function onRoute(): void {
    if (!ws.index) return;
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
        if(routeLoad.pending)return;
        routeLoad.pending=true;const destination=location.href;ws.pageCanvas.setAttribute('aria-busy','true');
        void (async()=>{
          if(ws.editor){await ws.editor.isReady;await ws.editor.saver.flush();}
          await ws.saveOrder;
          if(location.href===destination)location.reload();
        })().catch(showError).finally(()=>{routeLoad.pending=false;ws.pageCanvas.removeAttribute('aria-busy');});return;
      }
      library.dispose?.(); library.dispose = null; library.category = null;
      ws.frame.element.removeAttribute('data-desktop-library');
      ws.frame.setActiveShortcut(null);
      ws.generation++;ws.selection++;ws.pageComments?.destroy(); ws.pageComments = null;
      ws.editor?.destroy();ws.editor=null;ws.currentId='';
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
    ws.closeSearch = openPageSearch({ workspaceName, pages: () => ws.index?.pages ?? [], onOpen: navigate });
  });
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
        await refreshTeamspaces();
        refreshDateTitles();
        ws.frame.setPages(withSections(loaded.pages), loaded.activeId);
        onRoute();
        scheduleDateRefresh();
        window.addEventListener('focus', refreshDateTitles);
        if (ref.kind === 'remote') {
          const reconnect = (): void => {
            saveStatus.online(navigator.onLine);
            if (!navigator.onLine) return;
            if (ws.manifestFailed && ws.pendingManifests === 0) saveManifest();
            else void refreshTeamspaces().then(()=>refreshRemoteManifest());
          };
          window.addEventListener('offline', () => saveStatus.online(false));
          window.addEventListener('online', reconnect);
          window.addEventListener('focus', reconnect);
          window.setInterval(reconnect, 15_000);
          window.addEventListener('beforeunload', (event) => { if (ws.pendingManifests > 0 || ws.manifestFailed) event.preventDefault(); });
        }
      } catch (error) { showError(error); }
    },
    async flush() {
      const wasInert = ws.frame.element.inert;
      ws.frame.element.inert = true;
      try {
        if (ws.editor) await ws.editor.isReady;
        if (ws.editor && ref.kind === 'local') {
          const data = await ws.editor.save();
          await repository.writePage(ws.currentId, JSON.stringify(data));
        }
        if (ws.editor && ref.kind === 'remote') await ws.editor.saver.flush();
        await ws.saveOrder;
      } finally { ws.frame.element.inert = wasInert; }
    },
    onRoute,
    toggleSidebar() {
      ws.frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    },
    createPage,
  };
}
