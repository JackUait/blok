/**
 * Type-level conformance test for the published React adapter surface.
 * Run via `tsc --noEmit` (part of `yarn lint:types`). NOT executed — only compiled.
 *
 * Each assertion forces a compile error if the published `types/react.d.ts`
 * drifts from the source implementation in `src/react`.
 */
import type {
  UseBlokConfig as PublishedUseBlokConfig,
  BlokContentProps as PublishedBlokContentProps,
  BlokEditorProps as PublishedBlokEditorProps,
} from '../../../types/react';
import type { UseBlokConfig as SourceUseBlokConfig } from '../../../src/react/types';
import type { BlokEditorProps as SourceBlokEditorProps } from '../../../src/react/BlokEditor';
import type { BlokContentProps as SourceBlokContentProps } from '../../../src/react/types';

/** Compile error unless A and B are mutually assignable. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _useBlokConfig: AssertEqual<PublishedUseBlokConfig, SourceUseBlokConfig> = true;
const _contentProps: AssertEqual<PublishedBlokContentProps, SourceBlokContentProps> = true;
const _editorProps: AssertEqual<PublishedBlokEditorProps, SourceBlokEditorProps> = true;

void _useBlokConfig;
void _contentProps;
void _editorProps;
