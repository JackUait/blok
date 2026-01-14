# ESLint Rules for Encouraging Behavior-Driven Testing

**Date**: 2025-01-14
**Status**: Design Approved

## Problem Statement

Tests in the codebase commonly use anti-patterns that focus on implementation details rather than observable behavior:

1. **Direct event dispatching**: `dispatchEvent(new MouseEvent('click'))` bypasses browser's normal event handling
2. **Prototype spying**: `vi.spyOn(ClassName.prototype, 'method')` couples tests to internal implementation
3. **Private property access**: Tests access `_private` or `#private` properties directly
4. **Missing behavior verification**: Tests verify internal calls without checking side effects

These practices create fragile tests that pass but don't guarantee correct user-facing behavior.

## Solution

Add ESLint rules to discourage these patterns and encourage better testing practices.

## Rules to Implement

### 1. `no-direct-event-dispatch`

**Targets**: Unit tests (`test/unit/**/*.ts`) and E2E tests (`test/playwright/**/*.ts`)

Flags `dispatchEvent` calls for problematic user interaction events:
- Mouse: `click`, `dblclick`, `mousedown`, `mouseup`, `mouseover`, `mouseout`, `mousemove`
- Keyboard: `keydown`, `keyup`, `keypress`
- Form: `input`, `change`, `submit`
- Focus: `focus`, `blur`

**Allows**: Custom business events (`CustomEvent`), non-interaction events

**Alternatives suggested**:
- Unit tests: Use `@testing-library/user-event`
- E2E tests: Use Playwright's `click()`, `press()`, `type()`, etc.

### 2. `no-implementation-detail-spying`

**Targets**: Unit tests

Flags:
- `vi.spyOn(SomeClass.prototype, 'methodName')`
- `jest.spyOn(SomeClass.prototype, 'methodName')`

**Message**: "Avoid spying on prototype methods. Test behavior through public APIs instead."

### 3. `no-prototype-property-binding`

**Targets**: Unit tests

Flags binding built-in prototype methods:
- `Map.prototype.method.bind(instance)`
- `Set.prototype.method.bind(instance)`
- `Array.prototype.method.bind(instance)`
- `Object.prototype.method.bind(instance)`

**Rationale**: Tests shouldn't need to manipulate prototype methods of built-ins.

### 4. `no-instance-property-deletion`

**Targets**: Unit tests

Flags:
- `delete instance.method`
- `delete (instance as any).property`

**Rationale**: If you need to delete mock methods to test the prototype, you're testing implementation details.

### 5. `prefer-public-api`

**Targets**: Unit tests

Flags direct access to module internal properties starting with `_`.

**Example violation**:
```typescript
modules.InternalModule._privateMethod  // flagged
blokInstance._internalState            // flagged
```

### 6. `require-behavior-verification`

**Targets**: Unit tests and E2E tests

Warns when tests only verify internal calls without checking observable outcomes:
- DOM state (textContent, attributes, checked)
- Return values
- Emitted events

**Implementation**: Analyzes test structure to ensure side effects are verified, not just mock calls.

## Configuration

All rules start at `warn` level with `allowList` option for exceptions.

```javascript
// Unit test config
{
  'internal-unit-test/no-direct-event-dispatch': 'warn',
  'internal-unit-test/no-implementation-detail-spying': 'warn',
  'internal-unit-test/no-prototype-property-binding': 'warn',
  'internal-unit-test/no-instance-property-deletion': 'warn',
  'internal-unit-test/prefer-public-api': 'warn',
  'internal-unit-test/require-behavior-verification': 'warn',
}

// E2E test config
{
  'internal-playwright/no-direct-event-dispatch': 'warn',
  'internal-playwright/require-behavior-verification': 'warn',
}
```

## Dependencies

```bash
yarn add -D @testing-library/user-event
```

## Migration Strategy

**Phase 1: Infrastructure**
1. Install `@testing-library/user-event`
2. Implement ESLint rules in `eslint.config.mjs`
3. Create test helper utilities

**Phase 2: Gradual Rollout**
1. All rules start at `warn` level
2. Run `yarn lint` to identify violations
3. Fix violations in new tests first (greenfield)
4. Address violations when modifying existing tests (boy scout rule)

**Exception Handling**: Each rule supports `allowList` config for legitimate edge cases (e.g., testing low-level event handling utilities).

## Files to Modify

1. `eslint.config.mjs` - Add rules to `internal-unit-test` and `internal-playwright` plugins
2. `package.json` - Add `@testing-library/user-event` dev dependency
3. `CLAUDE.md` - Document testing best practices
