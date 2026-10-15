import { describe, expect, it } from 'vitest'
import { NODE_H, NODE_W } from './model'
import { nodeRect, roundedPath, routeLink, type Point, type Rect } from './router'

const crossesBox = (points: Point[], r: Rect) => {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a, b] = [points[i], points[i + 1]]
    if (Math.max(a[0], b[0]) > r.x && Math.min(a[0], b[0]) < r.x + r.w && Math.max(a[1], b[1]) > r.y && Math.min(a[1], b[1]) < r.y + r.h) return true
  }
  return false
}

describe('routeLink', () => {
  it('goes straight between two boxes on one row', () => {
    const a = nodeRect('a', 0, 100)
    const b = nodeRect('b', 400, 100)
    expect(routeLink(a, b, [a, b])).toEqual([[NODE_W, 100 + NODE_H / 2], [400, 100 + NODE_H / 2]])
  })

  it('steps around a box that sits in the way on the same row', () => {
    const a = nodeRect('a', 0, 100)
    const wall = nodeRect('wall', 200, 100)
    const b = nodeRect('b', 500, 100)
    const route = routeLink(a, b, [a, wall, b])
    expect(route.length).toBeGreaterThan(2)
    expect(crossesBox(route, wall)).toBe(false)
  })

  it('changes row in a free channel between two columns', () => {
    const a = nodeRect('a', 0, 100)
    const b = nodeRect('b', 400, 300)
    const route = routeLink(a, b, [a, b])
    expect(route.length).toBe(4)
    expect(route[0]).toEqual([NODE_W, 126])
    expect(route.at(-1)).toEqual([400, 326])
    expect(route[1][0]).toBe(route[2][0]) // one vertical piece
    expect(route[1][0]).toBeGreaterThan(NODE_W)
    expect(route[1][0]).toBeLessThan(400)
  })

  it('avoids a box standing in the vertical channel', () => {
    const a = nodeRect('a', 0, 100)
    const b = nodeRect('b', 400, 300)
    const blocker = nodeRect('blocker', 150, 180) // sits between the rows, mid-way across
    const route = routeLink(a, b, [a, b, blocker])
    expect(crossesBox(route, blocker)).toBe(false)
  })

  it('loops around when the target starts before the source ends', () => {
    const a = nodeRect('a', 300, 100)
    const b = nodeRect('b', 320, 300)
    const route = routeLink(a, b, [a, b])
    expect(route[0]).toEqual([300 + NODE_W, 126])
    expect(route.at(-1)).toEqual([320, 326])
    expect(route.length).toBeGreaterThanOrEqual(5)
    expect(crossesBox(route, a)).toBe(false)
    expect(crossesBox(route, b)).toBe(false)
  })
})

describe('roundedPath', () => {
  it('rounds corners and keeps the end points', () => {
    const d = roundedPath([[0, 0], [100, 0], [100, 100]], 10)
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d).toContain('Q100,0 100,10')
    expect(d.endsWith('L100,100')).toBe(true)
  })
  it('never rounds more than half a short piece', () => {
    expect(roundedPath([[0, 0], [10, 0], [10, 10]], 50)).toContain('Q10,0 10,5')
  })
})
