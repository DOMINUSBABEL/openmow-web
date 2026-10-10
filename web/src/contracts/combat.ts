/**
 * FROZEN CONTRACT: Combat & Ballistics Types (T10 / Gate G3).
 * Governs weapon profiles, ballistic trajectory, armor penetration, and damage calculation.
 */

export type AmmoKind = 'bullet' | 'ap' | 'apcr' | 'fg' | 'grenade';
export type WeaponClass = 'rifle' | 'pistol' | 'smg' | 'mgun' | 'cannon' | 'rocket' | 'grenade';
export type ArmorAspect = 'front' | 'side' | 'rear' | 'top';

export interface WeaponSpec {
  name: string;
  proto: string;
  weaponClass: WeaponClass;
  range: [minM: number, maxM: number]; // in meters (1m = 20 GEM units)
  healthDamage: number;                // direct health damage to humans
  rechargeTime: number;               // reload time in seconds
  recoveryTime: number;               // interval between consecutive shots in seconds
  bulletSpeed: number;                // muzzle velocity in m/s
  projectileDamageTable: Record<number, number>; // distance in meters -> penetration in mm
  burst: { short: number; long: number };
  ammoType: AmmoKind;
  accuracySpread: number;             // spread multiplier
  explosive?: { radiusM: number; damage: number };
  fireSound?: string;                 // e.g. 'rifle/m1_shot', 'smg/mp40_burst'
}

export interface ArmorSettings {
  front: number; // mm
  side: number;  // mm
  rear: number;  // mm
  top: number;   // mm
}

export interface HitResult {
  hit: boolean;
  point: [x: number, y: number, z: number];
  distanceM: number;
  penetrated: boolean;
  effectiveArmorMm: number;
  nominalArmorMm: number;
  penetrationMm: number;
  impactAngleDeg: number;
  ricochet: boolean;
  damageDealt: number;
  targetKilled: boolean;
  componentHit?: string;
  targetId: number;
  shooterId: number;
}

export interface ActiveProjectile {
  id: number;
  shooterId: number;
  targetEntityId?: number;
  weapon: WeaponSpec;
  x: number;
  y: number;
  z: number;
  vx: number; // GEM units / s
  vy: number; // GEM units / s
  vz: number; // GEM units / s
  traveledUnits: number;
  maxDistanceUnits: number;
  alive: boolean;
}
