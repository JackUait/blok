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
const _knownKey: BlokMessageKey = 'tools.link.addLink';

// @ts-expect-error - a renamed/typo'd built-in key is rejected at the override site.
const _typoKey: BlokMessageKey = 'tools.link.addLnk';

// Overrides typed as BlokMessages catch a typo'd key via `satisfies`.
const _overrides = {
  'toolNames.text': 'Текст',
  'tools.link.addLink': 'Добавить ссылку',
} satisfies BlokMessages;

const _badOverrides = {
  // @ts-expect-error - 'toolName.text' (missing plural) is not a built-in key.
  'toolName.text': 'Текст',
} satisfies BlokMessages;

// The tool-name namespace is an open template type: any registration name works.
const _builtinToolName: ToolNameMessageKey = 'toolNames.header';
const _customToolName: ToolNameMessageKey = 'toolNames.myCustomWidget';

// @ts-expect-error - a key outside the toolNames namespace is not a ToolNameMessageKey.
const _notAToolName: ToolNameMessageKey = 'tools.link.addLink';
