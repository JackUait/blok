/**
 * Type-level tests for the public config callback/object aliases (#19).
 * Run with: tsc --noEmit --strict test/unit/types/config-aliases-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile. Without the named
 * aliases, a consumer wrapper is forced to reach in with
 * `NonNullable<BlokConfig['onSave']>` / `BlokConfig['style']` index-access that
 * silently breaks the day a config field is renamed or restructured. The named
 * exports below are the stable surface those wrappers bind to instead.
 */

import type {
  API,
  BlokConfig,
  OnReadyHandler,
  OnChangeHandler,
  OnSaveHandler,
  OnErrorHandler,
  OnEnterHandler,
  OnSubmitHandler,
  OnBeforeRenderHandler,
  OnAfterRenderHandler,
  OnThemeChangeHandler,
  OnBeforePasteHandler,
  BlokStyleConfig,
  BlokLinkConfig,
  OutputData,
  PersistedDocument,
  SaveContext,
  SaveResult,
} from '../../../types';

/** True only when `A` and `B` are mutually assignable (structurally identical). */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Each named handler alias must be exactly the type the config member carries.
// If a member is renamed or its signature drifts, these assertions break in
// this file (not silently in every consumer that index-accessed the config).
const _onReady: Exact<OnReadyHandler, NonNullable<BlokConfig['onReady']>> = true;
const _onChange: Exact<OnChangeHandler, NonNullable<BlokConfig['onChange']>> = true;
const _onSave: Exact<OnSaveHandler, NonNullable<BlokConfig['onSave']>> = true;
const _onError: Exact<OnErrorHandler, NonNullable<BlokConfig['onError']>> = true;
const _onEnter: Exact<OnEnterHandler, NonNullable<BlokConfig['onEnter']>> = true;
const _onSubmit: Exact<OnSubmitHandler, NonNullable<BlokConfig['onSubmit']>> = true;
const _onBeforeRender: Exact<OnBeforeRenderHandler, NonNullable<BlokConfig['onBeforeRender']>> = true;
const _onAfterRender: Exact<OnAfterRenderHandler, NonNullable<BlokConfig['onAfterRender']>> = true;
const _onThemeChange: Exact<OnThemeChangeHandler, NonNullable<BlokConfig['onThemeChange']>> = true;
const _onBeforePaste: Exact<OnBeforePasteHandler, NonNullable<BlokConfig['onBeforePaste']>> = true;
const _style: Exact<BlokStyleConfig, NonNullable<BlokConfig['style']>> = true;
const _link: Exact<BlokLinkConfig, NonNullable<BlokConfig['link']>> = true;

void _onReady;
void _onChange;
void _onSave;
void _onError;
void _onEnter;
void _onSubmit;
void _onBeforeRender;
void _onAfterRender;
void _onThemeChange;
void _onBeforePaste;
void _style;
void _link;

// A consumer wrapper can now declare its props with the named alias directly,
// with no BlokConfig index-access anywhere in its source.
declare const saveHandler: OnSaveHandler;
declare const doc: OutputData;
declare const api: API;
saveHandler(doc, api);

/**
 * `persistence` is written by hand far more often than it is read back, and its
 * members have to be nameable for that: a wrapper holding the version between a
 * load and a save needs the type, not an index-access into
 * `BlokConfig['persistence']` that breaks the day the key is restructured.
 */
type Persistence = NonNullable<BlokConfig['persistence']>;

const _persistedDocument: Exact<
  OutputData | PersistedDocument | null,
  Awaited<ReturnType<Persistence['load']>>
> = true;
const _saveContext: Exact<SaveContext, Parameters<Persistence['save']>[1]> = true;
const _saveResult: Exact<SaveResult | void, Awaited<ReturnType<Persistence['save']>>> = true;

void _persistedDocument;
void _saveContext;
void _saveResult;
