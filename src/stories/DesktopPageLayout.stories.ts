import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { createPageToolbar } from '../../desktop/src/page-toolbar';
import { Blok } from '../blok';
import { defaultTools } from './helpers';
import '../../desktop/src/shell.css';

let liveEditor: Blok | null = null;

function page(fullWidth: boolean, nested = false): HTMLElement {
  try { liveEditor?.destroy(); } catch { /* A previous story may already have been removed. */ }
  liveEditor = null;
  const root = document.createElement('div');
  root.setAttribute('data-desktop-shell', '');
  root.setAttribute('data-blok-theme', 'dark');
  root.style.height = '680px';
  const canvas = document.createElement('main');
  canvas.setAttribute('data-blok-agent-editor', '');
  canvas.style.height = '100%';
  const article = document.createElement('article');
  article.setAttribute('data-desktop-document', '');
  const holder = document.createElement('div');
  article.append(holder);
  let editor: Blok | null = null;
  const apply = (enabled: boolean): void => {
    canvas.toggleAttribute('data-full-width', enabled);
    article.toggleAttribute('data-full-width', enabled);
    editor?.width.set(enabled ? 'full' : 'narrow');
  };
  const title = nested ? 'jojo' : 'Carnet de voyage';
  const toolbar = createPageToolbar([
    ...(nested ? [{ id: 'parent', title: 'Nouvelle page', icon: '🏕️', menuHeading: 'Pages locales', menu: [
      { id: 'parent', title: 'Nouvelle page', icon: '🏕️', current: true, children: [
        { id: 'current', title, icon: '🎸', current: true, onOpen: () => undefined },
      ], onOpen: () => undefined },
      { id: 'other', title: 'Autre page', onOpen: () => undefined },
    ] }] : []),
    { id: 'current', title, icon: nested ? '🎸' : '🌍', ...(nested ? {
      menuHeading: 'Nouvelle page',
      menu: [{ id: 'current', title, icon: '🎸', current: true, onOpen: () => undefined }],
    } : {}) },
  ], fullWidth, apply);
  canvas.append(toolbar.element, article);
  root.append(canvas);
  editor = new Blok({
    holder,
    tools: defaultTools,
    pageTitle: { placeholder: 'Nouvelle page' },
    data: {
      time: Date.now(), version: '2.1.0',
      blocks: [{ id: 'example', type: 'paragraph', data: { text: 'Une page large donne plus de place aux blocs, aux tableaux et aux images.' } }],
    },
  });
  liveEditor = editor;
  apply(fullWidth);
  void editor.isReady.then(() => editor?.title.set(title, { record: false })).catch(() => undefined);
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
export const SousPage: Story = {
  render: () => page(false, true),
  play: async ({ canvasElement }) => {
    const items = canvasElement.querySelectorAll('[data-desktop-page-breadcrumb-item]');

    expect(Array.from(items).map((item) => item.textContent)).toEqual(['🏕️Nouvelle page', '🎸jojo']);
    expect(canvasElement.querySelector('[data-desktop-page-breadcrumb-separator]')?.textContent).toBe('/');
    await userEvent.click(canvasElement.querySelector<HTMLButtonElement>('[data-page-id="parent"] > button')!);
    expect(canvasElement.querySelector('[data-desktop-breadcrumb-menu-heading]')?.textContent).toBe('Pages locales');
    expect(canvasElement.querySelector('[data-desktop-breadcrumb-menu-children]')).not.toBeNull();
  },
};
export const Bascule: Story = {
  render: () => page(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('[data-blok-element-content]')).toBeTruthy());
    await userEvent.click(canvas.getByRole('button', { name: 'Actions de la page' }));
    await userEvent.click(canvas.getByRole('switch', { name: 'Pleine largeur' }));
    expect(canvasElement.querySelector('[data-desktop-document]')?.hasAttribute('data-full-width')).toBe(true);
    expect(canvasElement.querySelector('[data-blok-editor]')?.getAttribute('data-blok-width')).toBe('full');
    expect(canvas.getByRole('switch', { name: 'Pleine largeur' }).getAttribute('aria-checked')).toBe('true');
  },
};
