/**
 * OpenMoW-Web Deterministic Combat & Ballistics Engine (T10 / Gate G3).
 *
 * Implements:
 * 1. Weapon and ammo profiles derived directly from GEM2 game data (/set/stuff/):
 *    - Range (meters), healthDamage, rechargeTime, recoveryTime, bulletSpeed.
 *    - Projectile damage & penetration tables (penetration in mm vs distance in meters).
 * 2. Armor and volume model:
 *    - Nominal thickness per component (turret, body, mantlet, engine, track).
 *    - Aspect calculation: Front (|angle| <= 45°), Side (45°..135°), Rear (> 135°).
 *    - Slope and angle of incidence: T_eff = T / cos(alpha).
 *    - Ricochet / bounce mechanics (angles >= 70° or penetration < T_eff).
 * 3. Human hit resolution:
 *    - Direct healthDamage dealt to human 100 HP health pool.
 *    - Lethality check (e.g. Garand 160 dmg or Mosin 200 dmg kills in 1 shot at 30m).
 * 4. Active projectile trajectory and deterministic collision detection.
 *
 * Pure deterministic engine code, zero Three.js/DOM dependencies.
 */

import type { SimEntity } from './components';
import type { World } from './world';
import { issueMoveOrder } from './orders';
import type {
  WeaponSpec,
  ArmorSettings,
  HitResult,
  ActiveProjectile,
  ArmorAspect,
} from '../contracts/combat';
import type { ProtoDoc } from '../contracts/proto';

export const GEM_UNITS_PER_METER = 20;

// Standard GEM2 Weapon Profiles extracted from /set/stuff/
export const BUILTIN_WEAPONS: Record<string, WeaponSpec> = {
  garand: {
    name: 'M1 Garand',
    proto: 'garand',
    weaponClass: 'rifle',
    range: [65, 70],
    healthDamage: 160, // /set/stuff/rifle/garand
    rechargeTime: 3.0,
    recoveryTime: 0.4,
    bulletSpeed: 426.5, // m/s
    projectileDamageTable: { 10: 5, 50: 5, 100: 0 },
    burst: { short: 1, long: 1 },
    ammoType: 'bullet',
    accuracySpread: 0.6,
    fireSound: 'rifle/m1_shot',
  },
  mosin: {
    name: 'Mosin-Nagant M91/30',
    proto: 'mosin',
    weaponClass: 'rifle',
    range: [65, 70],
    healthDamage: 200, // /set/stuff/rifle/rifle.pattern
    rechargeTime: 3.0,
    recoveryTime: 2.4,
    bulletSpeed: 425.0,
    projectileDamageTable: { 10: 5, 50: 5, 100: 0 },
    burst: { short: 1, long: 1 },
    ammoType: 'bullet',
    accuracySpread: 0.5,
    fireSound: 'rifle/mosin_shot',
  },
  k98: {
    name: 'Karabiner 98k',
    proto: 'k98',
    weaponClass: 'rifle',
    range: [65, 70],
    healthDamage: 200,
    rechargeTime: 3.0,
    recoveryTime: 2.4,
    bulletSpeed: 425.0,
    projectileDamageTable: { 10: 5, 50: 5, 100: 0 },
    burst: { short: 1, long: 1 },
    ammoType: 'bullet',
    accuracySpread: 0.5,
    fireSound: 'rifle/mauzer_shot',
  },
  mp40: {
    name: 'MP 40',
    proto: 'mp40',
    weaponClass: 'smg',
    range: [45, 50],
    healthDamage: 35, // 3 shots required to kill 100 HP soldier
    rechargeTime: 2.8,
    recoveryTime: 0.1,
    bulletSpeed: 300.0,
    projectileDamageTable: { 10: 4, 30: 2, 50: 0 },
    burst: { short: 3, long: 6 },
    ammoType: 'bullet',
    accuracySpread: 0.8,
    fireSound: 'smg/mp40_burst',
  },
  colt: {
    name: 'Colt M1911',
    proto: 'colt',
    weaponClass: 'pistol',
    range: [25, 30],
    healthDamage: 35,
    rechargeTime: 2.0,
    recoveryTime: 0.35,
    bulletSpeed: 250.0,
    projectileDamageTable: { 10: 2, 30: 0 },
    burst: { short: 1, long: 1 },
    ammoType: 'bullet',
    accuracySpread: 1.0,
    fireSound: 'pistol/colt',
  },
  '88mm_kwk36': {
    name: '8.8 cm KwK 36 L/56 (Tiger I)',
    proto: '88mm_kwk36',
    weaponClass: 'cannon',
    range: [130, 140],
    healthDamage: 200,
    rechargeTime: 6.0, // /set/stuff/gun/88mm_kwk36
    recoveryTime: 6.0,
    bulletSpeed: 400.0,
    // Exact table from /set/stuff/gun/88mm_kwk36 damage2:
    projectileDamageTable: {
      10: 139,
      50: 127,
      75: 115,
      100: 105,
      125: 97,
      150: 77.6,
      200: 0,
    },
    burst: { short: 1, long: 1 },
    ammoType: 'ap',
    accuracySpread: 0.3,
    fireSound: 'cannon/gun_heavy',
  },
  '75mm_m3': {
    name: '75 mm Gun M3 (Sherman M4A3)',
    proto: '75mm_m3',
    weaponClass: 'cannon',
    range: [110, 120],
    healthDamage: 150,
    rechargeTime: 6.0, // /set/stuff/gun/75mm_m3
    recoveryTime: 6.0,
    bulletSpeed: 309.5,
    // Exact table from /set/stuff/gun/75mm_m3 damage:
    projectileDamageTable: {
      10: 102,
      50: 84,
      75: 68,
      100: 54,
      125: 44,
      130: 41.8,
      175: 0,
    },
    burst: { short: 1, long: 1 },
    ammoType: 'ap',
    accuracySpread: 0.4,
    fireSound: 'cannon/gun_medium',
  },
};

// Standard Tank Armor Tables from GEM2 tank .def files
export const BUILTIN_ARMOR: Record<string, Record<string, ArmorSettings>> = {
  m4a3_75: {
    // /entity/-vehicle/tank_medium/m4a3_75/m4a3_75.def: ("armor_medium" turret(76 51 51 25) body(51 38 38 22))
    turret: { front: 76, side: 51, rear: 51, top: 25 },
    body: { front: 51, side: 38, rear: 38, top: 22 },
    mantlet: { front: 89, side: 89, rear: 89, top: 89 },
    engine: { front: 40, side: 38, rear: 38, top: 22 },
    track: { front: 18, side: 18, rear: 18, top: 18 },
  },
  pz6e: {
    // /entity/-vehicle/tank_heavy/pz6e/pz6e.def: ("armor_heavy" turret(100 80 80 25) body(100 80 80 25))
    turret: { front: 100, side: 80, rear: 80, top: 25 },
    body: { front: 100, side: 80, rear: 80, top: 25 },
    mantlet: { front: 120, side: 120, rear: 120, top: 120 },
    engine: { front: 10, side: 80, rear: 80, top: 25 },
    track: { front: 20, side: 20, rear: 20, top: 20 },
  },
};

/**
 * Calculate target aspect relative to incoming projectile direction.
 * Front: |angle| <= 45°
 * Side:  45° < |angle| <= 135°
 * Rear:  |angle| > 135°
 */
export function calculateAspect(
  targetHeadingDeg: number,
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number
): ArmorAspect {
  // Vector from shooter to target (direction of incoming fire)
  const dirX = targetX - shooterX;
  const dirY = targetY - shooterY;
  const incomingFireAngleDeg = (Math.atan2(dirY, dirX) * 180) / Math.PI;

  // In GEM2 coordinate system, angle diff between incoming fire and target heading:
  // Direct frontal hit means fire arrives opposite to target's heading (diff = 180).
  let angleDiff = Math.abs(incomingFireAngleDeg - targetHeadingDeg) % 360;
  if (angleDiff > 180) {
    angleDiff = 360 - angleDiff;
  }

  // Heading is the front direction of the vehicle:
  // If projectile arrives from the front: angleDiff is near 180 degrees (opposite direction).
  // Relative approach angle from vehicle forward vector:
  const aspectAngle = 180 - angleDiff;

  if (aspectAngle <= 45) {
    return 'front';
  } else if (aspectAngle <= 135) {
    return 'side';
  } else {
    return 'rear';
  }
}

/**
 * Calculate effective armor thickness given nominal plate thickness and impact angle.
 * alpha: Angle of incidence from surface normal in degrees (0° = perpendicular).
 * If alpha >= 70°: ricochet threshold!
 */
export function calculateEffectiveArmor(nominalMm: number, impactAngleDeg: number): number {
  if (nominalMm <= 0) return 0;
  const clampedAngle = Math.max(0, Math.min(89, Math.abs(impactAngleDeg)));
  if (clampedAngle >= 70) {
    return Infinity; // Automatic ricochet / bounce
  }
  const cosAlpha = Math.cos((clampedAngle * Math.PI) / 180);
  return nominalMm / cosAlpha;
}

/**
 * Linearly interpolate penetration in mm from weapon's projectileDamageTable at distance in meters.
 */
export function getPenetrationAtDistance(weapon: WeaponSpec, distanceM: number): number {
  const table = weapon.projectileDamageTable;
  const distances = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  if (distances.length === 0) return 0;
  if (distanceM <= distances[0]) return table[distances[0]];
  if (distanceM >= distances[distances.length - 1]) return table[distances[distances.length - 1]];

  for (let i = 0; i < distances.length - 1; i++) {
    const d0 = distances[i];
    const d1 = distances[i + 1];
    if (distanceM >= d0 && distanceM <= d1) {
      const p0 = table[d0];
      const p1 = table[d1];
      const t = (distanceM - d0) / (d1 - d0);
      return p0 + (p1 - p0) * t;
    }
  }

  return 0;
}

/**
 * Evaluate armor penetration and damage against a vehicle.
 */
export function evaluateVehicleHit(
  weapon: WeaponSpec,
  distanceM: number,
  target: SimEntity,
  impactAngleDeg = 0,
  componentName = 'body',
  shooterX = 0,
  shooterY = 0
): HitResult {
  const penetrationMm = getPenetrationAtDistance(weapon, distanceM);

  // Determine aspect (front, side, rear)
  const aspect = calculateAspect(target.transform.zl, shooterX, shooterY, target.transform.x, target.transform.y);

  // Determine nominal armor
  let nominalArmorMm = 15; // default fallback
  if (target.armor && target.armor.settings[componentName]) {
    nominalArmorMm = target.armor.settings[componentName][aspect] ?? 15;
  } else if (BUILTIN_ARMOR[target.proto]?.[componentName]) {
    nominalArmorMm = BUILTIN_ARMOR[target.proto][componentName][aspect] ?? 15;
  }

  // Calculate effective armor
  const effectiveArmorMm = calculateEffectiveArmor(nominalArmorMm, impactAngleDeg);
  const ricochet = impactAngleDeg >= 70 || penetrationMm < effectiveArmorMm;
  const penetrated = !ricochet && penetrationMm >= effectiveArmorMm;

  let damageDealt = 0;
  let targetKilled = false;

  if (penetrated) {
    // Penetration deals severe internal damage
    damageDealt = weapon.healthDamage > 0 ? weapon.healthDamage : Math.round(penetrationMm - effectiveArmorMm + 50);
    target.health.current = Math.max(0, target.health.current - damageDealt);

    // Component durability degradation
    if (target.armor) {
      target.armor.durability[componentName] = Math.max(0, (target.armor.durability[componentName] ?? 1.0) - 0.5);
    }

    if (target.health.current <= 0) {
      target.health.alive = false;
      targetKilled = true;
    }
  } else {
    // Non-penetration / Ricochet: spall damage or zero
    damageDealt = 0;
  }

  return {
    hit: true,
    point: [target.transform.x, target.transform.y, target.transform.z],
    distanceM,
    penetrated,
    effectiveArmorMm: Number.isFinite(effectiveArmorMm) ? Math.round(effectiveArmorMm * 10) / 10 : 9999,
    nominalArmorMm,
    penetrationMm: Math.round(penetrationMm * 10) / 10,
    impactAngleDeg,
    ricochet,
    damageDealt,
    targetKilled,
    componentHit: componentName,
    targetId: target.id,
    shooterId: 0,
  };
}

/**
 * Evaluate bullet hit against infantry / human.
 */
export function evaluateHumanHit(weapon: WeaponSpec, distanceM: number, target: SimEntity): HitResult {
  const damage = weapon.healthDamage;
  target.health.current = Math.max(0, target.health.current - damage);
  const targetKilled = target.health.current <= 0;
  if (targetKilled) {
    target.health.alive = false;
  }

  return {
    hit: true,
    point: [target.transform.x, target.transform.y, target.transform.z],
    distanceM,
    penetrated: true,
    effectiveArmorMm: 0,
    nominalArmorMm: 0,
    penetrationMm: getPenetrationAtDistance(weapon, distanceM),
    impactAngleDeg: 0,
    ricochet: false,
    damageDealt: damage,
    targetKilled,
    componentHit: 'torso',
    targetId: target.id,
    shooterId: 0,
  };
}

/**
 * Setup weapon and combat component for an entity from proto or defaults.
 */
export function setupEntityCombat(entity: SimEntity, _protoDoc?: ProtoDoc) {
  if (entity.kind === 'human') {
    // Resolve primary weapon from inventory or proto
    let weaponKey = 'garand';
    const protoLower = entity.proto.toLowerCase();
    if (protoLower.includes('ger') || protoLower.includes('k98')) {
      weaponKey = 'k98';
    } else if (protoLower.includes('rus') || protoLower.includes('mosin')) {
      weaponKey = 'mosin';
    } else if (protoLower.includes('mgun') || protoLower.includes('smg')) {
      weaponKey = 'mp40';
    } else if (protoLower.includes('tankman')) {
      weaponKey = 'colt';
    }

    const weapon = BUILTIN_WEAPONS[weaponKey] ?? BUILTIN_WEAPONS['garand'];
    entity.combat = {
      weapon,
      ammoCount: 50,
      maxAmmo: 100,
      reloadTimer: 0,
      cooldownTimer: 0,
      shotsFired: 0,
      kills: 0,
      suppression: 0,
    };
  } else if (entity.kind === 'entity') {
    // Vehicles / Cannons
    const protoLower = entity.proto.toLowerCase();
    let weaponKey: string | undefined;

    if (protoLower.includes('pz6') || protoLower.includes('tiger')) {
      weaponKey = '88mm_kwk36';
    } else if (protoLower.includes('m4a3') || protoLower.includes('sherman')) {
      weaponKey = '75mm_m3';
    } else if (protoLower.includes('pz4') || protoLower.includes('pz3')) {
      weaponKey = '75mm_m3';
    }

    if (weaponKey && BUILTIN_WEAPONS[weaponKey]) {
      entity.combat = {
        weapon: BUILTIN_WEAPONS[weaponKey],
        ammoCount: 40,
        maxAmmo: 60,
        reloadTimer: 0,
        cooldownTimer: 0,
        shotsFired: 0,
        kills: 0,
        suppression: 0,
      };
    }

    // Setup armor settings
    if (BUILTIN_ARMOR[entity.proto]) {
      entity.armor = {
        settings: { ...BUILTIN_ARMOR[entity.proto] },
        durability: { body: 1.0, turret: 1.0, mantlet: 1.0, engine: 1.0, track: 1.0 },
      };
    }
  }
}

/**
 * Deterministic Combat Engine managing firing, projectiles, and hit resolution.
 */
export class CombatEngine {
  private world: World;
  private nextProjId = 1;
  public activeProjectiles: ActiveProjectile[] = [];

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Order a unit to attack a target entity.
   */
  orderAttack(shooterId: number, targetId: number): boolean {
    const shooter = this.world.getEntity(shooterId);
    const target = this.world.getEntity(targetId);
    if (!shooter || !target || !shooter.health.alive || !target.health.alive) return false;
    if (!shooter.combat?.weapon) return false;

    shooter.combat.targetEntityId = targetId;
    return true;
  }

  /**
   * Attempt to fire unit weapon at a target entity.
   */
  fireAtTarget(shooterId: number, targetId: number): boolean {
    const shooter = this.world.getEntity(shooterId);
    const target = this.world.getEntity(targetId);
    if (!shooter || !target || !shooter.health.alive || !target.health.alive) return false;
    const combat = shooter.combat;
    if (!combat || !combat.weapon) return false;
    const weapon = combat.weapon;

    // Check cooldown and ammo
    if (combat.cooldownTimer > 0 || combat.reloadTimer > 0) return false;
    if (combat.ammoCount <= 0) {
      combat.reloadTimer = weapon.rechargeTime;
      combat.ammoCount = combat.maxAmmo;
      return false;
    }

    // Distance check
    const dx = target.transform.x - shooter.transform.x;
    const dy = target.transform.y - shooter.transform.y;
    const distUnits = Math.hypot(dx, dy);
    const distM = distUnits / GEM_UNITS_PER_METER;

    if (distM > weapon.range[1]) return false;

    // Orient shooter toward target
    const targetHeadingDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (shooter.turret) {
      let relYaw = targetHeadingDeg - shooter.transform.zl;
      while (relYaw > 180) relYaw -= 360;
      while (relYaw < -180) relYaw += 360;
      shooter.turret.targetTurretYaw = relYaw;
    } else {
      shooter.transform.zl = targetHeadingDeg;
    }

    // Consume ammo and set recovery cooldown
    combat.ammoCount--;
    combat.cooldownTimer = weapon.recoveryTime;
    combat.shotsFired++;

    // Calculate projectile velocity vector
    const speedUnitsPerSec = weapon.bulletSpeed * GEM_UNITS_PER_METER;
    const normX = dx / (distUnits || 1);
    const normY = dy / (distUnits || 1);

    const projectile: ActiveProjectile = {
      id: this.nextProjId++,
      shooterId,
      targetEntityId: targetId,
      weapon,
      x: shooter.transform.x,
      y: shooter.transform.y,
      z: shooter.transform.z + 15, // muzzle height
      vx: normX * speedUnitsPerSec,
      vy: normY * speedUnitsPerSec,
      vz: 0,
      traveledUnits: 0,
      maxDistanceUnits: distUnits + 20, // target distance
      alive: true,
    };

    this.activeProjectiles.push(projectile);
    this.world.eventBus.emit(
      'combat:fire',
      {
        shooterId,
        targetId,
        weapon: weapon.name,
        fireSound: weapon.fireSound,
        x: shooter.transform.x,
        y: shooter.transform.y,
      },
      this.world.tickIndex
    );
    return true;
  }

  /**
   * Step combat and ballistic simulation for one tick (dt = 0.05s at 20 Hz).
   */
  step(dt: number) {
    // 1. Update weapon timers and auto-fire for units targeting an enemy
    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive || !ent.combat) continue;
      const combat = ent.combat;

      if (combat.cooldownTimer > 0) {
        combat.cooldownTimer = Math.max(0, combat.cooldownTimer - dt);
      }
      if (combat.reloadTimer > 0) {
        combat.reloadTimer = Math.max(0, combat.reloadTimer - dt);
      }

      // Auto-fire at current target if in range and ready
      if (combat.targetEntityId && combat.cooldownTimer === 0 && combat.reloadTimer === 0) {
        const target = this.world.getEntity(combat.targetEntityId);
        if (target && target.health.alive) {
          const fired = this.fireAtTarget(ent.id, target.id);
          if (!fired) {
            const dx = target.transform.x - ent.transform.x;
            const dy = target.transform.y - ent.transform.y;
            const dist = Math.hypot(dx, dy);
            const maxRangeUnits = (combat.weapon?.range[1] ?? 30) * GEM_UNITS_PER_METER;
            if (dist > maxRangeUnits * 0.85 && ent.brain.moveMode !== 'hold' && !ent.movement.order) {
              const approachX = target.transform.x - (dx / (dist || 1)) * (maxRangeUnits * 0.7);
              const approachY = target.transform.y - (dy / (dist || 1)) * (maxRangeUnits * 0.7);
              issueMoveOrder(this.world, [ent.id], approachX, approachY, undefined, true);
            }
          }
        } else {
          combat.targetEntityId = undefined;
        }
      }
    }

    // 2. Advance active ballistic projectiles
    for (const proj of this.activeProjectiles) {
      if (!proj.alive) continue;

      const stepDist = Math.hypot(proj.vx, proj.vy) * dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.z += proj.vz * dt;
      proj.traveledUnits += stepDist;

      // Check hit against target
      if (proj.targetEntityId) {
        const target = this.world.getEntity(proj.targetEntityId);
        if (target && target.health.alive) {
          const distToTarget = Math.hypot(target.transform.x - proj.x, target.transform.y - proj.y);
          const hitRadius = target.kind === 'human' ? 15 : 40; // 0.75m for human, 2m for vehicle

          if (distToTarget <= hitRadius || proj.traveledUnits >= proj.maxDistanceUnits) {
            // Impact!
            proj.alive = false;
            const distanceM = proj.traveledUnits / GEM_UNITS_PER_METER;
            let hitResult: HitResult;

            if (target.kind === 'human') {
              hitResult = evaluateHumanHit(proj.weapon, distanceM, target);
            } else {
              hitResult = evaluateVehicleHit(
                proj.weapon,
                distanceM,
                target,
                0,
                'body',
                proj.x - proj.vx * dt,
                proj.y - proj.vy * dt
              );
            }

            hitResult.shooterId = proj.shooterId;
            const shooter = this.world.getEntity(proj.shooterId);
            if (shooter?.combat && hitResult.targetKilled) {
              shooter.combat.kills++;
            }

            if (target.combat) {
              target.combat.suppression = Math.min(100, (target.combat.suppression ?? 0) + 35);
            }

            this.world.eventBus.emit('combat:hit', hitResult, this.world.tickIndex);
          }
        }
      }

      if (proj.traveledUnits >= proj.maxDistanceUnits) {
        proj.alive = false;
      }
    }

    // Remove dead projectiles
    this.activeProjectiles = this.activeProjectiles.filter((p) => p.alive);
  }
}
