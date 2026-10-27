import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

import type { AgentApprovalRequest, AgentBatch, AgentResult, AgentSession, OutputBlockData, OutputData } from '../../../../types';

type Approve = (request: AgentApprovalRequest) => Promise<boolean>;

// The editor sets this when the database tool has config.forms, as the Share panel needs.
const FORMS_HOST = { names: [], impl: { databaseFormsHost: true } } as unknown as Parameters<typeof openJsonSession>[2];

const sessions: Array<[string, (seed: OutputData) => AgentSession, (seed: OutputData) => AgentSession]> = [
  ['json', seed => openJsonSession(seed, undefined, FORMS_HOST), seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed, undefined, FORMS_HOST), seed => openStoreSession(seed)],
];

const formView = (id: string, form: Record<string, unknown> = {}, name = 'Signup'): Record<string, unknown> => ({
  id, name, type: 'form', position: id === 'v2' ? 'a1' : 'a0', sorts: [], filters: [], visibleProperties: [], form,
});

const database = (views: Array<Record<string, unknown>> = [formView('v1')], title = 'Tasks'): OutputBlockData => ({
  id: 'db', type: 'database', content: [],
  data: {
    title,
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views,
    activeViewId: String(views[0]?.id),
  },
});

const seed = (views?: Array<Record<string, unknown>>, title?: string): OutputData => ({ blocks: [database(views, title)] });

const update = (changes: Record<string, unknown>, viewId = 'v1'): AgentBatch['commands'][number] =>
  ({ name: 'database.updateView', args: { id: 'db', viewId, changes } });

const run = (session: AgentSession, commands: unknown[], approve?: Approve): Promise<AgentResult> =>
  session.execute({ commands } as AgentBatch, approve === undefined ? {} : { approve });

const viewOf = async (session: AgentSession, viewId = 'v1'): Promise<Record<string, unknown>> => {
  const read = await session.read({ ids: ['db'], detail: 'full' });
  const views: unknown = read.blocks.find(block => block.id === 'db')?.data?.views;
  const list = Array.isArray(views) ? views.filter((view): view is Record<string, unknown> => typeof view === 'object' && view !== null) : [];

  return list.find(view => view.id === viewId) ?? {};
};

const codeOf = (result: AgentResult): string | undefined => (result.ok ? undefined : result.error.code);

const makePublic = update({ form: { public: true } });

describe.each(sessions)('changing who can see or fill out a view, on a %s session', (_name, open, openWithoutHost) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is refused where no person can be asked, and the form stays as it was', async () => {
    const session = open(seed());

    try {
      const result = await run(session, [makePublic]);

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details).toMatchObject({
        reason: 'no-channel',
        approval: { kind: 'database.share', blockId: 'db', viewId: 'v1', changes: [{ setting: 'access', to: 'public' }] },
      });
      expect((await viewOf(session)).form).toEqual({});
    } finally {
      session.close();
    }
  });

  it('applies once the person approves, asking once with exactly what changes', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [makePublic], approve);

      expect(codeOf(result)).toBeUndefined();
      expect((await viewOf(session)).form).toEqual({ public: true });
      expect(approve.mock.calls).toEqual([[{
        kind: 'database.share', blockId: 'db', title: 'Tasks', viewId: 'v1', view: 'Signup', changes: [{ setting: 'access', to: 'public' }],
      }]]);
    } finally {
      session.close();
    }
  });

  it('a no applies nothing in the batch and says so', async () => {
    const session = open(seed());

    try {
      const result = await run(session, [update({ name: 'Renamed' }), makePublic], () => Promise.resolve(false));

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details?.reason).toBe('denied');
      expect(result.ok ? '' : result.error.message).not.toMatch(/unlock/i);
      expect(await viewOf(session)).toMatchObject({ name: 'Signup', form: {} });
    } finally {
      session.close();
    }
  });

  it('"Who can fill out" is one choice: making a closed form public opens it', async () => {
    const session = open(seed([formView('v1', { closed: true })]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      await run(session, [makePublic], approve);

      expect((await viewOf(session)).form).toEqual({ public: true });
      expect(approve.mock.calls[0]?.[0]).toMatchObject({ changes: [{ setting: 'access', to: 'public' }] });
    } finally {
      session.close();
    }
  });

  it('closing a public form asks too: any sharing change is the person\'s', async () => {
    const session = open(seed([formView('v1', { public: true })]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      await run(session, [update({ form: { closed: true } })], approve);

      expect((await viewOf(session)).form).toEqual({ closed: true });
      expect(approve.mock.calls[0]?.[0]).toMatchObject({ changes: [{ setting: 'access', to: 'closed' }] });
    } finally {
      session.close();
    }
  });

  it('asks nothing for a setting that stays as it is', async () => {
    const session = open(seed([formView('v1', { public: true, anonymous: true })]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [update({ form: { public: true, anonymous: true, submitLabel: 'Go' } })], approve);

      expect(codeOf(result)).toBeUndefined();
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  it('asks once per view, naming every change of that view', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      await run(session, [update({ form: { public: true, anonymous: true, submissionAccess: 'edit' } })], approve);

      expect(approve).toHaveBeenCalledTimes(1);
      expect(approve.mock.calls[0]?.[0]).toMatchObject({ changes: [
        { setting: 'access', to: 'public' }, { setting: 'anonymous', to: true }, { setting: 'submissionAccess', to: 'edit' },
      ] });
      expect((await viewOf(session)).form).toEqual({ public: true, anonymous: true, submissionAccess: 'edit' });
    } finally {
      session.close();
    }
  });

  it('a yes for one view never covers another', async () => {
    const session = open(seed([formView('v1'), formView('v2', {}, 'Other')]));
    const approve = vi.fn<Approve>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    try {
      const result = await run(session, [makePublic, update({ form: { public: true } }, 'v2')], approve);

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(approve.mock.calls.map(([request]) => request.kind === 'database.share' && request.viewId)).toEqual(['v1', 'v2']);
      expect((await viewOf(session, 'v1')).form).toEqual({});
      expect((await viewOf(session, 'v2')).form).toEqual({});
    } finally {
      session.close();
    }
  });

  it('a yes for one change never covers another: a change that grew while the person decided asks again', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>()
      .mockImplementationOnce(async () => {
        // A peer turns anonymous on while the question is open, so the batch would now also turn it off.
        await run(session, [update({ form: { anonymous: true } })], () => Promise.resolve(true));

        return true;
      })
      .mockResolvedValueOnce(false);

    try {
      const result = await run(session, [update({ form: { public: true, anonymous: false } })], approve);

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(approve.mock.calls.map(([request]) => request.kind === 'database.share' && request.changes)).toEqual([
        [{ setting: 'access', to: 'public' }],
        [{ setting: 'access', to: 'public' }, { setting: 'anonymous', to: false }],
      ]);
      expect((await viewOf(session)).form).toEqual({ anonymous: true });
    } finally {
      session.close();
    }
  });

  it('asks again on every batch: an approval never outlives its batch', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      await run(session, [makePublic], approve);
      await run(session, [update({ form: { public: false } })], approve);

      expect(approve).toHaveBeenCalledTimes(2);
      expect(approve.mock.calls[1]?.[0]).toMatchObject({ changes: [{ setting: 'access', to: 'workspace' }] });
    } finally {
      session.close();
    }
  });

  it('calendar sync has no setting a person can change in Blok, so it is refused without asking, approval or not', async () => {
    const session = open(seed([{ ...formView('v1'), type: 'calendar' }]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [update({ calendarSync: { enabled: true, calendarId: 'team@example.com' } })], approve);

      expect(codeOf(result)).toBe('PRECONDITION_FAILED');
      expect(approve).not.toHaveBeenCalled();
      expect((await viewOf(session)).calendarSync).toBeUndefined();
    } finally {
      session.close();
    }
  });

  describe('without the host\'s form sharing (no database config.forms), as the Share panel', () => {
    it.each([
      [{ form: { public: true } }],
      [{ form: { anonymous: true } }],
      [{ form: { submissionAccess: 'edit' } }],
    ])('refuses %j as unavailable here, even with a yes ready', async (changes) => {
      const session = openWithoutHost(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        const result = await run(session, [update(changes)], approve);

        expect(codeOf(result)).toBe('COMMAND_UNAVAILABLE');
        expect(result.ok ? undefined : result.error.details?.reason).toBe('host');
        expect(approve).not.toHaveBeenCalled();
        expect((await viewOf(session)).form).toEqual({});
      } finally {
        session.close();
      }
    });

    it('still lets the person approve closing the form, which the panel offers', async () => {
      const session = openWithoutHost(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        expect(codeOf(await run(session, [update({ form: { closed: true } })], approve))).toBeUndefined();
        expect(approve).toHaveBeenCalledTimes(1);
        expect((await viewOf(session)).form).toEqual({ closed: true });
      } finally {
        session.close();
      }
    });

    it('a duplicate of a public form is refused too', async () => {
      const session = openWithoutHost(seed([formView('v1', { public: true })]));

      try {
        expect(codeOf(await run(session, [{ name: 'database.duplicateView', args: { id: 'db', viewId: 'v1' } }], () => Promise.resolve(true))))
          .toBe('COMMAND_UNAVAILABLE');
      } finally {
        session.close();
      }
    });
  });

  it('refuses a calendar id with hidden characters: the person must see exactly what it is', async () => {
    const session = open(seed([{ ...formView('v1'), type: 'calendar' }]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [update({ calendarSync: { enabled: true, calendarId: 'team‮@evil.com' } })], approve);

      expect(codeOf(result)).toBe('INVALID_ARGS');
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  it.each([
    ['longer than the question shows', 'a'.repeat(65)],
    ['with a bidi override', 'team\u202E@evil.com'],
  ])('refuses a calendar id %s on any write path, before the person is asked', async (_label, calendarId) => {
    const session = open({ blocks: [] });
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [{
        name: 'block.insert',
        args: {
          id: 'db9', type: 'database', position: 'end',
          data: {
            title: 'New', schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], activeViewId: 'nv',
            views: [{ id: 'nv', name: 'Cal', type: 'calendar', position: 'a0', sorts: [], filters: [], visibleProperties: [], calendarSync: { enabled: true, calendarId } }],
          },
        },
      }], approve);

      expect(codeOf(result)).toBe('INVALID_ARGS');
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  it('refuses a 65-character calendar id through updateView too', async () => {
    const session = open(seed([{ ...formView('v1'), type: 'calendar' }]));
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      expect(codeOf(await run(session, [update({ calendarSync: { enabled: true, calendarId: 'a'.repeat(65) } })], approve))).toBe('INVALID_ARGS');
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  it('duplicating a public form makes a new public form, so it asks', async () => {
    const session = open(seed([formView('v1', { public: true })]));

    try {
      const result = await run(session, [{ name: 'database.duplicateView', args: { id: 'db', viewId: 'v1' } }]);

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details?.approval).toMatchObject({ kind: 'database.share', changes: [{ setting: 'access', to: 'public' }] });
    } finally {
      session.close();
    }
  });

  it('inserting a database that carries a public form asks first', async () => {
    const viewId = { id: 'nv' };
    const session = open({ blocks: [] });

    try {
      const result = await run(session, [{
        name: 'block.insert',
        args: {
          id: 'db9', type: 'database', position: 'end',
          data: {
            title: 'New', schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], activeViewId: 'nv',
            views: [{ ...viewId, name: 'Signup', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [], form: { public: true } }],
          },
        },
      }]);
      const read = await session.read({ detail: 'outline' });

      expect(read.blocks.some(block => block.id === 'db9')).toBe(false);
      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details?.approval).toMatchObject({ kind: 'database.share', blockId: 'db9', changes: [{ setting: 'access', to: 'public' }] });
    } finally {
      session.close();
    }
  });

  it('a public form view with no id never lands', async () => {
    const session = open({ blocks: [] });

    try {
      const result = await run(session, [{
        name: 'block.insert',
        args: {
          id: 'db9', type: 'database', position: 'end',
          data: {
            title: 'New', schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], activeViewId: 'nv',
            views: [{ name: 'Signup', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [], form: { public: true } }],
          },
        },
      }]);
      const read = await session.read({ detail: 'outline' });

      expect(result.ok).toBe(false);
      expect(read.blocks.some(block => block.id === 'db9')).toBe(false);
    } finally {
      session.close();
    }
  });

  it('refuses public and closed together: "Who can fill out" is one choice', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      expect(codeOf(await run(session, [update({ form: { public: true, closed: true } })], approve))).toBe('INVALID_ARGS');
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  describe('a brand-new database that is already shared', () => {
    const innerDb = (id: string, form: Record<string, unknown> = { public: true, anonymous: true }): OutputBlockData => ({
      id, type: 'database', content: [],
      data: {
        title: 'Inner', activeViewId: `${id}-v`, schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: `${id}-v`, name: 'Signup', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [], form }],
      },
    });
    const BOTH = [{ setting: 'access', to: 'public' }, { setting: 'anonymous', to: true }];
    // A row with a page body holding a public form, and a template row like it.
    const withRows = (): OutputData => ({
      blocks: [
        {
          id: 'db', type: 'database', content: ['r1', 'tpl'],
          data: { title: 'Tasks', activeViewId: 'v1', views: [formView('v1')], schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }] },
        },
        { id: 'r1', type: 'database-row', parent: 'db', content: ['in1'], data: { properties: { t: 'One' }, position: 'a0' } },
        { ...innerDb('in1'), parent: 'r1' },
        { id: 'tpl', type: 'database-row', parent: 'db', content: ['in2'], data: { properties: { t: 'Template' }, position: 'a1', template: true } },
        { ...innerDb('in2'), parent: 'tpl' },
        { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Empty' }, position: 'a2' } },
      ],
    });
    const databases = async (session: AgentSession): Promise<number> =>
      (await session.read({ detail: 'outline' })).blocks.filter(block => block.type === 'database').length;
    const expectAsked = async (session: AgentSession, commands: unknown[]): Promise<void> => {
      const before = await databases(session);
      const approve = vi.fn<Approve>(() => Promise.resolve(false));
      const result = await run(session, commands, approve);

      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(approve.mock.calls[0]?.[0]).toMatchObject({ kind: 'database.share', changes: BOTH });
      expect(await databases(session)).toBe(before);
    };

    it('block.insert of a new public, anonymous database asks first', async () => {
      const session = open({ blocks: [] });

      try {
        const { id: _id, content: _content, ...block } = innerDb('x');

        await expectAsked(session, [{ name: 'block.insert', args: { ...block, id: 'db9', position: 'end' } }]);
      } finally {
        session.close();
      }
    });

    it('block.insert of one nested as a child asks first', async () => {
      const session = open({ blocks: [] });

      try {
        await expectAsked(session, [{
          name: 'block.insert',
          args: { type: 'toggle', position: 'end', data: { text: [{ text: 'Forms' }] }, children: [{ type: 'database', data: innerDb('x').data }] },
        }]);
      } finally {
        session.close();
      }
    });

    it('block.duplicate of a shared database asks first', async () => {
      const session = open({ blocks: [innerDb('src')] });

      try {
        await expectAsked(session, [{ name: 'block.duplicate', args: { id: 'src' } }]);
      } finally {
        session.close();
      }
    });

    it('duplicateRow of a row whose page holds one asks first', async () => {
      const session = open(withRows());

      try {
        await expectAsked(session, [{ name: 'database.duplicateRow', args: { id: 'db', rowId: 'r1' } }]);
      } finally {
        session.close();
      }
    });

    it('applyTemplate that copies one asks first', async () => {
      const session = open(withRows());

      try {
        await expectAsked(session, [{ name: 'database.applyTemplate', args: { id: 'db', rowId: 'r2', templateId: 'tpl' } }]);
      } finally {
        session.close();
      }
    });

    it('is refused outright without the host\'s form sharing, even with a yes ready', async () => {
      const session = openWithoutHost({ blocks: [] });
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        const { id: _id, content: _content, ...block } = innerDb('x');
        const result = await run(session, [{ name: 'block.insert', args: { ...block, id: 'db9', position: 'end' } }], approve);

        expect(codeOf(result)).toBe('COMMAND_UNAVAILABLE');
        expect(approve).not.toHaveBeenCalled();
        expect(await databases(session)).toBe(0);
      } finally {
        session.close();
      }
    });
  });

  describe('what the person is shown', () => {
    it('a rename in the same batch cannot change the names in the question', async () => {
      const session = open(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(false));

      try {
        await run(session, [
          { name: 'block.update', args: { id: 'db', data: { title: 'Scratch test' } } },
          { name: 'database.renameView', args: { id: 'db', viewId: 'v1', name: 'Internal only' } },
          makePublic,
        ], approve);

        expect(approve.mock.calls[0]?.[0]).toMatchObject({ title: 'Tasks', view: 'Signup' });
      } finally {
        session.close();
      }
    });

    it('shows the database and view names as one plain line, without bidi or control characters', async () => {
      const session = open(seed([formView('v1', {}, 'Sign‮up\n​now')], 'Pay‮roll\u0007'));
      const approve = vi.fn<Approve>(() => Promise.resolve(false));

      try {
        await run(session, [makePublic], approve);

        expect(approve.mock.calls[0]?.[0]).toMatchObject({ title: 'Payroll', view: 'Signup now' });
      } finally {
        session.close();
      }
    });
  });

  describe('the model cannot approve by itself', () => {
    it('an approval flag in the command args is refused', async () => {
      const session = open(seed());

      try {
        const result = await run(session, [{ ...makePublic, args: { ...makePublic.args, approved: true } }]);

        expect(codeOf(result)).toBe('INVALID_ARGS');
        expect((await viewOf(session)).form).toEqual({});
      } finally {
        session.close();
      }
    });

    it('an approval field on the batch is ignored', async () => {
      const session = open(seed());

      try {
        const result = await session.execute({ commands: [makePublic], approved: true, approve: true } as unknown as AgentBatch);

        expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
        expect((await viewOf(session)).form).toEqual({});
      } finally {
        session.close();
      }
    });

    it('anything but a literal true is a no', async () => {
      const session = open(seed());

      try {
        const result = await run(session, [makePublic], (() => Promise.resolve('yes')) as unknown as Approve);

        expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
        expect((await viewOf(session)).form).toEqual({});
      } finally {
        session.close();
      }
    });
  });

  describe('undo and redo', () => {
    const undo = { name: 'history.undo', args: {} };
    const redo = { name: 'history.redo', args: {} };

    it('undoing a sharing change is a sharing change, so it asks, and is refused where no person can be asked', async () => {
      const session = open(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        await run(session, [makePublic], approve);
        expect(codeOf(await run(session, [undo]))).toBe('APPROVAL_REQUIRED');
        expect((await viewOf(session)).form).toEqual({ public: true });
        expect(codeOf(await run(session, [undo], approve))).toBeUndefined();
        expect((await viewOf(session)).form).toEqual({});
        expect(approve.mock.calls[1]?.[0]).toEqual({
          kind: 'database.share', blockId: 'db', title: 'Tasks', viewId: 'v1', view: 'Signup', changes: [{ setting: 'access', to: 'workspace' }],
        });
      } finally {
        session.close();
      }
    });

    it('a redo of an approved change asks again', async () => {
      const session = open(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        await run(session, [makePublic], approve);
        await run(session, [undo], approve);
        expect(codeOf(await run(session, [redo], () => Promise.resolve(false)))).toBe('APPROVAL_REQUIRED');
        expect((await viewOf(session)).form).toEqual({});
        expect(codeOf(await run(session, [redo], approve))).toBeUndefined();
        expect((await viewOf(session)).form).toEqual({ public: true });
        expect(approve.mock.calls[2]?.[0]).toMatchObject({ changes: [{ setting: 'access', to: 'public' }] });
      } finally {
        session.close();
      }
    });

    it('a step that changed while the person decided is STALE, never an unapproved change', async () => {
      const session = open(seed([formView('v1'), formView('v2', {}, 'Other')]));
      const approve = vi.fn<Approve>()
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(async () => {
          await run(session, [update({ name: 'Moved on' }, 'v2')]);

          return true;
        });

      try {
        await run(session, [makePublic], approve);
        const undone = await run(session, [undo], approve);

        expect(codeOf(undone)).toBe('STALE');
        expect((await viewOf(session)).form).toEqual({ public: true });
      } finally {
        session.close();
      }
    });

    it('a write over a sharing value Blok cannot read lands, but its undo is refused, never run unasked', async () => {
      const session = open(seed([formView('v1', { submissionAccess: 'everyone' })]));

      try {
        const written = await run(session, [update({ form: { submissionAccess: 'edit' } })], () => Promise.resolve(true));

        expect(codeOf(written)).toBeUndefined();
        // A snapshot session reads the value itself (INVALID_ARGS); a native one kept no record (APPROVAL_REQUIRED).
        expect(['INVALID_ARGS', 'APPROVAL_REQUIRED']).toContain(codeOf(await run(session, [undo], () => Promise.resolve(true))));
        expect((await viewOf(session)).form).toEqual({ submissionAccess: 'edit' });
      } finally {
        session.close();
      }
    });

    it('a step that changes no sharing undoes without asking', async () => {
      const session = open(seed());
      const approve = vi.fn<Approve>(() => Promise.resolve(true));

      try {
        await run(session, [update({ name: 'Renamed' })]);
        expect(codeOf(await run(session, [undo], approve))).toBeUndefined();
        expect(approve).not.toHaveBeenCalled();
      } finally {
        session.close();
      }
    });
  });
});
