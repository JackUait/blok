import type { LooseOutputBlockData } from '../../types';

export type UpdateKind = 'added' | 'removed' | 'changed' | 'moved';

/** One block of a `/history/changes` row. */
export interface UpdateBlock {
  id: string;
  type: string | null;
  kind: UpdateKind;
  before?: LooseOutputBlockData;
  after?: LooseOutputBlockData;
}

/** One `/history/changes` row. */
export interface UpdateRecord {
  sequence: number;
  committedAt: number | null;
  actor: string | null;
  blocks: UpdateBlock[];
  /** `title`, `icon`, or `values.<key>`. */
  page?: string[];
}

/** One record and the version it was read from. */
export interface UpdateRow {
  lineage: string;
  /** The version the record belongs to. Records of different versions never fold. */
  sequence: number;
  truncated?: boolean;
  record: UpdateRecord;
}

export interface FoldedUpdate extends UpdateRow {
  truncated: boolean;
  /** `<lineage>:<sequence of the newest folded record>`: the version after this update. */
  key: string;
  /** Every block the entry still touches, oldest first. */
  blockIds: string[];
}

export interface FoldUpdatesOptions {
  /** Neighbours closer than this fold. Default 2 minutes. */
  gapMs?: number;
}

const DEFAULT_GAP = 2 * 60_000;

const joins = (newer: UpdateRow, older: UpdateRow, gapMs: number): boolean =>
  newer.lineage === older.lineage
  && newer.sequence === older.sequence
  && newer.record.actor !== null
  && newer.record.actor === older.record.actor
  && newer.record.committedAt !== null
  && older.record.committedAt !== null
  && Math.abs(newer.record.committedAt - older.record.committedAt) < gapMs;

/** One block over a run: `before` from the oldest record, `after` from the newest; null when added then removed. */
const combineBlock = (older: UpdateBlock, newer: UpdateBlock): UpdateBlock | null => {
  if (older.kind === 'added') {
    return newer.kind === 'removed' ? null : { id: newer.id, type: newer.type, kind: 'added', after: newer.after };
  }

  if (newer.kind === 'removed') {
    return { id: newer.id, type: newer.type, kind: 'removed', before: older.before };
  }

  const kind: UpdateKind = older.kind === 'moved' && newer.kind === 'moved' ? 'moved' : 'changed';

  return { id: newer.id, type: newer.type, kind, before: older.before, after: newer.after };
};

/** Records of a run, oldest first, as one record dated by the newest. */
const combineRecords = (run: UpdateRecord[]): UpdateRecord => {
  const blocks = new Map<string, UpdateBlock | null>();
  const page = new Set<string>();

  run.forEach((record) => {
    record.blocks.forEach((block) => {
      const seen = blocks.get(block.id);

      blocks.set(block.id, seen === undefined || seen === null ? block : combineBlock(seen, block));
    });
    record.page?.forEach((key) => page.add(key));
  });

  const newest = run[run.length - 1];

  return {
    sequence: newest.sequence,
    committedAt: newest.committedAt,
    actor: newest.actor,
    blocks: [...blocks.values()].filter((block): block is UpdateBlock => block !== null),
    ...(page.size > 0 ? { page: [...page] } : {}),
  };
};

/** A reload writes an empty record and a repaint a tool's own tidy-up: neither says anything in a feed. */
const isVisible = ({ record }: UpdateRow): boolean => record.blocks.length > 0 || (record.page ?? []).length > 0;

const entry = (row: UpdateRow, truncated: boolean): FoldedUpdate => ({
  lineage: row.lineage,
  sequence: row.sequence,
  truncated,
  record: row.record,
  key: `${row.lineage}:${row.record.sequence}`,
  blockIds: row.record.blocks.map((block) => block.id),
});

/**
 * Folds runs of neighbouring records by one person, in one version and less
 * than `gapMs` apart, into one feed entry each. Records that change nothing
 * visible are dropped first.
 * @param rows - newest first
 * @param options - the gap
 */
export const foldUpdates = (rows: UpdateRow[], options: FoldUpdatesOptions = {}): FoldedUpdate[] => {
  const gapMs = options.gapMs ?? DEFAULT_GAP;
  const runs: UpdateRow[][] = [];

  rows.filter(isVisible).forEach((next) => {
    const run = runs[runs.length - 1];

    if (run !== undefined && joins(run[run.length - 1], next, gapMs)) {
      run.push(next);
    } else {
      runs.push([next]);
    }
  });

  return runs.map((run) => entry(
    run.length === 1 ? run[0] : { ...run[0], record: combineRecords(run.map((one) => one.record).reverse()) },
    run.some((one) => one.truncated === true)
  ));
};
