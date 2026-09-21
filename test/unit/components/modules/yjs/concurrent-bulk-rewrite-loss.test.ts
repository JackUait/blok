import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';
import { clean } from '../../../../../src/components/utils/sanitizer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const block = (id: string, type: string, data: Record<string, unknown>): YjsOutputBlockData => ({
  id,
  type,
  data,
});

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/**
 * Fix a store's Yjs client id, so a tie between two concurrent inserts at the
 * same position resolves the same way on every run.
 * @param store - the store to pin
 * @param clientId - the id to give it
 */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

/**
 * Two peers holding the same one-block document.
 * @param type - the block's tool name
 * @param data - the block's data
 */
const twoPeers = (type: string, data: Record<string, unknown>): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON([block('b1', type, data)]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

const valueOf = (store: DocumentStore, key: string): string =>
  ((store.toJSON()[0]?.data as Record<string, unknown> | undefined)?.[key] as string | undefined) ?? '';

/** One edit the write produced, as Yjs actually recorded it. */
interface RecordedOp {
  index: number;
  remove: number;
  insert: string;
}

/**
 * The edits ONE save produced, read off the Y.Text itself rather than
 * recomputed from the two strings. The shape IS the tier: a single
 * delete/insert pair spanning the block is the single-region answer, and a
 * keystroke anywhere inside that span loses every neighbour Yjs could anchor
 * it to. Several narrow pairs are the character or the word pass.
 * @param store - the peer performing the save
 * @param key - the mergeable text key
 * @param save - the save to measure
 */
const opsOf = (store: DocumentStore, key: string, save: () => void): RecordedOp[] => {
  const data = store.blocksMap.get('b1')?.get('data');

  if (!(data instanceof Y.Map)) {
    throw new Error('block b1 has no data map');
  }

  const text = data.get(key);

  if (!(text instanceof Y.Text)) {
    throw new Error(`data.${key} is not a Y.Text`);
  }

  const ops: RecordedOp[] = [];
  const observer = (event: Y.YTextEvent): void => {
    const walked = event.delta.reduce((index, part) => {
      if (typeof part.retain === 'number') {
        return index + part.retain;
      }

      if (typeof part.delete === 'number') {
        ops.push({ index,
          remove: part.delete,
          insert: '' });

        return index;
      }

      if (typeof part.insert === 'string') {
        ops.push({ index,
          remove: 0,
          insert: part.insert });

        return index + part.insert.length;
      }

      return index;
    }, 0);

    expect(walked).toBeGreaterThanOrEqual(0);
  };

  text.observe(observer);
  save();
  text.unobserve(observer);

  return ops;
};

/** The width of the stored span a save rewrote: first touched offset to last. */
const spanOf = (ops: RecordedOp[]): number => {
  if (ops.length === 0) {
    return 0;
  }

  const starts = ops.map((op) => op.index);
  const ends = ops.map((op) => op.index + Math.max(op.remove, op.insert.length));

  return Math.max(...ends) - Math.min(...starts);
};

/**
 * The toggle tool's `sanitize.text` allowlist, copied from
 * `src/tools/toggle/index.ts:442-459`. It has no `strong`, `s`, `u` or `span`,
 * so converting a formatted paragraph into a toggle strips those tags out of
 * the whole string.
 */
const TOGGLE_TEXT_ALLOWLIST = {
  br: true,
  a: { href: true },
  b: true,
  i: true,
  mark: { class: true,
    style: true },
  code: true,
};

/**
 * What a turn-into hands the new tool: the exported string put through the
 * target tool's allowlist. `src/components/modules/blockManager/block-mutation.ts:748-770`
 * cleans the exported string, then `replaceBlockContent` routes the carried-over
 * `text`/`code` key back through `updateBlockData`
 * (`src/components/modules/yjs/document-store.ts:867-877`), so the whole
 * re-sanitized string is diffed against what the peer is typing into.
 * @param text - the block's stored text
 * @param allowlist - the target tool's `sanitize` entry for the field
 */
const convertedText = (text: string, allowlist: Record<string, unknown> = {}): string =>
  clean(text, allowlist);

/**
 * A paragraph with `n` bold spans. `<strong>` is what the inline toolbar's bold
 * writes, and neither the code tool's allowlist (empty — `code: PLAINTEXT` is
 * dropped at the boundary, `src/components/utils/sanitizer.ts:117-127`) nor the
 * toggle's keeps it.
 * @param n - how many bold spans
 */
const boldParagraph = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<strong>bold${i}</strong> word${i}`).join(' ');

/**
 * The same, with no word breaks at all.
 * @param n - how many bold spans
 */
const boldCjkParagraph = (n: number): string =>
  Array.from({ length: n }, (_, i) => `<strong>重点${i}</strong>内容${i}。`).join('');

const SENTENCE = 'The quick brown fox jumps over the lazy dog while the sun sets slowly behind the hills. ';

/** A paragraph of ordinary prose, long enough that replacing it is a big diff. */
const PARAGRAPH = SENTENCE.repeat(6).slice(0, 520);

/**
 * A save that rewrites a whole block's mergeable text in ONE write is
 * expressed as a diff against the stored string. Past `MAX_DIFF_DISTANCE`
 * (64, `src/components/modules/yjs/document-store.ts:27`) the character pass
 * gives up; past the word pass too, `diffText` returns the single region
 * (`document-store.ts:250-255`), which deletes every character between the
 * first and the last change. A peer's concurrent keystroke inside that span
 * has no surviving neighbour left, so Yjs surfaces it at the edge.
 *
 * The gestures below are the ones that really produce such a write. Each
 * failing test states the damage FIRST; the tier each gesture lands in is
 * measured separately at the bottom of the file, off the Y.Text itself.
 */
describe('bulk text rewrites versus a peer typing', () => {
  describe('turn-into a tool whose allowlist is narrower than the block\'s markup', () => {
    it('keeps a character typed mid-paragraph when 40 bold spans are stripped', () => {
      const before = boldParagraph(40);
      const { a, b } = twoPeers('paragraph', { text: before });

      // Converting to a code block: the allowlist is empty, so every tag goes.
      a.updateBlockData('b1', 'text', convertedText(before));
      b.updateBlockData('b1', 'text', before.replace('word20', 'word20!'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('word20!');
      expect(valueOf(a, 'text').startsWith('!')).toBe(false);
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('keeps it in a CJK paragraph carrying only FOUR bold spans', () => {
      const before = boldCjkParagraph(4);
      const { a, b } = twoPeers('paragraph', { text: before });

      a.updateBlockData('b1', 'text', convertedText(before));
      b.updateBlockData('b1', 'text', before.replace('内容2', '内容2！'));

      sync(a, b);

      // A 96-character paragraph. With no word breaks the word pass tokenizes
      // the whole span to ONE word, so it can only answer as wide as the single
      // region it exists to narrow.
      expect(valueOf(a, 'text')).toContain('内容2！');
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('keeps a whole word the peer typed, in one piece and in its sentence', () => {
      const before = boldParagraph(40);
      const { a, b } = twoPeers('paragraph', { text: before });

      a.updateBlockData('b1', 'text', convertedText(before));
      b.updateBlockData('b1', 'text', before.replace('word20', 'word20 IMPORTANT'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('word20 IMPORTANT');
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('keeps it when only 20 spans are stripped — the word pass still narrows that', () => {
      const before = boldParagraph(20);
      const { a, b } = twoPeers('paragraph', { text: before });

      a.updateBlockData('b1', 'text', convertedText(before, TOGGLE_TEXT_ALLOWLIST));
      b.updateBlockData('b1', 'text', before.replace('word10', 'word10!'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('word10!');
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('keeps it for paragraph to header, where the allowlists match', () => {
      const before = boldParagraph(40);
      const { a, b } = twoPeers('paragraph', { text: before });

      a.updateBlockData('b1', 'text', convertedText(before, { strong: true }));
      b.updateBlockData('b1', 'text', before.replace('word20', 'word20!'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('word20!');
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });
  });

  describe('a paste that replaces the whole block', () => {
    it('does not prepend the peer\'s character to text pasted over a paragraph', () => {
      const { a, b } = twoPeers('paragraph', { text: PARAGRAPH });

      // `src/tools/paragraph/index.ts:452-460` — onPaste assigns the whole
      // pasted innerHTML as the block's text.
      a.updateBlockData('b1', 'text', 'Completely different replacement prose about shipping invoices. '.repeat(8));
      b.updateBlockData('b1', 'text', PARAGRAPH.replace('sun sets', 'sun sets!'));

      sync(a, b);

      expect(valueOf(a, 'text').startsWith('!')).toBe(false);
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('does not prepend it when the block pasted over holds 5000 characters', () => {
      const huge = SENTENCE.repeat(60).slice(0, 5000);
      const { a, b } = twoPeers('paragraph', { text: huge });

      a.updateBlockData('b1', 'text', 'A short replacement.');
      b.updateBlockData('b1', 'text', huge.replace('lazy dog while', 'lazy dog! while'));

      sync(a, b);

      expect(valueOf(a, 'text').startsWith('!')).toBe(false);
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('does not prepend it when a code block is pasted over', () => {
      const body = Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i});`).join('\n');
      const { a, b } = twoPeers('code', { code: body });

      // `src/tools/code/index.ts:505-522` — onPaste assigns the whole pasted
      // textContent as the block's code.
      a.updateBlockData('b1', 'code', 'print("hello")\nprint("world")');
      b.updateBlockData('b1', 'code', body.replace('compute(16);', 'compute(16);;'));

      sync(a, b);

      expect(valueOf(a, 'code').startsWith(';')).toBe(false);
      expect(valueOf(b, 'code')).toBe(valueOf(a, 'code'));
    });

    it('keeps a character typed OUTSIDE the run a ranged paste replaced', () => {
      const { a, b } = twoPeers('paragraph', { text: PARAGRAPH });

      // The ordinary inline paste is a ranged splice
      // (`src/components/modules/caret.ts:1263-1287`), so the new string
      // differs from the stored one only across the selected run.
      a.updateBlockData('b1', 'text', `Replacement prose that is entirely different here. ${PARAGRAPH.slice(260)}`);
      b.updateBlockData('b1', 'text', `${PARAGRAPH.slice(0, 400)}!${PARAGRAPH.slice(400)}`);

      sync(a, b);

      expect(valueOf(a, 'text')).toContain(`${PARAGRAPH.slice(390, 400)}!`);
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });
  });

  describe('a block that is one long run with no word breaks', () => {
    it('keeps the peer\'s character when a run of emoji is replaced', () => {
      const before = '😀😁😂🤣😃😄😅😆'.repeat(20);
      const { a, b } = twoPeers('paragraph', { text: before });

      a.updateBlockData('b1', 'text', '🙂'.repeat(160));
      b.updateBlockData('b1', 'text', `${before.slice(0, 80)}X${before.slice(80)}`);

      sync(a, b);

      expect(valueOf(a, 'text').startsWith('X')).toBe(false);
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });
  });

  describe('gestures that stay under the cap', () => {
    it('keeps the peer\'s character when a markdown "# " prefix is stripped', () => {
      // `src/components/modules/blockEvents/composers/markdownShortcuts.ts:955-977`
      // removes only the shortcut characters from the leading text node.
      const { a, b } = twoPeers('paragraph', { text: `# ${PARAGRAPH}` });

      a.updateBlockData('b1', 'text', PARAGRAPH);
      b.updateBlockData('b1', 'text', `# ${PARAGRAPH.replace('sun sets', 'sun sets!')}`);

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('sun sets!');
      expect(valueOf(b, 'text')).toBe(valueOf(a, 'text'));
    });

    it('keeps it when an inline bold shortcut wraps one phrase', () => {
      const { a, b } = twoPeers('paragraph', { text: PARAGRAPH });

      a.updateBlockData('b1', 'text', PARAGRAPH.replace('quick brown fox', '<strong>quick brown fox</strong>'));
      b.updateBlockData('b1', 'text', PARAGRAPH.replace('hills.', 'hills!'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('hills!');
      expect(valueOf(a, 'text')).toContain('<strong>quick brown fox</strong>');
    });

    it('writes nothing at all when a list item is only re-indented', () => {
      // `src/tools/list/index.ts:603-608` snapshots the SAME innerHTML back
      // into the patch; only `depth` changes.
      const { a, b } = twoPeers('list', { text: PARAGRAPH,
        style: 'unordered',
        depth: 0 });

      const ops = opsOf(a, 'text', () => {
        a.updateBlockData('b1', 'text', PARAGRAPH);
        a.updateBlockData('b1', 'depth', 1);
      });

      b.updateBlockData('b1', 'text', PARAGRAPH.replace('sun sets', 'sun sets!'));

      sync(a, b);

      expect(valueOf(a, 'text')).toContain('sun sets!');
      expect(ops).toHaveLength(0);
    });
  });

  /**
   * Which tier each gesture lands in, read off the Y.Text the save wrote. ONE
   * delete/insert pair spanning the block is the single-region answer; several
   * narrow pairs are the character or the word pass. Separate from the tests
   * above so the measurement keeps running while the damage assertions are red.
   */
  describe('measuring the tier each gesture lands in', () => {
    const opsFor = (type: string, key: string, before: string, after: string): RecordedOp[] => {
      const { a } = twoPeers(type, { [key]: before });

      return opsOf(a, key, () => {
        a.updateBlockData('b1', key, after);
      });
    };

    it('stripping 40 bold spans collapses to one region over the whole paragraph', () => {
      const before = boldParagraph(40);
      const ops = opsFor('paragraph', 'text', before, convertedText(before));

      expect(ops).toHaveLength(2);
      expect(spanOf(ops)).toBeGreaterThan(before.length - 10);
    });

    it('stripping 20 bold spans still answers in narrow regions', () => {
      const before = boldParagraph(20);
      const ops = opsFor('paragraph', 'text', before, convertedText(before, TOGGLE_TEXT_ALLOWLIST));

      expect(ops.length).toBeGreaterThan(2);
    });

    it('stripping only FOUR bold spans in CJK already collapses to one region', () => {
      const before = boldCjkParagraph(4);
      const ops = opsFor('paragraph', 'text', before, convertedText(before));

      expect(ops).toHaveLength(2);
      expect(spanOf(ops)).toBeGreaterThan(before.length - 10);
    });

    it('stripping four bold spans in Latin text stays on the character pass', () => {
      const before = boldParagraph(3);
      const ops = opsFor('paragraph', 'text', before, convertedText(before));

      expect(ops.length).toBeGreaterThan(2);
    });

    it('a paste over the whole paragraph replaces every character of it', () => {
      const ops = opsFor('paragraph', 'text', PARAGRAPH, 'Completely different replacement prose. '.repeat(8));

      expect(ops).toHaveLength(2);
      expect(spanOf(ops)).toBe(PARAGRAPH.length);
    });

    it('a paste over a code block replaces every character of it', () => {
      const body = Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i});`).join('\n');
      const ops = opsFor('code', 'code', body, 'print("hello")\nprint("world")');

      expect(ops).toHaveLength(2);
      expect(spanOf(ops)).toBe(body.length);
    });

    it('replacing a run of emoji collapses to one region', () => {
      const before = '😀😁😂🤣😃😄😅😆'.repeat(20);
      const ops = opsFor('paragraph', 'text', before, '🙂'.repeat(160));

      expect(ops).toHaveLength(2);
      expect(spanOf(ops)).toBe(before.length);
    });

    it('stripping a markdown "# " prefix is one narrow op', () => {
      const ops = opsFor('paragraph', 'text', `# ${PARAGRAPH}`, PARAGRAPH);

      expect(ops).toHaveLength(1);
      expect(spanOf(ops)).toBe(2);
    });

    it('an inline bold shortcut is a pair of narrow ops', () => {
      const ops = opsFor(
        'paragraph',
        'text',
        PARAGRAPH,
        PARAGRAPH.replace('quick brown fox', '<strong>quick brown fox</strong>')
      );

      expect(ops.length).toBeLessThanOrEqual(4);
      expect(spanOf(ops)).toBeLessThan(40);
    });

    it('a ranged paste over the first half touches only the first half', () => {
      const ops = opsFor(
        'paragraph',
        'text',
        PARAGRAPH,
        `Replacement prose that is entirely different here. ${PARAGRAPH.slice(260)}`
      );

      expect(spanOf(ops)).toBeLessThan(300);
    });
  });
});
