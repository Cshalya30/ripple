/**
 * Draws the dependency lines of the Flow so they run between the boxes, not across them.
 * Every line is a few straight, right-angled pieces. For each one we try a set of candidate routes and keep the
 * one that touches the fewest boxes (then the shortest). Pure geometry; no React.
 */
import { NODE_H, NODE_W } from './model'

export interface Rect { id: string; x: number; y: number; w: number; h: number }
export type Point = [number, number]

const PAD = 3

/** Does an axis-aligned segment cross the (padded) rectangle? */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const left = r.x - PAD
  const right = r.x + r.w + PAD
  const top = r.y - PAD
  const bottom = r.y + r.h + PAD
  const minX = Math.min(a[0], b[0])
  const maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxY = Math.max(a[1], b[1])
  return maxX > left && minX < right && maxY > top && minY < bottom
}

function hits(points: Point[], obstacles: Rect[], skip: Set<string>): number {
  let n = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const r of obstacles) if (!skip.has(r.id) && crosses(points[i], points[i + 1], r)) n += 1
  }
  return n
}

function length(points: Point[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) total += Math.abs(points[i + 1][0] - points[i][0]) + Math.abs(points[i + 1][1] - points[i][1])
  return total
}

/** Drop repeated points and merge collinear runs so rounding the corners is clean. */
function tidy(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    out.push(p)
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true
    const a = out[i - 1]
    const b = out[i + 1]
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]))
  })
}

/** From the right edge of `from` to the left edge of `to`. `obstacles` are every box and waiting bar on the canvas. */
export function routeLink(from: Rect, to: Rect, obstacles: Rect[]): Point[] {
  const sx = from.x + from.w
  const sy = from.y + NODE_H / 2
  const tx = to.x
  const ty = to.y + NODE_H / 2
  const skip = new Set([from.id, to.id])
  const candidates: { points: Point[]; bends: number }[] = []

  if (tx - sx >= 16) {
    if (Math.abs(sy - ty) < 1) candidates.push({ points: [[sx, sy], [tx, ty]], bends: 0 })
    const lo = sx + 8
    const hi = tx - 8
    const steps = Math.min(36, Math.max(1, Math.floor((hi - lo) / 4)))
    for (let i = 0; i <= steps; i += 1) {
      const xm = lo + ((hi - lo) * i) / steps
      candidates.push({ points: [[sx, sy], [xm, sy], [xm, ty], [tx, ty]], bends: 2 })
    }
  }
  // Around: leave to the right, run along a gap between rows, come in from the left. Always possible.
  const gaps = [from.y - 12, from.y + NODE_H + 12, to.y - 12, to.y + NODE_H + 12, (sy + ty) / 2]
  const out = tx - sx >= 16 ? 8 : 12
  for (const gy of gaps) {
    candidates.push({ points: [[sx, sy], [sx + out, sy], [sx + out, gy], [tx - out, gy], [tx - out, ty], [tx, ty]], bends: 4 })
  }

  let best = candidates[0]
  let bestCost = Infinity
  const mid = (sx + tx) / 2
  for (const c of candidates) {
    const cost = hits(c.points, obstacles, skip) * 1000 + length(c.points) * 0.02 + c.bends * 4 + (c.bends === 2 ? Math.abs(c.points[1][0] - mid) * 0.01 : 0)
    if (cost < bestCost) { best = c; bestCost = cost }
  }
  return tidy(best.points)
}

/** SVG path through the points with softly rounded corners. */
export function roundedPath(points: Point[], radius = 7): string {
  if (points.length < 2) return ''
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1])
    const outLen = Math.abs(next[0] - cur[0]) + Math.abs(next[1] - cur[1])
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const inDir: Point = [Math.sign(cur[0] - prev[0]), Math.sign(cur[1] - prev[1])]
    const outDir: Point = [Math.sign(next[0] - cur[0]), Math.sign(next[1] - cur[1])]
    d += ` L${cur[0] - inDir[0] * r},${cur[1] - inDir[1] * r} Q${cur[0]},${cur[1]} ${cur[0] + outDir[0] * r},${cur[1] + outDir[1] * r}`
  }
  const last = points.at(-1)!
  return `${d} L${last[0]},${last[1]}`
}

export const nodeRect = (id: string, x: number, y: number): Rect => ({ id, x, y, w: NODE_W, h: NODE_H })
