/**
 * Combat & Ballistics Subsystem Acceptance Tests (T10 / Gate G3).
 *
 * Verifies:
 * 1. Ballistic and Armor constants grounded in original GEM2 data with source table.
 * 2. Rifle vs Infantry at 30 m kills in N shots coherent with healthDamage (Garand 160 dmg kills 100 HP in 1 shot, MP40 35 dmg kills in 3 shots).
 * 3. Tiger 88mm AP penetrates Sherman front and side without bouncing.
 * 4. Sherman 75mm AP bounces on Tiger front (84mm < 100mm) but penetrates Tiger side at close range (102mm > 80mm).
 * 5. Extreme angle ricochet threshold (alpha >= 70 deg).
 * 6. Headless multi-tick deterministic 20 Hz ballistic simulation with 100% state hash equality.
 */

import { describe, it, expect } from 'vitest';
import { World } from '../src/engine/world';
import {
  BUILTIN_WEAPONS,
  BUILTIN_ARMOR,
  calculateAspect,
  calculateEffectiveArmor,
  getPenetrationAtDistance,
  evaluateVehicleHit,
  evaluateHumanHit,
  GEM_UNITS_PER_METER,
} from '../src/engine/combat';
import { issueAttackOrder } from '../src/engine/orders';
import type { SimEntity } from '../src/engine/components';

describe('Combat & Ballistics Engine (T10 / Gate G3 Acceptance)', () => {
  it('validates weapon and armor parameters against GEM2 source data table', () => {
    // Ground truth verification table
    const verificationTable = [
      {
        entity: 'garand',
        parameter: 'healthDamage',
        value: BUILTIN_WEAPONS['garand'].healthDamage,
        expected: 160,
        source: '/set/stuff/rifle/garand',
      },
      {
        entity: 'garand',
        parameter: 'recoveryTime',
        value: BUILTIN_WEAPONS['garand'].recoveryTime,
        expected: 0.4,
        source: '/set/stuff/rifle/garand',
      },
      {
        entity: 'mosin',
        parameter: 'healthDamage',
        value: BUILTIN_WEAPONS['mosin'].healthDamage,
        expected: 200,
        source: '/set/stuff/rifle/rifle.pattern',
      },
      {
        entity: '88mm_kwk36',
        parameter: 'penetration @10m',
        value: BUILTIN_WEAPONS['88mm_kwk36'].projectileDamageTable[10],
        expected: 139,
        source: '/set/stuff/gun/88mm_kwk36 (damage2 a(139))',
      },
      {
        entity: '88mm_kwk36',
        parameter: 'penetration @50m',
        value: BUILTIN_WEAPONS['88mm_kwk36'].projectileDamageTable[50],
        expected: 127,
        source: '/set/stuff/gun/88mm_kwk36 (damage2 b(127))',
      },
      {
        entity: '88mm_kwk36',
        parameter: 'penetration @100m',
        value: BUILTIN_WEAPONS['88mm_kwk36'].projectileDamageTable[100],
        expected: 105,
        source: '/set/stuff/gun/88mm_kwk36 (damage2 d(105))',
      },
      {
        entity: '75mm_m3',
        parameter: 'penetration @10m',
        value: BUILTIN_WEAPONS['75mm_m3'].projectileDamageTable[10],
        expected: 102,
        source: '/set/stuff/gun/75mm_m3 (damage a(102))',
      },
      {
        entity: '75mm_m3',
        parameter: 'penetration @50m',
        value: BUILTIN_WEAPONS['75mm_m3'].projectileDamageTable[50],
        expected: 84,
        source: '/set/stuff/gun/75mm_m3 (damage b(84))',
      },
      {
        entity: '75mm_m3',
        parameter: 'penetration @100m',
        value: BUILTIN_WEAPONS['75mm_m3'].projectileDamageTable[100],
        expected: 54,
        source: '/set/stuff/gun/75mm_m3 (damage d(54))',
      },
      {
        entity: 'm4a3_75',
        parameter: 'body front armor',
        value: BUILTIN_ARMOR['m4a3_75'].body.front,
        expected: 51,
        source: '/entity/-vehicle/tank_medium/m4a3_75/m4a3_75.def (armor_medium body(51 ...))',
      },
      {
        entity: 'm4a3_75',
        parameter: 'turret front armor',
        value: BUILTIN_ARMOR['m4a3_75'].turret.front,
        expected: 76,
        source: '/entity/-vehicle/tank_medium/m4a3_75/m4a3_75.def (armor_medium turret(76 ...))',
      },
      {
        entity: 'pz6e',
        parameter: 'body front armor',
        value: BUILTIN_ARMOR['pz6e'].body.front,
        expected: 100,
        source: '/entity/-vehicle/tank_heavy/pz6e/pz6e.def (armor_heavy body(100 ...))',
      },
      {
        entity: 'pz6e',
        parameter: 'turret front armor',
        value: BUILTIN_ARMOR['pz6e'].turret.front,
        expected: 100,
        source: '/entity/-vehicle/tank_heavy/pz6e/pz6e.def (armor_heavy turret(100 ...))',
      },
    ];

    console.table(verificationTable);
    for (const row of verificationTable) {
      expect(row.value).toBe(row.expected);
    }
  });

  it('rifle kills infantry at 30 m in N shots coherent with healthDamage', () => {
    // 1. M1 Garand (healthDamage: 160) vs 100 HP human
    const garand = BUILTIN_WEAPONS['garand'];
    const soldier: SimEntity = {
      id: 101,
      idHex: '0x65',
      kind: 'human',
      proto: 'mp/ger/rifle',
      transform: { x: 600, y: 0, z: 0, zl: 0, prevX: 600, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 1 },
      tags: new Set(),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'ai', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    };

    const res1 = evaluateHumanHit(garand, 30, soldier);
    console.log(`[T10 Rifle Test] Garand vs 100 HP Infantry: Damage=${res1.damageDealt}, Alive=${soldier.health.alive}`);
    expect(res1.damageDealt).toBe(160);
    expect(res1.targetKilled).toBe(true);
    expect(soldier.health.alive).toBe(false);
    expect(soldier.health.current).toBe(0);

    // 2. MP40 (healthDamage: 35) vs 100 HP human requires exactly 3 shots
    const mp40 = BUILTIN_WEAPONS['mp40'];
    const soldier2: SimEntity = {
      id: 102,
      idHex: '0x66',
      kind: 'human',
      proto: 'mp/usa/rifle',
      transform: { x: 600, y: 0, z: 0, zl: 0, prevX: 600, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 0 },
      tags: new Set(),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'ai', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    };

    // Shot 1: 100 -> 65
    evaluateHumanHit(mp40, 30, soldier2);
    expect(soldier2.health.current).toBe(65);
    expect(soldier2.health.alive).toBe(true);

    // Shot 2: 65 -> 30
    evaluateHumanHit(mp40, 30, soldier2);
    expect(soldier2.health.current).toBe(30);
    expect(soldier2.health.alive).toBe(true);

    // Shot 3: 30 -> 0 (KILLED in exactly 3 shots)
    const resThird = evaluateHumanHit(mp40, 30, soldier2);
    console.log(`[T10 SMG Test] MP40 Shot 3: HP=${soldier2.health.current}, Killed=${resThird.targetKilled}`);
    expect(soldier2.health.current).toBe(0);
    expect(soldier2.health.alive).toBe(false);
    expect(resThird.targetKilled).toBe(true);
  });

  it('88 mm AP penetrates Sherman front and side without bouncing', () => {
    const gun88 = BUILTIN_WEAPONS['88mm_kwk36'];

    // Sherman facing Tiger (facing along X axis towards positive X, Tiger at positive X firing back)
    const sherman: SimEntity = {
      id: 201,
      idHex: '0xc9',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['tank']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 180, posture: 'stand' },
      armor: {
        settings: { ...BUILTIN_ARMOR['m4a3_75'] },
        durability: { body: 1.0, turret: 1.0, mantlet: 1.0, engine: 1.0, track: 1.0 },
      },
    };

    // Case 1: 88 mm AP vs Sherman Frontal Hull at 50 m
    // Shooter at x=1000 (50 m away along +X), firing at sherman at x=0
    const hitFront50m = evaluateVehicleHit(gun88, 50, sherman, 0, 'body', 1000, 0);
    console.log(
      `[T10 Tiger vs Sherman Front 50m] Pen=${hitFront50m.penetrationMm}mm vs Armor=${hitFront50m.effectiveArmorMm}mm -> Penetrated=${hitFront50m.penetrated}, Ricochet=${hitFront50m.ricochet}`
    );
    expect(hitFront50m.penetrationMm).toBe(127);
    expect(hitFront50m.nominalArmorMm).toBe(51);
    expect(hitFront50m.penetrated).toBe(true);
    expect(hitFront50m.ricochet).toBe(false);

    // Case 2: 88 mm AP vs Sherman Frontal Turret at 100 m
    const hitTurret100m = evaluateVehicleHit(gun88, 100, sherman, 0, 'turret', 2000, 0);
    console.log(
      `[T10 Tiger vs Sherman Turret 100m] Pen=${hitTurret100m.penetrationMm}mm vs Armor=${hitTurret100m.effectiveArmorMm}mm -> Penetrated=${hitTurret100m.penetrated}`
    );
    expect(hitTurret100m.penetrationMm).toBe(105);
    expect(hitTurret100m.nominalArmorMm).toBe(76);
    expect(hitTurret100m.penetrated).toBe(true);
    expect(hitTurret100m.ricochet).toBe(false);

    // Case 3: 88 mm AP vs Sherman Lateral / Side at 50 m (firing from flank y=1000)
    const hitSide50m = evaluateVehicleHit(gun88, 50, sherman, 0, 'body', 0, 1000);
    console.log(
      `[T10 Tiger vs Sherman Side 50m] Pen=${hitSide50m.penetrationMm}mm vs Armor=${hitSide50m.effectiveArmorMm}mm -> Penetrated=${hitSide50m.penetrated}, Ricochet=${hitSide50m.ricochet}`
    );
    expect(hitSide50m.nominalArmorMm).toBe(38);
    expect(hitSide50m.penetrated).toBe(true);
    expect(hitSide50m.ricochet).toBe(false);
  });

  it('75 mm AP of Sherman bounces on Tiger front (84mm < 100mm) but penetrates Tiger side at close range', () => {
    const gun75 = BUILTIN_WEAPONS['75mm_m3'];

    const tiger: SimEntity = {
      id: 301,
      idHex: '0x12d',
      kind: 'entity',
      proto: 'pz6e',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 900, max: 900, alive: true },
      owner: { player: 1 },
      tags: new Set(['tank']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'ai', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 140, posture: 'stand' },
      armor: {
        settings: { ...BUILTIN_ARMOR['pz6e'] },
        durability: { body: 1.0, turret: 1.0, mantlet: 1.0, engine: 1.0, track: 1.0 },
      },
    };

    // Case 1: Sherman 75 mm vs Tiger Frontal Hull at 50 m
    // Penetration: 84 mm. Tiger Front: 100 mm. MUST BOUNCE!
    const hitFront50m = evaluateVehicleHit(gun75, 50, tiger, 0, 'body', 1000, 0);
    console.log(
      `[T10 Sherman vs Tiger Front 50m] Pen=${hitFront50m.penetrationMm}mm vs Armor=${hitFront50m.effectiveArmorMm}mm -> Penetrated=${hitFront50m.penetrated}, Ricochet=${hitFront50m.ricochet}`
    );
    expect(hitFront50m.penetrationMm).toBe(84);
    expect(hitFront50m.nominalArmorMm).toBe(100);
    expect(hitFront50m.penetrated).toBe(false);
    expect(hitFront50m.ricochet).toBe(true);

    // Case 2: Sherman 75 mm vs Tiger Frontal Turret at 100 m
    // Penetration: 54 mm. Tiger Turret: 100 mm. MUST BOUNCE!
    const hitTurret100m = evaluateVehicleHit(gun75, 100, tiger, 0, 'turret', 2000, 0);
    expect(hitTurret100m.penetrationMm).toBe(54);
    expect(hitTurret100m.penetrated).toBe(false);
    expect(hitTurret100m.ricochet).toBe(true);

    // Case 3: Flanking shot at Tiger side at close range (10 m)
    // Penetration at 10m: 102 mm. Tiger side: 80 mm. MUST PENETRATE!
    const hitSide10m = evaluateVehicleHit(gun75, 10, tiger, 0, 'body', 0, 200);
    console.log(
      `[T10 Sherman vs Tiger Side 10m Flank] Pen=${hitSide10m.penetrationMm}mm vs Armor=${hitSide10m.effectiveArmorMm}mm -> Penetrated=${hitSide10m.penetrated}, Ricochet=${hitSide10m.ricochet}`
    );
    expect(hitSide10m.penetrationMm).toBe(102);
    expect(hitSide10m.nominalArmorMm).toBe(80);
    expect(hitSide10m.penetrated).toBe(true);
    expect(hitSide10m.ricochet).toBe(false);
  });

  it('enforces ricochet at extreme impact angles (>= 70 deg)', () => {
    const gun88 = BUILTIN_WEAPONS['88mm_kwk36'];
    const plateMm = 50;

    // Normal incidence (0 deg) -> Penetrates easily (127mm vs 50mm)
    const eff0 = calculateEffectiveArmor(plateMm, 0);
    expect(eff0).toBe(50);

    // Moderate slope (30 deg) -> Effective armor = 50 / cos(30) = 57.7mm -> Still penetrates
    const eff30 = calculateEffectiveArmor(plateMm, 30);
    expect(eff30).toBeCloseTo(57.7, 1);

    // Extreme glance (75 deg >= 70 deg threshold) -> Infinite effective armor (automatic ricochet)
    const eff75 = calculateEffectiveArmor(plateMm, 75);
    expect(eff75).toBe(Infinity);

    const sherman: SimEntity = {
      id: 401,
      idHex: '0x191',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['tank']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 180, posture: 'stand' },
      armor: {
        settings: { ...BUILTIN_ARMOR['m4a3_75'] },
        durability: { body: 1.0, turret: 1.0, mantlet: 1.0, engine: 1.0, track: 1.0 },
      },
    };

    // Even an 88 mm shell ricochets at 75 degrees!
    const hitGlance = evaluateVehicleHit(gun88, 50, sherman, 75, 'body', 1000, 0);
    console.log(`[T10 Extreme Angle Test] 88mm at 75° angle: Ricochet=${hitGlance.ricochet}, Penetrated=${hitGlance.penetrated}`);
    expect(hitGlance.ricochet).toBe(true);
    expect(hitGlance.penetrated).toBe(false);
  });

  it('runs multi-tick ballistic combat simulation with 100% deterministic state hash', () => {
    function runSimulation() {
      const world = new World(19440606);

      // Shooter (Garand rifleman at x=0, y=0)
      const shooterId = 501;
      const targetId = 502;

      world.entities.set(shooterId, {
        id: shooterId,
        idHex: '0x1f5',
        kind: 'human',
        proto: 'mp/usa/rifle',
        transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
        health: { current: 100, max: 100, alive: true },
        owner: { player: 0 },
        tags: new Set(['player']),
        inventory: [],
        crew: { passengers: new Map() },
        brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
        movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
        combat: {
          weapon: BUILTIN_WEAPONS['garand'],
          ammoCount: 8,
          maxAmmo: 8,
          reloadTimer: 0,
          cooldownTimer: 0,
          shotsFired: 0,
          kills: 0,
        },
      });

      // Target (Enemy infantry at x=600 [30 m], y=0)
      world.entities.set(targetId, {
        id: targetId,
        idHex: '0x1f6',
        kind: 'human',
        proto: 'mp/ger/rifle',
        transform: { x: 600, y: 0, z: 0, zl: 180, prevX: 600, prevY: 0, prevZ: 0, prevZl: 180 },
        health: { current: 100, max: 100, alive: true },
        owner: { player: 1 },
        tags: new Set(['enemy']),
        inventory: [],
        crew: { passengers: new Map() },
        brain: { moveMode: 'hold', control: 'ai', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
        movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
      });

      // Issue attack order
      issueAttackOrder(world, [shooterId], targetId, true);

      // Step 2 seconds (40 ticks at 20 Hz):
      // Bullet travels 426.5 m/s = 8530 units/s.
      // 600 units distance takes ~0.07s (about 2 ticks)!
      for (let t = 0; t < 40; t++) {
        world.step();
      }

      const shooter = world.getEntity(shooterId)!;
      const target = world.getEntity(targetId)!;

      return {
        hash: world.computeStateHash(),
        shotsFired: shooter.combat!.shotsFired,
        kills: shooter.combat!.kills,
        targetAlive: target.health.alive,
        targetHp: target.health.current,
      };
    }

    const run1 = runSimulation();
    const run2 = runSimulation();

    console.log(`[T10 Simulation Test] Run 1: Hash=${run1.hash}, Shots=${run1.shotsFired}, Kills=${run1.kills}, TargetAlive=${run1.targetAlive}`);
    console.log(`[T10 Simulation Test] Run 2: Hash=${run2.hash}, Shots=${run2.shotsFired}, Kills=${run2.kills}, TargetAlive=${run2.targetAlive}`);

    expect(run1.shotsFired).toBeGreaterThanOrEqual(1);
    expect(run1.kills).toBe(1);
    expect(run1.targetAlive).toBe(false);
    expect(run1.targetHp).toBe(0);

    // 100% Deterministic state hash equality
    expect(run1.hash).toBe(run2.hash);
  });
});
