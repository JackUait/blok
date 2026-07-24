/**
 * Type-level tests for the message-key contract (#38 + #40).
 * Run with: tsc --noEmit --strict test/unit/types/message-keys-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 *
 * ROOT CAUSE this guards (#40): `config.i18n.messages` keys were an untyped
 * `Record<string, string>`, so when a built-in key was renamed a host's
 * override silently stopped matching (this is how a 0.15 table-key rename
 * killed a consumer's Russian overrides). `BlokMessages` is the opt-in,
 * generated, rename-safe contract; `ToolNameMessageKey` (#38) documents +
 * types the `toolNames.<name>` namespace.
 */

import type { BlokMessageKey, BlokMessages, ToolNameMessageKey } from '../../../types';

// A real built-in key is a valid BlokMessageKey.
const knownKey: BlokMessageKey = 'tools.link.addLink';
void knownKey;

// @ts-expect-error - a renamed/typo'd built-in key is rejected at the override site.
const typoKey: BlokMessageKey = 'tools.link.addLnk';
void typoKey;

// Overrides typed as BlokMessages catch a typo'd key via `satisfies`.
const overrides = {
  'toolNames.text': 'Текст',
  'tools.link.addLink': 'Добавить ссылку',
} satisfies BlokMessages;
void overrides;

const badOverrides = {
  // @ts-expect-error - 'toolName.text' (missing plural) is not a built-in key.
  'toolName.text': 'Текст',
} satisfies BlokMessages;
void badOverrides;

// The tool-name namespace is an open template type: any registration name works.
const builtinToolName: ToolNameMessageKey = 'toolNames.header';
const customToolName: ToolNameMessageKey = 'toolNames.myCustomWidget';
void builtinToolName;
void customToolName;

// @ts-expect-error - a key outside the toolNames namespace is not a ToolNameMessageKey.
const notAToolName: ToolNameMessageKey = 'tools.link.addLink';
void notAToolName;
