/** Empty remote spaces stay empty until a member explicitly creates a page — unless welcome seed runs first. */

export interface EmptyWorkspaceExtras {
  onTemplate?: () => void;
  onInvite?: () => void;
  onImport?: () => void;
  onGettingStarted?: () => void;
}

export function createEmptyWorkspaceState(
  viewer: boolean,
  onCreate: () => void,
  extras: EmptyWorkspaceExtras = {},
): HTMLElement {
  const element = document.createElement('section');
  element.setAttribute('data-desktop-document', '');
  element.setAttribute('data-desktop-empty', '');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = viewer
    ? 'Aucune page n’est partagée avec vous pour le moment'
    : 'Cet espace est vide. Créez votre première page.';
  element.append(message);
  if (viewer) return element;

  const cards = document.createElement('div');
  cards.setAttribute('data-desktop-empty-cards', '');
  const addCard = (key: string, label: string, hint: string, onClick: () => void, createAttr = false): void => {
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('data-desktop-empty-card', key);
    if (createAttr) card.setAttribute('data-desktop-empty-create', '');
    card.setAttribute('data-desktop-settings-copy', '');
    const title = document.createElement('strong');
    title.textContent = label;
    const detail = document.createElement('span');
    detail.textContent = hint;
    card.append(title, detail);
    card.addEventListener('click', onClick);
    cards.append(card);
  };
  addCard('create', 'Créer une page', 'Une page blanche dans cet espace.', onCreate, true);
  addCard(
    'template',
    'Partir d’un modèle',
    'Choisissez où créer, y compris une base de données.',
    () => extras.onTemplate?.() ?? onCreate(),
  );
  addCard(
    'invite',
    'Inviter des personnes',
    'Ajoutez des membres à l’espace.',
    () => extras.onInvite?.(),
  );
  element.append(cards);

  const links = document.createElement('div');
  links.setAttribute('data-desktop-empty-links', '');
  const addLink = (key: string, label: string, onClick: () => void): void => {
    const link = document.createElement('button');
    link.type = 'button';
    link.setAttribute('data-desktop-empty-link', key);
    link.textContent = label;
    link.addEventListener('click', onClick);
    links.append(link);
  };
  addLink('import', 'Importer', () => extras.onImport?.());
  addLink('getting-started', 'Premiers pas', () => extras.onGettingStarted?.());
  element.append(links);
  return element;
}
