import earth from './assets/covers/nasa_the_blue_marble.jpg';
import desert from './assets/covers/nasa_great_sandy_desert_australia.jpg';
import nebula from './assets/covers/webb1.jpg';
import oxbow from './assets/covers/met_oxbow.jpg';
import lakeGeorge from './assets/covers/met_lake_george.jpg';
import rockyMountains from './assets/covers/met_rocky_mountains.jpg';
import aegeanSea from './assets/covers/met_aegean_sea.jpg';
import greatWave from './assets/covers/met_great_wave.jpg';
import seteWave from './assets/covers/met_sete_wave.jpg';
import cypresses from './assets/covers/met_wheat_field_cypresses.jpg';
import summerAfternoon from './assets/covers/met_summer_afternoon.jpg';
import gulfStream from './assets/covers/met_gulf_stream.jpg';
import irises from './assets/covers/met_irises.jpg';
import roses from './assets/covers/met_roses.jpg';
import haraFuji from './assets/covers/met_hara_fuji.jpg';
import nihonbashi from './assets/covers/met_nihonbashi.jpg';
import fujiSenju from './assets/covers/met_fuji_senju.jpg';

export const COVER_GROUPS = [
  { label: 'Couleurs et dégradés', items: [
    { id: 'dusk', label: 'Crépuscule', background: 'linear-gradient(115deg, #24304b, #82587b 54%, #d49470)' },
    { id: 'ocean', label: 'Océan', background: 'linear-gradient(110deg, #102d43, #266e82 50%, #83afa5)' },
    { id: 'forest', label: 'Forêt', background: 'linear-gradient(115deg, #193a34, #4f745e 55%, #a5a979)' },
    { id: 'clay', label: 'Terre', background: 'linear-gradient(110deg, #4e3530, #aa695a 53%, #e2b78c)' },
    { id: 'violet', label: 'Violet', background: 'linear-gradient(115deg, #322450, #654a9a 55%, #b78bb4)' },
    { id: 'paper', label: 'Papier', background: 'linear-gradient(110deg, #6a695f, #a8a494 52%, #ded9c7)' },
  ] },
  { label: 'Images spatiales', items: [
    { id: 'earth', label: 'La Terre', background: `url("${earth}")` },
    { id: 'desert', label: 'Désert australien', background: `url("${desert}")` },
    { id: 'nebula', label: 'Nébuleuse', background: `url("${nebula}")` },
  ] },
  { label: 'Paysages · The Met', items: [
    { id: 'met-oxbow', label: 'The Oxbow · Thomas Cole', background: `url("${oxbow}")` },
    { id: 'met-lake-george', label: 'Lake George · John Frederick Kensett', background: `url("${lakeGeorge}")` },
    { id: 'met-rocky-mountains', label: 'Rocky Mountains · Albert Bierstadt', background: `url("${rockyMountains}")` },
    { id: 'met-aegean-sea', label: 'The Aegean Sea · Frederic Edwin Church', background: `url("${aegeanSea}")` },
    { id: 'met-wheat-field-cypresses', label: 'Champ de blé aux cyprès · Vincent van Gogh', background: `url("${cypresses}")` },
    { id: 'met-summer-afternoon', label: 'Après-midi d’été · Asher Brown Durand', background: `url("${summerAfternoon}")` },
    { id: 'met-gulf-stream', label: 'Le Gulf Stream · Winslow Homer', background: `url("${gulfStream}")` },
  ] },
  { label: 'Vagues · The Met', items: [
    { id: 'met-great-wave', label: 'La Grande Vague · Hokusai', background: `url("${greatWave}")` },
    { id: 'met-sete-wave', label: 'La Grande Vague, Sète · Gustave Le Gray', background: `url("${seteWave}")` },
  ] },
  { label: 'Fleurs · The Met', items: [
    { id: 'met-irises', label: 'Iris · Vincent van Gogh', background: `url("${irises}")` },
    { id: 'met-roses', label: 'Roses · Vincent van Gogh', background: `url("${roses}")` },
  ] },
  { label: 'Estampes japonaises · The Met', items: [
    { id: 'met-hara-fuji', label: 'Le mont Fuji au matin · Utagawa Hiroshige', background: `url("${haraFuji}")` },
    { id: 'met-nihonbashi', label: 'Averse à Nihonbashi · Utagawa Hiroshige', background: `url("${nihonbashi}")` },
    { id: 'met-fuji-senju', label: 'Fuji vu de Senju · Katsushika Hokusai', background: `url("${fujiSenju}")` },
  ] },
] as const;

export const COVER_PRESETS = COVER_GROUPS.flatMap((group) => [...group.items]);
export type CoverId = typeof COVER_PRESETS[number]['id'];
export const isCoverId = (value: unknown): value is CoverId => COVER_PRESETS.some((item) => item.id === value);

export function createAddCoverButton(onChange: (cover: CoverId) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-desktop-add-cover', '');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 4.5h14v11H3zM3 13l4.2-4 3.2 3 2.5-2.2L17 13.5M13.5 7.2h.01');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  button.append(svg, document.createTextNode('Ajouter une couverture'));
  button.addEventListener('click', () => onChange('dusk'));
  return button;
}

export function createPageCover(
  value: CoverId,
  position: number,
  onChange: (cover: CoverId | undefined) => void,
  onPositionChange: (position: number) => void,
): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-desktop-cover', '');
  const image = document.createElement('div');
  image.setAttribute('data-desktop-cover-image', '');
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', 'Couverture de la page');
  image.style.backgroundImage = COVER_PRESETS.find((item) => item.id === value)!.background;
  const applyPosition = (next: number): void => { image.style.backgroundPosition = `center ${next}%`; };
  applyPosition(position);

  const actions = document.createElement('div');
  actions.setAttribute('data-desktop-cover-actions', '');
  const reposition = document.createElement('button');
  reposition.type = 'button';
  reposition.textContent = 'Repositionner';
  const change = document.createElement('button');
  change.type = 'button';
  change.textContent = 'Changer la couverture';
  change.setAttribute('aria-haspopup', 'dialog');
  change.setAttribute('aria-expanded', 'false');

  const gallery = document.createElement('div');
  gallery.setAttribute('data-desktop-cover-gallery', '');
  gallery.setAttribute('role', 'dialog');
  gallery.setAttribute('aria-label', 'Choisir une couverture');
  gallery.hidden = true;
  const head = document.createElement('div');
  head.setAttribute('data-desktop-cover-gallery-head', '');
  const title = document.createElement('strong');
  title.textContent = 'Couverture de page';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Supprimer';
  remove.addEventListener('click', () => onChange(undefined));
  head.append(title, remove);
  gallery.append(head);
  const scroll = document.createElement('div');
  scroll.setAttribute('data-desktop-cover-gallery-scroll', '');
  for (const group of COVER_GROUPS) {
    const section = document.createElement('section');
    section.setAttribute('aria-label', group.label);
    const heading = document.createElement('h3');
    heading.textContent = group.label;
    const grid = document.createElement('div');
    grid.setAttribute('data-desktop-cover-grid', '');
    for (const preset of group.items) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('aria-label', preset.label);
      option.setAttribute('title', preset.label);
      option.setAttribute('data-cover-id', preset.id);
      option.setAttribute('aria-pressed', String(preset.id === value));
      option.style.backgroundImage = preset.background;
      option.addEventListener('click', () => onChange(preset.id));
      grid.append(option);
    }
    section.append(heading, grid);
    scroll.append(section);
  }
  gallery.append(scroll);
  const closeGallery = (): void => {
    gallery.hidden = true;
    change.setAttribute('aria-expanded', 'false');
    actions.removeAttribute('data-open');
  };
  change.addEventListener('click', () => {
    if (gallery.hidden) {
      gallery.hidden = false;
      scroll.style.maxHeight = `${Math.max(0, Math.min(400, window.innerHeight - gallery.getBoundingClientRect().top - 54))}px`;
      change.setAttribute('aria-expanded', 'true');
      actions.setAttribute('data-open', '');
    } else closeGallery();
  });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeGallery(); });
  actions.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && actions.contains(event.relatedTarget)) return;
    closeGallery();
  });

  const drag = document.createElement('div');
  drag.setAttribute('data-desktop-cover-drag', '');
  drag.setAttribute('role', 'slider');
  drag.setAttribute('aria-label', 'Position verticale de la couverture');
  drag.setAttribute('aria-valuemin', '0');
  drag.setAttribute('aria-valuemax', '100');
  drag.tabIndex = 0;
  drag.hidden = true;
  const guide = document.createElement('span');
  guide.textContent = 'Glisser pour repositionner la couverture';
  drag.append(guide);
  let draft = position;
  let start: { y: number; position: number } | null = null;
  const setDraft = (next: number): void => {
    draft = Math.max(0, Math.min(100, Math.round(next)));
    drag.setAttribute('aria-valuenow', String(draft));
    applyPosition(draft);
  };
  setDraft(position);
  const finish = (): void => {
    drag.hidden = true;
    root.removeAttribute('data-repositioning');
    actions.replaceChildren(reposition, change, gallery);
    actions.removeAttribute('data-open');
    reposition.focus();
  };
  drag.addEventListener('pointerdown', (event) => {
    start = { y: event.clientY, position: draft };
    drag.setPointerCapture(event.pointerId);
  });
  drag.addEventListener('pointermove', (event) => {
    if (start) setDraft(start.position - (event.clientY - start.y) / 2);
  });
  drag.addEventListener('pointerup', () => { start = null; });
  drag.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') setDraft(draft + 5);
    else if (event.key === 'ArrowDown') setDraft(draft - 5);
    else if (event.key === 'Home') setDraft(0);
    else if (event.key === 'End') setDraft(100);
    else if (event.key === 'Escape') { setDraft(position); finish(); }
    else return;
    event.preventDefault();
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Annuler';
  cancel.addEventListener('click', () => { setDraft(position); finish(); });
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Enregistrer la position';
  save.addEventListener('click', () => { onPositionChange(draft); finish(); });
  reposition.addEventListener('click', () => {
    closeGallery();
    drag.hidden = false;
    root.setAttribute('data-repositioning', '');
    actions.replaceChildren(cancel, save);
    actions.setAttribute('data-open', '');
    drag.focus();
  });
  actions.append(reposition, change, gallery);
  root.append(image, drag, actions);
  return root;
}
