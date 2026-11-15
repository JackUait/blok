import { PAGE_LEVELS, WORKSPACE_ROLES } from './access-vocabulary';
import type { DesktopPage } from './storage';

/** Deterministic welcome page id so concurrent empty opens merge-dedupe. */
export function welcomePageId(workspaceId: string): string {
  return `welcome-${workspaceId}`;
}

/** Subpage explaining sharing, linked from the welcome document. */
export function welcomeRightsPageId(workspaceId: string): string {
  return `welcome-rights-${workspaceId}`;
}

/** The sample database page, seeded beside the welcome page like Notion's To Do List. */
export function welcomeTasksPageId(workspaceId: string): string {
  return `welcome-tasks-${workspaceId}`;
}

export function welcomeSeedStorageKey(workspaceKey: string): string {
  return `blok:desktop:welcome-seeded:${workspaceKey}`;
}

export function hasWelcomeSeeded(workspaceKey: string): boolean {
  try {
    return localStorage.getItem(welcomeSeedStorageKey(workspaceKey)) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeeded(workspaceKey: string): void {
  try {
    localStorage.setItem(welcomeSeedStorageKey(workspaceKey), '1');
  } catch {
    /* private mode */
  }
}

/** Auto-seed only on an empty remote workspace that has never been seeded, and never for viewers. */
export function shouldSeedWelcome(options: {
  empty: boolean;
  seeded: boolean;
  viewer: boolean;
  remote: boolean;
}): boolean {
  return options.remote && options.empty && !options.seeded && !options.viewer;
}

type Block = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
};

type WelcomeDocument = { title: string; blocks: Block[] };

export interface WelcomeDocuments {
  welcome: WelcomeDocument;
  rights: WelcomeDocument;
  tasks: WelcomeDocument;
  pages: DesktopPage[];
  /** Page id paired with its document, so the seeding loop stays generic. */
  documents: Array<{ pageId: string; document: WelcomeDocument }>;
}

const id = (prefix: string, workspaceId: string, suffix: string): string =>
  `${prefix}-${workspaceId}-${suffix}`;

/**
 * Client-side welcome fixture (plan §10.1), patterned on Notion's own
 * "Welcome to Notion" page: a 👋 page icon, one checklist whose first item is
 * already ticked, nested sub-items, inline `code` for the slash commands, and a
 * toggle at the end holding a few more tips. No headings — the checklist is the
 * page. The sample database lives on its own page, the way Notion seeds a
 * separate "To Do List" rather than embedding one.
 */
export function buildWelcomeDocuments(workspaceId: string): WelcomeDocuments {
  const welcomeId = welcomePageId(workspaceId);
  const rightsId = welcomeRightsPageId(workspaceId);
  const tasksId = welcomeTasksPageId(workspaceId);
  const dbId = id('welcome-db', workspaceId, 'tasks');
  const viewId = id('welcome-view', workspaceId, 'all');
  const titleProp = 'title';
  const statusProp = id('prop', workspaceId, 'status');
  const row1 = id('welcome-row', workspaceId, '1');
  const row2 = id('welcome-row', workspaceId, '2');
  const row3 = id('welcome-row', workspaceId, '3');
  const toggleId = id('welcome-toggle', workspaceId, 'tips');

  /** A checklist line. `depth` indents it, `checked` ticks and strikes it. */
  const check = (suffix: string, text: string, extra: { depth?: number; checked?: boolean } = {}): Block => ({
    id: id('welcome-check', workspaceId, suffix),
    type: 'list',
    data: { text, style: 'checklist', checked: extra.checked ?? false, ...(extra.depth ? { depth: extra.depth } : {}) },
  });

  const tip = (suffix: string, text: string): Block => ({
    id: id('welcome-tip', workspaceId, suffix),
    type: 'paragraph',
    data: { text },
    parent: toggleId,
  });

  const welcome: WelcomeDocuments['welcome'] = {
    title: 'Bienvenue sur Blok',
    blocks: [
      // Already done by the time you read this — ticked, like Notion's first line.
      check('account', 'Créer votre compte', { checked: true }),
      check('desktop', '<b>Installer l’application de bureau</b> pour travailler hors ligne et emporter Blok partout'),
      check('slash', 'Cliquez n’importe où ci-dessous et <b>tapez</b> <code>/</code> pour voir ce que vous pouvez créer — titres, tableaux, cases à cocher, etc.'),
      check('slash-page', 'Tapez <code>/page</code> pour ajouter une <b>nouvelle page</b> et imbriquer ce que vous voulez, où vous voulez', { depth: 1 }),
      check('sidebar', '<b>Trouvez</b>, <b>organisez</b> et <b>ajoutez des pages</b> depuis la barre latérale, à gauche 👈'),
      check('tasks', 'Jetez un œil à la page <b>À faire</b> ajoutée pour vous, avec d’autres astuces', { depth: 1 }),
      check('drag', 'Glissez un bloc par sa poignée ☰ pour le déplacer, ou <code>Tab</code> pour l’imbriquer sous le précédent', { depth: 1 }),
      check('share', 'Utilisez <b>Partager</b>, en haut de la page, pour choisir qui la voit'),
      check('rights', 'Les trois rôles et les trois niveaux sont expliqués dans <b>Droits et partage</b>', { depth: 1 }),
      // Notion links its seeded pages from the checklist; Blok's native
      // construct for that is the page block, so the two land here.
      {
        id: id('welcome-page', workspaceId, 'tasks-link'),
        type: 'page',
        data: { pageId: tasksId },
      },
      {
        id: id('welcome-page', workspaceId, 'rights-link'),
        type: 'page',
        data: { pageId: rightsId },
      },
      {
        id: toggleId,
        type: 'toggle',
        data: { text: 'Ceci est un bloc dépliable. Cliquez sur le petit triangle pour quelques astuces de plus.' },
        content: [
          id('welcome-tip', workspaceId, 'mention'),
          id('welcome-tip', workspaceId, 'search'),
          id('welcome-tip', workspaceId, 'drop'),
        ],
      },
      tip('mention', 'Tapez <code>@</code> pour mentionner une page ou une date, où que vous soyez.'),
      tip('search', '<code>Cmd</code>+<code>K</code> ouvre la recherche : retrouvez une page par son titre ou son chemin.'),
      tip('drop', 'Glissez une image depuis votre bureau directement dans la page — elle s’y dépose.'),
    ],
  };

  const tasks: WelcomeDocuments['tasks'] = {
    title: 'À faire',
    blocks: [
      {
        id: id('tasks-p', workspaceId, 'intro'),
        type: 'paragraph',
        data: { text: 'Cochez, renommez, ajoutez des colonnes — cette base est la vôtre.' },
      },
      {
        id: dbId,
        type: 'database',
        data: {
          title: 'À faire',
          starter: 'tasks',
          schema: [
            { id: titleProp, name: 'Tâche', type: 'title', position: 'a0' },
            {
              id: statusProp,
              name: 'Statut',
              type: 'status',
              position: 'a1',
              // SelectOption lives under config.options as {id,label,color?,position}
              // (types/tools/database.d.ts). Every reader in src/shared/database/
              // goes through property.config?.options, so a top-level array of
              // {id,name,color} renders the column empty.
              config: {
                options: [
                  { id: 'todo', label: 'À faire', color: 'gray', position: 'a0' },
                  { id: 'doing', label: 'En cours', color: 'blue', position: 'a1' },
                  { id: 'done', label: 'Terminé', color: 'green', position: 'a2' },
                ],
              },
            },
          ],
          views: [
            {
              id: viewId,
              name: 'Toutes les tâches',
              type: 'table',
              position: 'a0',
              visibleProperties: [titleProp, statusProp],
            },
          ],
          activeViewId: viewId,
        },
        content: [row1, row2, row3],
      },
      {
        id: row1,
        type: 'database-row',
        data: { title: 'Essayer la boîte à outils', properties: { [titleProp]: 'Essayer la boîte à outils', [statusProp]: 'todo' }, position: 'a0' },
        parent: dbId,
      },
      {
        id: row2,
        type: 'database-row',
        data: { title: 'Partager une page', properties: { [titleProp]: 'Partager une page', [statusProp]: 'doing' }, position: 'a1' },
        parent: dbId,
      },
      {
        id: row3,
        type: 'database-row',
        data: { title: 'Inviter un collègue', properties: { [titleProp]: 'Inviter un collègue', [statusProp]: 'done' }, position: 'a2' },
        parent: dbId,
      },
    ],
  };

  const rights: WelcomeDocuments['rights'] = {
    title: 'Droits et partage',
    blocks: [
      {
        id: id('rights-p', workspaceId, 'intro'),
        type: 'paragraph',
        data: {
          text: `Trois rôles d’espace (${WORKSPACE_ROLES.admin}, ${WORKSPACE_ROLES.member}, ${WORKSPACE_ROLES.viewer}) et trois niveaux de page (${PAGE_LEVELS.view}, ${PAGE_LEVELS.edit}, ${PAGE_LEVELS.full}). Le droit le plus large l’emporte ; une page privée reste hors de l’espace jusqu’à ce que vous la partagiez.`,
        },
      },
      {
        id: id('rights-p', workspaceId, 'share'),
        type: 'paragraph',
        data: {
          text: 'Ouvrez <b>Partager</b> en haut à droite pour inviter quelqu’un sur cette page, ou invitez des membres depuis le menu de l’espace.',
        },
      },
    ],
  };

  const pages: DesktopPage[] = [
    { id: welcomeId, title: welcome.title, icon: '👋', parentId: null },
    { id: rightsId, title: rights.title, icon: '🔑', parentId: welcomeId },
    { id: tasksId, title: tasks.title, icon: '✅', parentId: null },
  ];

  const documents = [
    { pageId: welcomeId, document: welcome },
    { pageId: rightsId, document: rights },
    { pageId: tasksId, document: tasks },
  ];

  return { welcome, rights, tasks, pages, documents };
}

export interface SeedWelcomeOptions {
  docs: WelcomeDocuments;
  /**
   * Put the seeded pages in the index and the sidebar. `selectId` opens that
   * page; `null` leaves the current selection alone.
   */
  publishPages(selectId: string | null): void;
  /** Flush the index so the server has created the page rows. */
  flushOrder(): Promise<void>;
  seedDocument(pageId: string, document: { title: string; blocks: unknown[] }): Promise<void>;
}

/**
 * Order matters, and it is the whole point of this function.
 *
 * Opening a page starts collaboration on it, and collaboration reads the
 * checkpoint ONCE, when it admits the document. Selecting the welcome page
 * before the seed lands admits an empty document; the seed then writes a
 * checkpoint nobody will ever read again, and the page stays blank for good —
 * `pages.content` full, `admission_started` true, `version` still 0.
 *
 * So: publish the pages without selecting any, flush so the rows exist, seed
 * every document, and only then open the welcome page.
 */
export async function seedWelcomeDocuments(options: SeedWelcomeOptions): Promise<boolean> {
  const welcome = options.docs.pages[0];
  if (!welcome) return false;
  options.publishPages(null);
  try {
    await options.flushOrder();
    for (const { pageId, document } of options.docs.documents) {
      await options.seedDocument(pageId, document);
    }
  } catch {
    return false;
  }
  options.publishPages(welcome.id);
  return true;
}
