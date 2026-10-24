import { isRichText, readEmbed } from '../rich-text/guards';
import { failure, warning } from './errors';
import { applyEdits } from './json-applier';
import { RICH_TEXT_MARKS } from '../tool-descriptions/rich-text';
import { looksLikeMarkdown } from './markdown-lookalike';
import { defaultLinkResolver, dropLinkOnPageMention, normalizeAgentMarks } from './mark-input';
import { snapshotTree } from './placement-rules';
import { KNOWN_MARKS } from './rich-text-ops';
import { cloneRecord, copyValue } from './snapshot';

import type { AgentErrorCode, AgentWarning, AgentWarningCode, ChangedSet, Edit, PlannedBlock, TextRangeRef } from '../../../types/agent';
import type { RichText } from '../../../types/rich-text';
import type { EditStamp } from './json-applier';
import type { PlacementTree } from './placement-rules';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerContext, PlannerTool } from './types';

export const PREPARE_PENDING: unique symbol = Symbol('prepare-pending');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
const nameOf = (parentId: string | null): string => parentId === null ? 'the root' : `"${parentId}"`;
const subtreeIds = (block: PlannedBlock): string[] =>
  [block.id, ...block.children.flatMap(subtreeIds)];

/** The explicit ids a block.insert spec tree gives its new blocks. */
export const insertSpecIds = (spec: unknown): string[] => !isRecord(spec) ? [] : [
  ...(typeof spec.id === 'string' && spec.id !== '' ? [spec.id] : []),
  ...(isArray(spec.children) ? spec.children.flatMap(insertSpecIds) : []),
];

/** Why "$ref" resolves to nothing: `isBlock` when a block has that id, `known` the refs set so far. */
export const unresolvedRefMessage = (ref: string, isBlock: boolean, known: readonly string[]): string => {
  if (isBlock) {
    return `"$${ref}" is not a ref. To mean the existing block "${ref}", write "${ref}" without the "$". To mean a block this batch creates, give that command "ref": "${ref}".`;
  }

  const example = /^[A-Za-z][\w-]*$/.test(ref) ? ref : (known[0] ?? 'intro');
  const listed = known.length === 0 ? '' : ` Refs so far: ${known.map(name => `"$${name}"`).join(', ')}.`;

  return `Ref "${ref}" was not set by an earlier command in this batch.${listed}`
    + ` Give the command that creates a block "ref": "${example}", then later commands use "$${example}".`
    + ' A ref lasts one batch; a later batch uses the ids in the result\'s refs.';
};

export class PlanState {
  public index = 0;
  public readonly edits: Edit[] = [];
  public readonly editCommand: number[] = [];
  public readonly results: unknown[] = [];
  public readonly refs: Record<string, string> = {};
  public readonly changed: ChangedSet = { created: [], updated: [], moved: [], removed: [] };
  public readonly touched = new Set<string>();
  /** Plain ids that some command in the batch names as parentId. */
  public readonly filledParents = new Set<string>();
  /** Every ref the batch sets, later commands included. */
  public readonly batchRefs = new Set<string>();
  /** Explicit ids the batch's block.insert specs give new blocks. */
  public readonly batchIds = new Set<string>();
  public lastRange?: TextRangeRef;

  private readonly reserved = new Map<string, string>();
  private copyingStored = false;
  private readonly allocated = new Set<string>();

  constructor(
    public readonly draft: DocSnapshot,
    public readonly ctx: PlannerContext,
    public readonly warnings: AgentWarning[],
    private readonly stamp: EditStamp
  ) {}

  /** Runs `build` with every rich field read as stored: block.duplicate copies stored blocks. */
  public copyStored<T>(build: () => T): T {
    const previous = this.copyingStored;

    this.copyingStored = true;
    try {
      return build();
    } finally {
      this.copyingStored = previous;
    }
  }

  public setCommandIndex(index: number): void {
    this.index = index;
  }

  public tool(type: string): PlannerTool | undefined {
    return this.ctx.tools.get(type);
  }

  public actionsOf(tool: string): string[] {
    return [...this.ctx.commands.values()]
      .filter(entry => typeof entry.source === 'object' && entry.source.tool === tool)
      .map(entry => entry.name)
      .sort();
  }

  public fail(code: AgentErrorCode, message: string, path = '', details?: Record<string, unknown>): never {
    throw failure(code, message, {
      commandIndex: this.index,
      path: `/commands/${this.index}/args${path}`,
      ...(details !== undefined && { details }),
    });
  }

  public warn(code: AgentWarningCode, message: string, extra: { blockId?: string; field?: string } = {}): void {
    this.warnings.push(warning(code, message, { commandIndex: this.index, ...extra }));
  }

  public reserveId(id: string, path: string): void {
    const slot = `/commands/${this.index}/args${path}`;
    const reservedAt = this.reserved.get(id);

    // Reservation passes may revisit the same input slot.
    if (this.draft.has(id) || this.allocated.has(id) || (reservedAt !== undefined && reservedAt !== slot)) {
      this.fail('INVALID_ARGS', `Id "${id}" is already in use. Omit id to get a fresh one.`, path);
    }
    this.reserved.set(id, slot);
  }

  /** Frees an id reserved by reserveFreshId so one explicit block spec can claim it. */
  public releaseReservation(id: string): void {
    if (!this.allocated.has(id) && !this.draft.has(id)) {
      this.reserved.delete(id);
    }
  }

  public newBlockId(explicit: string | undefined, path: string): string {
    if (explicit !== undefined) {
      if (explicit === '' || this.draft.has(explicit) || this.allocated.has(explicit)) {
        this.fail('INVALID_ARGS', `Id "${explicit}" is already in use or empty. Omit id to get a fresh one.`, path);
      }
      this.allocated.add(explicit);

      return explicit;
    }

    const id = this.reserveFreshId(path);

    this.allocated.add(id);

    return id;
  }

  // The builder claims these IDs after copy references are remapped.
  public reserveFreshId(path: string): string {
    while (true) {
      const id = this.ctx.ports.newId();

      if (id === '') {
        this.fail('INVALID_ARGS', 'The ID generator returned an empty block ID.', path);
      }
      if (this.draft.has(id) || this.reserved.has(id) || this.allocated.has(id)) {
        continue;
      }
      this.reserveId(id, path);

      return id;
    }
  }

  public resolveId(value: unknown, path: string): string {
    if (typeof value !== 'string' || value === '') {
      return this.fail('INVALID_ARGS', 'Expected a block id, or "$" plus a ref an earlier command set.', path);
    }
    if (value.startsWith('$')) {
      const ref = value.slice(1);
      const id = Object.prototype.hasOwnProperty.call(this.refs, ref) ? this.refs[ref] : undefined;

      if (id !== undefined && this.draft.has(id)) {
        return id;
      }
      if (this.isBlockNotRef(ref)) {
        this.correctRef(ref);

        return ref;
      }

      return this.fail('BLOCK_NOT_FOUND', this.unresolvedRefMessage(ref), path, { ref });
    }

    // Agents skip comment threads (user decision 2026-10-16): one is a block they cannot see.
    return this.draft.has(value) && !this.inAnnotation(value)
      ? value
      : this.fail('BLOCK_NOT_FOUND', `Block "${value}" does not exist. Read the document for current ids.`, path, { id: value });
  }

  /**
   * "$x" with no ref x anywhere in the batch, while an earlier command made block x with that id:
   * the "$" is a slip. Never a block the batch did not make: documents use ids like "h1", and a
   * forgotten ref would land on the old block.
   */
  public isBlockNotRef(ref: string): boolean {
    return !Object.prototype.hasOwnProperty.call(this.refs, ref) && !this.batchRefs.has(ref)
      && this.batchIds.has(ref) && this.draft.has(ref) && !this.inAnnotation(ref);
  }

  private correctRef(ref: string): void {
    const message = `"$${ref}" is not a ref, but block "${ref}" exists, so it was used. Write "${ref}" without the "$".`;

    // Reservation passes resolve the same value again.
    if (!this.warnings.some(item => item.commandIndex === this.index && item.message === message)) {
      this.warn('CORRECTED', message);
    }
  }

  private unresolvedRefMessage(ref: string): string {
    return unresolvedRefMessage(ref, this.draft.has(ref) && !this.inAnnotation(ref), Object.keys(this.refs));
  }

  /** The block is not page content (a comment thread) or sits under one. */
  private inAnnotation(id: string): boolean {
    const seen = new Set<string>();
    const cursor: { id: string | null } = { id };

    while (cursor.id !== null && !seen.has(cursor.id)) {
      const type = this.draft.get(cursor.id)?.type;

      if (type !== undefined && this.tool(type)?.entry.children.annotation === true) return true;
      seen.add(cursor.id);
      cursor.id = this.draft.parentOf(cursor.id);
    }

    return false;
  }

  public requireBlock(value: unknown, path: string): SnapBlock {
    const id = this.resolveId(value, path);
    const block = this.draft.get(id);

    return block ?? this.fail('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, path, { id });
  }

  public tree(): PlacementTree {
    return snapshotTree(this.draft, type => {
      const entry = this.tool(type)?.entry;

      return entry === undefined ? undefined : { ...entry.children, restrictedInTableCell: entry.restrictedInTableCell };
    });
  }

  public place(parentArg: unknown, position: unknown): { parentId: string | null; afterId: string | null } {
    const parentId = parentArg === undefined || parentArg === null ? parentArg : this.resolveId(parentArg, '/parentId');

    if (isRecord(position)) {
      const key = 'before' in position ? 'before' : 'after';
      const refId = this.resolveId(position[key], `/position/${key}`);
      const refParent = this.draft.parentOf(refId);

      if (parentId !== undefined && parentId !== refParent) {
        this.fail('PLACEMENT_REFUSED', `Block "${refId}" is not a child of ${nameOf(parentId)}. Drop parentId or pick a sibling inside it.`, '/position', { reason: 'NOT_A_CHILD' });
      }
      if (key === 'after') {
        return { parentId: refParent, afterId: refId };
      }

      const siblings = this.draft.childrenOf(refParent);
      const at = siblings.indexOf(refId);

      return { parentId: refParent, afterId: at > 0 ? siblings[at - 1] ?? null : null };
    }

    const resolved = parentId ?? null;
    const siblings = this.draft.childrenOf(resolved);

    return { parentId: resolved, afterId: position === 'start' ? null : siblings[siblings.length - 1] ?? null };
  }

  public emit(...edits: Edit[]): void {
    const clone = globalThis.structuredClone;

    for (const raw of edits) {
      const edit = typeof clone === 'function' ? clone(raw) : { ...raw };

      if (typeof clone !== 'function') {
        Object.entries(raw).forEach(([key, value]) => {
          Object.defineProperty(edit, key, { value: copyValue(value) });
        });
      }

      this.edits.push(edit);
      this.editCommand.push(this.index);
      switch (edit.op) {
        case 'insert':
          subtreeIds(edit.block).forEach(id => {
            this.changed.created.push(id);
            this.touched.add(id);
          });
          break;
        case 'remove': {
          const ids = edit.withChildren ? this.draft.subtree(edit.id) : [edit.id];

          this.changed.removed.push(...ids);
          ids.forEach(id => this.touched.delete(id));
          const lifted = edit.withChildren ? [] : this.draft.childrenOf(edit.id);

          lifted.forEach(id => {
            this.changed.moved.push(id);
            this.touched.add(id);
          });
          break;
        }
        case 'move':
          this.changed.moved.push(edit.id);
          this.touched.add(edit.id);
          break;
        case 'setPageField':
          break;
        case 'replaceType':
        case 'setData':
        case 'setRichText':
        case 'setTunes':
          this.changed.updated.push(edit.id);
          this.touched.add(edit.id);
          break;
      }
      applyEdits(this.draft, [edit], this.stamp);
    }
  }

  public prepareData(
    type: string,
    raw: Record<string, unknown>,
    path: string,
    blockId: string,
    options: { normalize?: boolean; stored?: readonly string[] } = {}
  ): Record<string, unknown> {
    const tool = this.tool(type);
    const input = cloneRecord(raw);

    for (const field of tool?.entry.richTextFields ?? []) {
      const value = input[field];

      if (value === undefined) {
        continue;
      }

      const literal = typeof value === 'string' && value !== '' ? [{ text: value }] : [];
      const rich = typeof value === 'string'
        ? literal
        : this.readRichInput(value, `${path}/${pointerKey(field)}`, blockId, field, this.copyingStored || options.stored?.includes(field) === true);

      input[field] = rich;
      if (looksLikeMarkdown(this.ctx.richText.plainText(rich))) {
        this.warn('LOOKS_LIKE_MARKDOWN', `"${field}" looks like Markdown. It was saved as literal text. Use marks for formatting, or markdown.insert to convert Markdown.`, { blockId, field });
      }
    }

    const sanitized = this.ctx.ports.sanitizeBlockData(type, cloneRecord(input));

    for (const key of Object.keys(input)) {
      if (JSON.stringify(sanitized[key]) !== JSON.stringify(input[key])) {
        this.warn('SANITIZED', `"${key}" was changed by the sanitizer. Read the block to see what was kept.`, { blockId, field: key });
      }
    }

    return options.normalize === false || tool?.runtime.normalize === undefined ? sanitized : tool.runtime.normalize(sanitized);
  }

  /**
   * A `stored` field was rebuilt from the draft, plus input already read here, or
   * by a tool's normalizer: runs the agent did not write keep their marks as stored.
   */
  private readRichInput(value: unknown, path: string, blockId: string, field: string, stored: boolean): RichText {
    if (!isArray(value)) {
      this.fail('INVALID_ARGS', `"${field}" takes plain text or rich-text segments.`, path);
    }

    for (const [index, segment] of value.entries()) {
      const at = `${path}/${index}`;

      if (!isRecord(segment) || ('text' in segment && 'embed' in segment)) {
        this.fail('INVALID_ARGS', 'Expected one text or embed segment.', at);
      }
      if (segment.marks !== undefined && !isRecord(segment.marks)) {
        this.fail('INVALID_ARGS', 'Segment marks must be a record.', `${at}/marks`);
      }
      if ('text' in segment && typeof segment.text !== 'string') {
        this.fail('INVALID_ARGS', 'Segment text must be a string.', `${at}/text`);
      }
      if ('embed' in segment && readEmbed(segment.embed) === undefined) {
        this.fail('INVALID_ARGS', 'Expected one valid HTML, equation or page embed.', `${at}/embed`);
      }
      if (!isRichText([segment])) {
        this.fail('INVALID_ARGS', 'Expected one text or embed segment with no extra fields.', at);
      }
      // The same check text.format's `set` gets from its command schema.
      const problem = stored || segment.marks === undefined ? undefined : this.ctx.validate(RICH_TEXT_MARKS, segment.marks)[0];

      if (problem !== undefined) {
        this.fail('INVALID_ARGS', `Mark ${problem.path.slice(1) || 'value'}: ${problem.message}`, `${at}/marks${problem.path}`);
      }
    }
    if (!isRichText(value)) {
      this.fail('INVALID_ARGS', 'Expected rich-text segments.', path);
    }

    const notes = new Set<string>();
    const resolveLink = this.ctx.ports.resolveLink ?? defaultLinkResolver;
    const rich: RichText = value.map(segment => {
      if (segment.marks === undefined) {
        return segment;
      }

      const unknown = Object.keys(segment.marks).filter(key => !KNOWN_MARKS.has(key) && !key.startsWith('tag:'));

      if (unknown.length > 0) {
        this.warn('UNKNOWN_MARK_DROPPED', `Unknown mark(s) ${unknown.join(', ')} dropped. Marks: ${[...KNOWN_MARKS].join(', ')}.`, { blockId, field });
      }

      const known = { ...segment.marks };

      unknown.forEach(key => Reflect.deleteProperty(known, key));

      if (stored) {
        return { ...segment, marks: known };
      }

      const normalized = normalizeAgentMarks(known, resolveLink);
      const repaired = dropLinkOnPageMention({ ...segment, marks: normalized.marks });

      [...normalized.notes, ...(repaired.note === undefined ? [] : [repaired.note])].forEach(note => notes.add(note));

      return repaired.segment;
    });

    notes.forEach(note => this.warn('CORRECTED', `"${field}": ${note}`, { blockId, field }));

    return this.ctx.richText.canonicalize(rich);
  }
}
