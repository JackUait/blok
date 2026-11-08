import { Blok, defaultTools, type OutputData } from '@bloklabs/core/full';
import { createPageFrame, type PageFrame, type ShellPage, type SidebarAction } from '@blok/sidebar';
import { dataDirectory, loadIndex, readFile, writeFile, type WorkspaceIndex } from './storage';

export interface Workspace {
  element: HTMLElement;
  start(): Promise<void>;
  onRoute(): void;
  toggleSidebar(): void;
  createPage(parentId?: string | null): void;
}

export function createWorkspace(onLayout: (width: number) => void): Workspace {
  let index: WorkspaceIndex | null = null;
  let editor: Blok | null = null;
  let frame: PageFrame;
  let currentId = '';
  let generation = 0;
  let saveOrder = Promise.resolve();
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
  const showError = (error: unknown): void => {
    status.textContent = `Enregistrement impossible : ${String(error)}`;
    status.setAttribute('data-error', '');
  };
  const select = (id: string): void => {
    if (!index) return;
    const page = index.pages.find((item) => item.id === id);
    if (!page) return;
    index.activeId = id;
    saveManifest();
    frame.setPages(index.pages, id);
    if (currentId === id) return;
    currentId = id;
    const turn = ++generation;
    editor?.destroy();
    editor = null;
    status.textContent = 'Ouverture de la page…';
    status.removeAttribute('data-error');
    const article = document.createElement('article');
    article.setAttribute('data-desktop-document', '');
    const holder = document.createElement('div');
    article.append(holder);
    frame.canvas.replaceChildren(article);
    const instance = new Blok({
      holder,
      tools: defaultTools,
      pageTitle: {
        placeholder: 'Nouvelle page',
        onChange(title) {
          if (generation !== turn || !index) return;
          const next = title.trim() || 'Nouvelle page';
          page.title = next;
          document.title = next;
          frame.setPages(index.pages, id);
          saveManifest();
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
    void instance.isReady.then(() => {
      if (generation !== turn) return;
      if (!instance.title.get()) instance.title.set(page.title, { record: false });
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
      if (currentId === page.id) editor?.title.set(command.title);
    } else if (command.type === 'duplicate') {
      const copy: ShellPage = { ...page, id: crypto.randomUUID(), title: `${page.title} (copie)` };
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
  const sidebar = frame.element.querySelector('[data-blok-sidebar]') as HTMLElement;
  const storageButton = document.createElement('button');
  storageButton.type = 'button';
  storageButton.setAttribute('data-desktop-storage', '');
  storageButton.textContent = 'Données sur cet appareil';
  sidebar.insertBefore(storageButton, sidebar.querySelector('[data-blok-sidebar-edge]'));
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
        const directory = await dataDirectory();
        storageButton.title = directory;
        storageButton.setAttribute('aria-label', `Données locales : ${directory}. Copier le chemin`);
        storageButton.addEventListener('click', () => {
          void navigator.clipboard.writeText(directory).then(() => {
            storageButton.textContent = 'Chemin copié';
            window.setTimeout(() => { storageButton.textContent = 'Données sur cet appareil'; }, 1800);
          }).catch(showError);
        });
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
