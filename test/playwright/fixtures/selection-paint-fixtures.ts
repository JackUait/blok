import type { OutputData } from '@/types';

type Blocks = OutputData['blocks'];
type Block = Blocks[number];

/**
 * One block (plus any blocks it needs, e.g. a column_list's columns) that renders a leaf tool. `id` is the block to check.
 * The first returned block has id `idPrefix` and is the block under test. A container's `childIds` are the ids
 * of the returned blocks whose `parent` equals the `parentId` passed in, in order. A block with no `parent`
 * belongs at the document root (the table of contents' heading), wherever the leaf sits.
 */
export interface LeafFixture { tool: string; blocks: (parentId: string | null, idPrefix: string) => OutputData['blocks']; }

/** A container that can hold child blocks: returns its own blocks given the ids of the children to put inside, and the id of the block whose holder visually owns them. */
export interface ContainerFixture { tool: string; blocks: (idPrefix: string, childIds: string[]) => OutputData['blocks']; childParentId: (idPrefix: string) => string; }

// Tiny media generated with ffmpeg, inlined so nothing loads from the network.
/** 160x90 solid blue PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAACXBIWXMAAAABAAAAAQBPJcTWAAAA60lEQVR4nO3RAQkAIBDAwM9lOzsbwBQijIMLMNisfQib7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwEPmblDZZWJ3gAAAABJRU5ErkJggg==';

/** 160x90 solid green VP8 WebM, one frame. */
const WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIWPBrKW6e0t+cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4JCwgaC6gVqagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3PWY8CLY8WIWPBrKW6e0t9nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1zueBAKPJgQAAgHAFAJ0BKqAAWgADhwiFhYiZhIgTAgJ08kDoLGqpNdxDqqTXcQ6qk13EOqpNdxDqqTXcQ6YA/ruzk/S9/+LQ/t5/wa2lABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=';

/** 0.1 s, 440 Hz, 8 kHz mono 8-bit WAV. */
const WAV = 'data:audio/wav;base64,UklGRmYDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgATElTVBoAAABJTkZPSVNGVA0AAABMYXZmNjEuNy4xMDAAAGRhdGEgAwAAgIWKjY+PjoqFgHt2cnBwcXV5foSJjY+PjouGgXx3c3BwcXR4fYOIjI+PjoyHgn13c3BwcHN3fYKHi46Pj4yIg314dHFwcHN3fIGGi46Pj42JhH55dXFwcHJ2e4CFio6Pj42KhYB6dXJwcHF1en+EiY2Pj46KhoF7dnJwcHF0eX6DiIyPj46Lh4J8d3NwcHF0eH2CiIyPj4+MiIN9eHRxcHBzd3yCh4uOj4+MiIN+eXRxcHBydnuBhoqOj4+NiYR/enVxcHBydXp/hYqNj4+OioWAe3ZycHBxdXl+hImNj4+Oi4aBfHdzcHBxdHh9g4iMj4+OjIeCfXdzcHBwc3d9goeLjo+PjIiDfXh0cXBwc3d8gYaLjo+PjYmEfnl1cXBwcnZ7gIWKjo+PjYqFgHp1cnBwcXV6f4SJjY+PjoqGgXt2cnBwcXR5foOIjI+PjouHgnx3c3BwcXR4fYKIjI+Pj4yIg314dHFwcHN3fIKHi46Pj4yIg355dHFwcHJ2e4GGio6Pj42JhH96dXFwcHJ1en+Fio2Pj46KhYB7dnJwcHF1eX6EiY2Pj46LhoF8d3NwcHF0eH2DiIyPj46Mh4J9d3NwcHBzd32Ch4uOj4+MiIN9eHRxcHBzd3yBhouOj4+NiYR+eXVxcHBydnuAhYqOj4+NioWAenVycHBxdXp/hImNj4+OioaBe3ZycHBxdHl+g4iMj4+Oi4eCfHdzcHBxdHh9goiMj4+PjIiDfXh0cXBwc3d8goeLjo+PjIiDfnl0cXBwcnZ7gYaKjo+PjYmEf3p1cXBwcnV6f4WKjY+PjoqFgHt2cnBwcXV5foSJjY+PjouGgXx3c3BwcXR4fYOIjI+PjoyHgn13c3BwcHN3fYKHi46Pj4yIg314dHFwcHN3fIGGi46Pj42JhH55dXFwcHJ2e4CFio6Pj42KhYB6dXJwcHF1en+EiY2Pj46KhoF7dnJwcHF0eX6DiIyPj46Lh4J8d3NwcHF0eH2CiIyPj4+MiIN9eHRxcHBzd3yCh4uOj4+MiIN+eXRxcHBydnuBhoqOj4+NiYR/enVxcHBydXo=';

/** Saved peaks skip decoding and draw the waveform at once. Values are 0..1. */
const PEAKS = [0.2, 0.5, 0.9, 0.6, 0.3, 0.7, 1, 0.4, 0.25, 0.55, 0.8, 0.35];

/** Puts `parent` on a top-level block only when it sits inside a container. */
const top = (block: Block, parentId: string | null): Block => (parentId === null ? block : { ...block, parent: parentId });

const leaf = (tool: string, data: Block['data']): LeafFixture => ({
  tool,
  blocks: (parentId, idPrefix) => [top({ id: idPrefix, type: tool, data }, parentId)],
});

export const LEAF_FIXTURES: LeafFixture[] = [
  leaf('paragraph', { text: 'A plain paragraph line' }),
  leaf('header', { text: 'A level two heading', level: 2 }),
  leaf('list', { text: 'A bulleted item', style: 'unordered' }),
  {
    tool: 'table',
    blocks: (parentId, idPrefix) => [top({
      id: idPrefix,
      type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] },
    }, parentId)],
  },
  {
    tool: 'toggle',
    blocks: (parentId, idPrefix) => [
      top({ id: idPrefix, type: 'toggle', data: { text: 'An open toggle', isOpen: true }, content: [`${idPrefix}-p`] }, parentId),
      { id: `${idPrefix}-p`, type: 'paragraph', data: { text: 'Inside the toggle' }, parent: idPrefix },
    ],
  },
  {
    tool: 'callout',
    blocks: (parentId, idPrefix) => [
      top({ id: idPrefix, type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: [`${idPrefix}-p`] }, parentId),
      { id: `${idPrefix}-p`, type: 'paragraph', data: { text: 'Inside the callout' }, parent: idPrefix },
    ],
  },
  {
    tool: 'database',
    blocks: (parentId, idPrefix) => [
      top({
        id: idPrefix,
        type: 'database',
        data: {
          title: 'Tasks',
          schema: [{ id: `${idPrefix}-name`, name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: `${idPrefix}-v`, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: `${idPrefix}-v`,
        },
        content: [`${idPrefix}-r1`, `${idPrefix}-r2`],
      }, parentId),
      { id: `${idPrefix}-r1`, type: 'database-row', parent: idPrefix, data: { position: 'a0', properties: { [`${idPrefix}-name`]: 'First row' } } },
      { id: `${idPrefix}-r2`, type: 'database-row', parent: idPrefix, data: { position: 'a1', properties: { [`${idPrefix}-name`]: 'Second row' } } },
    ],
  },
  leaf('divider', {}),
  leaf('spacer', { height: 40 }),
  {
    // Alone, the outline shows only its empty text. Its heading stays at the root:
    // a heading inside a toggle, toggle heading or tab is folded and left out (OUTLINE_CONTAINERS).
    tool: 'table_of_contents',
    blocks: (parentId, idPrefix) => [
      top({ id: idPrefix, type: 'table_of_contents', data: {} }, parentId),
      { id: `${idPrefix}-h`, type: 'header', data: { text: 'Outlined heading', level: 2 } },
    ],
  },
  leaf('quote', { text: 'A quoted line', size: 'default' }),
  leaf('code', { code: 'const answer = 42;', language: 'javascript' }),
  leaf('image', { url: PNG, caption: 'An image' }),
  leaf('file', { url: PNG, fileName: 'report.png', mimeType: 'image/png', size: 313 }),
  leaf('audio', { url: WAV, title: 'A tone', artist: 'Blok', duration: 0.1, peaks: PEAKS }),
  leaf('video', { url: WEBM, caption: 'A video' }),
  {
    tool: 'tabs',
    blocks: (parentId, idPrefix) => [
      top({ id: idPrefix, type: 'tabs', data: {}, content: [`${idPrefix}-t`] }, parentId),
      { id: `${idPrefix}-t`, type: 'tab', data: { title: 'First tab' }, parent: idPrefix, content: [`${idPrefix}-p`] },
      { id: `${idPrefix}-p`, type: 'paragraph', data: { text: 'Inside the tab' }, parent: `${idPrefix}-t` },
    ],
  },
  // The frame is a codepen iframe: the figure renders offline, the page inside it needs the network.
  leaf('embed', { service: 'codepen', source: 'https://codepen.io/team/pen/abc123', embed: 'https://codepen.io/abc123?default-tab=result' }),
  leaf('bookmark', {
    url: 'https://example.com/article',
    title: 'An example article',
    description: 'A saved link preview that needs no fetch.',
    image: PNG,
    favicon: PNG,
    domain: 'example.com',
  }),
];

export const CONTAINER_FIXTURES: ContainerFixture[] = [
  {
    tool: 'toggle',
    blocks: (idPrefix, childIds) => [{ id: idPrefix, type: 'toggle', data: { text: 'An open toggle', isOpen: true }, content: childIds }],
    childParentId: (idPrefix) => idPrefix,
  },
  {
    tool: 'header',
    blocks: (idPrefix, childIds) => [{
      id: idPrefix,
      type: 'header',
      data: { text: 'An open toggle heading', level: 2, isToggleable: true, isOpen: true },
      content: childIds,
    }],
    childParentId: (idPrefix) => idPrefix,
  },
  {
    tool: 'callout',
    blocks: (idPrefix, childIds) => [{ id: idPrefix, type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: childIds }],
    childParentId: (idPrefix) => idPrefix,
  },
  {
    // The children go in the first column; the second gets a line so it does not show its empty state.
    tool: 'column',
    blocks: (idPrefix, childIds) => [
      { id: idPrefix, type: 'column_list', data: {}, content: [`${idPrefix}-c1`, `${idPrefix}-c2`] },
      { id: `${idPrefix}-c1`, type: 'column', data: {}, parent: idPrefix, content: childIds },
      { id: `${idPrefix}-c2`, type: 'column', data: {}, parent: idPrefix, content: [`${idPrefix}-c2p`] },
      { id: `${idPrefix}-c2p`, type: 'paragraph', data: { text: 'Second column' }, parent: `${idPrefix}-c2` },
    ],
    childParentId: (idPrefix) => `${idPrefix}-c1`,
  },
  {
    tool: 'tab',
    blocks: (idPrefix, childIds) => [
      { id: idPrefix, type: 'tabs', data: {}, content: [`${idPrefix}-t`] },
      { id: `${idPrefix}-t`, type: 'tab', data: { title: 'First tab' }, parent: idPrefix, content: childIds },
    ],
    childParentId: (idPrefix) => `${idPrefix}-t`,
  },
];

/** Tools from defaultBlockTools deliberately not in either table, each with the reason. */
export const FIXTURE_EXEMPTIONS: Record<string, string> = {
  column_list: 'Layout (`isLayout`): never a selection unit. It renders as part of the `column` container fixture.',
  'database-row': 'Layout (`isLayout`) and lives only under a database: never a selection unit. The `database` leaf renders two rows.',
  'database-comment': 'An annotation (`isAnnotation`) drawn by its database, never page content.',
};
