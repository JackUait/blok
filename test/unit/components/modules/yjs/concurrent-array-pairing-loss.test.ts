import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type * as Y from 'yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * A local save that only ADDS and REMOVES elements of an array-of-objects —
 * no element moves — still reaches `deepAssignYArray`'s "genuine reorder"
 * splice, which deletes every element container in the changed middle and
 * re-creates it. A peer editing a nested field of one of those elements loses
 * that edit, even though the element it edited is still there afterwards.
 *
 * Why an order-preserving write ends up there: `pairGridRows`
 * (src/components/modules/yjs/document-store.ts:1859-1867, the positional
 * remainder pass) hands a genuinely NEW element the index of a doc element
 * that the similarity pass above it (:1847) had just refused with score 0.
 * That manufactured pair CROSSES the correct ones, so `isOrdered` (:1636) is
 * false and the splice at :1657-1665 runs.
 *
 * Measured over 3459 two-peer scenarios (3- and 4-element arrays, every
 * ordered selection of the elements, an insertion at every position, with and
 * without a local edit of another element): 2791 lose the peer's write. Of the
 * 239 scenarios whose local write preserves element order AND reaches the
 * pairing (array length changed), 43 of 83 that took the splice branch lose
 * it; the ordered-pairing branch lost 0 of 124.
 */
describe('concurrent array element pairing', () => {
  let store: DocumentStore;
  let peer: DocumentStore;

  type Row = { label: string; body: { key: string; text: string } };

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const rows = (count: number): Row[] =>
    Array.from({ length: count }, (_, index) => ({
      label: `row ${index}`,
      body: { key: `k${index}`, text: `text ${index}` },
    }));

  const NEW_ROW: Row = { label: 'row new', body: { key: 'kNEW', text: 'text new' } };

  /** Seed `store` with `base`, bring `peer` up to it, and hand both back. */
  const seed = (base: Row[]): void => {
    store.addBlock({ id: 'grid1', type: 'table', data: { rows: clone(base) } });
    peer.applyRemoteUpdate(store.encodeStateAsUpdate(peer.getStateVector()));
  };

  /** The peer types into ONE element's nested container, and saves. */
  const peerEdits = (base: Row[], index: number): void => {
    const saved = clone(base);

    saved[index].body.text = 'PEER TYPED THIS';
    peer.updateBlockData('grid1', 'rows', saved);
  };

  const exchange = (): void => {
    const fromStore = store.encodeStateAsUpdate(peer.getStateVector());
    const fromPeer = peer.encodeStateAsUpdate(store.getStateVector());

    peer.applyRemoteUpdate(fromStore);
    store.applyRemoteUpdate(fromPeer);
  };

  const textOf = (source: DocumentStore, key: string): string | undefined => {
    const saved = source.toJSON().find(block => block.id === 'grid1')?.data.rows as Row[] | undefined;

    return saved?.find(row => row.body?.key === key)?.body?.text;
  };

  const yRows = (source: DocumentStore): Y.Array<unknown> =>
    ((source.getBlockById('grid1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('rows') as Y.Array<unknown>;

  beforeEach(() => {
    store = new DocumentStore(new YBlockSerializer());
    peer = new DocumentStore(new YBlockSerializer());
  });

  afterEach(() => {
    store.destroy();
    peer.destroy();
  });

  it('keeps a peer edit when the local save drops two rows and adds one at the front', () => {
    const base = rows(3);

    seed(base);
    peerEdits(base, 0);

    // Local save: rows 1 and 2 gone, a new row added at the front. Row 0 keeps
    // its place relative to everything else that survives — nothing moved.
    store.updateBlockData('grid1', 'rows', [clone(NEW_ROW), clone(base[0])]);

    exchange();

    expect(textOf(store, 'k0')).toBe('PEER TYPED THIS');
    expect(textOf(peer, 'k0')).toBe('PEER TYPED THIS');
    expect(store.toJSON().find(block => block.id === 'grid1')?.data.rows).toHaveLength(2);
  });

  it('keeps a peer edit when the local save drops two rows and adds one at the end', () => {
    const base = rows(3);

    seed(base);
    peerEdits(base, 2);

    store.updateBlockData('grid1', 'rows', [clone(base[2]), clone(NEW_ROW)]);

    exchange();

    expect(textOf(store, 'k2')).toBe('PEER TYPED THIS');
    expect(textOf(peer, 'k2')).toBe('PEER TYPED THIS');
  });

  it('keeps a peer edit when the local save drops the last two of four rows and adds one', () => {
    const base = rows(4);

    seed(base);
    peerEdits(base, 1);

    store.updateBlockData('grid1', 'rows', [clone(NEW_ROW), clone(base[0]), clone(base[1])]);

    exchange();

    expect(textOf(store, 'k1')).toBe('PEER TYPED THIS');
    expect(textOf(peer, 'k1')).toBe('PEER TYPED THIS');
  });

  it('keeps the Y container of a row that survives an add-and-remove save', () => {
    const base = rows(3);

    seed(base);

    const survivor = yRows(store).get(0);

    store.updateBlockData('grid1', 'rows', [clone(NEW_ROW), clone(base[0])]);

    // The whole element is re-created, which is why the peer's nested write
    // above goes with it — this is not a mis-pairing, it is a splice.
    expect(yRows(store).toArray()).toContain(survivor);
  });

  /**
   * The counter-case to all four above, and the reason pass 4 may not simply
   * stand down when the leftover counts differ: here the rank pair is the
   * RIGHT one. One element is edited in place and another appended, so the
   * similarity pass scores the edited element 0 against its own doc container
   * — their only shared key is the one that changed — and refuses it. Pairing
   * it by rank crosses nothing, and it is what keeps the container the peer is
   * writing into.
   *
   * Ported from the .NET converter's
   * `AnUnequalArrayMiddleKeepsTheContainerThatSurvives`, the lockstep
   * counterpart of this walk.
   */
  it('keeps a peer write on an element the local save edited in place while appending another', () => {
    type Cell = { a: string; b?: string };

    const base: Cell[] = [{ a: '1' }, { a: '2' }, { a: '3' }];

    store.addBlock({ id: 'grid1',
      type: 'table',
      data: { rows: clone(base) } });
    peer.applyRemoteUpdate(store.encodeStateAsUpdate(peer.getStateVector()));

    peer.updateBlockData('grid1', 'rows', [{ a: '1' }, { a: '2' }, { a: '3',
      b: 'peer' }]);
    store.updateBlockData('grid1', 'rows', [{ a: '1' }, { a: '2' }, { a: '3x' }, { a: '4' }]);

    exchange();

    const cells = store.toJSON().find(block => block.id === 'grid1')?.data.rows as Cell[];

    expect(cells.find(cell => cell.a === '3x')?.b).toBe('peer');
    expect(cells.map(cell => cell.a)).toEqual(['1', '2', '3x', '4']);
  });

  // Control: the same write WITHOUT the deletions pairs cleanly and keeps the
  // peer's edit, so the loss above is the pairing, not the insertion.
  it('control — a plain front insertion keeps the peer edit', () => {
    const base = rows(3);

    seed(base);
    peerEdits(base, 0);

    store.updateBlockData('grid1', 'rows', [clone(NEW_ROW), ...clone(base)]);

    exchange();

    expect(textOf(store, 'k0')).toBe('PEER TYPED THIS');
    expect(textOf(peer, 'k0')).toBe('PEER TYPED THIS');
  });
});
