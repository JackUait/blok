import { describe, expect, it } from 'vitest';

import { collectHeadings } from '../../../../src/tools/table-of-contents/headings';

type Node = { tool: string; id: string; level?: number; text?: string; children?: Node[] };

const header = (id: string, level: number, text: string): Node => ({ tool: 'header', id, level, text });

/** Builds holders the way core mounts them: holder → content → tool root, children inside the holder. */
const mount = (nodes: Node[]): HTMLElement => {
  const redactor = document.createElement('div');

  redactor.setAttribute('data-blok-redactor', '');

  const build = (node: Node): HTMLElement => {
    const holder = document.createElement('div');
    const content = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    holder.setAttribute('data-blok-component', node.tool);
    holder.setAttribute('data-blok-id', node.id);
    content.setAttribute('data-blok-element-content', '');
    holder.appendChild(content);

    if (node.tool === 'header') {
      const root = document.createElement(`h${node.level ?? 1}`);

      root.setAttribute('data-blok-tool', 'header');
      root.setAttribute('data-blok-heading-level', String(node.level ?? 1));
      root.innerHTML = node.text ?? '';
      content.appendChild(root);
    } else {
      const root = document.createElement('div');

      root.setAttribute('data-blok-tool', node.tool);
      content.appendChild(root);
    }

    const slot = document.createElement('div');

    holder.appendChild(slot);
    (node.children ?? []).forEach((child) => slot.appendChild(build(child)));

    return holder;
  };

  nodes.forEach((node) => redactor.appendChild(build(node)));

  return redactor;
};

describe('collectHeadings', () => {
  it('lists top-level headings in reading order with their block id, level and plain text', () => {
    const root = mount([
      header('a', 1, 'Intro'),
      { tool: 'paragraph', id: 'p' },
      header('b', 2, 'Why <b>it</b>&nbsp;matters'),
    ]);

    expect(collectHeadings(root)).toEqual([
      { id: 'a', level: 1, text: 'Intro' },
      { id: 'b', level: 2, text: 'Why it matters' },
    ]);
  });

  it('reads headings inside columns and callouts, column by column', () => {
    const root = mount([
      {
        tool: 'column_list',
        id: 'cl',
        children: [
          { tool: 'column', id: 'c1', children: [ header('left', 2, 'Left') ] },
          { tool: 'column', id: 'c2', children: [ header('right', 2, 'Right') ] },
        ],
      },
      { tool: 'callout', id: 'co', children: [ header('note', 3, 'Note') ] },
    ]);

    expect(collectHeadings(root).map((h) => h.id)).toEqual(['left', 'right', 'note']);
  });

  it('skips headings tucked inside toggles, lists, quotes and toggle headings', () => {
    const root = mount([
      { tool: 'toggle', id: 't', children: [ header('in-toggle', 2, 'Hidden') ] },
      { tool: 'list', id: 'l', children: [ header('in-list', 2, 'Hidden') ] },
      { ...header('section', 1, 'Section'), children: [ header('in-section', 2, 'Hidden') ] },
    ]);

    expect(collectHeadings(root).map((h) => h.id)).toEqual(['section']);
  });

  it('skips a heading with no text', () => {
    const root = mount([ header('empty', 1, ' <br>'), header('full', 1, 'Full') ]);

    expect(collectHeadings(root).map((h) => h.id)).toEqual(['full']);
  });

  it('clamps an unreadable level to 1', () => {
    const root = mount([ header('a', 1, 'A') ]);

    root.querySelector('[data-blok-tool="header"]')?.setAttribute('data-blok-heading-level', 'x');

    expect(collectHeadings(root)[0].level).toBe(1);
  });

  it('ignores headings outside the root it was given', () => {
    const root = mount([ header('mine', 1, 'Mine') ]);
    const other = mount([ header('theirs', 1, 'Theirs') ]);

    document.body.append(root, other);

    expect(collectHeadings(root).map((h) => h.id)).toEqual(['mine']);

    root.remove();
    other.remove();
  });
});
