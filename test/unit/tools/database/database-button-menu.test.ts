import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { buttonEditItems, buttonHasError, valueChoicesFor } from '../../../../src/tools/database/database-button-menu';
import type { ButtonMenuContext } from '../../../../src/tools/database/database-button-menu';
import type { ButtonAction, ButtonSettings, PropertyDefinition, PropertySettingsV2 } from '../../../../src/tools/database/types';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
  { id: 'stage', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 'o1', label: 'Ship', position: 'a0' }] } },
  { id: 'due', name: 'Due', type: 'date', position: 'a3' },
  { id: 'owner', name: 'Owner', type: 'person', position: 'a4' },
  { id: 'calc', name: 'Calc', type: 'formula', position: 'a5', formula: { expression: '1' } },
];

const button: PropertyDefinition = { id: 'btn', name: 'Act', type: 'button', position: 'a6', button: { label: 'Go', buttonActions: [{ id: 'a1', type: 'openPage' }] } };

interface Item { name?: string; title?: string; secondaryLabel?: string; valueLabel?: string; element?: HTMLElement; isActive?: boolean | (() => boolean); onActivate?: () => void; children?: { items?: Item[] } }

const find = (items: PopoverItemParams[] | Item[] | undefined, ...path: string[]): Item | undefined => {
  let level = items as Item[] | undefined;
  let found: Item | undefined;

  for (const name of path) {
    found = level?.find((item) => item.name === name);
    level = found?.children?.items;
  }

  return found;
};

describe('button settings items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers a value per type: checked, options, today, me', () => {
    expect(valueChoicesFor(schema[1]).map((c) => c.value)).toEqual([true, false]);
    expect(valueChoicesFor(schema[2]).map((c) => c.value)).toEqual(['o1', null]);
    expect(valueChoicesFor(schema[3]).map((c) => c.value)).toEqual(['@today', null]);
    expect(valueChoicesFor(schema[4]).map((c) => c.value)).toEqual([[{ id: '@me' }], []]);
  });

  it('adds an edit-property action with a fresh id after the existing ones', () => {
    const update = vi.fn();
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: true, update });

    find(items, 'buttonAddAction', 'buttonAdd-editProperty', 'buttonAdd-editProperty-done', 'buttonValue-done-0')?.onActivate?.();

    const next = update.mock.calls[0][0] as { button: ButtonSettings };

    expect(next.button.label).toBe('Go');
    expect(next.button.buttonActions?.map((a) => a.type)).toEqual(['openPage', 'editProperty']);
    expect(next.button.buttonActions?.[1]).toMatchObject({ type: 'editProperty', propertyId: 'done', value: true });
    expect(next.button.buttonActions?.[1].id).not.toBe('a1');
  });

  it('never offers a computed property or the button itself as an edit target', () => {
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => [...schema, button], hasHostActions: false, update: vi.fn() });
    const targets = find(items, 'buttonAddAction', 'buttonAdd-editProperty')?.children?.items?.map((i) => i.name);

    expect(targets).toEqual(['buttonAdd-editProperty-title', 'buttonAdd-editProperty-done', 'buttonAdd-editProperty-stage', 'buttonAdd-editProperty-due', 'buttonAdd-editProperty-owner']);
  });

  it('removes an action', () => {
    const update = vi.fn();
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: false, update });

    find(items, 'buttonAction-a1', 'buttonAction-a1-remove')?.onActivate?.();

    expect(update).toHaveBeenCalledWith({ button: { label: 'Go', buttonActions: [] } });
  });

  it('offers the host action only when the host listens', () => {
    const withHost = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: true, update: vi.fn() });
    const without = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: false, update: vi.fn() });

    expect(find(withHost, 'buttonAddAction', 'buttonAdd-callback')).toBeDefined();
    expect(find(without, 'buttonAddAction', 'buttonAdd-callback')).toBeUndefined();
  });
});

const OTHER: PropertyDefinition[] = [
  { id: 'ot', name: 'Task', type: 'title', position: 'a0' },
  { id: 'flag', name: 'Flag', type: 'checkbox', position: 'a1' },
];

type Update = Mock<(patch: Partial<PropertySettingsV2>) => void>;

const ctxOf = (actions: ButtonAction[], extra: Partial<Omit<ButtonMenuContext, 'update'>> = {}): ButtonMenuContext & { update: Update } => ({
  i18n: { t: (k: string, vars?: Record<string, unknown>) => (vars === undefined ? k : `${k} ${JSON.stringify(vars)}`) },
  schema: () => [...schema, { ...button, button: { buttonActions: actions } }],
  hasHostActions: true,
  hasNotify: true,
  databaseId: 'db',
  dataSources: () => [{ id: 'db', title: 'Here' }, { id: 'other', title: 'Other' }],
  targetSchema: (id: string) => (id === 'other' ? OTHER : schema),
  people: () => Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, name: `User ${i}` })),
  editFilter: vi.fn(),
  update: vi.fn<(patch: Partial<PropertySettingsV2>) => void>(),
  ...extra,
});

const lastActions = (update: Update): ButtonAction[] =>
  (update.mock.calls.at(-1)?.[0] as { button: ButtonSettings }).button.buttonActions ?? [];

const itemsFor = (actions: ButtonAction[], ctx = ctxOf(actions)): PopoverItemParams[] =>
  buttonEditItems({ ...button, button: { buttonActions: actions } }, ctx);

describe('button settings items — Notion actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the actions in Notion\'s order (research/17 §3b), Blok\'s own two last', () => {
    const add = find(itemsFor([]), 'buttonAddAction')?.children?.items ?? [];

    expect(add.map((i) => i.name)).toEqual([
      'buttonAdd-editProperty', 'buttonAdd-addPage', 'buttonAdd-editPages', 'buttonAdd-sendNotification',
      'buttonAdd-showConfirmation', 'buttonAdd-openPage', 'buttonAdd-defineVariables', 'buttonAdd-insertBlocks', 'buttonAdd-callback',
    ]);
    expect(add.map((i) => i.title).slice(1, 7)).toEqual([
      'tools.database.buttonActionAddPage', 'tools.database.buttonActionEditPages', 'tools.database.buttonActionSendNotification',
      'tools.database.buttonActionShowConfirmation', 'tools.database.buttonActionOpenPage', 'tools.database.buttonActionDefineVariables',
    ]);
  });

  it('offers Send notification only with the host lever, and only once', () => {
    const names = (items: PopoverItemParams[]): Array<string | undefined> => (find(items, 'buttonAddAction')?.children?.items ?? []).map((i) => i.name);

    expect(names(itemsFor([], ctxOf([], { hasNotify: false })))).not.toContain('buttonAdd-sendNotification');
    expect(names(itemsFor([{ id: 'n', type: 'sendNotification' }]))).not.toContain('buttonAdd-sendNotification');
  });

  it('starts a confirmation with Notion\'s message and button texts', () => {
    const ctx = ctxOf([]);

    find(itemsFor([], ctx), 'buttonAddAction', 'buttonAdd-showConfirmation')?.onActivate?.();

    expect(lastActions(ctx.update)[0]).toMatchObject({
      type: 'showConfirmation',
      message: 'tools.database.buttonConfirmDefault',
      confirmLabel: 'tools.database.buttonConfirmContinue',
      cancelLabel: 'tools.database.optionDeleteCancel',
    });
  });

  it('Add page to: picks a data source, which clears values set for the old one', () => {
    const actions: ButtonAction[] = [{ id: 'a', type: 'addPage', edits: [{ id: 'e', propertyId: 'done', value: true }] }];
    const ctx = ctxOf(actions);
    const source = find(itemsFor(actions, ctx), 'buttonAction-a', 'buttonAction-a-source');

    expect(source?.children?.items?.map((i) => i.title)).toEqual(['Here', 'Other']);
    find(itemsFor(actions, ctx), 'buttonAction-a', 'buttonAction-a-source', 'buttonSource-a-other')?.onActivate?.();

    expect(lastActions(ctx.update)[0]).toEqual({ id: 'a', type: 'addPage', databaseId: 'other', edits: [] });
  });

  it('Add page to: sets a value from the picked database\'s schema', () => {
    const actions: ButtonAction[] = [{ id: 'a', type: 'addPage', databaseId: 'other' }];
    const ctx = ctxOf(actions);
    const props = find(itemsFor(actions, ctx), 'buttonAction-a', 'buttonAction-a-edit')?.children?.items ?? [];

    expect(props.map((i) => i.title)).toEqual(['Flag']);
    find(itemsFor(actions, ctx), 'buttonAction-a', 'buttonAction-a-edit', 'buttonAction-a-edit-flag', 'buttonAction-a-value-flag-0')?.onActivate?.();

    expect(lastActions(ctx.update)[0]).toMatchObject({ databaseId: 'other', edits: [{ propertyId: 'flag', value: true }] });
  });

  it('Edit pages in: offers This page, each earlier added page, then the data sources', () => {
    const actions: ButtonAction[] = [{ id: 'a', type: 'addPage', databaseId: 'other' }, { id: 'b', type: 'editPages' }];
    const target = find(itemsFor(actions), 'buttonAction-b', 'buttonAction-b-target')?.children?.items ?? [];

    expect(target.map((i) => i.name)).toEqual(['buttonTarget-b-thisPage', 'buttonTarget-b-step-a', 'buttonTarget-b-db', 'buttonTarget-b-other']);
    expect(target[1].valueLabel).toBe('tools.database.buttonPageAddedTo {"name":"Other"}');
  });

  it('Edit pages in: a data source edits all pages until a filter is set, and the filter row opens the filter editor', () => {
    const all: ButtonAction[] = [{ id: 'b', type: 'editPages', target: { type: 'database', databaseId: 'other' } }];
    const some: ButtonAction[] = [{ id: 'b', type: 'editPages', target: { type: 'database', databaseId: 'other', filters: [{ propertyId: 'flag', operator: 'is', value: true }] } }];
    const ctx = ctxOf(all);

    expect(find(itemsFor(all, ctx), 'buttonAction-b', 'buttonAction-b-filter')?.title).toBe('tools.database.buttonAllPages');
    expect(find(itemsFor(some), 'buttonAction-b', 'buttonAction-b-filter')?.title).toBe('tools.database.buttonMatchOneFilter');
    find(itemsFor(all, ctx), 'buttonAction-b', 'buttonAction-b-filter')?.onActivate?.();

    expect(ctx.editFilter).toHaveBeenCalledWith('b');
  });

  it('Define variables starts with Variable 1 and adds the next one', () => {
    const ctx = ctxOf([]);

    find(itemsFor([], ctx), 'buttonAddAction', 'buttonAdd-defineVariables')?.onActivate?.();
    const added = lastActions(ctx.update);

    expect(added[0]).toMatchObject({ type: 'defineVariables', variables: [{ name: 'tools.database.buttonVariableName {"n":1}', kind: 'text', value: '' }] });
    find(itemsFor(added, ctx), `buttonAction-${added[0].id}`, `buttonAction-${added[0].id}-addVariable`)?.onActivate?.();

    expect(lastActions(ctx.update)[0]).toMatchObject({ variables: [{ name: 'tools.database.buttonVariableName {"n":1}' }, { name: 'tools.database.buttonVariableName {"n":2}' }] });
  });

  // secondaryLabel draws a keyboard shortcut (glyphs, aria-keyshortcuts). These rows show values, so they use valueLabel.
  it('shows each row\'s current pick as a plain value, never as a shortcut', () => {
    const actions: ButtonAction[] = [
      { id: 'a', type: 'addPage', databaseId: 'other' },
      { id: 'o', type: 'openPage', stepId: 'a' },
      { id: 'b', type: 'editPages', target: { type: 'database', databaseId: 'other' } },
      { id: 'v', type: 'defineVariables', variables: [{ id: 'x', name: 'X', kind: 'text', value: 'hello' }] },
      { id: 'n', type: 'sendNotification', recipients: { type: 'property', propertyId: 'owner' } },
    ];
    const all = (items: Item[]): Item[] => items.flatMap((item) => [item, ...all(item.children?.items ?? [])]);
    const items = itemsFor(actions) as Item[];

    expect(all(items).filter((item) => item.secondaryLabel !== undefined).map((item) => item.name)).toEqual([]);
    expect(find(items, 'buttonAction-a', 'buttonAction-a-source')?.valueLabel).toBe('Other');
    expect(find(items, 'buttonAction-b', 'buttonAction-b-target')?.valueLabel).toBe('Other');
    expect(find(items, 'buttonAction-v', 'buttonVariable-v-x')?.valueLabel).toBe('hello');
    expect(find(items, 'buttonAction-n', 'buttonAction-n-recipients')?.valueLabel).toBe('Owner');
  });

  it('Send notification: picks up to 20 specific people, or a person property', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}` }));
    const full: ButtonAction[] = [{ id: 'n', type: 'sendNotification', recipients: { type: 'people', people: many } }];
    const ctx = ctxOf(full);
    const people = find(itemsFor(full, ctx), 'buttonAction-n', 'buttonAction-n-recipients', 'buttonRecipients-n-people')?.children?.items ?? [];

    find(itemsFor(full, ctx), 'buttonAction-n', 'buttonAction-n-recipients', 'buttonRecipients-n-people', 'buttonPerson-n-u21')?.onActivate?.();
    expect(ctx.update).not.toHaveBeenCalled();
    expect(people).toHaveLength(25);
    const props = find(itemsFor([{ id: 'n', type: 'sendNotification' }], ctx), 'buttonAction-n', 'buttonAction-n-recipients', 'buttonRecipients-n-property')?.children?.items ?? [];

    expect(props.map((i) => i.title)).toEqual(['Owner']);
  });

  it('flags an action that cannot run (research/17 §3d)', () => {
    const ctx = ctxOf([]);
    const flag = (actions: ButtonAction[]): boolean => buttonHasError({ buttonActions: actions }, ctx);

    expect(flag([{ id: 'n', type: 'sendNotification' }])).toBe(true);
    expect(flag([{ id: 'n', type: 'sendNotification', recipients: { type: 'people', people: [] } }])).toBe(true);
    expect(flag([{ id: 'n', type: 'sendNotification', recipients: { type: 'property', propertyId: 'done' } }])).toBe(true);
    expect(flag([{ id: 'n', type: 'sendNotification', recipients: { type: 'property', propertyId: 'owner' } }])).toBe(false);
    expect(flag([{ id: 'b', type: 'editPages' }])).toBe(true);
    expect(flag([{ id: 'b', type: 'editPages', target: { type: 'addedPage', stepId: 'gone' } }])).toBe(true);
    expect(flag([{ id: 'a', type: 'addPage', databaseId: 'gone' }])).toBe(true);
    expect(flag([{ id: 'a', type: 'editProperty', propertyId: 'gone', value: null }])).toBe(true);
    expect(flag([{ id: 'a', type: 'addPage', databaseId: 'other', edits: [{ id: 'e', propertyId: 'flag', value: true }] }])).toBe(false);
  });
});
