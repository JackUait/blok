import { navigationFavorites, navigationRecents } from './navigation-preferences';
import { openPageSearch, openPageCreation, type CreationDestination } from './navigation-dialogs';
import { PopoverDesktop } from '@blok/popover';
import { customEmojiStore } from './custom-emojis';
import { createEmptyWorkspaceState } from './workspace-empty';
import { mountRemoteAssets } from './remote-assets';
import { Blok, defaultTools, type OutputData } from '@bloklabs/core/full';
import { Audio, Bookmark, File, Video, Callout, Code, Database, DatabaseComment, DatabaseRow, Divider, Image, Page, Quote, Table, TableOfContents, Toggle, type PageConfig } from '@bloklabs/core/tools';
import { createPageFrame, type PageFrame, type ShellPage, type SidebarAction } from '@blok/sidebar';
import { type DesktopPage, type WorkspaceIndex } from './storage';
import { workspaceRepository } from './workspace-repository';
import { pageAccess } from './page-access';
import { openPageSharing } from './cloud/page-sharing';
import { groupPagesBySection, sectionNames } from './page-section';
import { describeAccessLoss } from './access-friction';
import { activeWorkspace, workspaceKey, type WorkspaceRef } from './workspace-registry';
import { createDesktopFooter, readAppearance } from './settings';
import {
  buildWelcomeDocuments,
  hasWelcomeSeeded,
  markWelcomeSeeded,
  shouldSeedWelcome,
  welcomePageId,
} from './welcome-seed';
import { COVER_GALLERY, readCoverFile, createAddCoverButton, createPageCover, isPageCover, trackPageHeaderHover, type PageCover } from './cover';
import { mountAgentAssistant, type AgentAssistantHandle } from '@blok/agent-assistant';
import { bindAssistantButton, createAssistantButton, createWorkspaceAssistant } from './assistant';
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

function syncStatusLabel(synced: boolean, pending: boolean): string {
  if (synced) return '';
  return pending ? 'Synchronisation…' : 'Connexion au serveur…';
}

function syncStatusState(synced: boolean, pending: boolean): string {
  if (synced) return 'connected';
  return pending ? 'pending' : 'connecting';
}

export function createWorkspace(onLayout: (width: number) => void, onPageIcon: (id: string, icon: string) => void, options: { ref?: WorkspaceRef } = {}): Workspace {
  const ref = Object.freeze({... (options.ref ?? activeWorkspace())});
  const repository = workspaceRepository(ref);
  const favorites = navigationFavorites(ref);
  const recentPages = navigationRecents(ref);
  const pageUrl = (id: string): string => {
    const url = new URL('/', ref.kind === 'remote' ? ref.server : location.href);
    url.searchParams.set('page', id);
    return url.href;
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
  const adoptIndex = (value: WorkspaceIndex): WorkspaceIndex => {
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
    const tagged = pages.map((page) => ({ ...page, favorite: favorites.has(page.id) }));
    if (ref.kind !== 'remote') return tagged;
    if (!ws.index?.access) return tagged.map((page) => ({ ...page, section: page.parentId ? undefined : 'workspace' }));
    const roots = tagged.filter((page) => !page.parentId);
    const labelled = new Map(groupPagesBySection(roots, ws.index.access)
      .flatMap((group) => group.pages.map((page) => [page.id, sectionNames[group.section]] as const)));
    return tagged.map((page) => labelled.has(page.id) ? { ...page, section: labelled.get(page.id) } : page);
  };
  const readOnly = (pageId: string): boolean => !ws.access.canEdit(pageId);
  const canCreateUnder = (parentId: string | null): boolean =>
    parentId ? ws.access.canEdit(parentId) : !ws.access.readOnlyWorkspace;
  // The add-cover button is re-appended whenever the core rebuilds the icon row, and
  // WebKit keeps `:hover` latched on a node moved under the cursor. See trackPageHeaderHover.
  trackPageHeaderHover(document);
  const pageListeners = new Map<string, Set<() => void>>();
  const status = document.createElement('div');
  status.setAttribute('data-desktop-status', '');
  status.setAttribute('role', 'status');
  status.textContent = 'Ouverture des pages…';

  const pageFromUrl = (): string | null => new URL(location.href).searchParams.get('page');
  const navigate = (id: string, replace = false): void => {
    const url = new URL(location.href);
    url.searchParams.set('page', id);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    onRoute();
  };
  const saveManifest = (): void => {
    if (!ws.index) return;
    const snapshot = JSON.stringify(ws.index);
    ws.pendingManifests++;
    ws.saveOrder = ws.saveOrder.catch(() => undefined).then(async () => {
      await repository.saveIndex(JSON.parse(snapshot) as WorkspaceIndex);
      ws.manifestFailed = false;
    }).catch((error) => { ws.manifestFailed = true; showError(error); throw error; }).finally(() => { ws.pendingManifests--; });
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
      ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(ws.currentId));
      for (const id of new Set([...original.pages.map((page) => page.id), ...ws.index.pages.map((page) => page.id)])) notifyPage(id);
      ws.refreshPagePresentation?.();
      if (!ws.index.pages.some((page) => page.id === ws.currentId)) onRoute();
    } catch (error) { showError(error); }
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
    ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
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
  const notifyPage = (id: string): void => { pageListeners.get(id)?.forEach((listener) => listener()); };
  const breadcrumbMenuHeading = (parentId: string | null | undefined, byId: Map<string, ShellPage>): string => {
    if (parentId) return byId.get(parentId)?.title ?? 'Pages';
    return ref.kind === 'remote' ? ref.name : 'Pages locales';
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
  const showError = (error: unknown): void => {
    // Un retrait d'accès ferme la session en moins de cinq secondes côté
    // serveur. Le présenter comme une panne d'enregistrement laisserait croire
    // à un incident, et pousserait à réessayer pour rien.
    const refusal = describeAccessLoss(error);
    status.textContent = refusal ?? `Enregistrement impossible : ${String(error)}`;
    status.setAttribute('data-error', '');
    status.setAttribute('data-sync-state', refusal ? 'denied' : 'error');
  };
  const iconValue = (icon: ReturnType<Blok['title']['icon']['get']>): string | undefined => {
    if (icon?.type === 'emoji') return icon.value;
    if (icon?.type === 'image') return icon.url;
    return undefined;
  };
  const syncPageIcon = (page: ShellPage, icon: ReturnType<Blok['title']['icon']['get']>, persist = true): void => {
    if (!ws.index) return;
    const target = page;
    const next = iconValue(icon);
    if (target.icon !== next) {
      target.icon = next;
      ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
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
    href: (id) => `?page=${encodeURIComponent(id)}`,
    pageIdFromHref: (href) => {
      const url = new URL(href);
      return url.protocol === location.protocol && url.host === location.host && url.pathname === location.pathname
        ? url.searchParams.get('page') : null;
    },
    open: (id) => { if (ws.index?.pages.some((page) => page.id === id)) navigate(id); },
    create: async ({ pageId, title, parentId, document: initialDocument }) => {
      if (!ws.index || !canCreateUnder(parentId ?? ws.currentId ?? null)) throw new Error('Espace indisponible ou en lecture seule');
      if (ws.index.pages.some((page) => page.id === pageId)) throw new Error('Cette page existe déjà');
      const page: DesktopPage = { id: pageId, title: title?.trim() || 'Nouvelle page', parentId: parentId ?? ws.currentId };
      if (initialDocument && ref.kind === 'local') await repository.writePage(pageId, JSON.stringify(initialDocument));
      ws.index.pages.push(page);
      ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
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
    ws.frame.setPages(withSections(ws.index.pages), id);
    onPageIcon(id, page.icon ?? '');
    if (ws.currentId === id) {
      ws.pageToolbar?.setBreadcrumbs(breadcrumbs(id));
      return;
    }
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
    ws.editor?.destroy();
    ws.editor = null;
    status.textContent = 'Ouverture de la page…';
    status.removeAttribute('data-error');
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
    }, ref.kind === 'remote' ? (anchor) => openPageSharing(ref, id, page.title, anchor, refreshRemoteManifest) : undefined, {
      workspaceName: ref.name,
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
    ws.refreshPagePresentation = () => { applyFullWidth(); renderCover(); ws.titleDateMention?.refresh(); };
    ws.pageCanvas.replaceChildren(toolbar.element, article);
    renderCover();
    const instance = new Blok({
      holder,
      readOnly: readOnly(id),
      tools: { ...desktopTools, database: {class: Database, config: {customEmojis: () => emojis.list(), coverGallery: COVER_GALLERY, uploadCover: (file: globalThis.File) => readCoverFile(file).then(repository.uploadImage)}}, page: { class: Page, config: { ...pageConfig } } },
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
          return raw ? JSON.parse(raw) as OutputData : null;
        },
        async save(data) {
          await repository.writePage(id, JSON.stringify(data));
        },
        onError: showError,
      } }),
    });
    ws.editor = instance;
    ws.remotePending = false;
    instance.width.set(page.fullWidth === true ? 'full' : 'narrow');
    void instance.isReady.then(() => {
      if (ws.generation !== turn) return;
      instance.on('collaboration:status', (raw) => {
        if (ws.generation !== turn) return;
        const event = raw as { status?: string; save?: { pendingOperations?: number; pendingBytes?: number } };
        const pendingOps = event.save?.pendingOperations ?? 0;
        const pendingBytes = event.save?.pendingBytes ?? 0;
        ws.remotePending = pendingOps > 0 || pendingBytes > 0;
        if (ref.kind === 'remote' && !ws.manifestFailed) {
          const synced = !ws.remotePending && event.status === 'connected';
          status.textContent = syncStatusLabel(synced, ws.remotePending);
          status.setAttribute('data-sync-state', syncStatusState(synced, ws.remotePending));
          status.removeAttribute('data-error');
        }
      });

      const redactor = holder.querySelector<HTMLElement>('[data-blok-redactor]');
      if (redactor) ws.floatingToc = createFloatingToc(ws.pageCanvas, redactor);
      attachCoverAction();
      if (ref.kind === 'local' && (!instance.title.get() || page.titleDate)) instance.title.set(page.title, { record: false });
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
      syncPageIcon(page, instance.title.icon.get(), ref.kind === 'local');
      toolbar.setBreadcrumbs(breadcrumbs(id));
      document.title = page.title;
      if (ref.kind === 'local') status.textContent = '';
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
    const copy: DesktopPage = { ...page, id: crypto.randomUUID(), title: `${page.title} (copie)`, titleDate: undefined, titleDateDisplay: undefined, titleDateSuffix: undefined };
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
    const url = new URL(location.href);
    url.searchParams.set('page', page.id);
    window.open(url.href, '_blank', 'noopener,noreferrer');
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
      ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
      saveManifest();
    } finally { ws.frame.element.inert = wasInert; ws.metadataAction = false; }
  };

  ws.frame = createPageFrame({
    teamspace: ref.kind === 'remote' ? { name: ref.name } : undefined,
    pages: [], activeId: '',
    recentIds: recentPages.ids,
    onRecentsChange: recentPages.save,
    onOpen: (id) => navigate(id),
    onCreate: (parentId) => chooseNewPage(parentId),
    onCreatePrivate: ref.kind === 'remote' ? () => chooseNewPage(null, true) : undefined,
    onSearch: (recentIds) => {
      ws.closeSearch?.();
      ws.closeSearch = openPageSearch({ workspaceName: ref.name, pages: () => ws.index?.pages ?? [], onOpen: navigate, recentIds });
    },
    onTeamspaceMenu: (anchor) => {
      const menuState = { requestedPanel: undefined as 'invites' | 'general' | undefined, settled: false };
      const menu = new PopoverDesktop({ trigger: anchor, autoFocusFirstItem: true,
        items: [
          ...(ref.kind === 'remote' && ref.role === 'admin' ? [{ name: 'invite', title: 'Inviter des membres', closeOnActivate: true,
            onActivate: () => { menuState.requestedPanel = 'invites'; } }] : []),
          { name: 'settings', title: 'Paramètres de l’espace', closeOnActivate: true,
            onActivate: () => { menuState.requestedPanel = 'general'; } },
        ],
      });
      anchor.setAttribute('aria-expanded', 'true');
      menu.on('closed', () => {
        if (menuState.settled) return;
        menuState.settled = true;
        anchor.setAttribute('aria-expanded', 'false');
        // Release the menu's focus manager before handing focus to a modal.
        queueMicrotask(() => {
          menu.destroy();
          if (menuState.requestedPanel) ws.footer.dispatchEvent(new CustomEvent('blok:desktop-open-settings', { detail: menuState.requestedPanel }));
        });
      });
      menu.show();
    },
    onAction: (command) => { void action(command).catch(showError); },
    pageUrl,
    availableActions: ['rename', 'duplicate', 'delete', 'open-tab'],
    canEdit: (id) => !readOnly(id),
    canCreate: canCreateUnder,
    onFavorite: (id, value) => {
      favorites.set(id, value);
      if (ws.currentId === id) ws.pageToolbar?.setFavorite(value);
    },
  });
  ws.frame.element.append(status);
  ws.assistant = mountAgentAssistant({
    getPageText: () => ws.pageCanvas.querySelector('[data-desktop-document]')?.textContent?.slice(0, 100_000) ?? '',
    openSettings: () => ws.footer.dispatchEvent(new Event('blok:desktop-open-ai-settings')),
    ...createWorkspaceAssistant(ref),
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
  sidebar.insertBefore(ws.footer, sidebar.querySelector('[data-blok-sidebar-edge]'));
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
    const rightsPage = docs.pages[1];
    if (!welcomePage || !rightsPage) return null;
    for (const page of docs.pages) {
      if (!ws.index.pages.some((item) => item.id === page.id)) ws.index.pages.push(page);
    }
    ws.frame.setPages(withSections(ws.index.pages), welcomePage.id);
    saveManifest();
    try {
      await ws.saveOrder;
      if (ref.kind === 'remote') {
        await repository.seedPage(welcomePage.id, docs.welcome);
        await repository.seedPage(rightsPage.id, docs.rights);
      } else {
        await repository.writePage(welcomePage.id, JSON.stringify(docs.welcome));
        await repository.writePage(rightsPage.id, JSON.stringify(docs.rights));
      }
      markWelcomeSeeded(key);
      return welcomePage.id;
    } catch {
      ws.index.pages = ws.index.pages.filter((page) => !docs.pages.some((seeded) => seeded.id === page.id));
      ws.frame.setPages(withSections(ws.index.pages), ws.index.activeId);
      saveManifest();
      try { await ws.saveOrder; } catch { /* keep empty */ }
      return null;
    }
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
    ws.editor?.destroy(); ws.editor = null;
    ws.currentId = '';
    status.textContent = '';
    status.removeAttribute('data-error');
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
    document.title = ref.name;
  }

  function onRoute(): void {
    if (!ws.index) return;
    if (!ws.index.pages.length) { void showEmptyWorkspace().catch(showError); return; }
    const id = pageFromUrl();
    const target = ws.index.pages.find((page) => page.id === id)?.id ?? ws.index.activeId;
    if (id !== target) {
      navigate(target, true);
      return;
    }
    void select(target).catch((error) => {
      if (ws.currentId && pageFromUrl() !== ws.currentId) {
        const url = new URL(location.href); url.searchParams.set('page', ws.currentId);
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
    ws.closeSearch = openPageSearch({ workspaceName: ref.name, pages: () => ws.index?.pages ?? [], onOpen: navigate });
  });
  function chooseNewPage(parentId: string | null = null, privatePage = false): void {
    if (!ws.index || !canCreateUnder(parentId)) return;
    const destinations: CreationDestination[] = [];
    if (canCreateUnder(null)) {
      destinations.push({ value: 'workspace', label: ref.name, parentId: null });
      if (ref.kind === 'remote') destinations.push({ value: 'private', label: 'Privé · Vous uniquement', parentId: null, privatePage: true });
    }
    destinations.push(...ws.index.pages.filter((page) => canCreateUnder(page.id)).map((page) => ({ value: page.id, label: page.title, parentId: page.id })));
    openPageCreation({ destinations, destination: parentId ?? (privatePage ? 'private' : 'workspace'),
      onCreate: (target, database) => createPage(target.parentId, target.privatePage, database),
    });
  }

  function createPage(parentId: string | null = null, privatePage = false, database = false): void {
    if (!ws.index || ws.metadataAction || !canCreateUnder(parentId)) return;
    const page: DesktopPage = { id: crypto.randomUUID(), title: database ? 'Nouvelle base de données' : 'Nouvelle page', parentId, ...(privatePage ? { initialVisibility: 'private' as const } : {}) };
    ws.index.pages.push(page);
    saveManifest();
    void ws.saveOrder.then(async () => {
      if (ws.manifestFailed) return;
      if (database) {
        const document = { title: page.title, blocks: [{ id: crypto.randomUUID(), type: 'database', data: { initialView: 'table', fullPage: true } }] };
        if (ref.kind === 'remote') await repository.seedPage(page.id, document);
        else await repository.writePage(page.id, JSON.stringify(document));
      }
      if (privatePage) await refreshRemoteManifest();
      navigate(page.id);
    }).catch(showError);
  }

  return {
    element: ws.frame.element,
    async start() {
      try {
        const loaded = adoptIndex(await repository.loadIndex());
        refreshDateTitles();
        ws.frame.setPages(withSections(loaded.pages), loaded.activeId);
        onRoute();
        scheduleDateRefresh();
        window.addEventListener('focus', refreshDateTitles);
        if (ref.kind === 'remote') {
          window.addEventListener('focus', () => { void refreshRemoteManifest(); });
          window.setInterval(() => { void refreshRemoteManifest(); }, 15_000);
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
