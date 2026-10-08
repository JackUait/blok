import { isRichText, readEmbed } from '../rich-text/guards';
import { failure, warning } from './errors';
import { applyEdits } from './json-applier';
import { looksLikeMarkdown } from './markdown-lookalike';
import { snapshotTree } from './placement-rules';
import { KNOWN_MARKS } from './rich-text-ops';

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

export class PlanState {
  public index = 0;
  public readonly edits: Edit[] = [];
  public readonly editCommand: number[] = [];
  public readonly results: unknown[] = [];
  public readonly refs: Record<string, string> = {};
  public readonly changed: ChangedSet = { created: [], updated: [], moved: [], removed: [] };
  public readonly touched = new Set<string>();
  public lastRange?: TextRangeRef;

  private readonly reserved = new Map<string, string>();
  private readonly allocated = new Set<string>();

  constructor(
    public readonly draft: DocSnapshot,
    public readonly ctx: PlannerContext,
    public readonly warnings: AgentWarning[],
    private readonly stamp: EditStamp
  ) {}

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

  public newBlockId(explicit: string | undefined, path: string): string {
    if (explicit !== undefined) {
      if (explicit === '' || this.draft.has(explicit) || this.allocated.has(explicit)) {
        this.fail('INVALID_ARGS', `Id "${explicit}" is already in use or empty. Omit id to get a fresh one.`, path);
      }
      this.allocated.add(explicit);

      return explicit;
    }

    while (true) {
      const id = this.ctx.ports.newId();

      if (id === '') {
        this.fail('INVALID_ARGS', 'The ID generator returned an empty block ID.', path);
      }
      if (this.draft.has(id) || this.reserved.has(id) || this.allocated.has(id)) {
        continue;
      }
      this.allocated.add(id);

      return id;
    }
  }

  public resolveId(value: unknown, path: string): string {
    if (typeof value !== 'string' || value === '') {
      return this.fail('INVALID_ARGS', 'Expected a block id or "$ref".', path);
    }
    if (value.startsWith('$')) {
      const ref = value.slice(1);
      const id = Object.prototype.hasOwnProperty.call(this.refs, ref) ? this.refs[ref] : undefined;

      return id !== undefined && this.draft.has(id)
        ? id
        : this.fail('BLOCK_NOT_FOUND', `Ref "${ref}" has no existing block from an earlier command.`, path, { ref });
    }

    return this.draft.has(value)
      ? value
      : this.fail('BLOCK_NOT_FOUND', `Block "${value}" does not exist. Read the document for current ids.`, path, { id: value });
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
    for (const raw of edits) {
      const edit = structuredClone(raw);

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
    options: { normalize?: boolean } = {}
  ): Record<string, unknown> {
    const tool = this.tool(type);
    const input = structuredClone(raw);

    for (const field of tool?.entry.richTextFields ?? []) {
      const value = input[field];

      if (value === undefined) {
        continue;
      }

      const literal = typeof value === 'string' && value !== '' ? [{ text: value }] : [];
      const rich = typeof value === 'string'
        ? literal
        : this.readRichInput(value, `${path}/${pointerKey(field)}`, blockId, field);

      input[field] = rich;
      if (looksLikeMarkdown(this.ctx.richText.plainText(rich))) {
        this.warn('LOOKS_LIKE_MARKDOWN', `"${field}" looks like Markdown. It was saved as literal text. Use marks for formatting, or markdown.insert to convert Markdown.`, { blockId, field });
      }
    }

    const sanitized = this.ctx.ports.sanitizeBlockData(type, structuredClone(input));

    for (const key of Object.keys(input)) {
      if (JSON.stringify(sanitized[key]) !== JSON.stringify(input[key])) {
        this.warn('SANITIZED', `"${key}" was changed by the sanitizer. Read the block to see what was kept.`, { blockId, field: key });
      }
    }

    return options.normalize === false || tool?.runtime.normalize === undefined ? sanitized : tool.runtime.normalize(sanitized);
  }

  private readRichInput(value: unknown, path: string, blockId: string, field: string): RichText {
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
    }
    if (!isRichText(value)) {
      this.fail('INVALID_ARGS', 'Expected rich-text segments.', path);
    }

    const rich: RichText = value.map(segment => {
      if (segment.marks === undefined) {
        return segment;
      }

      const unknown = Object.keys(segment.marks).filter(key => !KNOWN_MARKS.has(key) && !key.startsWith('tag:'));

      if (unknown.length === 0) {
        return segment;
      }
      this.warn('UNKNOWN_MARK_DROPPED', `Unknown mark(s) ${unknown.join(', ')} dropped. Marks: ${[...KNOWN_MARKS].join(', ')}.`, { blockId, field });

      const marks = { ...segment.marks };

      unknown.forEach(key => Reflect.deleteProperty(marks, key));

      return { ...segment, marks };
    });

    return this.ctx.richText.canonicalize(rich);
  }
}
