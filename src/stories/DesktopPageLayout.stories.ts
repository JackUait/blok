import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, within } from 'storybook/test';
import { createPageToolbar } from '../../desktop/src/page-toolbar';
import '../../desktop/src/shell.css';

function page(fullWidth: boolean): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-desktop-shell', '');
  root.setAttribute('data-blok-theme', 'dark');
  root.style.height = '680px';
  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-agent-editor', '');
  canvas.style.height = '100%';
  const article = document.createElement('article');
  article.setAttribute('data-desktop-document', '');
  const title = document.createElement('h1');
  title.textContent = 'Carnet de voyage';
  const text = document.createElement('p');
  text.textContent = 'Une page large garde des marges confortables tout en donnant plus de place aux tableaux et aux images.';
  article.append(title, text);
  const apply = (enabled: boolean): void => {
    canvas.toggleAttribute('data-full-width', enabled);
    article.toggleAttribute('data-full-width', enabled);
  };
  const toolbar = createPageToolbar('Carnet de voyage', '🌍', fullWidth, apply);
  canvas.append(toolbar.element, article);
  root.append(canvas);
  apply(fullWidth);
  return root;
}

const meta: Meta = {
  title: 'Shell/Desktop/Mise en page',
  parameters: { layout: 'fullscreen' },
  render: () => page(false),
};
export default meta;
type Story = StoryObj;

export const Normale: Story = { render: () => page(false) };
export const PleineLargeur: Story = { render: () => page(true) };
export const Bascule: Story = {
  render: () => page(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Actions de la page' }));
    await userEvent.click(canvas.getByRole('switch', { name: 'Pleine largeur' }));
    expect(canvasElement.querySelector('[data-desktop-document]')?.hasAttribute('data-full-width')).toBe(true);
    expect(canvas.getByRole('switch', { name: 'Pleine largeur' }).getAttribute('aria-checked')).toBe('true');
  },
};
