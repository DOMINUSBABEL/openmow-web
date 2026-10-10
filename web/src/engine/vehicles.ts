/**
 * OpenMoW-Web Vehicle Physics, Locomotion & Turret Subsystem (T09 / Gate G2).
 *
 * Implements:
 * 1. Chassis locomotion physics: MaxSpeed (km/h -> GEM u/s), StartTime acceleration,
 *    BrakeTime deceleration, TurnTime hull rotation, TurnRadius steering.
 * 2. Crew Link management: driver, gunner, commander, charger, and seatN passengers.
 * 3. Boarding / unboarding (board).
 * 4. Turret and gun rotation with revolute limits and traverse speed.
 *
 * Pure deterministic engine code, zero Three.js/DOM dependencies.
 */
import type { SimEntity, ChassisComponent, TurretComponent } from './components';
import type { World } from './world';
import type { ProtoDoc } from '../contracts/proto';

export const GEM_UNITS_PER_METER = 20;

/** Convert km/h to GEM2 units per second (20 u = 1 m) */
export function kmhToGemSpeed(kmh: number): number {
  return (kmh * 1000 / 3600) * GEM_UNITS_PER_METER;
}

/** Default vehicle chassis parameters when not explicitly defined in proto */
export function createDefaultChassis(protoName: string, protoDoc?: ProtoDoc): ChassisComponent | undefined {
  const isTank = protoName.includes('tank') || protoName.startsWith('pz') || protoName.startsWith('m4') ||
                 protoName.startsWith('t34') || protoName.startsWith('stug') || protoName.startsWith('su') ||
                 protoName.startsWith('kv') || protoName.startsWith('is') || protoName.startsWith('chi_');
  const isCar = protoName.includes('car') || protoName.startsWith('willys') || protoName.startsWith('blitz') ||
                protoName.startsWith('gaz') || protoName.startsWith('kubel') || protoName.startsWith('sdkfz');
  const isCannon = protoName.includes('cannon') || protoName.startsWith('flak') || protoName.startsWith('pak') ||
                   protoName.startsWith('m1_') || protoName.startsWith('qf') || protoName.startsWith('zis');

  if (!isTank && !isCar && !isCannon && !protoDoc?.chassis?.Locomotion) {
    return undefined;
  }

  const loco = protoDoc?.chassis?.Locomotion ?? {};
  const maxSpeedKmh = Number(loco.maxspeed ?? loco.MaxSpeed ?? (isTank ? 25 : isCar ? 45 : 0));
  const startTime = Number(loco.StartTime ?? (isTank ? 12.0 : isCar ? 6.0 : 5.0));
  const brakeTime = Number(loco.BrakeTime ?? 1.5);
  const turnTime = Number(loco.TurnTime ?? (isTank ? 10.0 : isCar ? 6.0 : 15.0));
  const turnRadiusM = Number(loco.TurnRadius ?? (isTank ? 8.0 : isCar ? 6.0 : 0.0));

  const maxSpeed = kmhToGemSpeed(maxSpeedKmh);
  const acceleration = startTime > 0 ? maxSpeed / startTime : maxSpeed;
  const deceleration = brakeTime > 0 ? maxSpeed / brakeTime : maxSpeed * 2;
  const turnSpeedDeg = turnTime > 0 ? 360 / turnTime : 36;
  const turnRadius = turnRadiusM * GEM_UNITS_PER_METER;

  return {
    maxSpeedKmH: maxSpeedKmh,
    maxSpeed,
    startTime,
    acceleration,
    brakeTime,
    deceleration,
    turnTime,
    turnSpeedDeg,
    turnRadius,
    currentSpeed: 0,
  };
}

/** Default turret parameters for armed vehicles / emplacements */
export function createDefaultTurret(protoName: string): TurretComponent | undefined {
  const hasTurret = protoName.includes('tank') || protoName.startsWith('pz') || protoName.startsWith('m4') ||
                    protoName.startsWith('t34') || protoName.startsWith('flak') || protoName.startsWith('pak') ||
                    protoName.startsWith('m5') || protoName.startsWith('m3cannon');

  if (!hasTurret) return undefined;

  // Typical historical traverse speed: ~15 to 24 deg/s (GEM speed 0.01..0.02 rad/tick at 20 Hz)
  const isCasemate = protoName.startsWith('stug') || protoName.startsWith('su') || protoName.startsWith('jagd');

  return {
    turretBone: isCasemate ? undefined : 'turret',
    gunBone: 'gun_rot',
    turretYaw: 0,
    targetTurretYaw: 0,
    turretSpeed: isCasemate ? 8.0 : 18.0, // deg / s
    gunPitch: 0,
    targetGunPitch: 0,
    gunLimits: isCasemate ? [-10, 15] : [-10, 25],
    gunSpeed: 10.0, // deg / s
  };
}

/** Initialize chassis and turret on a SimEntity */
export function setupVehicleEntity(entity: SimEntity, protoDoc?: ProtoDoc) {
  const chassis = createDefaultChassis(entity.proto, protoDoc);
  if (chassis) {
    entity.chassis = chassis;
    entity.movement.maxSpeed = chassis.maxSpeed;
    entity.movement.turnRadius = chassis.turnRadius;
  }
  const turret = createDefaultTurret(entity.proto);
  if (turret) {
    entity.turret = turret;
  }
}

/**
 * Step vehicle physics for one tick (dt = 0.05s).
 * Simulates real acceleration curve, braking, turning, and turret rotation.
 */
export function stepVehiclePhysics(entity: SimEntity, dt: number) {
  // 1. Chassis locomotion
  if (entity.chassis) {
    const ch = entity.chassis;
    const isMoving = entity.movement.order?.type === 'move';

    if (isMoving) {
      // Accelerate towards maxSpeed
      if (ch.currentSpeed < ch.maxSpeed) {
        ch.currentSpeed = Math.min(ch.maxSpeed, ch.currentSpeed + ch.acceleration * dt);
      }
    } else {
      // Decelerate / brake to 0
      if (ch.currentSpeed > 0) {
        ch.currentSpeed = Math.max(0, ch.currentSpeed - ch.deceleration * dt);
      }
    }
    entity.movement.currentSpeed = ch.currentSpeed;
  }

  // 2. Turret traverse & gun elevation
  if (entity.turret) {
    const tu = entity.turret;

    // Turret Yaw
    let diffYaw = tu.targetTurretYaw - tu.turretYaw;
    while (diffYaw > 180) diffYaw -= 360;
    while (diffYaw < -180) diffYaw += 360;

    const maxYawStep = tu.turretSpeed * dt;
    if (Math.abs(diffYaw) <= maxYawStep) {
      tu.turretYaw = tu.targetTurretYaw;
    } else {
      tu.turretYaw += Math.sign(diffYaw) * maxYawStep;
    }

    // Gun Pitch (elevation)
    let diffPitch = tu.targetGunPitch - tu.gunPitch;
    const maxPitchStep = tu.gunSpeed * dt;
    if (Math.abs(diffPitch) <= maxPitchStep) {
      tu.gunPitch = tu.targetGunPitch;
    } else {
      tu.gunPitch += Math.sign(diffPitch) * maxPitchStep;
    }

    // Clamp within limits if defined
    if (tu.gunLimits) {
      tu.gunPitch = Math.max(tu.gunLimits[0], Math.min(tu.gunLimits[1], tu.gunPitch));
    }
  }
}

/**
 * Aim vehicle turret at a world target coordinate (x, y).
 */
export function issueTurretAimOrder(world: World, vehicleId: number, targetX: number, targetY: number, targetPitch = 0): boolean {
  const vehicle = world.getEntity(vehicleId);
  if (!vehicle || !vehicle.turret || !vehicle.health.alive) return false;

  const dx = targetX - vehicle.transform.x;
  const dy = targetY - vehicle.transform.y;
  const worldAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  // Relative to vehicle hull heading
  let relYaw = worldAngleDeg - vehicle.transform.zl;
  while (relYaw > 180) relYaw -= 360;
  while (relYaw < -180) relYaw += 360;

  vehicle.turret.targetTurretYaw = relYaw;
  vehicle.turret.targetGunPitch = targetPitch;

  world.eventBus.emit('entity:turret_aim', { vehicleId, targetX, targetY, relYaw, targetPitch }, world.tickIndex);
  return true;
}

/**
 * Issue a boarding order for a human soldier to enter a vehicle.
 */
export function issueBoardOrder(world: World, humanId: number, vehicleId: number, preferredSeat?: string): boolean {
  const human = world.getEntity(humanId);
  const vehicle = world.getEntity(vehicleId);
  if (!human || !vehicle || !human.health.alive || !vehicle.health.alive) return false;

  // Available seats priority
  const seatOrder = ['driver', 'gunner', 'commander', 'charger', 'seat1', 'seat2', 'seat3', 'seat4'];
  let assignedSeat = preferredSeat;

  if (!assignedSeat) {
    for (const s of seatOrder) {
      if (!vehicle.crew.passengers.has(s)) {
        assignedSeat = s;
        break;
      }
    }
  }

  if (!assignedSeat) return false; // Vehicle is full

  // Assign crew
  human.crew.vehicleId = vehicle.id;
  human.crew.seat = assignedSeat;
  vehicle.crew.passengers.set(assignedSeat, human.id);

  // Position human inside vehicle
  human.transform.x = vehicle.transform.x;
  human.transform.y = vehicle.transform.y;
  human.transform.z = vehicle.transform.z;
  human.transform.zl = vehicle.transform.zl;

  world.eventBus.emit('entity:boarded', { humanId, vehicleId, seat: assignedSeat }, world.tickIndex);
  return true;
}

/**
 * Issue an unboarding order for crew members to exit a vehicle.
 */
export function issueUnboardOrder(world: World, vehicleId: number, specificHumanId?: number): number {
  const vehicle = world.getEntity(vehicleId);
  if (!vehicle) return 0;

  const toUnboard: Array<{ seat: string; humanId: number }> = [];

  for (const [seat, hId] of vehicle.crew.passengers.entries()) {
    if (specificHumanId === undefined || specificHumanId === hId) {
      toUnboard.push({ seat, humanId: hId });
    }
  }

  let count = 0;
  for (const item of toUnboard) {
    vehicle.crew.passengers.delete(item.seat);
    const human = world.getEntity(item.humanId);
    if (human) {
      human.crew.vehicleId = undefined;
      human.crew.seat = undefined;
      // Offset exiting soldier to side of vehicle (e.g. 30 GEM units = 1.5 m)
      human.transform.x = vehicle.transform.x + 30;
      human.transform.y = vehicle.transform.y + 30;
      human.movement.posture = 'stand';
      world.eventBus.emit('entity:unboarded', { humanId: human.id, vehicleId }, world.tickIndex);
      count++;
    }
  }

  return count;
}
