# API Documentation Interactive Demos Design

**Date:** 2026-01-23
**Status:** Design Approved

## Problem

The `/docs` page has extensive API documentation with code examples (60+ methods across 15+ API modules), but these are static code blocks without interactive demonstrations. Users can't see what the API calls actually *do*—they have to mentally translate the code into behavior.

A user reads about `editor.blocks.move(0, 2)` but can't see what that actually does to the editor content.

## Goal

Add interactive demos to the API documentation so users can see what each API method actually does.

## Approach

Each API method card will have a side-by-side layout: code example on the left, interactive mini-editor demo on the right.

## Architecture

### Component Structure

```
ApiMethodCard (new)
├── ApiMethodCode (left side)
│   ├── Method signature
│   ├── Description
│   └── CodeBlock example
└── ApiMethodDemo (right side, new)
    ├── MiniBlokEditor (embedded editor instance)
    ├── DemoControls (buttons to trigger the method)
    └── DemoOutput (shows result/logs)
```

### Data Flow

1. `api-data.ts` extends `ApiMethod` to include `demoConfig` — defines how to demo that method
2. `ApiMethodDemo` receives the method config and sets up appropriate controls
3. When user clicks a demo button, the API method is called on the mini editor
4. Result is displayed (either as JSON output or visual state change)

### Key Consideration

Each demo needs its own isolated `Blok` instance. We can't share one instance across all demos because methods like `clear()` or `render()` would conflict.

## Component Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  blocks.move(toIndex, fromIndex?)  →  void                  │
│  Move a block to a new position.                           │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ // Code example     │  │  ┌─────────────────────────┐ │  │
│  │ editor.blocks.move(0│  │  │  Hello World             │ │  │
│  │ );                  │  │  │                          │ │  │
│  │                     │  │  │  [Try: Move to top]      │ │  │
│  └─────────────────────┘  │  └─────────────────────────┘ │  │
│                           │  Output: ✓ Block moved        │  │
│                           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### MiniBlokEditor Component

- Mounts a minimal Blok instance (paragraph + header tools)
- Fixed height (~200px) to keep cards compact
- Read-only-ish: user can see content but controls are via demo buttons
- Provides accessor methods like `getBlockCount()` for demos to verify behavior

### DemoControls Component

- Renders buttons based on `demoConfig.actions`
- Example: `move()` method might have actions like "Move first to last", "Move last to first"
- Each action is a pre-configured API call with clear, user-friendly label

### DemoOutput Component

- Shows success/error state after action runs
- Displays relevant return values (e.g., "Moved block from index 2 to index 0")
- Brief, ephemeral messages—no persistent logging needed

## Data Structure

### Type Definitions

```typescript
export interface DemoAction {
  label: string;           // Button text: "Move to top"
  execute: (editor: Blok) => Promise<void> | void;  // What to do
  expectedOutput?: string; // What to show on success
}

export interface DemoConfig {
  initialState?: {         // Optional: custom starting content
    blocks: BlockData[];
  };
  actions: DemoAction[];   // Buttons to show
}

export interface ApiMethod {
  name: string;
  returnType: string;
  description: string;
  example?: string;
  demo?: DemoConfig;       // NEW - optional
}
```

### Example Usage in api-data.ts

```typescript
{
  name: 'blocks.move(toIndex, fromIndex?)',
  returnType: 'void',
  description: 'Moves a block to a new position.',
  example: `// Move current block to top\neditor.blocks.move(0);`,
  demo: {
    actions: [
      {
        label: 'Move first to last',
        execute: async (editor) => {
          await editor.blocks.move(2, 0);
        },
        expectedOutput: 'Moved block from index 0 to index 2'
      },
      {
        label: 'Move last to top',
        execute: async (editor) => {
          const count = editor.blocks.getBlocksCount();
          await editor.blocks.move(0, count - 1);
        },
        expectedOutput: 'Moved last block to index 0'
      }
    ]
  }
}
```

### Benefits

- Gradual rollout: add `demo` to methods one at a time
- No breaking changes: methods without demos just render as static code
- Execute functions run in the docs context—can call real Blok APIs

## Implementation Flow

### How a Demo Runs

1. **User scrolls to an API method card**
   - `ApiMethodCard` mounts
   - `MiniBlokEditor` initializes a fresh Blok instance with default content (or custom from `demo.initialState`)
   - Demo buttons appear, all ready to go

2. **User clicks a demo button (e.g., "Move first to last")**
   - `DemoControls` calls the `execute` function, passing the mini editor instance
   - The API method runs (`editor.blocks.move(2, 0)`)
   - Blok updates its internal state and re-renders the blocks
   - `MiniBlokEditor` reflects the change immediately

3. **Result is displayed**
   - On success: `DemoOutput` shows the `expectedOutput` message
   - On error: catches and displays the error in red
   - User can try another action, or click "Reset" to restore initial state

### Reset Functionality

- Each demo card has a "Reset" button that re-runs the initial state render
- Essential for methods that destroy/modify state so users can try again

### Error Handling

- All `execute` calls wrapped in try/catch
- Errors displayed in `DemoOutput` with friendly message
- Editor remains usable even after failed action

### Key Implementation Detail

The `execute` functions in `api-data.ts` are pure—they receive a `Blok` instance and call methods on it. They don't need to know about React, mounting, or lifecycle. This keeps the demo data declarative and testable.

## Styling & Responsive Design

### Desktop Layout (Card-Level Side-by-Side)

```css
.api-method-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-xl);
  padding: var(--spacing-lg);
  background: var(--color-surface-elevated);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.api-method-demo {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.mini-blok-editor {
  height: 200px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-background);
}
```

### Responsive Behavior

1. **Tablet (< 1024px):** Stack vertically—code on top, demo below
2. **Mobile (< 640px):** Demo collapses into "Try it" expandable section to avoid overwhelming the page

### Demo Controls Styling

- Action buttons: secondary style (outlined, subtle)
- "Reset" button: tertiary style (text-only, subtle)
- Output message: small text, success (green) or error (red) color
- All controls scale with font size for accessibility

### Loading States

- During async `execute`, button shows spinner or "Loading…" text
- Button disabled until action completes
- Prevents double-clicks on slow operations

### Performance Consideration

- Only initialize Blok instance when card is in viewport (use IntersectionObserver)
- Unmount editor when card leaves viewport to free memory
- Lazy-load the Blok bundle only when first demo is needed

## Testing Strategy

### Unit Tests (Vitest + React Testing Library)

1. **ApiMethodCard component**
   - Renders code block and demo side-by-side
   - Shows demo section when `demo` config exists
   - Falls back to static display when no demo config

2. **DemoControls component**
   - Renders correct buttons from `actions` config
   - Calls `execute` function when button clicked
   - Shows loading state during async execution
   - Displays output message after completion

3. **DemoOutput component**
   - Shows success message with correct styling
   - Shows error message when action fails
   - Handles empty state (no output yet)

### Integration Tests

1. **MiniBlokEditor**
   - Mounts Blok instance successfully
   - Renders initial content
   - Exposes methods for demo actions
   - Cleans up on unmount (calls `destroy()`)

2. **End-to-end demo flow**
   - User clicks action → API executes → editor updates
   - Reset button restores initial state
   - Error handling displays correctly

### E2E Tests (Playwright)

1. **API docs page load**
   - Sidebar renders correctly
   - Methods with demos show interactive controls
   - Methods without demos show static code only

2. **Demo interaction**
   - Click "Move first to last" → blocks reorder in preview
   - Click "Reset" → content restores
   - Error case shows friendly message

## Migration & Rollout Plan

### Phase 1: Foundation (no visible changes)
- Create `ApiMethodCard`, `MiniBlokEditor`, `DemoControls`, `DemoOutput` components
- Write unit tests for all new components
- Set up data structure extensions in `api-data.ts`
- **No demo configs added yet** - methods render exactly as before

### Phase 2: Pilot Demos
- Add demo configs to 3-5 representative methods covering different patterns:
  - Simple: `blocks.clear()` - one action, clear visual result
  - Parameterized: `blocks.move()` - multiple actions with different args
  - Async: `blocks.render()` - shows data loading
  - Read-only: `blocks.getBlocksCount()` - shows return value
- Test these manually on the docs site
- Gather feedback on UX

### Phase 3: Broad Rollout
- Add demos to remaining high-value methods (core Blok class, Blocks API, Caret API)
- Each PR adds demos for one API module
- Methods without demos continue to work as-is

### Phase 4: Polish
- Add IntersectionObserver for viewport-based lazy loading
- Refine responsive behavior based on real usage
- Performance optimization if needed

## Files to Create/Modify

### New Files
- `docs/src/components/api/ApiMethodCard.tsx`
- `docs/src/components/api/ApiMethodDemo.tsx`
- `docs/src/components/api/MiniBlokEditor.tsx`
- `docs/src/components/api/DemoControls.tsx`
- `docs/src/components/api/DemoOutput.tsx`
- `docs/src/components/api/ApiMethodCard.test.tsx`
- `docs/src/components/api/ApiMethodDemo.test.tsx`
- `docs/src/components/api/MiniBlokEditor.test.tsx`
- `docs/src/components/api/DemoControls.test.tsx`
- `docs/src/components/api/DemoOutput.test.tsx`

### Modified Files
- `docs/src/components/api/api-data.ts` - extend interfaces, add demo configs
- `docs/src/components/api/ApiSection.tsx` - use ApiMethodCard instead of inline render
- `docs/assets/api.css` - add demo-related styles

## Success Criteria

- Users can understand what an API method does without reading the code
- Demo execution feels instant (< 100ms for most actions)
- Page load time is not significantly impacted
- All demos work on mobile devices
- Adding a new demo requires < 5 minutes of developer time
