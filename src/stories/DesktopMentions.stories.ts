import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Blok } from '../blok';
import { localDateIso } from '../shared/date-mention';
import { PageTool, type PageConfig } from '../tools/page';
import { defaultTools } from './helpers';
import '../../desktop/src/shell.css';

let liveEditor: Blok | null = null;

function mentions(): HTMLElement {
  liveEditor?.destroy();
  const root = document.createElement('main');
  const holder = document.createElement('div');
  const status = document.createElement('p');
  const today = localDateIso(new Date());
  const pages = [{ pageId: 'roadmap', title: 'Feuille de route', icon: { type: 'emoji' as const, value: '🗺️' } }];
  const pageConfig: PageConfig = {
    todayMention: { label: 'Aujourd’hui', heading: 'Date', locale: 'fr' },
    search: async (query) => pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    resolve: (id) => pages.find((page) => page.pageId === id) ?? null,
    open: (id) => { status.textContent = `Page ouverte : ${id}`; },
  };

  root.setAttribute('data-desktop-shell', '');
  root.setAttribute('data-blok-theme', 'dark');
  root.style.minHeight = '540px';
  root.style.padding = '64px max(24px, calc((100vw - 760px) / 2))';
  status.setAttribute('role', 'status');
  status.style.color = '#aaa';
  root.append(holder, status);
  liveEditor = new Blok({
    holder,
    tools: { ...defaultTools, page: { class: PageTool, config: { ...pageConfig } } },
    data: { blocks: [
      { id: 'mentions', type: 'paragraph', data: {
        text: `Voir <a data-blok-page-id="roadmap">Page</a> et <time data-blok-date-mention="" datetime="${today}">Aujourd’hui</time>.`,
      } },
      { id: 'entry', type: 'paragraph', data: { text: 'Tape @ puis today, ou le nom d’une page.' } },
    ] },
  });
  return root;
}

const meta: Meta = {
  title: 'Shell/Desktop/Mentions',
  parameters: { layout: 'fullscreen' },
  render: mentions,
};
export default meta;
type Story = StoryObj;

export const PageEtDate: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('time[data-blok-date-mention]')?.textContent).toBe('Aujourd’hui'));
    expect(canvasElement.querySelector('a[data-blok-page-id="roadmap"]')).toBeTruthy();
    const date = canvasElement.querySelector<HTMLElement>('time[data-blok-date-mention]');

    if (date === null) return;
    await userEvent.click(date);
    await waitFor(() => expect(document.querySelector('[data-blok-database-date-editor]')).toBeTruthy());
    expect(document.querySelector('[data-blok-database-date-end-toggle]')).toBeTruthy();
    expect(document.querySelector('[data-blok-database-date-setting="dateFormat"]')).toBeTruthy();
  },
};
