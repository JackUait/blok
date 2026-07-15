import { describe, it, expect } from 'vitest'

import * as iconsEntry from '../../../src/icons'
import * as iconsSource from '../../../src/components/icons'

/**
 * The `@blok/core/icons` subpath exists so a third-party block author can
 * reuse the exact SVG constants the first-party tools use for their toolbox and
 * settings UI — without copying SVG markup. The public entry (`src/icons`) must
 * therefore re-export the full icon module verbatim.
 */
describe('@blok/core/icons public entry', () => {
  it('re-exports every symbol from the internal icon module', () => {
    expect(Object.keys(iconsEntry).sort()).toEqual(Object.keys(iconsSource).sort())
  })

  it('exposes the icon SVG string constants used by first-party tools', () => {
    const entry = iconsEntry as Record<string, unknown>
    for (const name of ['IconText', 'IconQuote', 'IconListBulleted', 'IconH1', 'IconImage']) {
      expect(typeof entry[name], `${name} should be an exported SVG string`).toBe('string')
      expect((entry[name] as string).length).toBeGreaterThan(0)
    }
  })
})
