/**
 * FROZEN CONTRACT (T08 / Navigation).
 * Specification for the 1m navigation grid and pathfinding.
 */

export interface NavGridDoc {
  mission: string;
  originX: number;     // GEM2 units (e.g. -4440.0)
  originY: number;     // GEM2 units (e.g. -8160.0)
  cellSize: number;    // GEM2 units per cell (20 = 1 meter)
  width: number;       // Grid width in cells
  height: number;      // Grid height in cells
  blockedCount: number;
  totalCells: number;
  rle: number[];       // Alternating run lengths [count0, count1, count0, ...]
}

export interface NavWaypoint {
  x: number;
  y: number;
}

export interface NavPath {
  waypoints: NavWaypoint[];
  totalDistance: number;
  smoothed: boolean;
}

export interface NavOptions {
  allowDiagonal?: boolean;
  smoothPath?: boolean;
  maxIterations?: number;
  turnRadius?: number;    // Radius in GEM units (0 for infantry)
}
