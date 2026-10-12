import type { InsertSpec } from '../../../types/agent';
import type { BlockPosition } from '../../../types/api/blocks';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';

const TAB = 'tab';

// English form of tools.tabs.defaultTitle ("Tab {number}"); agents write English titles.
const defaultTitle = (n: number): string => `Tab ${n}`;

export const TABS_DEFAULT_CHILDREN: InsertSpec[] = [1, 2, 3].map(n => ({ type: TAB, data: { title: defaultTitle(n) } }));

interface TabInput { title: string; icon?: string }

const target = (ctx: ToolActionContext): NonNullable<ToolActionContext['block']> =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a tabs block.');

// The tool ignores and evicts non-tab children, so counts and indices skip them.
const tabsOf = (ctx: ToolActionContext, children: readonly string[]): string[] =>
  children.filter(id => ctx.read(id)?.type === TAB);

const tabData = ({ title, icon }: TabInput): Record<string, unknown> => (icon === undefined ? { title } : { title, icon });

const create: ToolActionImpl<{ tabs?: TabInput[]; parentId?: string | null; position?: BlockPosition }, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const tabs = args.tabs ?? [1, 2, 3].map(n => ({ title: defaultTitle(n) }));

    if (tabs.length === 0) {
      ctx.fail('INVALID_ARGS', 'Pass at least one tab, or omit tabs for three default tabs.');
    }
    // children: [] keeps the planner from adding the default tabs first.
    const id = ctx.insert({ type: ctx.tool, data: {}, parentId: args.parentId, position: args.position, children: [] });

    return { id, childIds: tabs.map(tab => ctx.insert({ type: TAB, data: tabData(tab), parentId: id, children: [] })) };
  },
};

const addTab: ToolActionImpl<{ title?: string; icon?: string; at?: number }, undefined, { id: string }> = {
  run: (ctx, args) => {
    const block = target(ctx);
    const tabs = tabsOf(ctx, block.children);
    const before = args.at === undefined ? undefined : tabs[args.at];

    return {
      id: ctx.insert({
        type: TAB,
        data: tabData({ title: args.title ?? defaultTitle(tabs.length + 1), icon: args.icon }),
        parentId: block.id,
        position: before === undefined ? 'end' : { before },
        children: [],
      }),
    };
  },
};

const deleteTab: ToolActionImpl<{ tabId: string }> = {
  run: (ctx, args) => {
    const block = target(ctx);
    const tabs = tabsOf(ctx, block.children);

    if (!tabs.includes(args.tabId)) {
      ctx.fail('PRECONDITION_FAILED', `Block ${args.tabId} is not a tab of this tabs block.`);
    }
    // Matches the tool: deleting the last tab deletes the whole block.
    ctx.remove(tabs.length === 1 ? block.id : args.tabId, { withChildren: true });

    return undefined;
  },
};

export const TABS_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = { create, addTab, deleteTab };
