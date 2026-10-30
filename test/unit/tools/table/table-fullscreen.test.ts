import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import { TableFullscreen } from '../../../../src/tools/table/table-fullscreen';

const mount = (): { fullscreen: TableFullscreen; holder: HTMLElement; root: HTMLElement } => {
  const holder = document.createElement('div');
  const root = document.createElement('div');
  const scroll = document.createElement('div');

  scroll.setAttribute('data-blok-table-scroll', '');
  scroll.appendChild(document.createElement('div'));
  root.appendChild(scroll);
  holder.appendChild(root);
  document.body.appendChild(holder);
  // jsdom has no Web Animations API.
  Object.defineProperty(holder, 'getAnimations', { value: () => [] });

  const fullscreen = new TableFullscreen({
    getHost: () => holder,
    getTitle: () => 'Budget',
    getSize: () => ({ rows: 2, cols: 3 }),
    getMinSize: () => ({ rows: 1, cols: 1 }),
    setSize: vi.fn(),
    isReadOnly: () => false,
    onRelayout: vi.fn(),
    t: (key) => key,
  });

  root.appendChild(fullscreen.button);
  root.appendChild(fullscreen.header);
  fullscreen.watchCorner(root);

  return { fullscreen, holder, root };
};

describe('TableFullscreen header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('holds nothing while the table is inline, so the block has no hidden caret inputs', () => {
    const { fullscreen, root } = mount();

    expect(fullscreen.header.childNodes).toHaveLength(0);
    expect(root.querySelectorAll('input')).toHaveLength(0);

    fullscreen.destroy();
  });

  it('shows the title and size while open and empties again on close', () => {
    const { fullscreen } = mount();

    fullscreen.open();

    expect(fullscreen.header.textContent).toContain('Budget');
    expect(fullscreen.header.textContent).toContain('3 × 2');
    expect(fullscreen.header.querySelectorAll('input')).toHaveLength(2);

    fullscreen.close();

    expect(fullscreen.header.childNodes).toHaveLength(0);

    fullscreen.destroy();
  });

  it('fills and empties the header without counting as a block edit', () => {
    const { fullscreen, root } = mount();
    const handler = new MutationHandler(() => root, null, vi.fn());
    const observer = new MutationObserver(() => undefined);

    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    // The editor reads each event's records before the next event runs.
    fullscreen.open();
    const opened = observer.takeRecords();
    const openIsEdit = handler.handleMutation(opened).shouldFireUpdate;

    fullscreen.close();
    const closed = observer.takeRecords();
    const closeIsEdit = handler.handleMutation(closed).shouldFireUpdate;

    observer.disconnect();

    expect(closeIsEdit).toBe(false);
    expect(openIsEdit).toBe(false);
    expect(opened.length).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThan(0);

    fullscreen.destroy();
  });
});
