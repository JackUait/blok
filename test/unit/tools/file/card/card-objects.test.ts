import { describe, it, expect } from 'vitest';
import { buildCardObject, titleOf, type CardContent } from '../../../../../src/tools/file/card/card-objects';

const build = (content: CardContent): ReturnType<typeof buildCardObject> => buildCardObject(content);
const q = (root: HTMLElement, role: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-role="${role}"]`);
const cell = (text: string, value: number | null = null): { text: string; value: number | null } => ({ text, value });

describe('titleOf', () => {
  it('turns a file name into a title: no extension, dashes as spaces, first letter up', () => {
    expect(titleOf('interview-take_2.mp3')).toBe('Interview take 2');
  });

  it('keeps a name that has no extension', () => {
    expect(titleOf('LICENSE')).toBe('LICENSE');
  });

  it('never returns an empty title', () => {
    expect(titleOf('.env')).toBe('.env');
  });
});

describe('buildCardObject', () => {
  it('marks the stage as decoration that takes no focus or clicks', () => {
    const { stage } = build({ kind: 'text', text: 'hello' });

    expect(stage.getAttribute('aria-hidden')).toBe('true');
    expect(stage.hasAttribute('inert')).toBe(true);
    expect(stage.getAttribute('data-file-object')).toBe('text');
  });

  it('draws a PDF as a pile: the page on top, two sheets under it, and a page mark', () => {
    const page = document.createElement('canvas');
    const { stage, top, unders } = build({ kind: 'pdf', page, pages: 14 });

    expect(unders).toHaveLength(2);
    expect(top.contains(page)).toBe(true);
    expect(q(stage, 'file-object-pages')?.textContent).toBe('1 / 14');
    expect(q(stage, 'file-object-pages')?.getAttribute('dir')).toBe('ltr');
  });

  it('draws a Word file as its first page with one sheet under it', () => {
    const page = document.createElement('section');
    const { top, unders } = build({ kind: 'document', page, pageWidth: 816 });

    expect(unders).toHaveLength(1);
    expect(top.contains(page)).toBe(true);
  });

  it('shrinks a Word page to the width of the sheet', () => {
    const page = document.createElement('section');
    build({ kind: 'document', page, pageWidth: 720 });

    // The sheet is 180px wide.
    expect(page.parentElement?.style.getPropertyValue('--blok-file-fit')).toBe('0.25');
  });

  it('zooms a Word page past its margins, so the text is larger', () => {
    const page = document.createElement('section');
    build({ kind: 'document', page, pageWidth: 816, margins: { top: 96, start: 96, end: 96 } });
    const frame = page.parentElement;

    // 156px of sheet for 624px of text.
    expect(frame?.style.getPropertyValue('--blok-file-fit')).toBe('0.25');
    expect(frame?.style.getPropertyValue('--blok-file-fit-x')).toBe('-12.00px');
    expect(frame?.style.getPropertyValue('--blok-file-fit-y')).toBe('-14.00px');
  });

  it('draws plain text as one sheet with nothing under it', () => {
    const { stage, unders } = build({ kind: 'text', text: 'first\nsecond' });

    expect(unders).toHaveLength(0);
    expect(q(stage, 'file-object-text')?.textContent).toBe('first\nsecond');
  });

  it('draws Markdown rendered, without pictures or anything that loads', () => {
    const { stage } = build({
      kind: 'markdown',
      html: '<h1>README</h1><p>Hi <img src="https://x/y.png"> <a href="https://x">link</a></p><script>1</script><iframe src="https://x"></iframe>',
    });
    const md = q(stage, 'file-object-markdown');

    expect(md?.querySelector('h1')?.textContent).toBe('README');
    expect(md?.querySelector('img, script, iframe')).toBeNull();
    expect(md?.querySelector('a')?.textContent).toBe('link');
  });

  describe('spreadsheet', () => {
    const rows = [
      [cell('Quarter'), cell('Revenue'), cell('Costs'), cell('Margin'), cell('Notes')],
      [cell('Q1 2026'), cell('412,300', 412300), cell('268,900', 268900), cell('34.8%', 0.348), cell('ok')],
      [cell('Q2 2026'), cell('438,750', 438750)],
    ];

    it('shows the real cells: four columns at most, with row numbers', () => {
      const { stage } = build({ kind: 'spreadsheet', rows });
      const table = q(stage, 'file-object-table');
      const texts = Array.from(table?.children ?? []).map((node) => node.textContent);

      expect(texts.slice(0, 5)).toEqual(['1', 'Quarter', 'Revenue', 'Costs', 'Margin']);
      expect(texts.slice(5, 10)).toEqual(['2', 'Q1 2026', '412,300', '268,900', '34.8%']);
      // A short row is padded, so the grid stays aligned.
      expect(texts.slice(10, 15)).toEqual(['3', 'Q2 2026', '438,750', '', '']);
    });

    it('marks the header row and aligns numbers to the end', () => {
      const { stage } = build({ kind: 'spreadsheet', rows });
      const cells = Array.from(q(stage, 'file-object-table')?.children ?? []);

      expect(cells[1].getAttribute('data-cell')).toBe('head');
      expect(cells[7].getAttribute('data-cell')).toBe('number');
      expect(cells[6].getAttribute('data-cell')).toBe('text');
    });

    it('has a selected cell, two sheets under it, and reports its columns', () => {
      const { stage, unders, columns } = build({ kind: 'spreadsheet', rows });

      expect(q(stage, 'file-object-selection')).not.toBeNull();
      expect(unders).toHaveLength(2);
      expect(columns).toBe(4);
    });

    it('reports fewer columns for a narrow sheet, and draws no selection on a one-row sheet', () => {
      const { stage, columns } = build({ kind: 'spreadsheet', rows: [[cell('a'), cell('b')]] });

      expect(columns).toBe(2);
      expect(q(stage, 'file-object-selection')).toBeNull();
    });

    it('gives the cells and the selection one direction, taken from the sheet\'s own text', () => {
      const { stage } = build({ kind: 'spreadsheet', rows });
      const selection = q(stage, 'file-object-selection');

      expect(selection?.parentElement).toBe(q(stage, 'file-object-table')?.parentElement);
      expect(selection?.parentElement?.getAttribute('dir')).toBe('auto');
    });

    it('shows six rows at most', () => {
      const many = Array.from({ length: 20 }, (_, i) => [cell(`r${i}`)]);
      const { stage } = build({ kind: 'spreadsheet', rows: many });

      expect(q(stage, 'file-object-table')?.children).toHaveLength(6 * 5);
    });
  });

  it('draws slides as a landscape sheet with two under it, scaled to fit', () => {
    const slide = document.createElement('div');
    const { top, unders } = build({ kind: 'presentation', slide, width: 960, height: 540 });

    expect(unders).toHaveLength(2);
    expect(top.getAttribute('data-shape')).toBe('land');
    expect(unders.every((under) => under.getAttribute('data-shape') === 'land')).toBe(true);
    expect(slide.parentElement?.style.getPropertyValue('--blok-file-fit')).toBe('0.1875');
  });

  describe('code', () => {
    const content: CardContent = {
      kind: 'code',
      fileName: 'paste-handler.ts',
      lang: 'typescript',
      text: 'const a = 1;\nconst b = 2;\n',
      html: '<span class="token keyword">const</span> a = 1;\n<span class="token keyword">const</span> b = 2;\n',
    };

    it('is an editor tab that names the file and badges its language', () => {
      const { stage, top } = build(content);
      const tab = q(stage, 'file-object-tab');

      expect(top.getAttribute('data-shape')).toBe('editor');
      expect(tab?.textContent).toBe('TSpaste-handler.ts');
      expect(tab?.querySelector('[data-lang]')?.getAttribute('data-lang')).toBe('typescript');
    });

    it('is laid out left to right in any editor direction', () => {
      expect(build(content).top.getAttribute('dir')).toBe('ltr');
    });

    it('numbers the lines the file really has', () => {
      const { stage } = build(content);

      expect(q(stage, 'file-object-line-numbers')?.textContent).toBe('1\n2');
    });

    it('shows the highlighted code', () => {
      const { stage } = build(content);
      const code = q(stage, 'file-object-code');

      expect(code?.textContent).toBe('const a = 1;\nconst b = 2;\n');
      expect(code?.querySelectorAll('.token.keyword')).toHaveLength(2);
    });

    it('shows plain code when the language has no highlighter', () => {
      const { stage } = build({ ...content, html: null, text: '<b>not markup</b>' });
      const code = q(stage, 'file-object-code');

      expect(code?.textContent).toBe('<b>not markup</b>');
      expect(code?.querySelector('b')).toBeNull();
    });

    it('badges a language it has no short name for with the extension', () => {
      const { stage } = build({ ...content, fileName: 'notes.zig', lang: 'zig' });

      expect(q(stage, 'file-object-tab')?.textContent).toBe('ZIGnotes.zig');
    });
  });

  it('draws a picture as a print with one sheet under it', () => {
    const { stage, top, unders } = build({ kind: 'image', src: 'https://cdn/photo.jpg' });

    expect(unders).toHaveLength(1);
    expect(top.getAttribute('data-shape')).toBe('print');
    expect(stage.querySelector('img')?.getAttribute('src')).toBe('https://cdn/photo.jpg');
  });

  it('draws a video as a filmstrip of its frames', () => {
    const frames = [document.createElement('canvas'), document.createElement('canvas')];
    const { stage, top, unders } = build({ kind: 'video', frames });

    expect(unders).toHaveLength(0);
    expect(top.getAttribute('data-shape')).toBe('strip');
    expect(q(stage, 'file-object-track')?.children).toHaveLength(2);
  });

  it('draws audio as a record in a sleeve that carries the title', () => {
    const { stage, top, detail } = build({ kind: 'audio', title: 'Interview take 2' });

    expect(top.getAttribute('data-shape')).toBe('vinyl');
    expect(q(stage, 'file-object-title')?.textContent).toBe('Interview take 2');
    expect(detail?.textContent).toBe('');
  });

  it('draws an archive as a folder with three sheets and a sticker', () => {
    const { stage, top, detail } = build({ kind: 'archive', title: 'Brand assets' });

    expect(top.getAttribute('data-shape')).toBe('folder');
    expect(stage.querySelectorAll('[data-role="file-object-folder-sheet"]')).toHaveLength(3);
    expect(q(stage, 'file-object-title')?.textContent).toBe('Brand assets');
    expect(detail).not.toBeNull();
  });

  describe('unknown file', () => {
    it('is a punch card of ten rows and thirty columns, headed by the file name', () => {
      const { stage, top } = build({ kind: 'generic', title: 'Backup 2026-11', bytes: null });

      expect(top.getAttribute('data-shape')).toBe('punch');
      expect(q(stage, 'file-object-holes')?.children).toHaveLength(300);
      expect(q(stage, 'file-object-punch-head')?.textContent).toMatch(/^BACKUP 2026-11 · /);
    });

    it('prints the first bytes of the file in the header once they are known', () => {
      const bytes = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
      const { stage } = build({ kind: 'generic', title: 'Backup', bytes });

      expect(q(stage, 'file-object-punch-head')?.textContent).toBe('BACKUP · 0003 0609 0C0F 1215 181B 1E21 2427');
    });

    it('punches a different card for different bytes', () => {
      const punched = (bytes: Uint8Array): string => {
        const { stage } = build({ kind: 'generic', title: 'x', bytes });

        return Array.from(q(stage, 'file-object-holes')?.children ?? []).map((node) => (node.hasAttribute('data-hole') ? '1' : '0')).join('');
      };
      const a = punched(Uint8Array.from({ length: 64 }, (_, i) => i * 7 + 1));
      const b = punched(Uint8Array.from({ length: 64 }, (_, i) => 255 - i));

      expect(a).not.toBe(b);
      expect(a).toContain('1');
    });
  });
});
