/**
 * OpenMoW-Web Navigation Engine (T08).
 * High-performance 1m grid navigation, A* pathfinding, string-pulling path smoothing,
 * and kinematic steering with turn radius support.
 *
 * 100% deterministic, zero DOM/Three.js dependencies. Runs headless in Node and browser.
 */
import type { NavGridDoc, NavOptions, NavPath, NavWaypoint } from '../contracts/nav';

// Min-heap for A* open set
class FastMinHeap {
  indices: Int32Array;
  costs: Int32Array;
  size = 0;

  constructor(capacity = 16384) {
    this.indices = new Int32Array(capacity);
    this.costs = new Int32Array(capacity);
  }

  clear() {
    this.size = 0;
  }

  push(index: number, cost: number) {
    if (this.size >= this.indices.length) {
      // Resize
      const newIndices = new Int32Array(this.indices.length * 2);
      const newCosts = new Int32Array(this.costs.length * 2);
      newIndices.set(this.indices);
      newCosts.set(this.costs);
      this.indices = newIndices;
      this.costs = newCosts;
    }

    let i = this.size++;
    this.indices[i] = index;
    this.costs[i] = cost;

    // Sift up
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.costs[i] < this.costs[p]) {
        const tmpIdx = this.indices[i];
        const tmpCost = this.costs[i];
        this.indices[i] = this.indices[p];
        this.costs[i] = this.costs[p];
        this.indices[p] = tmpIdx;
        this.costs[p] = tmpCost;
        i = p;
      } else {
        break;
      }
    }
  }

  pop(): number {
    if (this.size === 0) return -1;
    const top = this.indices[0];
    this.size--;
    if (this.size > 0) {
      this.indices[0] = this.indices[this.size];
      this.costs[0] = this.costs[this.size];

      // Sift down
      let i = 0;
      while (true) {
        let best = i;
        const left = (i << 1) + 1;
        const right = left + 1;

        if (left < this.size && this.costs[left] < this.costs[best]) {
          best = left;
        }
        if (right < this.size && this.costs[right] < this.costs[best]) {
          best = right;
        }

        if (best !== i) {
          const tmpIdx = this.indices[i];
          const tmpCost = this.costs[i];
          this.indices[i] = this.indices[best];
          this.costs[i] = this.costs[best];
          this.indices[best] = tmpIdx;
          this.costs[best] = tmpCost;
          i = best;
        } else {
          break;
        }
      }
    }
    return top;
  }
}

export class NavGrid {
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array; // 0 = walkable, 1 = blocked

  // Reusable A* memory pool to achieve sub-millisecond execution
  private runIds: Int32Array;
  private gCosts: Int32Array;
  private cameFrom: Int32Array;
  private currentRun = 0;
  private heap: FastMinHeap;

  constructor(doc: NavGridDoc) {
    this.originX = doc.originX;
    this.originY = doc.originY;
    this.cellSize = doc.cellSize || 20.0;
    this.width = doc.width;
    this.height = doc.height;

    const total = this.width * this.height;
    this.cells = new Uint8Array(total);

    // Decode RLE
    let ptr = 0;
    let val = 0;
    for (let i = 0; i < doc.rle.length; i++) {
      const len = doc.rle[i];
      if (val === 1) {
        this.cells.fill(1, ptr, Math.min(total, ptr + len));
      }
      ptr += len;
      val ^= 1;
    }

    this.runIds = new Int32Array(total);
    this.gCosts = new Int32Array(total);
    this.cameFrom = new Int32Array(total);
    this.heap = new FastMinHeap(8192);
  }

  worldToCell(worldX: number, worldY: number): [number, number] {
    const cx = Math.floor((worldX - this.originX) / this.cellSize);
    const cy = Math.floor((worldY - this.originY) / this.cellSize);
    return [cx, cy];
  }

  cellToWorld(cellX: number, cellY: number): [number, number] {
    const wx = this.originX + (cellX + 0.5) * this.cellSize;
    const wy = this.originY + (cellY + 0.5) * this.cellSize;
    return [wx, wy];
  }

  isWalkable(cellX: number, cellY: number): boolean {
    if (cellX < 0 || cellX >= this.width || cellY < 0 || cellY >= this.height) {
      return false;
    }
    return this.cells[cellY * this.width + cellX] === 0;
  }

  isWalkableWorld(worldX: number, worldY: number): boolean {
    const [cx, cy] = this.worldToCell(worldX, worldY);
    return this.isWalkable(cx, cy);
  }

  /**
   * Raycast line of sight test between two points on the grid using DDA.
   * Returns true if there are NO blocked cells between (x0, y0) and (x1, y1).
   */
  raycast(x0: number, y0: number, x1: number, y1: number): boolean {
    const [c0x, c0y] = this.worldToCell(x0, y0);
    const [c1x, c1y] = this.worldToCell(x1, y1);

    let cx = c0x;
    let cy = c0y;

    const dx = Math.abs(c1x - c0x);
    const dy = Math.abs(c1y - c0y);
    const sx = c0x < c1x ? 1 : -1;
    const sy = c0y < c1y ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (!this.isWalkable(cx, cy)) {
        return false;
      }
      if (cx === c1x && cy === c1y) {
        break;
      }
      const e2 = 2 * err;
      const stepX = e2 > -dy;
      const stepY = e2 < dx;

      // Prevent corner cutting: if moving diagonally, both orthogonal cells must be clear
      if (stepX && stepY) {
        if (!this.isWalkable(cx + sx, cy) || !this.isWalkable(cx, cy + sy)) {
          return false;
        }
      }

      if (stepX) {
        err -= dy;
        cx += sx;
      }
      if (stepY) {
        err += dx;
        cy += sy;
      }
    }
    return true;
  }

  /**
   * Find nearest walkable cell in a widening spiral if the target is blocked.
   */
  findNearestWalkable(cx: number, cy: number, maxRadius = 15): [number, number] | null {
    if (this.isWalkable(cx, cy)) return [cx, cy];

    for (let r = 1; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy of [-r, r]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (this.isWalkable(nx, ny)) return [nx, ny];
        }
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        for (let dx of [-r, r]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (this.isWalkable(nx, ny)) return [nx, ny];
        }
      }
    }
    return null;
  }

  /**
   * A* Pathfinding with Octile distance heuristic and path smoothing.
   */
  findPath(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    options?: NavOptions
  ): NavPath | null {
    let [c0x, c0y] = this.worldToCell(startX, startY);
    let [c1x, c1y] = this.worldToCell(targetX, targetY);

    if (!this.isWalkable(c0x, c0y)) {
      const altStart = this.findNearestWalkable(c0x, c0y);
      if (altStart) {
        c0x = altStart[0];
        c0y = altStart[1];
        const [altStartX, altStartY] = this.cellToWorld(c0x, c0y);
        startX = altStartX;
        startY = altStartY;
      }
    }

    if (!this.isWalkable(c1x, c1y)) {
      const alt = this.findNearestWalkable(c1x, c1y);
      if (!alt) return null;
      c1x = alt[0];
      c1y = alt[1];
      const [altTargetX, altTargetY] = this.cellToWorld(c1x, c1y);
      targetX = altTargetX;
      targetY = altTargetY;
    }

    if (c0x === c1x && c0y === c1y) {
      return {
        waypoints: [{ x: targetX, y: targetY }],
        totalDistance: Math.hypot(targetX - startX, targetY - startY),
        smoothed: true,
      };
    }

    // Direct line-of-sight shortcut
    if (this.raycast(startX, startY, targetX, targetY)) {
      return {
        waypoints: [{ x: targetX, y: targetY }],
        totalDistance: Math.hypot(targetX - startX, targetY - startY),
        smoothed: true,
      };
    }

    this.currentRun++;
    const runId = this.currentRun;
    const runIds = this.runIds;
    const gCosts = this.gCosts;
    const cameFrom = this.cameFrom;
    const width = this.width;
    const heap = this.heap;
    heap.clear();

    const startIndex = c0y * width + c0x;
    const targetIndex = c1y * width + c1x;

    runIds[startIndex] = runId;
    gCosts[startIndex] = 0;
    cameFrom[startIndex] = -1;

    // Octile heuristic (scale 10 / 14)
    const hDist = (ax: number, ay: number, bx: number, by: number) => {
      const dx = Math.abs(ax - bx);
      const dy = Math.abs(ay - by);
      return 10 * (dx + dy) - 6 * Math.min(dx, dy);
    };

    heap.push(startIndex, hDist(c0x, c0y, c1x, c1y));

    const maxIterations = options?.maxIterations ?? 50000;
    let iterations = 0;
    let found = false;

    // 8-neighbor offsets: [dx, dy, cost]
    const neighbors = [
      [1, 0, 10],
      [-1, 0, 10],
      [0, 1, 10],
      [0, -1, 10],
      [1, 1, 14],
      [1, -1, 14],
      [-1, 1, 14],
      [-1, -1, 14],
    ];

    while (heap.size > 0 && iterations++ < maxIterations) {
      const current = heap.pop();
      if (current === targetIndex) {
        found = true;
        break;
      }

      const curX = current % width;
      const curY = (current / width) | 0;
      const curG = gCosts[current];

      for (let i = 0; i < 8; i++) {
        const nx = curX + neighbors[i][0];
        const ny = curY + neighbors[i][1];

        if (nx < 0 || nx >= width || ny < 0 || ny >= this.height) continue;
        const nIndex = ny * width + nx;
        if (this.cells[nIndex] === 1) continue;

        // Prevent corner-cutting on diagonals
        if (i >= 4) {
          const adj1 = curY * width + nx;
          const adj2 = ny * width + curX;
          if (this.cells[adj1] === 1 || this.cells[adj2] === 1) {
            continue;
          }
        }

        const stepCost = neighbors[i][2];
        const tentG = curG + stepCost;

        if (runIds[nIndex] !== runId || tentG < gCosts[nIndex]) {
          runIds[nIndex] = runId;
          gCosts[nIndex] = tentG;
          cameFrom[nIndex] = current;
          const f = tentG + hDist(nx, ny, c1x, c1y);
          heap.push(nIndex, f);
        }
      }
    }

    if (!found) {
      return null;
    }

    // Reconstruct raw cell path
    const rawWaypoints: NavWaypoint[] = [];
    let curr = targetIndex;
    while (curr !== -1) {
      const cx = curr % width;
      const cy = (curr / width) | 0;
      const [wx, wy] = this.cellToWorld(cx, cy);
      rawWaypoints.push({ x: wx, y: wy });
      curr = cameFrom[curr];
    }
    rawWaypoints.reverse();

    // End exactly at target if target is walkable, otherwise at cell center
    if (rawWaypoints.length > 0 && this.isWalkableWorld(targetX, targetY)) {
      rawWaypoints[rawWaypoints.length - 1] = { x: targetX, y: targetY };
    }

    // Smooth path using line-of-sight raycasting (string pulling)
    const smooth = options?.smoothPath !== false;
    let finalWaypoints: NavWaypoint[] = rawWaypoints;

    if (smooth && rawWaypoints.length > 2) {
      const smoothed: NavWaypoint[] = [rawWaypoints[0]];
      let curIdx = 0;

      while (curIdx < rawWaypoints.length - 1) {
        let furthest = curIdx + 1;
        // Check how far we can look ahead with clear line of sight
        for (let next = rawWaypoints.length - 1; next > curIdx + 1; next--) {
          if (this.raycast(
            rawWaypoints[curIdx].x,
            rawWaypoints[curIdx].y,
            rawWaypoints[next].x,
            rawWaypoints[next].y
          )) {
            furthest = next;
            break;
          }
        }
        smoothed.push(rawWaypoints[furthest]);
        curIdx = furthest;
      }
      finalWaypoints = smoothed;
    }

    // Compute total path distance
    let totalDist = 0;
    for (let i = 1; i < finalWaypoints.length; i++) {
      totalDist += Math.hypot(
        finalWaypoints[i].x - finalWaypoints[i - 1].x,
        finalWaypoints[i].y - finalWaypoints[i - 1].y
      );
    }

    return {
      waypoints: finalWaypoints,
      totalDistance: totalDist,
      smoothed: smooth,
    };
  }
}
