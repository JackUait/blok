/**
 * Type-level tests for the interface-vs-type data-slot footgun helper (#22).
 * Run with: tsc --noEmit --strict test/unit/types/blok-data-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile (the `@ts-expect-error`
 * lines fail the build if the error they mark ever stops happening).
 *
 * The footgun: a plain `interface` has no implicit index signature, so it is
 * NOT assignable to the `Record<string, unknown>` block-`data` slot, while a
 * structurally identical `type` alias is. `BlokData<T>` is the third escape
 * hatch — it adapts an existing interface into the data slot without forcing
 * the consumer to rewrite it as a `type` alias.
 */

import type { BlokData, OutputBlockData } from '../../../types';

type DataSlot = OutputBlockData['data'];

interface TaskData {
  title: string;
  done: boolean;
}

type TaskDataAlias = {
  title: string;
  done: boolean;
};

declare const fromInterface: TaskData;
declare const fromAlias: TaskDataAlias;

// The footgun itself: a plain interface value cannot go straight into the
// Record<string, unknown> data slot. If this ever compiles, the footgun is gone
// and this test (plus the BlokData helper) can be revisited.
// @ts-expect-error interface lacks an implicit index signature
const _slotRejectsInterface: DataSlot = fromInterface;

// Escape hatch 1 — a `type` alias assigns cleanly (documented, no helper).
const _slotAcceptsAlias: DataSlot = fromAlias;

// Escape hatch 2 — BlokData<T> adapts an existing interface value into the slot.
const _slotAcceptsWrapped: DataSlot = fromInterface as BlokData<TaskData>;

// BlokData preserves precise per-key types (reading a known key is not `unknown`).
declare const wrapped: BlokData<TaskData>;
const _title: string = wrapped.title;
const _done: boolean = wrapped.done;

// A BlokData value is assignable to Record<string, unknown> directly, so it
// drops into any `data`-typed position, and into the typed OutputBlockData<T>.
const _asRecord: Record<string, unknown> = wrapped;
const _typedBlock: OutputBlockData<'task', BlokData<TaskData>> = {
  type: 'task',
  data: { title: 'x', done: false },
};

void _slotRejectsInterface;
void _slotAcceptsAlias;
void _slotAcceptsWrapped;
void _title;
void _done;
void _asRecord;
void _typedBlock;
