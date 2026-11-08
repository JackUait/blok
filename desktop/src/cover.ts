export const COVER_PRESETS = [
  { id: 'dusk', label: 'Crépuscule', background: 'linear-gradient(115deg, #24304b 0%, #82587b 54%, #d49470 100%)' },
  { id: 'ocean', label: 'Océan', background: 'linear-gradient(110deg, #102d43 0%, #266e82 50%, #83afa5 100%)' },
  { id: 'forest', label: 'Forêt', background: 'linear-gradient(115deg, #193a34 0%, #4f745e 55%, #a5a979 100%)' },
  { id: 'clay', label: 'Terre', background: 'linear-gradient(110deg, #4e3530 0%, #aa695a 53%, #e2b78c 100%)' },
  { id: 'violet', label: 'Violet', background: 'linear-gradient(115deg, #322450 0%, #654a9a 55%, #b78bb4 100%)' },
  { id: 'paper', label: 'Papier', background: 'linear-gradient(110deg, #6a695f 0%, #a8a494 52%, #ded9c7 100%)' },
] as const;

export type CoverId = typeof COVER_PRESETS[number]['id'];

export function isCoverId(value: unknown): value is CoverId {
  return COVER_PRESETS.some((preset) => preset.id === value);
}

export function createPageCover(value: CoverId | undefined, onChange: (cover: CoverId | undefined) => void): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-desktop-cover', '');
  const image = document.createElement('div');
  image.setAttribute('data-desktop-cover-image', '');
  const actions = document.createElement('div');
  actions.setAttribute('data-desktop-cover-actions', '');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = value ? 'Changer la couverture' : 'Ajouter une couverture';
  toggle.setAttribute('data-desktop-cover-toggle', '');
  toggle.setAttribute('aria-expanded', 'false');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Supprimer';
  remove.setAttribute('data-desktop-cover-remove', '');
  remove.hidden = !value;
  const gallery = document.createElement('div');
  gallery.setAttribute('data-desktop-cover-gallery', '');
  gallery.setAttribute('role', 'group');
  gallery.setAttribute('aria-label', 'Couvertures de page');
  gallery.hidden = true;
  for (const preset of COVER_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', preset.label);
    button.setAttribute('title', preset.label);
    button.setAttribute('data-cover-id', preset.id);
    button.style.background = preset.background;
    button.addEventListener('click', () => {
      onChange(preset.id);
      gallery.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
    gallery.append(button);
  }
  toggle.addEventListener('click', () => {
    gallery.hidden = !gallery.hidden;
    toggle.setAttribute('aria-expanded', String(!gallery.hidden));
  });
  remove.addEventListener('click', () => onChange(undefined));
  actions.append(toggle, remove, gallery);
  root.append(image, actions);
  root.style.setProperty('--desktop-cover-image', COVER_PRESETS.find((preset) => preset.id === value)?.background ?? 'none');
  if (value) root.setAttribute('data-has-cover', '');
  return root;
}
