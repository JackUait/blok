# Custom Emoji Picker & Notifier Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow library consumers to replace the built-in emoji picker and notifier with their own implementations by providing callback functions in `BlokConfig`.

**Architecture:** Two new optional fields on `BlokConfig` — `emojiPicker` and `notifier` — are stored on config and threaded through to the places that invoke those subsystems. When a field is present, the built-in UI is bypassed; when absent, behaviour is unchanged. TDD throughout: write failing tests first, then implement.

**Tech Stack:** TypeScript, Vitest (unit), existing module/tool patterns.

---

## Task 1: Add `emojiPicker` to `BlokConfig` type

**Files:**
- Modify: `types/configs/blok-config.d.ts:227`

**Step 1: No test needed** — this is a pure type addition. TypeScript will enforce correctness at compile time and the callout unit tests will cover runtime behaviour in Task 2.

**Step 2: Add the field to `BlokConfig`**

After the `notifierPosition` field (line 227), add:

```typescript
  /**
   * Custom emoji picker handler.
   * When provided, Blok calls this function instead of showing the built-in emoji picker.
   * Your implementation must call `onSelect` with the chosen native emoji character,
   * or call it with an empty string to clear the emoji.
   * @param onSelect - call with the selected emoji (e.g. "😊") or "" to remove
   */
  emojiPicker?: (onSelect: (emoji: string) => void) => void;
```

**Step 3: Run lint to verify types compile**

```bash
yarn lint
```

Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add types/configs/blok-config.d.ts
git commit -m "feat(types): add emojiPicker config option to BlokConfig"
```

---

## Task 2: Add `emojiPicker` to `CalloutConfig` and thread it through `CalloutTool`

**Files:**
- Modify: `src/tools/callout/types.ts`
- Modify: `src/tools/callout/index.ts`
- Test: `test/unit/tools/callout/callout.test.ts`

### Step 1: Write the failing test

Open `test/unit/tools/callout/callout.test.ts` and add this describe block inside the top-level `describe('CalloutTool', ...)`, after the existing `describe('setReadOnly()', ...)` block:

```typescript
describe('custom emojiPicker config', () => {
  it('calls config.emojiPicker instead of opening built-in picker when provided', async () => {
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const customPicker = vi.fn();
    const options = createOptions({}, {});
    // Override config with custom picker
    (options as unknown as { config: { emojiPicker: typeof customPicker } }).config = {
      emojiPicker: customPicker,
    };
    const tool = new CalloutTool(options);
    const wrapper = tool.render();
    const emojiBtn = wrapper.querySelector('[data-blok-testid="callout-emoji-btn"]') as HTMLButtonElement;

    emojiBtn.click();

    expect(customPicker).toHaveBeenCalledOnce();
    // The callback passed to customPicker should set the emoji when called
    const [onSelect] = customPicker.mock.calls[0] as [(emoji: string) => void];

    onSelect('🎉');
    expect(emojiBtn.textContent).toBe('🎉');
  });

  it('opens built-in picker when config.emojiPicker is not provided', async () => {
    const emojiPickerOpenSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../../../src/tools/callout/emoji-picker', () => ({
      EmojiPicker: vi.fn().mockImplementation(() => ({
        getElement: () => document.createElement('div'),
        open: emojiPickerOpenSpy,
      })),
    }));
    const { CalloutTool } = await import('../../../../src/tools/callout');
    const tool = new CalloutTool(createOptions());
    const wrapper = tool.render();
    const emojiBtn = wrapper.querySelector('[data-blok-testid="callout-emoji-btn"]') as HTMLButtonElement;

    emojiBtn.click();
    await Promise.resolve(); // flush microtasks

    expect(emojiPickerOpenSpy).toHaveBeenCalledOnce();
    vi.doUnmock('../../../../src/tools/callout/emoji-picker');
  });
});
```

### Step 2: Run test to verify it fails

```bash
yarn test test/unit/tools/callout/callout.test.ts -t "custom emojiPicker config"
```

Expected: FAIL — `customPicker` is never called because `openEmojiPicker` always uses the built-in picker.

### Step 3: Add `emojiPicker` to `CalloutConfig`

In `src/tools/callout/types.ts`, change `CalloutConfig` to:

```typescript
export interface CalloutConfig {
  /**
   * Custom emoji picker handler.
   * When provided, replaces the built-in emoji picker.
   * Call `onSelect` with the chosen emoji character, or "" to clear.
   */
  emojiPicker?: (onSelect: (emoji: string) => void) => void;
}
```

### Step 4: Store config in `CalloutTool` and route `openEmojiPicker`

In `src/tools/callout/index.ts`:

**a)** Add a private field after `private _colorPicker`:
```typescript
private readonly _customEmojiPicker: ((onSelect: (emoji: string) => void) => void) | undefined;
```

**b)** In the constructor, after `this.blockId = block?.id`:
```typescript
this._customEmojiPicker = config?.emojiPicker;
```

The constructor signature already has `config` available via `BlockToolConstructorOptions<CalloutData, CalloutConfig>`. Verify the destructure on line 78 already includes `config`:
```typescript
constructor({ data, api, readOnly, block, config }: BlockToolConstructorOptions<CalloutData, CalloutConfig>) {
```
If `config` is missing from the destructure, add it.

**c)** Replace `openEmojiPicker()` (lines 376–392) with:

```typescript
private openEmojiPicker(): void {
  if (this._dom === null) {
    return;
  }

  if (this._customEmojiPicker !== undefined) {
    this._customEmojiPicker((emoji: string) => this.setEmoji(emoji));
    return;
  }

  if (this._emojiPicker === null) {
    this._emojiPicker = new EmojiPicker({
      onSelect: (native: string) => this.setEmoji(native),
      onRemove: () => this.setEmoji(''),
      i18n: this.api.i18n,
      locale: this.api.i18n.getLocale(),
    });
    document.body.appendChild(this._emojiPicker.getElement());
  }

  void this._emojiPicker.open(this._dom.emojiButton);
}
```

### Step 5: Run test to verify it passes

```bash
yarn test test/unit/tools/callout/callout.test.ts -t "custom emojiPicker config"
```

Expected: PASS

### Step 6: Run full callout test suite

```bash
yarn test test/unit/tools/callout/callout.test.ts
```

Expected: all existing tests still PASS.

### Step 7: Commit

```bash
git add src/tools/callout/types.ts src/tools/callout/index.ts test/unit/tools/callout/callout.test.ts
git commit -m "feat(callout): support custom emojiPicker via tool config"
```

---

## Task 3: Add `notifier` to `BlokConfig` type

**Files:**
- Modify: `types/configs/blok-config.d.ts`

**Step 1: No separate test** — runtime behaviour is covered in Task 4.

**Step 2: Add the field to `BlokConfig`** after the `emojiPicker` field:

```typescript
  /**
   * Custom notifier handler.
   * When provided, Blok calls this function instead of showing the built-in DOM notification.
   * Your implementation receives the same options object that the built-in notifier accepts.
   * @param options - notification options (message, style, type, time, etc.)
   */
  notifier?: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void;
```

Also add the import at the top of the file (alongside the existing `NotifierPosition` import):

```typescript
import type { NotifierPosition, NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './notifier';
```

(Replace the existing `import type { NotifierPosition } from './notifier';` line.)

**Step 3: Run lint**

```bash
yarn lint
```

Expected: PASS

**Step 4: Commit**

```bash
git add types/configs/blok-config.d.ts
git commit -m "feat(types): add notifier config option to BlokConfig"
```

---

## Task 4: Thread `config.notifier` through `NotifierAPI`

**Files:**
- Modify: `src/components/modules/api/notifier.ts`
- Test: `test/unit/components/modules/api/notifier.test.ts` (create if missing)

### Step 1: Check whether a unit test file exists

```bash
ls test/unit/components/modules/api/
```

If `notifier.test.ts` does not exist, create it. If it exists, add to it.

### Step 2: Write the failing test

Create (or add to) `test/unit/components/modules/api/notifier.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dynamic import of the built-in notifier module
vi.mock('../../../../src/components/utils/notifier/index', () => ({
  show: vi.fn(),
}));

import type { ModuleConfig } from '../../../../src/types-internal/module-config';
import type { NotifierOptions } from '../../../../src/components/utils/notifier/types';
import { NotifierAPI } from '../../../../src/components/modules/api/notifier';

const makeConfig = (notifierOverride?: (opts: NotifierOptions) => void): ModuleConfig => ({
  config: {
    notifier: notifierOverride,
  } as never,
  eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as never,
});

describe('NotifierAPI', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls config.notifier instead of built-in when provided', () => {
    const customNotifier = vi.fn();
    const api = new NotifierAPI(makeConfig(customNotifier));
    const options: NotifierOptions = { message: 'hello', style: 'success' };

    api.show(options);

    expect(customNotifier).toHaveBeenCalledWith(options);
  });

  it('uses built-in notifier when config.notifier is not provided', async () => {
    const { show: builtInShow } = await import('../../../../src/components/utils/notifier/index');
    const api = new NotifierAPI(makeConfig());
    const options: NotifierOptions = { message: 'world' };

    api.show(options);
    // flush microtask (lazy dynamic import inside Notifier.show)
    await new Promise(r => setTimeout(r, 0));

    expect(builtInShow).toHaveBeenCalled();
  });
});
```

### Step 3: Run test to verify it fails

```bash
yarn test test/unit/components/modules/api/notifier.test.ts -t "calls config.notifier"
```

Expected: FAIL — `customNotifier` is never called.

### Step 4: Update `NotifierAPI` to route to custom notifier

In `src/components/modules/api/notifier.ts`, replace the entire file with:

```typescript
import type { Notifier as INotifier } from '../../../../types/api';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { Notifier } from '../../utils/notifier';
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions } from '../../utils/notifier/types';
import { DEFAULT_NOTIFIER_POSITION } from '../../utils/notifier/types';

/**
 * Notifier API module — routes show() to the custom handler when the consumer
 * provides one in BlokConfig.notifier, otherwise falls back to the built-in notifier.
 */
export class NotifierAPI extends Module {
  /**
   * Built-in notifier utility instance (used only when no custom handler is provided)
   */
  private builtInNotifier: Notifier;

  /**
   * Optional consumer-provided notifier handler from BlokConfig
   */
  private readonly customNotifier:
    | ((options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void)
    | undefined;

  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });

    this.builtInNotifier = new Notifier(config.notifierPosition ?? DEFAULT_NOTIFIER_POSITION);
    this.customNotifier = (config as { notifier?: (opts: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void }).notifier;
  }

  /**
   * Available methods exposed on api.notifier
   */
  public get methods(): INotifier {
    return {
      show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void =>
        this.show(options),
    };
  }

  /**
   * Show notification — delegates to custom handler if provided, else built-in
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    if (this.customNotifier !== undefined) {
      this.customNotifier(options);
      return;
    }

    this.builtInNotifier.show(options);
  }
}
```

### Step 5: Run test to verify it passes

```bash
yarn test test/unit/components/modules/api/notifier.test.ts
```

Expected: all PASS.

### Step 6: Commit

```bash
git add src/components/modules/api/notifier.ts test/unit/components/modules/api/notifier.test.ts
git commit -m "feat(notifier): route api.notifier.show() to custom handler when provided in config"
```

---

## Task 5: Full regression check

### Step 1: Run the complete unit test suite

```bash
yarn test
```

Expected: all tests PASS.

### Step 2: Run lint

```bash
yarn lint
```

Expected: no errors.

### Step 3: Commit if anything was incidentally fixed; otherwise done

---

## Summary of all changed files

| File | Change |
|------|--------|
| `types/configs/blok-config.d.ts` | Add `emojiPicker?` and `notifier?` fields; add notifier type imports |
| `src/tools/callout/types.ts` | Add `emojiPicker?` to `CalloutConfig` |
| `src/tools/callout/index.ts` | Store `_customEmojiPicker`; branch in `openEmojiPicker()` |
| `src/components/modules/api/notifier.ts` | Store `customNotifier`; branch in `show()` |
| `test/unit/tools/callout/callout.test.ts` | New `describe('custom emojiPicker config', ...)` block |
| `test/unit/components/modules/api/notifier.test.ts` | New test file |
