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
  let access = pageAccess(ref, undefined);
  const adoptIndex = (value: WorkspaceIndex): WorkspaceIndex => {
    index = value;
    access = pageAccess(ref, value.access);
    return value;
  };
  /**
   * Étiquette chaque page racine avec sa section. La section est dérivée de
   * l'état de partage, jamais rangée dans la page : inviter quelqu'un fait
   * basculer la page tout seul, au prochain index reçu.
   */
  const withSections = (pages: DesktopPage[]): DesktopPage[] => {
    pages = pages.map((page) => ({ ...page, favorite: favorites.has(page.id) }));
    if (ref.kind !== 'remote') return pages;
    if (!index?.access) return pages.map((page) => ({ ...page, section: page.parentId ? undefined : 'workspace' }));
    const roots = pages.filter((page) => !page.parentId);
    const labelled = new Map(groupPagesBySection(roots, index.access)
      .flatMap((group) => group.pages.map((page) => [page.id, sectionNames[group.section]] as const)));
    return pages.map((page) => labelled.has(page.id) ? { ...page, section: labelled.get(page.id) } : page);
  };
  const readOnly = (pageId: string): boolean => !access.canEdit(pageId);
  const canCreateUnder = (parentId: string | null): boolean =>
    parentId ? access.canEdit(parentId) : !access.readOnlyWorkspace;
  // The add-cover button is re-appended whenever the core rebuilds the icon row, and
  // WebKit keeps `:hover` latched on a node moved under the cursor. See trackPageHeaderHover.
  trackPageHeaderHover(document);
  let index: WorkspaceIndex | null = null;
  let editor: Blok | null = null;
  let remotePending = false;
  let selection = 0;
  let frame: PageFrame;
  let coverRowObserver: MutationObserver | null = null;
  let assistant: AgentAssistantHandle;
  let pageCanvas: HTMLElement;
  let footer: HTMLElement;
  let pageToolbar: PageToolbar | null = null;
  let refreshPagePresentation: (() => void) | null = null;
  let titleDateMention: TitleDateMentionBinding | null = null;
  let floatingToc: FloatingToc | null = null;
  let currentId = '';
  let generation = 0;
  let dateTimer: number | null = null;
  let saveOrder = Promise.resolve();
  let pendingManifests = 0;
  let manifestFailed = false;
  let refreshingManifest = false;
  let metadataAction = false;
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
    if (!index) return;
    const snapshot = JSON.stringify(index);
    pendingManifests++;
    saveOrder = saveOrder.catch(() => undefined).then(async () => {
      await repository.saveIndex(JSON.parse(snapshot) as WorkspaceIndex);
      manifestFailed = false;
    }).catch((error) => { manifestFailed = true; showError(error); throw error; }).finally(() => { pendingManifests--; });
    void saveOrder.catch(() => undefined);
  };
  const refreshRemoteManifest = async (): Promise<void> => {
    if (ref.kind !== 'remote' || !index || pendingManifests > 0 || manifestFailed || refreshingManifest || metadataAction) return;
    refreshingManifest = true;
    const original = index;
    try {
      const updated = await repository.refreshIndex(() => pendingManifests === 0 && !manifestFailed && !metadataAction && index === original);
      if (!updated) return;
      updated.activeId = updated.pages.some((page) => page.id === currentId) ? currentId : updated.activeId;
      // Retain the live page object: title/cover callbacks close over it.
      const live = original.pages.find((page) => page.id === currentId);
      const remotePage = updated.pages.find((page) => page.id === currentId);
      if (live && remotePage) {
        for (const key of Object.keys(live)) if (!(key in remotePage)) delete (live as unknown as Record<string, unknown>)[key];
        Object.assign(live, remotePage);
        updated.pages = updated.pages.map((page) => page.id === currentId ? live : page);
      }
      adoptIndex(updated);
      frame.setPages(withSections(index.pages), index.activeId);
      pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
      for (const id of new Set([...original.pages.map((page) => page.id), ...index.pages.map((page) => page.id)])) notifyPage(id);
      refreshPagePresentation?.();
      if (!index.pages.some((page) => page.id === currentId)) onRoute();
    } catch (error) { showError(error); }
    finally { refreshingManifest = false; }
  };
  const refreshDateTitles = (): void => {
    if (!index || ref.kind === 'remote') return;
    let changed = false;
    for (const page of index.pages) {
      if (!page.titleDate) continue;
      const display = titleDateLabel(page.titleDate, new Date(), page.titleDateDisplay);
      const label = display === null ? null : `@${display}${page.titleDateSuffix ?? ''}`;
      if (label === null || label === page.title) continue;
      page.title = label;
      changed = true;
      notifyPage(page.id);
    }
    if (!changed) return;
    frame.setPages(withSections(index.pages), index.activeId);
    pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
    const active = index.pages.find((page) => page.id === currentId);
    if (active?.titleDate && editor) {
      editor.title.set(active.title, { record: false });
      titleDateMention?.refresh();
      document.title = active.title;
    }
    saveManifest();
  };
  const scheduleDateRefresh = (): void => {
    if (dateTimer !== null) window.clearTimeout(dateTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dateTimer = window.setTimeout(() => {
      dateTimer = null;
      refreshDateTitles();
      scheduleDateRefresh();
    }, midnight.getTime() - now.getTime() + 50);
  };
  const notifyPage = (id: string): void => { pageListeners.get(id)?.forEach((listener) => listener()); };
  const breadcrumbs = (pageId: string): PageBreadcrumbItem[] => {
    if (!index) return [];
    const pages = index.pages;
    const byId = new Map(pages.map((page) => [page.id, page]));
    const seen = new Set<string>();
    const trail: ShellPage[] = [];
    let page = byId.get(pageId);

    while (page && !seen.has(page.id)) {
      trail.unshift(page);
      seen.add(page.id);
      page = page.parentId ? byId.get(page.parentId) : undefined;
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
      menuHeading: item.parentId ? byId.get(item.parentId)?.title ?? 'Pages' : ref.kind === 'remote' ? ref.name : 'Pages locales',
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
  const syncPageIcon = (page: ShellPage, icon: ReturnType<Blok['title']['icon']['get']>, persist = true): void => {
    if (!index) return;
    const next = icon?.type === 'emoji' ? icon.value : icon?.type === 'image' ? icon.url : undefined;
    if (page.icon !== next) {
      page.icon = next;
      frame.setPages(withSections(index.pages), index.activeId);
      pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
      if (persist) saveManifest();
      notifyPage(page.id);
    }
    onPageIcon(page.id, next ?? '');
  };
  const pageConfig: PageConfig = {
    createFromMention: true,
    todayMention: { label: 'Aujourd’hui', heading: 'Date', locale: 'fr' },
    databasePages: true,
    search: async (query) => {
      if (!index) return [];
      const needle = query.trim().toLocaleLowerCase();
      return index.pages.filter((page) => page.title.toLocaleLowerCase().includes(needle)).slice(0, 40)
        .map((page) => ({ pageId: page.id, title: page.title,
          ...(page.icon ? { icon: pageIcon(page.icon) } : {}) }));
    },
    resolve: (id) => {
      const page = index?.pages.find((item) => item.id === id);
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
    open: (id) => { if (index?.pages.some((page) => page.id === id)) navigate(id); },
    create: async ({ pageId, title, parentId, document: initialDocument }) => {
      if (!index || !canCreateUnder(parentId ?? currentId ?? null)) throw new Error('Espace indisponible ou en lecture seule');
      if (index.pages.some((page) => page.id === pageId)) throw new Error('Cette page existe déjà');
      const page: DesktopPage = { id: pageId, title: title?.trim() || 'Nouvelle page', parentId: parentId ?? currentId };
      if (initialDocument && ref.kind === 'local') await repository.writePage(pageId, JSON.stringify(initialDocument));
      index.pages.push(page);
      frame.setPages(withSections(index.pages), index.activeId);
      saveManifest();
      await saveOrder;
      if (initialDocument && ref.kind === 'remote') await repository.seedPage(pageId, initialDocument);
      notifyPage(pageId);
    },
  };
  const select = async (id: string): Promise<void> => {
    if (!index) return;
    refreshDateTitles();
    const page = index.pages.find((item) => item.id === id);
    if (!page) return;
    const selectedPage = page;
    const request = ++selection;
    if (currentId !== id && editor && ref.kind === 'remote') { await editor.isReady; await editor.saver.flush(); }
    if (selection !== request) return;
    index.activeId = id;
    if (ref.kind === 'local') saveManifest();
    frame.setPages(withSections(index.pages), id);
    onPageIcon(id, page.icon ?? '');
    if (currentId === id) {
      pageToolbar?.setBreadcrumbs(breadcrumbs(id));
      return;
    }
    currentId = id;
    frame.element.toggleAttribute('data-desktop-read-only', readOnly(id));
    const turn = ++generation;
    coverRowObserver?.disconnect();
    coverRowObserver = null;
    pageToolbar?.destroy();
    floatingToc?.destroy();
    floatingToc = null;
    titleDateMention?.destroy();
    titleDateMention = null;
    editor?.destroy();
    editor = null;
    status.textContent = 'Ouverture de la page…';
    status.removeAttribute('data-error');
    const article = document.createElement('article');
    article.setAttribute('data-desktop-document', '');
    const applyFullWidth = (): void => {
      const enabled = page.fullWidth === true;
      pageCanvas.toggleAttribute('data-full-width', enabled);
      article.toggleAttribute('data-full-width', enabled);
      editor?.width.set(enabled ? 'full' : 'narrow');
    };
    const toolbar = createPageToolbar(breadcrumbs(id), page.fullWidth === true, (enabled) => {
      if (readOnly(id)) return;
      page.fullWidth = enabled;
      applyFullWidth();
      saveManifest();
    }, '__TAURI_INTERNALS__' in window ? undefined : () => {
      frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    }, ref.kind === 'remote' ? (anchor) => openPageSharing(ref, id, page.title, anchor, refreshRemoteManifest) : undefined, {
      workspaceName: ref.name,
      workspacePages: () => {
        const pages = withSections(index?.pages ?? []);
        const choice = (page: DesktopPage): PageBreadcrumbChoice => ({
          id: page.id, title: page.title, icon: page.icon, current: page.id === currentId,
          onOpen: () => navigate(page.id),
          children: pages.filter((child) => child.parentId === page.id).map(choice),
        });
        return pages.filter((page) => !page.parentId && (ref.kind === 'local' || page.section === 'workspace')).map(choice);
      },
      pageUrl,
      favorite: favorites.has(id),
      onFavorite: (value) => {
        favorites.set(id, value);
        if (index) frame.setPages(withSections(index.pages), currentId);
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
    pageToolbar = toolbar;
    applyFullWidth();
    const holder = document.createElement('div');
    article.append(holder);
    let coverNode: HTMLElement | null = null;
    let renderedCover: PageCover | undefined;
    let renderedCoverPosition: number | undefined;
    let coverButton: HTMLButtonElement | null = null;
    function changeCover(cover: PageCover | undefined): void {
      if (readOnly(id)) return;
      selectedPage.cover = cover;
      if (cover === undefined) selectedPage.coverPosition = undefined;
      if (generation === turn) renderCover();
      saveManifest();
    }
    const attachCoverAction = (): void => {
      if (readOnly(id)) return;
      if (isPageCover(page.cover)) return;
      const row = holder.querySelector<HTMLElement>('[data-blok-page-icon-row]');
      if (!row) return;
      coverButton ??= createAddCoverButton(changeCover);
      if (coverButton.parentElement !== row) row.append(coverButton);
      if (coverRowObserver === null) {
        coverRowObserver = new MutationObserver(() => {
          if (generation === turn) attachCoverAction();
        });
        coverRowObserver.observe(row, { childList: true });
      }
    };
    const renderCover = (): void => {
      article.toggleAttribute('data-has-cover', isPageCover(page.cover));
      if (isPageCover(page.cover)) {
        coverButton?.remove();
        const position = typeof page.coverPosition === 'number' && Number.isFinite(page.coverPosition)
          ? Math.max(0, Math.min(100, page.coverPosition)) : 50;
        // Background metadata refreshes must preserve the open picker and its focus.
        if (coverNode && renderedCover === page.cover && renderedCoverPosition === position) return;
        renderedCover = page.cover;
        renderedCoverPosition = position;
        const next = createPageCover(page.cover, position, changeCover, (value) => {
          if (readOnly(id)) return;
          page.coverPosition = value;
          renderedCoverPosition = value;
          saveManifest();
        }, { upload: repository.uploadImage, resolveUrl: repository.assetUrl, readOnly: readOnly(id) });
        if (coverNode) coverNode.replaceWith(next);
        else pageCanvas.insertBefore(next, article);
        coverNode = next;
      } else {
        coverNode?.remove();
        coverNode = null;
        attachCoverAction();
      }
    };
    refreshPagePresentation = () => { applyFullWidth(); renderCover(); titleDateMention?.refresh(); };
    pageCanvas.replaceChildren(toolbar.element, article);
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
          if (generation !== turn || !index) return;
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
          frame.setPages(withSections(index.pages), id);
          if (ref.kind === 'local' || change.source !== 'remote') saveManifest();
        },
        onIconChange(icon, change) {
          if (generation !== turn || !index) return;
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
    editor = instance;
    remotePending = false;
    instance.width.set(page.fullWidth === true ? 'full' : 'narrow');
    void instance.isReady.then(() => {
      if (generation !== turn) return;
      instance.on('collaboration:status', (event) => {
        if (generation !== turn) return;
        remotePending = (event?.save?.pendingOperations ?? 0) > 0 || (event?.save?.pendingBytes ?? 0) > 0;
        if (ref.kind === 'remote' && !manifestFailed) {
          const synced = !remotePending && event?.status === 'connected';
          status.textContent = synced ? '' : remotePending ? 'Synchronisation…' : 'Connexion au serveur…';
          status.setAttribute('data-sync-state', synced ? 'connected' : remotePending ? 'pending' : 'connecting');
          status.removeAttribute('data-error');
        }
      });

      const redactor = holder.querySelector<HTMLElement>('[data-blok-redactor]');
      if (redactor) floatingToc = createFloatingToc(pageCanvas, redactor);
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
        titleDateMention = bindTitleDateMention(title, {
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

  const action = async (command: SidebarAction): Promise<void> => {
    if (command.type !== 'open-tab' && readOnly(command.id)) return;
    const wasInert = frame.element.inert;
    if (ref.kind === 'remote') { frame.element.inert = true; metadataAction = true; }
    try {
    if (ref.kind === 'remote' && editor && command.type !== 'open-tab') {
      await editor.isReady;
      await editor.saver.flush();
      await saveOrder;
    }
    if (!index) return;
    const page = index.pages.find((item) => item.id === command.id);
    if (!page) return;
    if (command.type === 'rename') {
      page.title = command.title;
      page.titleDate = undefined;
      page.titleDateDisplay = undefined;
      page.titleDateSuffix = undefined;
      notifyPage(page.id);
      if (currentId === page.id) editor?.title.set(command.title);
      else pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
    } else if (command.type === 'duplicate') {
      if (ref.kind === 'remote') {
        const copy = {id: crypto.randomUUID(), title: `${page.title} (copie)`, parentId: page.parentId};
        if (editor) { await editor.isReady; await editor.saver.flush(); }
        await saveOrder;
        await repository.duplicatePage(page.id, copy);
        const refreshed = adoptIndex(await repository.loadIndex());
        frame.setPages(withSections(refreshed.pages), refreshed.activeId);
        navigate(copy.id);
        return;
      }
      const copy: DesktopPage = { ...page, id: crypto.randomUUID(), title: `${page.title} (copie)`, titleDate: undefined, titleDateDisplay: undefined, titleDateSuffix: undefined };
      index.pages.push(copy);
      saveManifest();
      void repository.readPage(page.id).then(async (raw) => {
        if (raw) {
          const data = JSON.parse(raw) as OutputData;
          await repository.writePage(copy.id, JSON.stringify({ ...data, id: copy.id, title: copy.title }));
        }
        navigate(copy.id);
      }).catch(showError);
      return;
    } else if (command.type === 'delete') {
      if (index.pages.length === 1) return;
      const removed = new Set([page.id]);
      let previous = -1;
      while (previous !== removed.size) {
        previous = removed.size;
        index.pages.forEach((item) => { if (item.parentId && removed.has(item.parentId)) removed.add(item.id); });
      }
      if (removed.size === index.pages.length) return;
      index.trash = [...(index.trash ?? []), ...index.pages.filter((item) => removed.has(item.id))];
      index.pages = index.pages.filter((item) => !removed.has(item.id));
      removed.forEach(notifyPage);
      if (removed.has(currentId)) navigate(index.pages[0]!.id, true);
    } else if (command.type === 'open-tab') {
      if ('__TAURI_INTERNALS__' in window) {
        window.dispatchEvent(new Event('blok:desktop-new-tab'));
        navigate(page.id, true);
      } else {
        const url = new URL(location.href);
        url.searchParams.set('page', page.id);
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
      return;
    } else {
      return;
    }
    frame.setPages(withSections(index.pages), index.activeId);
    saveManifest();
    } finally { frame.element.inert = wasInert; metadataAction = false; }
  };

  frame = createPageFrame({
    teamspace: ref.kind === 'remote' ? { name: ref.name } : undefined,
    pages: [], activeId: '',
    recentIds: recentPages.ids,
    onRecentsChange: recentPages.save,
    onOpen: (id) => navigate(id),
    onCreate: (parentId) => chooseNewPage(parentId),
    onCreatePrivate: ref.kind === 'remote' ? () => chooseNewPage(null, true) : undefined,
    onSearch: (recentIds) => {
      closeSearch?.();
      closeSearch = openPageSearch({ workspaceName: ref.name, pages: () => index?.pages ?? [], onOpen: navigate, recentIds });
    },
    onTeamspaceMenu: (anchor) => {
      let requestedPanel: 'invites' | 'general' | undefined;
      let settled = false;
      const menu = new PopoverDesktop({ trigger: anchor, autoFocusFirstItem: true,
        items: [
          ...(ref.kind === 'remote' && ref.role === 'admin' ? [{ name: 'invite', title: 'Inviter des membres', closeOnActivate: true,
            onActivate: () => { requestedPanel = 'invites'; } }] : []),
          { name: 'settings', title: 'Paramètres de l’espace', closeOnActivate: true,
            onActivate: () => { requestedPanel = 'general'; } },
        ],
      });
      anchor.setAttribute('aria-expanded', 'true');
      menu.on('closed', () => {
        if (settled) return;
        settled = true;
        anchor.setAttribute('aria-expanded', 'false');
        // Release the menu's focus manager before handing focus to a modal.
        queueMicrotask(() => {
          menu.destroy();
          if (requestedPanel) footer.dispatchEvent(new CustomEvent('blok:desktop-open-settings', { detail: requestedPanel }));
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
      if (currentId === id) pageToolbar?.setFavorite(value);
    },
  });
  frame.element.append(status);
  assistant = mountAgentAssistant({
    getPageText: () => pageCanvas.querySelector('[data-desktop-document]')?.textContent?.slice(0, 100_000) ?? '',
    openSettings: () => footer.dispatchEvent(new Event('blok:desktop-open-ai-settings')),
    ...createWorkspaceAssistant(ref),
  });
  pageCanvas = assistant.editorSlot;
  frame.canvas.append(assistant.element);
  const sidebar = frame.element.querySelector('[data-blok-sidebar]') as HTMLElement;
  const panel = assistant.element.querySelector<HTMLElement>('[data-blok-agent-panel]')!;
  const assistantButton = createAssistantButton(() => {
    if (panel.hidden) assistant.open();
    else assistant.close();
  });
  frame.canvas.append(assistantButton);
  bindAssistantButton(assistantButton, panel);
  footer = createDesktopFooter((mode) => editor?.theme.set(mode));
  footer.addEventListener('blok:desktop-open-page', (event) => {
    const detail = (event as CustomEvent<{ pageId: string; seedWelcome?: boolean }>).detail;
    if (!detail?.pageId) return;
    const open = async (): Promise<void> => {
      if (index?.pages.some((page) => page.id === detail.pageId)) {
        navigate(detail.pageId);
        return;
      }
      if (detail.seedWelcome) {
        const id = await seedWelcomeWorkspace();
        if (!id) return;
        const target = index?.pages.some((page) => page.id === detail.pageId) ? detail.pageId : id;
        navigate(target);
      }
    };
    void open().catch(() => undefined);
  });
  sidebar.insertBefore(footer, sidebar.querySelector('[data-blok-sidebar-edge]'));
  const observer = new ResizeObserver(() => onLayout(sidebar.getBoundingClientRect().width));
  observer.observe(sidebar);
  frame.element.setAttribute('data-desktop-workspace', '');
  frame.element.toggleAttribute('data-desktop-read-only', access.readOnlyWorkspace);

  async function seedWelcomeWorkspace(): Promise<string | null> {
    if (!index || access.readOnlyWorkspace) return null;
    const workspaceId = ref.kind === 'remote' ? ref.workspaceId : ref.id;
    const key = workspaceKey(ref);
    const existing = index.pages.find((page) => page.id === welcomePageId(workspaceId));
    if (existing) {
      markWelcomeSeeded(key);
      return existing.id;
    }
    const docs = buildWelcomeDocuments(workspaceId);
    for (const page of docs.pages) {
      if (!index.pages.some((item) => item.id === page.id)) index.pages.push(page);
    }
    frame.setPages(withSections(index.pages), docs.pages[0]!.id);
    saveManifest();
    try {
      await saveOrder;
      if (ref.kind === 'remote') {
        await repository.seedPage(docs.pages[0]!.id, docs.welcome);
        await repository.seedPage(docs.pages[1]!.id, docs.rights);
      } else {
        await repository.writePage(docs.pages[0]!.id, JSON.stringify(docs.welcome));
        await repository.writePage(docs.pages[1]!.id, JSON.stringify(docs.rights));
      }
      markWelcomeSeeded(key);
      return docs.pages[0]!.id;
    } catch {
      index.pages = index.pages.filter((page) => !docs.pages.some((seeded) => seeded.id === page.id));
      frame.setPages(withSections(index.pages), index.activeId);
      saveManifest();
      try { await saveOrder; } catch { /* keep empty */ }
      return null;
    }
  }

  async function showEmptyWorkspace(): Promise<void> {
    if (editor) {
      await editor.isReady;
      if (ref.kind === 'remote') await editor.saver.flush();
    }
    if (index?.pages.length) { onRoute(); return; }
    const key = workspaceKey(ref);
    if (shouldSeedWelcome({
      empty: true,
      seeded: hasWelcomeSeeded(key),
      viewer: access.readOnlyWorkspace,
      remote: ref.kind === 'remote',
    })) {
      const seededId = await seedWelcomeWorkspace();
      if (seededId) {
        navigate(seededId);
        return;
      }
    }
    generation++;
    selection++;
    coverRowObserver?.disconnect(); coverRowObserver = null;
    pageToolbar?.destroy(); pageToolbar = null;
    floatingToc?.destroy(); floatingToc = null;
    titleDateMention?.destroy(); titleDateMention = null;
    refreshPagePresentation = null;
    editor?.destroy(); editor = null;
    currentId = '';
    status.textContent = '';
    status.removeAttribute('data-error');
    pageCanvas.replaceChildren(createEmptyWorkspaceState(access.readOnlyWorkspace, () => createPage(), {
      onTemplate: () => chooseNewPage(),
      onInvite: () => {
        footer.dispatchEvent(new CustomEvent('blok:desktop-open-settings', { detail: 'invites' }));
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
    if (!index) return;
    if (!index.pages.length) { void showEmptyWorkspace().catch(showError); return; }
    const id = pageFromUrl();
    const target = index.pages.find((page) => page.id === id)?.id ?? index.activeId;
    if (id !== target) {
      navigate(target, true);
      return;
    }
    void select(target).catch((error) => {
      if (currentId && pageFromUrl() !== currentId) {
        const url = new URL(location.href); url.searchParams.set('page', currentId);
        history.replaceState(null, '', url);
      }
      showError(error);
    });
  }

  let closeSearch: (() => void) | undefined;
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || !frame.element.isConnected || document.querySelector('[aria-modal="true"]')) return;
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    closeSearch?.();
    closeSearch = openPageSearch({ workspaceName: ref.name, pages: () => index?.pages ?? [], onOpen: navigate });
  });
  function chooseNewPage(parentId: string | null = null, privatePage = false): void {
    if (!index || !canCreateUnder(parentId)) return;
    const destinations: CreationDestination[] = [];
    if (canCreateUnder(null)) {
      destinations.push({ value: 'workspace', label: ref.name, parentId: null });
      if (ref.kind === 'remote') destinations.push({ value: 'private', label: 'Privé · Vous uniquement', parentId: null, privatePage: true });
    }
    destinations.push(...index.pages.filter((page) => canCreateUnder(page.id)).map((page) => ({ value: page.id, label: page.title, parentId: page.id })));
    openPageCreation({ destinations, destination: parentId ?? (privatePage ? 'private' : 'workspace'),
      onCreate: (target, database) => createPage(target.parentId, target.privatePage, database),
    });
  }

  function createPage(parentId: string | null = null, privatePage = false, database = false): void {
    if (!index || metadataAction || !canCreateUnder(parentId)) return;
    const page: DesktopPage = { id: crypto.randomUUID(), title: database ? 'Nouvelle base de données' : 'Nouvelle page', parentId, ...(privatePage ? { initialVisibility: 'private' as const } : {}) };
    index.pages.push(page);
    saveManifest();
    void saveOrder.then(async () => {
      if (manifestFailed) return;
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
    element: frame.element,
    async start() {
      try {
        const loaded = adoptIndex(await repository.loadIndex());
        refreshDateTitles();
        frame.setPages(withSections(loaded.pages), loaded.activeId);
        onRoute();
        scheduleDateRefresh();
        window.addEventListener('focus', refreshDateTitles);
        if (ref.kind === 'remote') {
          window.addEventListener('focus', () => { void refreshRemoteManifest(); });
          window.setInterval(() => { void refreshRemoteManifest(); }, 15_000);
          window.addEventListener('beforeunload', (event) => { if (pendingManifests > 0 || manifestFailed) event.preventDefault(); });
        }
      } catch (error) { showError(error); }
    },
    async flush() {
      const wasInert = frame.element.inert;
      frame.element.inert = true;
      try {
        if (editor) await editor.isReady;
        if (editor && ref.kind === 'local') {
          const data = await editor.save();
          await repository.writePage(currentId, JSON.stringify(data));
        }
        if (editor && ref.kind === 'remote') await editor.saver.flush();
        await saveOrder;
      } finally { frame.element.inert = wasInert; }
    },
    onRoute,
    toggleSidebar() {
      frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    },
    createPage,
  };
}
