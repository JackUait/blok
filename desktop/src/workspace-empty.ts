/** Empty remote spaces stay empty until a member explicitly creates a page. */
export function createEmptyWorkspaceState(viewer: boolean, onCreate: () => void): HTMLElement {
  const element = document.createElement('section');
  element.setAttribute('data-desktop-document', '');
  element.setAttribute('data-desktop-empty', '');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = viewer ? 'Aucune page n’est disponible dans cet espace.' : 'Cet espace est vide. Créez votre première page.';
  element.append(message);
  if (!viewer) {
    const create = document.createElement('button');
    create.type = 'button';
    create.setAttribute('data-desktop-settings-copy', '');
    create.setAttribute('data-desktop-empty-create', '');
    create.textContent = 'Créer une page';
    create.addEventListener('click', onCreate);
    element.append(create);
  }
  return element;
}
