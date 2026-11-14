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

export interface WelcomeDocuments {
  welcome: { title: string; blocks: Block[] };
  rights: { title: string; blocks: Block[] };
  pages: DesktopPage[];
}

const id = (prefix: string, workspaceId: string, suffix: string): string =>
  `${prefix}-${workspaceId}-${suffix}`;

/**
 * Client-side welcome fixture (plan §10.1), patterned after database-starters:
 * real blocks teaching Blok gestures, a rights subpage link, and a sample tasks database.
 */
export function buildWelcomeDocuments(workspaceId: string): WelcomeDocuments {
  const welcomeId = welcomePageId(workspaceId);
  const rightsId = welcomeRightsPageId(workspaceId);
  const dbId = id('welcome-db', workspaceId, 'tasks');
  const viewId = id('welcome-view', workspaceId, 'all');
  const titleProp = 'title';
  const statusProp = id('prop', workspaceId, 'status');
  const row1 = id('welcome-row', workspaceId, '1');
  const row2 = id('welcome-row', workspaceId, '2');
  const row3 = id('welcome-row', workspaceId, '3');

  const checklist = (suffix: string, text: string): Block => ({
    id: id('welcome-check', workspaceId, suffix),
    type: 'list',
    data: { text, style: 'checklist', checked: false },
  });

  const welcome: WelcomeDocuments['welcome'] = {
    title: 'Bienvenue sur Blok',
    blocks: [
      {
        id: id('welcome-p', workspaceId, 'intro'),
        type: 'paragraph',
        data: { text: 'Quelques gestes pour démarrer — chacun se vérifie en une action.' },
      },
      checklist('slash', 'Tapez <code>/</code> dans un paragraphe vide pour ouvrir la boîte à outils'),
      checklist('drag', 'Glissez un bloc par sa poignée ☰ pour le réordonner'),
      checklist('tab', 'Appuyez sur <code>Tab</code> pour imbriquer un bloc sous le précédent'),
      checklist('mention', 'Tapez <code>@</code> pour mentionner une page ou une date'),
      checklist('share', 'Utilisez le bouton <b>Partager</b> pour choisir qui voit cette page'),
      {
        id: id('welcome-h', workspaceId, 'rights'),
        type: 'header',
        data: { text: 'Droits et partage', level: 2 },
      },
      {
        id: id('welcome-p', workspaceId, 'rights'),
        type: 'paragraph',
        data: { text: 'Les rôles d’espace et les niveaux de page sont expliqués ici :' },
      },
      {
        id: id('welcome-page', workspaceId, 'rights-link'),
        type: 'page',
        data: { pageId: rightsId },
      },
      {
        id: id('welcome-h', workspaceId, 'db'),
        type: 'header',
        data: { text: 'Une base pour s’entraîner', level: 2 },
      },
      {
        id: id('welcome-p', workspaceId, 'db'),
        type: 'paragraph',
        data: { text: 'Exemple monté avec le modèle Tâches — modifiez-le librement.' },
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
              options: [
                { id: 'todo', name: 'À faire', color: 'gray' },
                { id: 'doing', name: 'En cours', color: 'blue' },
                { id: 'done', name: 'Terminé', color: 'green' },
              ],
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
    { id: welcomeId, title: welcome.title, parentId: null },
    { id: rightsId, title: rights.title, parentId: welcomeId },
  ];

  return { welcome, rights, pages };
}
