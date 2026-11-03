import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mermaid bundles these; they are not Blok dependencies, so they load untyped.
const load = createRequire(import.meta.url)

interface LayoutNode {
  id: () => string
  data: (key: string) => number
  position: (axis: 'x' | 'y') => number
  layoutDimensions: () => { w: number; h: number }
}

interface Graph {
  add: (element: { group: 'nodes' | 'edges'; data: Record<string, string | number>; position?: { x: number; y: number } }) => void
  nodes: () => LayoutNode[]
  layout: (options: Record<string, unknown>) => { run: () => void }
}

type Cytoscape = ((options: Record<string, unknown>) => Graph) & { use: (extension: unknown) => void }

const isCytoscape = (value: unknown): value is Cytoscape =>
  typeof value === 'function' && 'use' in value && typeof value.use === 'function'

const loaded: unknown = load('cytoscape')

if (!isCytoscape(loaded)) {
  throw new TypeError('cytoscape did not load')
}

const cytoscape = loaded

cytoscape.use(load('cytoscape-cose-bilkent'))
cytoscape.use(load('cytoscape-fcose'))

// The layouts call Math.random; a fixed sequence makes runs comparable.
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sizeNodes = (graph: Graph): void => {
  for (const node of graph.nodes()) {
    node.layoutDimensions = () => ({ w: node.data('width'), h: node.data('height') })
  }
}

// The options mermaid passes for a mindmap.
const mindmapPositions = (): Array<[string, number, number]> => {
  vi.spyOn(Math, 'random').mockImplementation(seeded(7))
  const graph = cytoscape({ headless: true, styleEnabled: false })

  for (let i = 0; i < 12; i++) {
    graph.add({ group: 'nodes', data: { id: `n${i}`, width: 60 + (i % 4) * 30, height: 40 }, position: { x: 0, y: 0 } })
  }
  for (let i = 1; i < 12; i++) {
    graph.add({ group: 'edges', data: { id: `e${i}`, source: `n${Math.floor((i - 1) / 3)}`, target: `n${i}` } })
  }
  sizeNodes(graph)
  graph.layout({ name: 'cose-bilkent', quality: 'proof', styleEnabled: false, animate: false }).run()

  return graph.nodes().map((node) => [node.id(), node.position('x'), node.position('y')])
}

// An architecture diagram: fcose with constraints, as mermaid runs it.
const runArchitecture = (): void => {
  vi.spyOn(Math, 'random').mockImplementation(seeded(42))
  const graph = cytoscape({ headless: true, styleEnabled: false })

  ;['db', 'disk', 'server', 'gateway'].forEach((id, i) => {
    graph.add({ group: 'nodes', data: { id, width: 80, height: 80 }, position: { x: i * 100, y: (i % 2) * 100 } })
  })
  ;[['db', 'server'], ['disk', 'server'], ['server', 'gateway']].forEach(([source, target], i) => {
    graph.add({ group: 'edges', data: { id: `a${i}`, source, target } })
  })
  sizeNodes(graph)
  graph.layout({
    name: 'fcose',
    quality: 'proof',
    randomize: false,
    nodeSeparation: 75,
    styleEnabled: false,
    animate: false,
    idealEdgeLength: () => 120,
    alignmentConstraint: { horizontal: [['db', 'server']] },
    relativePlacementConstraint: [{ left: 'disk', right: 'server', gap: 80 }],
  }).run()
}

describe('mermaid layout engine shared by mindmap and architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lays out a mindmap the same after an architecture diagram ran on the page', () => {
    const alone = mindmapPositions()

    runArchitecture()

    expect(mindmapPositions()).toEqual(alone)
  })
})
