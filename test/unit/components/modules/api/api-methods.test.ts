import { describe, it, expect, beforeEach, vi } from 'vitest'

import { API } from '../../../../../src/components/modules/api'
import { EventsDispatcher } from '../../../../../src/components/utils/events'

import type { ModuleConfig } from '../../../../../src/types-internal/module-config'
import type { BlokEventMap } from '../../../../../src/components/events'
import type { BlokModules } from '../../../../../src/types-internal/blok-modules'

/**
 * The `api.rectangleSelection` surface handed to tools must match its PUBLIC
 * type exactly (cancelActiveSelection / isRectActivated / clearSelection /
 * startSelection / endSelection). Assigning the whole RectangleSelection module
 * leaks untyped, unstable internals (prepare(), isMouseDownWithinBounds, the
 * Module base) that third parties could come to depend on. This guards the
 * curated facade.
 */

const PUBLIC_RECTANGLE_SELECTION_METHODS = [
  'cancelActiveSelection',
  'clearSelection',
  'endSelection',
  'isRectActivated',
  'startSelection',
].sort()

/** A RectangleSelection stub exposing both the public methods and internal leakage. */
const createRectangleSelectionStub = (): Record<string, unknown> => {
  return {
    cancelActiveSelection: vi.fn(),
    isRectActivated: vi.fn(() => false),
    clearSelection: vi.fn(),
    startSelection: vi.fn(),
    endSelection: vi.fn(),
    // Internal members that MUST NOT leak onto the public api surface.
    prepare: vi.fn(),
    get isMouseDownWithinBounds(): boolean {
      return false
    },
  }
}

/** Build a Blok-modules stub whose every API module exposes an empty methods/classes bag. */
const createBlokStub = (rectangleSelection: Record<string, unknown>): BlokModules => {
  const emptyMethods = { methods: {} }
  return {
    BlocksAPI: emptyMethods,
    CaretAPI: emptyMethods,
    ToolsAPI: emptyMethods,
    EventsAPI: emptyMethods,
    HistoryAPI: emptyMethods,
    ListenersAPI: emptyMethods,
    NotifierAPI: emptyMethods,
    SanitizerAPI: emptyMethods,
    SaverAPI: emptyMethods,
    SelectionAPI: emptyMethods,
    StylesAPI: { classes: {} },
    ToolbarAPI: emptyMethods,
    InlineToolbarAPI: emptyMethods,
    TooltipAPI: emptyMethods,
    I18nAPI: emptyMethods,
    ReadOnlyAPI: emptyMethods,
    UiAPI: emptyMethods,
    ThemeAPI: emptyMethods,
    RectangleSelection: rectangleSelection,
  } as unknown as BlokModules
}

const setupApi = (rectangleSelection = createRectangleSelectionStub()): { api: API; rectangleSelection: Record<string, unknown> } => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>()
  const moduleConfig: ModuleConfig = {
    config: { defaultBlock: 'paragraph' },
    eventsDispatcher,
  }
  const api = new API(moduleConfig)

  api.state = createBlokStub(rectangleSelection)

  return { api, rectangleSelection }
}

describe('API.methods.rectangleSelection facade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes exactly the five publicly-typed methods', () => {
    const { api } = setupApi()
    const surface = api.methods.rectangleSelection as unknown as Record<string, unknown>

    expect(Object.keys(surface).sort()).toEqual(PUBLIC_RECTANGLE_SELECTION_METHODS)
  })

  it('does not leak internal module members (prepare, isMouseDownWithinBounds)', () => {
    const { api } = setupApi()
    const surface = api.methods.rectangleSelection as unknown as Record<string, unknown>

    expect('prepare' in surface).toBe(false)
    expect('isMouseDownWithinBounds' in surface).toBe(false)
  })

  it('delegates each facade method to the underlying RectangleSelection module', () => {
    const { api, rectangleSelection } = setupApi()
    const surface = api.methods.rectangleSelection

    surface.startSelection(10, 20, true)
    surface.endSelection()
    surface.clearSelection()
    surface.cancelActiveSelection()
    void surface.isRectActivated()

    expect(rectangleSelection.startSelection).toHaveBeenCalledWith(10, 20, true)
    expect(rectangleSelection.endSelection).toHaveBeenCalledTimes(1)
    expect(rectangleSelection.clearSelection).toHaveBeenCalledTimes(1)
    expect(rectangleSelection.cancelActiveSelection).toHaveBeenCalledTimes(1)
    expect(rectangleSelection.isRectActivated).toHaveBeenCalledTimes(1)
  })
})
