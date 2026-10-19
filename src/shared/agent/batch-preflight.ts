import { AgentFailure } from './errors';
import { failUnknownTool, withRequiredDefaults } from './plan-block';
import { PlanState, unresolvedRefMessage } from './plan-state';
import { DocSnapshot } from './snapshot';
import { dataProblem } from './write-validation';

import type { AgentProblem } from '../../../types/agent';
import type { PlannerContext } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const SPEC_KEYS = new Set(['type', 'data', 'tunes', 'id', 'children']);

/**
 * The id fields the planner always resolves, so an undeclared "$ref" in one always fails.
 * Pinned per command by batch-all-problems.test.ts. Other fields (table cells) may hold "$" text,
 * block.insert's id names the new block, and a tool action reads its own args as it likes
 * (column_list.create ignores parentId when given from): only a block action's id is certain.
 */
const idFields = (name: unknown, args: Record<string, unknown>, commands: PlannerContext['commands']): Array<[string, unknown]> => {
  const source = typeof name === 'string' ? commands.get(name)?.source : undefined;

  if (source === undefined) {
    return [];
  }
  if (typeof source === 'object') {
    return source.target === 'block' ? [['/id', args.id]] : [];
  }
  const position = args.position;
  // place() reads only "before" when both are given.
  const key = isRecord(position) && 'before' in position ? 'before' : 'after';

  return [
    ...(name === 'block.insert' ? [] : [['/id', args.id] as [string, unknown]]),
    ['/parentId', args.parentId], ['/rootId', args.rootId],
    ...(isArray(args.ids) ? args.ids.map((id, index): [string, unknown] => [`/ids/${index}`, id]) : []),
    ...(isRecord(position) ? [[`/position/${key}`, position[key]] as [string, unknown]] : []),
  ];
};

const specIds = (spec: unknown): string[] => !isRecord(spec) ? [] : [
  ...(typeof spec.id === 'string' && spec.id !== '' ? [spec.id] : []),
  ...(isArray(spec.children) ? spec.children.flatMap(specIds) : []),
];

const refProblems = (
  commands: unknown[],
  registry: PlannerContext['commands'],
  isBlock: (id: string) => boolean
): AgentProblem[] => {
  const declared: string[] = [];
  const created = new Set<string>();
  const problems: AgentProblem[] = [];
  const everyRef = new Set(commands.flatMap(raw => !isRecord(raw) ? [] : [raw.ref, isRecord(raw.args) ? raw.args.ref : undefined]));

  commands.forEach((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.args)) {
      return;
    }
    const args = raw.args;

    idFields(raw.name, args, registry).forEach(([path, value]) => {
      if (typeof value !== 'string' || !value.startsWith('$') || declared.includes(value.slice(1))) {
        return;
      }
      const ref = value.slice(1);

      // The planner reads it as block ref (PlanState.isBlockNotRef).
      if (!everyRef.has(ref) && (created.has(ref) || isBlock(ref))) {
        return;
      }
      problems.push({
        code: 'BLOCK_NOT_FOUND',
        message: unresolvedRefMessage(ref, created.has(ref) || isBlock(ref), declared),
        commandIndex: index,
        path: `/commands/${index}/args${path}`,
      });
    });
    // The envelope moves a ref written inside args next to name, so it counts as set.
    [raw.ref, args.ref].forEach(ref => {
      if (typeof ref === 'string' && !declared.includes(ref)) {
        declared.push(ref);
      }
    });
    if (raw.name === 'block.insert') {
      specIds(args).forEach(id => created.add(id));
    }
  });

  return problems;
};

/** Mirrors buildBlock's data path for one block.insert spec tree. */
const specProblems = (state: PlanState, index: number, spec: unknown, path: string): AgentProblem[] => {
  if (!isRecord(spec) || typeof spec.type !== 'string' || spec.type === '') {
    return [];
  }
  const type = spec.type;
  const tool = state.tool(type);
  const children = isArray(spec.children) ? spec.children : [];
  const nested = (): AgentProblem[] => children.flatMap((child, at) =>
    specProblems(state, index, child, `${path}/children/${at}`));
  const guarded = (run: () => AgentProblem[]): AgentProblem[] => {
    try {
      return run();
    } catch (error) {
      if (error instanceof AgentFailure) {
        return [error.error];
      }
      throw error;
    }
  };

  if (tool === undefined) {
    return guarded(() => failUnknownTool(state, type, `${path}/type`));
  }
  // Host-prepared data joins the spec later, so its final shape is unknown here.
  if ((tool.entry.insertRequires?.length ?? 0) > 0) {
    return [];
  }
  const data = spec.data === undefined ? tool.entry.defaultData ?? {} : spec.data;
  const id = typeof spec.id === 'string' && spec.id !== '' ? spec.id : undefined;
  const own = !isRecord(data) ? [] : guarded(() => {
    const problem = dataProblem(state, index, {
      subject: id === undefined ? `The new "${type}" block` : `Block "${id}"`,
      type, path: `/commands/${index}/args${path}/data`, ...(id !== undefined && { blockId: id }),
    }, state.prepareData(type, withRequiredDefaults(tool, data), `${path}/data`, id ?? ''));

    return problem === undefined ? [] : [problem];
  });

  return [...own, ...nested()];
};

const insertProblems = (commands: unknown[], state: PlanState): AgentProblem[] => commands.flatMap((raw, index) => {
  if (!isRecord(raw) || raw.name !== 'block.insert' || !isRecord(raw.args) || raw.args.demote === true) {
    return [];
  }
  const spec = Object.fromEntries(Object.entries(raw.args).filter(([key]) => SPEC_KEYS.has(key)));
  const tool = typeof spec.type === 'string' ? state.tool(spec.type) : undefined;

  // planInsert refuses these and points at <type>.create instead.
  if (tool?.entry.children.ownedByTool === true && tool.runtime.defaultChildren === undefined
    && state.ctx.commands.has(`${String(spec.type)}.create`)) {
    return [];
  }
  state.setCommandIndex(index);

  return specProblems(state, index, spec, '');
});

/**
 * Problems a batch has no matter how its earlier commands go: an undeclared "$ref" in an id field,
 * and block.insert data the tool schema refuses. Read from the raw batch, so it also runs after the
 * envelope failed.
 */
export const preflightProblems = (
  batch: unknown,
  ctx: Omit<PlannerContext, 'prepared'>,
  snapshot: () => DocSnapshot
): AgentProblem[] => {
  if (!isRecord(batch) || !isArray(batch.commands)) {
    return [];
  }
  // Read the document only for a ref hint: a failed batch otherwise leaves the applier untouched.
  const read: { doc?: DocSnapshot } = {};
  const isBlock = (id: string): boolean => (read.doc ??= snapshot()).has(id);
  // prepareData and the unknown-tool hint read only the context, never the draft.
  const state = new PlanState(DocSnapshot.fromOutput({ blocks: [] }), { ...ctx, prepared: new Map() }, [], { actorId: '', at: 0 });

  return [...refProblems(batch.commands, ctx.commands, isBlock), ...insertProblems(batch.commands, state)];
};
