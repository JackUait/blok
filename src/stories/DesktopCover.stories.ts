import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, within } from 'storybook/test';
import { createAddCoverButton, createPageCover, type CoverId } from '../../desktop/src/cover';
import '../../desktop/src/shell.css';

function page(initialCover?: CoverId): HTMLElement {
  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-sidebar-canvas', '');
  canvas.style.minHeight = '680px';
  let cover = initialCover;
  let position = 50;
  const article = document.createElement('article');
  article.setAttribute('data-desktop-document', '');
  const appearance = document.createElement('div');
  appearance.setAttribute('data-desktop-page-appearance', '');
  const title = document.createElement('h1');
  title.textContent = 'Carnet de voyage';
  title.style.fontSize = '48px';
  title.style.margin = '0';
  article.append(appearance, title);
  canvas.append(article);
  const paint = (): void => {
    canvas.querySelector('[data-desktop-cover]')?.remove();
    article.toggleAttribute('data-has-cover', !!cover);
    if (cover) {
      appearance.replaceChildren();
      canvas.insertBefore(createPageCover(cover, position, (next) => { cover = next; paint(); },
        (next) => { position = next; paint(); }), article);
    } else {
      appearance.replaceChildren(createAddCoverButton((next) => { cover = next; paint(); }));
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
    expect(add).toBeTruthy();
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

export const Repositionnement: Story = {
  render: () => page('earth'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Repositionner' }));
    expect(canvas.getByRole('slider', { name: 'Position verticale de la couverture' })).toBeTruthy();
  },
};
