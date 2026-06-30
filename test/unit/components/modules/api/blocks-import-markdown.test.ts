import { describe, it, expect } from 'vitest'

import { BlocksAPI } from '../../../../../src/components/modules/api/blocks'
import { EventsDispatcher } from '../../../../../src/components/utils/events'

import type { ModuleConfig } from '../../../../../src/types-internal/module-config'
import type { BlokConfig } from '../../../../../types'
import type { BlokEventMap } from '../../../../../src/components/events'

/**
 * `importMarkdown` is a fully-implemented, documented public method on the
 * BlocksAPI module, but it was never wired into the `methods` getter handed to
 * tools — so `api.blocks.importMarkdown` (and `blok.blocks.importMarkdown`) were
 * unreachable. This guards the wiring so the affordance is real.
 */
describe('BlocksAPI.methods.importMarkdown wiring', () => {
  const createBlocksApi = (): BlocksAPI => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>()
    const moduleConfig: ModuleConfig = {
      config: { defaultBlock: 'paragraph' } as BlokConfig,
      eventsDispatcher,
    }

    return new BlocksAPI(moduleConfig)
  }

  it('exposes importMarkdown on the tool-facing methods surface', () => {
    const blocksApi = createBlocksApi()

    expect(typeof blocksApi.methods.importMarkdown).toBe('function')
  })

  it('delegates to the module implementation, forwarding md and options', async () => {
    const blocksApi = createBlocksApi()
    const calls: Array<[string, unknown]> = []

    // Replace the module-level implementation with a recorder; the methods
    // facade must forward to whatever `importMarkdown` resolves to on `this`.
    Object.defineProperty(blocksApi, 'importMarkdown', {
      configurable: true,
      value: async (md: string, options?: unknown) => {
        calls.push([md, options])

        return { blocks: [] }
      },
    })

    const config = { gfm: false }
    const result = await blocksApi.methods.importMarkdown('# Title', config)

    expect(calls).toEqual([['# Title', config]])
    expect(result).toEqual({ blocks: [] })
  })
})
