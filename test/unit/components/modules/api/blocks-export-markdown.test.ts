import { describe, it, expect } from 'vitest'

import { BlocksAPI } from '../../../../../src/components/modules/api/blocks'
import { EventsDispatcher } from '../../../../../src/components/utils/events'

import type { ModuleConfig } from '../../../../../src/types-internal/module-config'
import type { OutputData } from '../../../../../types'
import type { BlokEventMap } from '../../../../../src/components/events'
import type { BlokModules } from '../../../../../src/types-internal/blok-modules'

/**
 * `blocks.importMarkdown` had no outbound twin: `blocksToMarkdown` existed but was
 * reachable only from the clipboard. `blocks.exportMarkdown` is the symmetric
 * public export path — Markdown in, Markdown out.
 */
describe('BlocksAPI.exportMarkdown', () => {
  const createBlocksApi = (saved: OutputData | undefined): BlocksAPI => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>()
    const moduleConfig: ModuleConfig = {
      config: { defaultBlock: 'paragraph' },
      eventsDispatcher,
    }

    const blocksApi = new BlocksAPI(moduleConfig)

    blocksApi.state = {
      Saver: {
        save: async (): Promise<OutputData | undefined> => saved,
      },
    } as unknown as BlokModules

    return blocksApi
  }

  it('exposes exportMarkdown on the tool-facing methods surface', () => {
    const blocksApi = createBlocksApi({ blocks: [] })

    expect(typeof blocksApi.methods.exportMarkdown).toBe('function')
  })

  it('serializes the saved document to Markdown', async () => {
    const blocksApi = createBlocksApi({
      blocks: [
        { id: 'h', type: 'header', data: { text: 'Title', level: 1 } },
        { id: 'p', type: 'paragraph', data: { text: 'Intro' } },
      ],
    })

    expect(await blocksApi.exportMarkdown()).toBe('# Title\n\nIntro')
  })

  it('serializes a table as a pipe table without leaking its cell blocks as loose lines', async () => {
    const blocksApi = createBlocksApi({
      blocks: [
        {
          id: 't',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              [{ blocks: ['c1'] }, { blocks: ['c2'] }],
              [{ blocks: ['c3'] }, { blocks: ['c4'] }],
            ],
          },
        },
        { id: 'c1', type: 'paragraph', data: { text: 'a' }, parent: 't' },
        { id: 'c2', type: 'paragraph', data: { text: 'b' }, parent: 't' },
        { id: 'c3', type: 'paragraph', data: { text: 'c' }, parent: 't' },
        { id: 'c4', type: 'paragraph', data: { text: 'd' }, parent: 't' },
      ],
    })

    expect(await blocksApi.exportMarkdown()).toBe('| a | b |\n| --- | --- |\n| c | d |')
  })

  it('indents structurally nested blocks by their depth', async () => {
    const blocksApi = createBlocksApi({
      blocks: [
        { id: 'parent', type: 'paragraph', data: { text: 'root' } },
        { id: 'child', type: 'paragraph', data: { text: 'nested' }, parent: 'parent' },
      ],
    })

    expect(await blocksApi.exportMarkdown()).toBe('root\n\n    nested')
  })

  it('returns an empty string when there is nothing to save', async () => {
    const blocksApi = createBlocksApi(undefined)

    expect(await blocksApi.exportMarkdown()).toBe('')
  })
})
