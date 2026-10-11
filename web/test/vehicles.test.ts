/**
 * Vehicle Physics, Locomotion & Turret Automated Acceptance Suite (T09).
 * Acceptance criteria from docs/TASKS.md:
 * 1. Test of times 0 -> MaxSpeed within ±10%.
 * 2. Overlord tank drives and rotates turret.
 * 3. Crew Links and boarding / unboarding (board).
 * 4. Turret and gun rotation respects revolute limits and traverse speed.
 */
import { describe, it, expect } from 'vitest';
import { World, TICK_RATE, TICK_DT } from '../src/engine/world';
import {
  createDefaultChassis,
  createDefaultTurret,
  kmhToGemSpeed,
  setupVehicleEntity,
  issueTurretAimOrder,
  issueBoardOrder,
  issueUnboardOrder,
} from '../src/engine/vehicles';
import { issueMoveOrder } from '../src/engine/orders';
import { loadMissionDoc } from '../src/mission/load';

describe('Vehicle Subsystem (T09 Acceptance)', () => {
  it('measures 0 -> MaxSpeed acceleration time within ±10%', () => {
    // Sherman M4A3 tank parameters: maxSpeed = 33 km/h, startTime = 15 s
    const maxSpeedKmh = 33;
    const startTimeSec = 15.0;
    const expectedMaxSpeed = kmhToGemSpeed(maxSpeedKmh); // 33 * 1000 / 3600 * 20 = 183.33 GEM u/s

    const world = new World(1944);
    const tankId = 101;

    world.entities.set(tankId, {
      id: tankId,
      idHex: '0x65',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['player', 'tank']),
      inventory: [],
      crew: { passengers: new Map([['driver', 201]]) },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: expectedMaxSpeed, posture: 'stand' },
      chassis: {
        maxSpeedKmH: maxSpeedKmh,
        maxSpeed: expectedMaxSpeed,
        startTime: startTimeSec,
        acceleration: expectedMaxSpeed / startTimeSec,
        brakeTime: 1.5,
        deceleration: expectedMaxSpeed / 1.5,
        turnTime: 10,
        turnSpeedDeg: 36,
        turnRadius: 200,
        currentSpeed: 0,
      },
    });

    // Issue long-distance move order (10000 units away = 500m) so it is still cruising at maxSpeed at 15s
    issueMoveOrder(world, [tankId], 10000, 0, 'stand', true);

    const ticksTotal = Math.round(startTimeSec * TICK_RATE); // 15 * 20 = 300 ticks
    const halfTicks = Math.round(ticksTotal / 2); // 150 ticks = 7.5s

    let speedAtHalfTime = 0;
    for (let tick = 0; tick < ticksTotal; tick++) {
      world.step();
      if (tick === halfTicks - 1) {
        speedAtHalfTime = world.getEntity(tankId)!.movement.currentSpeed;
      }
    }

    const finalSpeed = world.getEntity(tankId)!.movement.currentSpeed;

    console.log(
      `[T09 Acceleration Test] Target MaxSpeed: ${expectedMaxSpeed.toFixed(2)} u/s (${maxSpeedKmh} km/h). ` +
        `At 50% time (7.5s): ${speedAtHalfTime.toFixed(2)} u/s (expected ~${(expectedMaxSpeed * 0.5).toFixed(2)}). ` +
        `At 100% time (15s): ${finalSpeed.toFixed(2)} u/s.`
    );

    // Speed at 50% time must be 50% ±10%
    const expectedHalf = expectedMaxSpeed * 0.5;
    expect(speedAtHalfTime).toBeGreaterThanOrEqual(expectedHalf * 0.9);
    expect(speedAtHalfTime).toBeLessThanOrEqual(expectedHalf * 1.1);

    // Speed at 100% time must be 100% ±10%
    expect(finalSpeed).toBeGreaterThanOrEqual(expectedMaxSpeed * 0.9);
    expect(finalSpeed).toBeLessThanOrEqual(expectedMaxSpeed * 1.01);
  });

  it('brakes smoothly to 0 within BrakeTime when order finishes or cancelled', () => {
    const maxSpeed = 180;
    const brakeTime = 1.5; // 1.5s
    const world = new World(1944);
    const carId = 102;

    world.entities.set(carId, {
      id: carId,
      idHex: '0x66',
      kind: 'entity',
      proto: 'willysmb',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 150, max: 150, alive: true },
      owner: { player: 0 },
      tags: new Set(['player', 'car']),
      inventory: [],
      crew: { passengers: new Map([['driver', 201]]) },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: maxSpeed, maxSpeed, posture: 'stand' },
      chassis: {
        maxSpeedKmH: 45,
        maxSpeed,
        startTime: 6,
        acceleration: maxSpeed / 6,
        brakeTime,
        deceleration: maxSpeed / brakeTime,
        turnTime: 6,
        turnSpeedDeg: 60,
        turnRadius: 120,
        currentSpeed: maxSpeed, // initially cruising at full speed
      },
    });

    // Clear order to trigger braking
    world.getEntity(carId)!.movement.order = undefined;

    const brakeTicks = Math.round(brakeTime * TICK_RATE); // 30 ticks = 1.5s
    for (let t = 0; t < brakeTicks; t++) {
      world.step();
    }

    const stoppedSpeed = world.getEntity(carId)!.movement.currentSpeed;
    console.log(`[T09 Braking Test] Speed after ${brakeTime}s braking: ${stoppedSpeed.toFixed(2)} u/s`);
    expect(stoppedSpeed).toBe(0);
  });

  it('manages crew links and boarding / unboarding (board)', () => {
    const world = new World(1944);
    const tankId = 501;
    const humanId1 = 601;
    const humanId2 = 602;

    world.entities.set(tankId, {
      id: tankId,
      idHex: '0x1f5',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: { x: 100, y: 100, z: 0, zl: 0, prevX: 100, prevY: 100, prevZ: 0, prevZl: 0 },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['player', 'tank']),
      inventory: [],
      crew: { passengers: new Map([['driver', humanId1]]) },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 180, posture: 'stand' },
    });

    world.entities.set(humanId1, {
      id: humanId1,
      idHex: '0x259',
      kind: 'human',
      proto: 'mp/usa/tankman',
      transform: { x: 100, y: 100, z: 0, zl: 0, prevX: 100, prevY: 100, prevZ: 0, prevZl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 0 },
      tags: new Set(['player']),
      inventory: [],
      crew: { vehicleId: tankId, seat: 'driver', passengers: new Map() },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    });

    world.entities.set(humanId2, {
      id: humanId2,
      idHex: '0x25a',
      kind: 'human',
      proto: 'mp/usa/rifle',
      transform: { x: 120, y: 120, z: 0, zl: 0, prevX: 120, prevY: 120, prevZ: 0, prevZl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 0 },
      tags: new Set(['player']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    });

    // 1. Initial state: human1 is driver, human2 is standing outside
    expect(world.getEntity(tankId)!.crew.passengers.get('driver')).toBe(humanId1);
    expect(world.getEntity(humanId2)!.crew.vehicleId).toBeUndefined();

    // 2. Boarding: human2 boards tank
    const boarded = issueBoardOrder(world, humanId2, tankId);
    expect(boarded).toBe(true);
    expect(world.getEntity(humanId2)!.crew.vehicleId).toBe(tankId);
    expect(world.getEntity(humanId2)!.crew.seat).toBe('gunner');
    expect(world.getEntity(tankId)!.crew.passengers.get('gunner')).toBe(humanId2);

    // 3. Tank moves: passengers must follow tank position
    world.getEntity(tankId)!.transform.x = 250;
    world.getEntity(tankId)!.transform.y = 350;
    world.step();

    expect(world.getEntity(humanId1)!.transform.x).toBe(250);
    expect(world.getEntity(humanId2)!.transform.x).toBe(250);

    // 4. Unboarding: gunner exits tank
    const unboardedCount = issueUnboardOrder(world, tankId, humanId2);
    expect(unboardedCount).toBe(1);
    expect(world.getEntity(tankId)!.crew.passengers.has('gunner')).toBe(false);
    expect(world.getEntity(humanId2)!.crew.vehicleId).toBeUndefined();
    // Exited soldier placed beside vehicle
    expect(world.getEntity(humanId2)!.transform.x).toBe(280); // 250 + 30
  });

  it('rotates turret and elevates gun respecting traverse speed and limits', () => {
    const world = new World(1944);
    const tankId = 701;

    world.entities.set(tankId, {
      id: tankId,
      idHex: '0x2bd',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: { x: 0, y: 0, z: 0, zl: 0, prevX: 0, prevY: 0, prevZ: 0, prevZl: 0 },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['player', 'tank']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'user', fireMode: 'hold', lookAround: false, aiMoveMode: 'disable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 180, posture: 'stand' },
      turret: {
        turretBone: 'turret',
        gunBone: 'gun_rot',
        turretYaw: 0,
        targetTurretYaw: 0,
        turretSpeed: 18.0, // 18 deg / s
        gunPitch: 0,
        targetGunPitch: 0,
        gunLimits: [-10, 20],
        gunSpeed: 10.0, // 10 deg / s
      },
    });

    // Order turret to aim 90 degrees left (target at x=0, y=500), gun elevated 15 deg
    issueTurretAimOrder(world, tankId, 0, 500, 15);

    expect(world.getEntity(tankId)!.turret!.targetTurretYaw).toBeCloseTo(90, 1);
    expect(world.getEntity(tankId)!.turret!.targetGunPitch).toBe(15);

    // Step 1 second (20 ticks): turret should traverse ~18 degrees
    for (let t = 0; t < 20; t++) {
      world.step();
    }
    let yawAfter1s = world.getEntity(tankId)!.turret!.turretYaw;
    expect(yawAfter1s).toBeCloseTo(18.0, 1);

    // Step 4 more seconds (total 5s = 90 degrees): turret should complete 90 deg rotation
    for (let t = 0; t < 80; t++) {
      world.step();
    }
    let finalYaw = world.getEntity(tankId)!.turret!.turretYaw;
    let finalPitch = world.getEntity(tankId)!.turret!.gunPitch;

    console.log(`[T09 Turret Test] Turret final yaw: ${finalYaw.toFixed(1)}° (target 90°), Gun pitch: ${finalPitch.toFixed(1)}° (target 15°)`);
    expect(finalYaw).toBeCloseTo(90.0, 1);
    expect(finalPitch).toBeCloseTo(15.0, 1);

    // Test gun limit clamping: order gun pitch beyond limits (e.g. 50 deg)
    issueTurretAimOrder(world, tankId, 0, 500, 50);
    for (let t = 0; t < 100; t++) {
      world.step();
    }
    const clampedPitch = world.getEntity(tankId)!.turret!.gunPitch;
    console.log(`[T09 Gun Clamping] Clamped pitch: ${clampedPitch.toFixed(1)}° (max allowed 20°)`);
    expect(clampedPitch).toBeLessThanOrEqual(20.0);
  });

  it('runs live Overlord skirmish vehicles test: setup and drives Allied tank', async () => {
    const doc = await loadMissionDoc('http://127.0.0.1:8080/conv/sdl/map/single/01_usa-skirmish/01_usa-overlord/0.mi.json');
    const world = new World(19440606);
    world.initFromMission(doc);

    // Find vehicles placed in Overlord
    const vehicles = Array.from(world.entities.values()).filter((e) => e.chassis !== undefined);
    console.log(`[T09 Overlord Armor] Vehicles initialized with chassis in Overlord: ${vehicles.length}`);
    expect(vehicles.length).toBeGreaterThan(0);

    // Pick first vehicle and test driving it
    const testVeh = vehicles[0];
    const initialX = testVeh.transform.x;
    const initialY = testVeh.transform.y;

    // Issue move order
    issueMoveOrder(world, [testVeh.id], initialX + 200, initialY, 'stand', true);
    expect(testVeh.movement.order).toBeDefined();

    // Rotate turret
    if (testVeh.turret) {
      issueTurretAimOrder(world, testVeh.id, initialX + 200, initialY + 200, 10);
    }

    // Step 2 seconds
    for (let t = 0; t < 40; t++) {
      world.step();
    }

    const movedDist = Math.hypot(testVeh.transform.x - initialX, testVeh.transform.y - initialY);
    console.log(`[T09 Overlord Armor] Vehicle ${testVeh.proto} (id=${testVeh.id}) drove ${movedDist.toFixed(1)} GEM units in 2s`);
    expect(movedDist).toBeGreaterThan(0);
  });
});
