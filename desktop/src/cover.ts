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
    { id: 'sunrise', label: 'Aurore', background: 'linear-gradient(110deg, #fad0c4, #ffd1ff)' },
    { id: 'sky', label: 'Ciel', background: 'linear-gradient(110deg, #a1c4fd, #c2e9fb)' },
    { id: 'mint', label: 'Menthe', background: 'linear-gradient(110deg, #84fab0, #8fd3f4)' },
    { id: 'sand', label: 'Sable', background: 'linear-gradient(110deg, #e6d9bd, #f5eee0)' },
    { id: 'rose', label: 'Rose', background: 'linear-gradient(110deg, #e8b5bd, #f8dedb)' },
    { id: 'midnight', label: 'Minuit', background: 'linear-gradient(110deg, #141e30, #475978)' },
    { id: 'paper', label: 'Papier', background: 'linear-gradient(110deg, #6a695f, #a8a494 52%, #ded9c7)' },
  ] },
  { label: 'Couleurs unies', items: [
    { id: 'solid-cream', label: 'Crème', background: 'linear-gradient(#e8dfcf, #e8dfcf)' },
    { id: 'solid-stone', label: 'Pierre', background: 'linear-gradient(#b8b5ad, #b8b5ad)' },
    { id: 'solid-gray', label: 'Gris', background: 'linear-gradient(#727777, #727777)' },
    { id: 'solid-blue', label: 'Bleu', background: 'linear-gradient(#7d9fb4, #7d9fb4)' },
    { id: 'solid-green', label: 'Vert', background: 'linear-gradient(#8d9e88, #8d9e88)' },
    { id: 'solid-yellow', label: 'Jaune', background: 'linear-gradient(#e7c578, #e7c578)' },
    { id: 'solid-orange', label: 'Orange', background: 'linear-gradient(#d99c76, #d99c76)' },
    { id: 'solid-red', label: 'Rouge', background: 'linear-gradient(#c57f78, #c57f78)' },
    { id: 'solid-pink', label: 'Rose poudré', background: 'linear-gradient(#cba3ae, #cba3ae)' },
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
/** The database row header stores URLs, so encode our built-in gradients as image sources. */
export const COVER_GALLERY = COVER_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.map((item) => {
    const image = /^url\("(.*)"\)$/.exec(item.background);
    if (image) return {label: item.label, url: new URL(image[1], location.href).href};
    const colors = item.background.match(/#[a-f0-9]{6}/gi) ?? ['#777777'];
    const stops = colors.map((color, index) => `<stop offset="${index / Math.max(1, colors.length - 1) * 100}%" stop-color="${color}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><defs><linearGradient id="g">${stops}</linearGradient></defs><path fill="url(#g)" d="M0 0h1600v600H0z"/></svg>`;
    return {label: item.label, url: `data:image/svg+xml,${encodeURIComponent(svg)}`};
  }),
}));
export type CoverId = typeof COVER_PRESETS[number]['id'];
export type PageCover = CoverId | (string & {});
export function isPageCover(value: unknown): value is PageCover {
  if (isCoverId(value)) return true;
  if (typeof value !== 'string') return false;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
export function readCoverFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choisissez une image PNG, JPEG, GIF ou WebP.'));
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('L’image doit peser moins de 5 Mo.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'));
    reader.readAsDataURL(file);
  });
}
export interface CoverOptions {
  upload?: (dataUrl: string) => Promise<string>;
  resolveUrl?: (url: string) => Promise<string>;
  readOnly?: boolean;
}
export const isCoverId = (value: unknown): value is CoverId => COVER_PRESETS.some((item) => item.id === value);

/**
 * Paints the page header's hover state as an attribute instead of leaning on CSS
 * `:hover`.
 *
 * workspace.ts re-appends the add-cover button whenever the core rebuilds the icon
 * row. WebKit — the engine behind the packaged Tauri window — never delivers the
 * matching `mouseleave` for a node moved under the cursor, so `:hover` on the header
 * latched and the button never left. The core's add-icon button is never moved, so
 * only this one stuck. Delegation reads the pointer's live target, so a replaced node
 * changes nothing.
 */
export function trackPageHeaderHover(root: Document): () => void {
  const HEADER = '[data-blok-page-header]';
  const FLAG = 'data-desktop-header-hover';
  const clear = (): void => {
    for (const header of root.querySelectorAll(HEADER)) header.removeAttribute(FLAG);
  };
  const over = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest(HEADER) : null;
    clear();
    target?.setAttribute(FLAG, '');
  };
  const out = (event: Event): void => {
    const to = event instanceof MouseEvent && event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (to?.closest(HEADER)) return;
    clear();
  };
  root.addEventListener('pointerover', over, true);
  root.addEventListener('pointerout', out, true);
  return () => {
    root.removeEventListener('pointerover', over, true);
    root.removeEventListener('pointerout', out, true);
    clear();
  };
}

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
  value: PageCover,
  position: number,
  onChange: (cover: PageCover | undefined) => void,
  onPositionChange: (position: number) => void,
  options: CoverOptions = {},
): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-desktop-cover', '');
  const image = document.createElement('div');
  image.setAttribute('data-desktop-cover-image', '');
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', 'Couverture de la page');
  const preset = COVER_PRESETS.find((item) => item.id === value);
  image.style.backgroundImage = preset?.background ?? `url(${JSON.stringify(value)})`;
  if (!preset && options.resolveUrl) void options.resolveUrl(value).then((url) => {
    image.style.backgroundImage = `url(${JSON.stringify(url)})`;
  }).catch(() => undefined);
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
  const tabs = document.createElement('div');
  tabs.setAttribute('data-desktop-cover-tabs', '');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Source de la couverture');
  gallery.append(tabs);
  const scroll = document.createElement('div');
  scroll.setAttribute('data-desktop-cover-gallery-scroll', '');
  const scrollFrame = document.createElement('div');
  scrollFrame.setAttribute('data-desktop-cover-gallery-viewport', '');
  const scrollbar = document.createElement('div');
  scrollbar.setAttribute('data-desktop-cover-gallery-scrollbar', '');
  scrollbar.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.setAttribute('data-desktop-cover-gallery-thumb', '');
  scrollbar.append(thumb);
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
  scrollFrame.append(scroll, scrollbar);
  gallery.append(scrollFrame);
  const uploadPanel = document.createElement('div');
  uploadPanel.setAttribute('data-desktop-cover-panel', '');
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.textContent = 'Choisir une image';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/gif,image/webp';
  file.hidden = true;
  const hint = document.createElement('p');
  hint.textContent = 'PNG, JPEG, GIF ou WebP · 5 Mo maximum';
  const uploadStatus = document.createElement('p');
  uploadStatus.setAttribute('role', 'status');
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!selected) return;
    upload.disabled = true;
    uploadStatus.textContent = 'Importation…';
    void readCoverFile(selected).then((data) => options.upload ? options.upload(data) : data).then((url) => {
      if (!isPageCover(url)) throw new Error('Image invalide.');
      onChange(url);
    }).catch((error: unknown) => {
      uploadStatus.textContent = error instanceof Error ? error.message : 'Impossible d’importer cette image.';
    }).finally(() => { upload.disabled = false; file.value = ''; });
  });
  uploadPanel.append(upload, file, hint, uploadStatus);
  const linkPanel = document.createElement('form');
  linkPanel.setAttribute('data-desktop-cover-panel', '');
  const link = document.createElement('input');
  link.type = 'url';
  link.placeholder = 'https://exemple.com/image.jpg';
  link.setAttribute('aria-label', 'Lien de l’image de couverture');
  link.required = true;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Appliquer';
  const linkStatus = document.createElement('p');
  linkStatus.setAttribute('role', 'status');
  const linkHint = document.createElement('p');
  linkHint.textContent = 'Collez le lien direct d’une image.';
  linkPanel.append(link, submit, linkHint, linkStatus);
  linkPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = link.value.trim();
    if (!/^https?:\/\//i.test(url) || !isPageCover(url)) { linkStatus.textContent = 'Saisissez une adresse HTTP ou HTTPS valide.'; return; }
    onChange(new URL(url).href);
  });
  gallery.append(uploadPanel, linkPanel);
  const panels = [scrollFrame, uploadPanel, linkPanel];
  const tabButtons: HTMLButtonElement[] = [];
  const selectTab = (index: number): void => {
    panels.forEach((panel, current) => { panel.hidden = current !== index; });
    tabButtons.forEach((tab, current) => { tab.setAttribute('aria-selected', String(current === index)); tab.tabIndex = current === index ? 0 : -1; });
    updateScrollbar();
  };
  ['Galerie', 'Importer', 'Lien'].forEach((label, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      selectTab(next); tabButtons[next].focus();
    });
    tabButtons.push(tab); tabs.append(tab);
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-label', label);
  });
  const updateScrollbar = (): void => {
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    scrollbar.hidden = maxScroll <= 1;
    if (scrollbar.hidden) return;
    const trackHeight = scrollbar.clientHeight;
    const thumbHeight = Math.max(24, trackHeight * scroll.clientHeight / scroll.scrollHeight);
    const travel = Math.max(0, trackHeight - thumbHeight);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${travel * scroll.scrollTop / maxScroll}px)`;
  };
  selectTab(0);
  scroll.addEventListener('scroll', updateScrollbar);
  let dragStart: { y: number; scrollTop: number } | null = null;
  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragStart = { y: event.clientY, scrollTop: scroll.scrollTop };
    thumb.setPointerCapture(event.pointerId);
  });
  thumb.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    const travel = scrollbar.clientHeight - thumb.clientHeight;
    if (travel > 0) scroll.scrollTop = dragStart.scrollTop
      + (event.clientY - dragStart.y) * (scroll.scrollHeight - scroll.clientHeight) / travel;
  });
  const endDrag = (): void => { dragStart = null; };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  scrollbar.addEventListener('pointerdown', (event) => {
    if (event.target === thumb) return;
    const travel = scrollbar.clientHeight - thumb.clientHeight;
    if (travel <= 0) return;
    const y = event.clientY - scrollbar.getBoundingClientRect().top - thumb.clientHeight / 2;
    scroll.scrollTop = y * (scroll.scrollHeight - scroll.clientHeight) / travel;
  });
  const closeGallery = (): void => {
    gallery.hidden = true;
    change.setAttribute('aria-expanded', 'false');
    actions.removeAttribute('data-open');
  };
  change.addEventListener('click', () => {
    if (gallery.hidden) {
      gallery.hidden = false;
      scroll.style.maxHeight = `${Math.max(0, Math.min(350, window.innerHeight - gallery.getBoundingClientRect().top - 100))}px`;
      updateScrollbar();
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
  root.append(image, drag);
  if (!options.readOnly) root.append(actions);
  return root;
}
