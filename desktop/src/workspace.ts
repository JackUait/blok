import { Blok, defaultTools, type OutputData } from '@bloklabs/core/full';
import { Callout, Code, Database, DatabaseComment, DatabaseRow, Divider, Image, Page, Quote, Table, TableOfContents, Toggle, type PageConfig } from '@bloklabs/core/tools';
import { createPageFrame, type PageFrame, type ShellPage, type SidebarAction } from '@blok/sidebar';
import { loadIndex, readFile, writeFile, type DesktopPage, type WorkspaceIndex } from './storage';
import { createDesktopFooter, readAppearance } from './settings';
import { createAddCoverButton, createPageCover, isCoverId, trackPageHeaderHover, type CoverId } from './cover';
import { mountAgentAssistant, type AgentAssistantHandle } from '../../src/shell/agent-assistant';
import { bindAssistantButton, createAssistantButton, inspectNativeProvider, nativeAgentModel, selectedProvider } from './assistant';
import { createPageToolbar, type PageBreadcrumbChoice, type PageBreadcrumbItem, type PageToolbar } from './page-toolbar';

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
  table_of_contents: { class: TableOfContents },
};

export interface Workspace {
  element: HTMLElement;
  start(): Promise<void>;
  onRoute(): void;
  toggleSidebar(): void;
  createPage(parentId?: string | null): void;
}

export function createWorkspace(onLayout: (width: number) => void, onPageIcon: (id: string, icon: string) => void): Workspace {
  // The add-cover button is re-appended whenever the core rebuilds the icon row, and
  // WebKit keeps `:hover` latched on a node moved under the cursor. See trackPageHeaderHover.
  trackPageHeaderHover(document);
  let index: WorkspaceIndex | null = null;
  let editor: Blok | null = null;
  let frame: PageFrame;
  let coverRowObserver: MutationObserver | null = null;
  let assistant: AgentAssistantHandle;
  let pageCanvas: HTMLElement;
  let footer: HTMLElement;
  let pageToolbar: PageToolbar | null = null;
  let currentId = '';
  let generation = 0;
  let saveOrder = Promise.resolve();
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
    saveOrder = saveOrder.then(() => writeFile('index', snapshot)).catch(showError);
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
      menuHeading: item.parentId ? byId.get(item.parentId)?.title ?? 'Pages' : 'Pages locales',
      menu: choicesFor(item.parentId, item.id),
    }));
  };
  const showError = (error: unknown): void => {
    status.textContent = `Enregistrement impossible : ${String(error)}`;
    status.setAttribute('data-error', '');
  };
  const syncPageIcon = (page: ShellPage, icon: ReturnType<Blok['title']['icon']['get']>): void => {
    if (!index) return;
    const next = icon?.type === 'emoji' ? icon.value : undefined;
    if (page.icon !== next) {
      page.icon = next;
      frame.setPages(index.pages, index.activeId);
      pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
      saveManifest();
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
          ...(page.icon ? { icon: { type: 'emoji' as const, value: page.icon } } : {}) }));
    },
    resolve: (id) => {
      const page = index?.pages.find((item) => item.id === id);
      return page ? { title: page.title, ...(page.icon ? { icon: { type: 'emoji' as const, value: page.icon } } : {}) } : null;
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
      if (!index) throw new Error('Espace local indisponible');
      if (index.pages.some((page) => page.id === pageId)) throw new Error('Cette page existe déjà');
      const page: DesktopPage = { id: pageId, title: title?.trim() || 'Nouvelle page', parentId: parentId ?? currentId };
      if (initialDocument) await writeFile(pageId, JSON.stringify(initialDocument));
      index.pages.push(page);
      frame.setPages(index.pages, index.activeId);
      saveManifest();
      await saveOrder;
      notifyPage(pageId);
    },
  };
  const select = (id: string): void => {
    if (!index) return;
    const page = index.pages.find((item) => item.id === id);
    if (!page) return;
    const selectedPage = page;
    index.activeId = id;
    saveManifest();
    frame.setPages(index.pages, id);
    onPageIcon(id, page.icon ?? '');
    if (currentId === id) {
      pageToolbar?.setBreadcrumbs(breadcrumbs(id));
      return;
    }
    currentId = id;
    const turn = ++generation;
    coverRowObserver?.disconnect();
    coverRowObserver = null;
    pageToolbar?.destroy();
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
      page.fullWidth = enabled;
      applyFullWidth();
      saveManifest();
    });
    pageToolbar = toolbar;
    applyFullWidth();
    const holder = document.createElement('div');
    article.append(holder);
    let coverNode: HTMLElement | null = null;
    let coverButton: HTMLButtonElement | null = null;
    function changeCover(cover: CoverId | undefined): void {
      selectedPage.cover = cover;
      if (cover === undefined) selectedPage.coverPosition = undefined;
      renderCover();
      saveManifest();
    }
    const attachCoverAction = (): void => {
      if (isCoverId(page.cover)) return;
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
      article.toggleAttribute('data-has-cover', isCoverId(page.cover));
      if (isCoverId(page.cover)) {
        coverButton?.remove();
        const position = typeof page.coverPosition === 'number' && Number.isFinite(page.coverPosition)
          ? Math.max(0, Math.min(100, page.coverPosition)) : 50;
        const next = createPageCover(page.cover, position, changeCover, (value) => {
          page.coverPosition = value;
          saveManifest();
        });
        if (coverNode) coverNode.replaceWith(next);
        else pageCanvas.insertBefore(next, article);
        coverNode = next;
      } else {
        coverNode?.remove();
        coverNode = null;
        attachCoverAction();
      }
    };
    pageCanvas.replaceChildren(toolbar.element, article);
    renderCover();
    const instance = new Blok({
      holder,
      tools: { ...desktopTools, page: { class: Page, config: { ...pageConfig } } },
      theme: readAppearance(),
      pageTitle: {
        placeholder: 'Nouvelle page',
        onChange(title) {
          if (generation !== turn || !index) return;
          const next = title.trim() || 'Nouvelle page';
          page.title = next;
          toolbar.setBreadcrumbs(breadcrumbs(id));
          notifyPage(id);
          document.title = next;
          frame.setPages(index.pages, id);
          saveManifest();
        },
        onIconChange(icon) {
          if (generation !== turn || !index) return;
          syncPageIcon(page, icon);
        },
      },
      documentId: id,
      persistence: {
        async load() {
          const raw = await readFile(id);
          return raw ? JSON.parse(raw) as OutputData : null;
        },
        async save(data) {
          await writeFile(id, JSON.stringify(data));
        },
        onError: showError,
      },
    });
    editor = instance;
    instance.width.set(page.fullWidth === true ? 'full' : 'narrow');
    void instance.isReady.then(() => {
      if (generation !== turn) return;
      attachCoverAction();
      if (!instance.title.get()) instance.title.set(page.title, { record: false });
      syncPageIcon(page, instance.title.icon.get());
      toolbar.setBreadcrumbs(breadcrumbs(id));
      document.title = page.title;
      status.textContent = '';
    }).catch(showError);
  };

  const action = (command: SidebarAction): void => {
    if (!index) return;
    const page = index.pages.find((item) => item.id === command.id);
    if (!page) return;
    if (command.type === 'rename') {
      page.title = command.title;
      notifyPage(page.id);
      if (currentId === page.id) editor?.title.set(command.title);
      else pageToolbar?.setBreadcrumbs(breadcrumbs(currentId));
    } else if (command.type === 'duplicate') {
      const copy: DesktopPage = { ...page, id: crypto.randomUUID(), title: `${page.title} (copie)` };
      index.pages.push(copy);
      saveManifest();
      void readFile(page.id).then(async (raw) => {
        if (raw) {
          const data = JSON.parse(raw) as OutputData;
          await writeFile(copy.id, JSON.stringify({ ...data, id: copy.id, title: copy.title }));
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
      window.dispatchEvent(new Event('blok:desktop-new-tab'));
      navigate(page.id, true);
      return;
    } else {
      return;
    }
    frame.setPages(index.pages, index.activeId);
    saveManifest();
  };

  frame = createPageFrame({
    pages: [], activeId: '',
    onOpen: (id) => navigate(id),
    onCreate: (parentId) => createPage(parentId),
    onAction: action,
  });
  frame.element.append(status);
  assistant = mountAgentAssistant({
    getPageText: () => pageCanvas.querySelector('[data-desktop-document]')?.textContent?.slice(0, 100_000) ?? '',
    openSettings: () => footer.dispatchEvent(new Event('blok:desktop-open-ai-settings')),
    inspectProvider: inspectNativeProvider,
    modelFor: nativeAgentModel,
    preferredProvider: selectedProvider,
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
  sidebar.insertBefore(footer, sidebar.querySelector('[data-blok-sidebar-edge]'));
  const observer = new ResizeObserver(() => onLayout(sidebar.getBoundingClientRect().width));
  observer.observe(sidebar);
  frame.element.setAttribute('data-desktop-workspace', '');

  function onRoute(): void {
    if (!index) return;
    const id = pageFromUrl();
    const target = index.pages.find((page) => page.id === id)?.id ?? index.activeId;
    if (id !== target) {
      navigate(target, true);
      return;
    }
    select(target);
  }

  function createPage(parentId: string | null = null): void {
    if (!index) return;
    const page: ShellPage = { id: crypto.randomUUID(), title: 'Nouvelle page', parentId };
    index.pages.push(page);
    saveManifest();
    navigate(page.id);
  }

  return {
    element: frame.element,
    async start() {
      try {
        index = await loadIndex();
        frame.setPages(index.pages, index.activeId);
        onRoute();
      } catch (error) { showError(error); }
    },
    onRoute,
    toggleSidebar() {
      frame.toggleSidebar();
      onLayout(sidebar.getBoundingClientRect().width);
    },
    createPage,
  };
}
