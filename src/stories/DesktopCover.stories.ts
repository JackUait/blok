import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { createAddCoverButton, createPageCover, type CoverId } from '../../desktop/src/cover';
import '../../desktop/src/shell.css';

function page(initialCover?: CoverId, initialIcon?: string): HTMLElement {
  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-sidebar-canvas', '');
  canvas.style.minHeight = '680px';
  let cover = initialCover;
  let position = 50;
  const article = document.createElement('article');
  article.setAttribute('data-desktop-document', '');
  const header = document.createElement('div');
  header.setAttribute('data-blok-page-header', '');
  const iconRow = document.createElement('div');
  iconRow.setAttribute('data-blok-page-icon-row', '');
  const addIcon = document.createElement('button');
  addIcon.type = 'button';
  addIcon.setAttribute('data-blok-page-add-icon', '');
  addIcon.textContent = 'Ajouter une icône';
  if (initialIcon) {
    iconRow.setAttribute('data-has-icon', '');
    const icon = document.createElement('button');
    icon.type = 'button';
    icon.setAttribute('data-blok-page-icon', '');
    icon.setAttribute('aria-label', 'Changer l’icône');
    icon.textContent = initialIcon;
    iconRow.append(icon);
  } else iconRow.append(addIcon);
  const title = document.createElement('h1');
  title.textContent = 'Carnet de voyage';
  title.style.fontSize = '48px';
  title.style.margin = '0';
  header.append(iconRow, title);
  article.append(header);
  canvas.append(article);
  const paint = (): void => {
    canvas.querySelector('[data-desktop-cover]')?.remove();
    article.toggleAttribute('data-has-cover', !!cover);
    if (cover) {
      iconRow.querySelector('[data-desktop-add-cover]')?.remove();
      canvas.insertBefore(createPageCover(cover, position, (next) => { cover = next; paint(); },
        (next) => { position = next; paint(); }), article);
    } else {
      iconRow.append(createAddCoverButton((next) => { cover = next; paint(); }));
    }
  };
  paint();
  return canvas;
}

const meta: Meta = {
  title: 'Shell/Desktop/Couverture',
  parameters: { layout: 'fullscreen' },
  render: () => page(),
};
export default meta;
type Story = StoryObj;

export const SansCouverture: Story = {
  render: () => page(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const add = canvas.getByRole('button', { name: 'Ajouter une couverture' });
    expect(add.parentElement?.hasAttribute('data-blok-page-icon-row')).toBe(true);
    expect(getComputedStyle(add).opacity).toBe('0');
  },
};

export const ActionsAuSurvol: Story = {
  render: () => page(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector<HTMLElement>('[data-blok-page-header]');
    if (!header) throw new Error('L’en-tête de page doit être présent.');
    const add = canvas.getByRole('button', { name: 'Ajouter une couverture' });
    await userEvent.hover(header);
    await waitFor(() => expect(getComputedStyle(add).opacity).toBe('1'));
    expect(getComputedStyle(canvas.getByRole('button', { name: 'Ajouter une icône' })).opacity).toBe('1');
  },
};

export const Ajout: Story = {
  render: () => page(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector<HTMLElement>('[data-blok-page-header]');
    if (!header) throw new Error('L’en-tête de page doit être présent.');
    await userEvent.hover(header);
    const add = canvas.getByRole('button', { name: 'Ajouter une couverture' });
    await userEvent.click(add);
    expect(canvas.getByRole('img', { name: 'Couverture de la page' })).toBeTruthy();
  },
};

export const Galerie: Story = {
  render: () => page('dusk'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Changer la couverture' }));
    expect(canvas.getByRole('dialog', { name: 'Choisir une couverture' })).toBeTruthy();
  },
};

export const IconeSurCouverture: Story = {
  render: () => page('met-oxbow', '🚙'),
  play: ({ canvasElement }) => {
    const cover = canvasElement.querySelector<HTMLElement>('[data-desktop-cover]');
    const icon = canvasElement.querySelector<HTMLElement>('[data-blok-page-icon]');
    if (!cover || !icon) throw new Error('La couverture et l’icône doivent être présentes.');
    const edge = cover.getBoundingClientRect().bottom;
    const iconBox = icon.getBoundingClientRect();
    expect(iconBox.top).toBeLessThan(edge);
    expect(iconBox.bottom).toBeGreaterThan(edge);
  },
};

export const CouvertureSansIcone: Story = {
  render: () => page('met-oxbow'),
  play: ({ canvasElement }) => {
    const cover = canvasElement.querySelector<HTMLElement>('[data-desktop-cover]');
    const addIcon = canvasElement.querySelector<HTMLElement>('[data-blok-page-add-icon]');
    if (!cover || !addIcon) throw new Error('La couverture et l’action d’icône doivent être présentes.');
    expect(addIcon.getBoundingClientRect().top).toBeGreaterThanOrEqual(cover.getBoundingClientRect().bottom);
  },
};

export const DomainePublic: Story = {
  render: () => page('met-great-wave'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Changer la couverture' }));
    expect(canvas.getByRole('button', { name: 'La Grande Vague · Hokusai' }).getAttribute('aria-pressed')).toBe('true');
    expect(canvas.getByRole('region', { name: 'Paysages · The Met' })).toBeTruthy();
  },
};

export const GalerieEtendue: Story = {
  render: () => page('met-irises', '🌸'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Changer la couverture' }));
    expect(canvas.getByRole('button', { name: 'Iris · Vincent van Gogh' }).getAttribute('aria-pressed')).toBe('true');
    expect(canvas.getByRole('region', { name: 'Estampes japonaises · The Met' })).toBeTruthy();
    const scroll = canvasElement.querySelector<HTMLElement>('[data-desktop-cover-gallery-scroll]');
    const scrollbar = canvasElement.querySelector<HTMLElement>('[data-desktop-cover-gallery-scrollbar]');
    const thumb = canvasElement.querySelector<HTMLElement>('[data-desktop-cover-gallery-thumb]');
    if (!scroll || !scrollbar || !thumb) throw new Error('La galerie doit avoir une barre de défilement.');
    expect(scrollbar.hidden).toBe(false);
    const initialTop = thumb.getBoundingClientRect().top;
    scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
    await waitFor(() => expect(thumb.getBoundingClientRect().top).toBeGreaterThan(initialTop));
  },
};

export const Repositionnement: Story = {
  render: () => page('earth'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Repositionner' }));
    expect(canvas.getByRole('slider', { name: 'Position verticale de la couverture' })).toBeTruthy();
  },
};
