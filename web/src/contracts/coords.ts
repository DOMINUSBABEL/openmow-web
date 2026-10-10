/**
 * FROZEN CONTRACT (owner: Opus). Do not change without an entry in docs/ESCALATIONS.md.
 *
 * GEM2 world/model space: z-up, left-handed (Direct3D), 1 unit = 5 cm.
 * three.js space used by the client: y-up, right-handed, SAME units (no rescale).
 *
 * Mapping is a pure axis swap (a mirror, determinant -1):
 *   three.x = gem.x,  three.y = gem.z,  three.z = gem.y
 * Apply it ONCE, on the scene root that holds every GEM2 object (models, terrain, effects).
 * Never bake it into converted assets; GLB files keep raw GEM2 coordinates and matrices.
 */
import { Matrix4, Object3D, Vector3 } from 'three';

export const GEM_UNITS_PER_METER = 20;

export const GEM_TO_THREE = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

/** Root node for all GEM2-space content. */
export function createGemRoot(): Object3D {
  const root = new Object3D();
  root.name = 'gem-root';
  root.matrixAutoUpdate = false;
  root.matrix.copy(GEM_TO_THREE);
  root.matrixWorldNeedsUpdate = true;
  return root;
}

/** Convert a GEM2 position (x, y, z-up) into three.js world coordinates. */
export function gemToThree(x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, z, y);
}

/** Convert three.js world coordinates back to GEM2 (x, y, z-up). */
export function threeToGem(v: Vector3): [number, number, number] {
  return [v.x, v.z, v.y];
}

/** GEM2 `{xform zl <deg>}` heading: rotation about GEM z (up), degrees, as used in .mi files. */
export function gemHeadingRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}
