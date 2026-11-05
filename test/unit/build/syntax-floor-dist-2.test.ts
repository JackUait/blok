import { describe, it, expect } from 'vitest'

import { scanDistShard } from './syntax-floor-scan'

describe('JS build target', () => {
  it('emits no syntax newer than the floor in dist shard 2', () => {
    expect(scanDistShard(1)).toEqual([])
  }, 300_000)
})
