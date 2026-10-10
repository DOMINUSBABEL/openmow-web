/**
 * RTS Unit Orders & Control System (T07 / Gate G2).
 * Pure deterministic engine functions, zero DOM/Three.js dependencies.
 */
import type { World } from './world';
import type { UnitPosture } from './components';

export interface FormationOffset {
  dx: number;
  dy: number;
}

/** Compute squad formation offsets for N units centered around target point */
export function computeFormationOffsets(count: number, spacing = 30): FormationOffset[] {
  if (count <= 1) return [{ dx: 0, dy: 0 }];

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const halfW = ((cols - 1) * spacing) / 2;
  const halfH = ((rows - 1) * spacing) / 2;

  const offsets: FormationOffset[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    offsets.push({
      dx: c * spacing - halfW,
      dy: r * spacing - halfH,
    });
  }
  return offsets;
}

/**
 * Issue a movement order to one or more units.
 * Orders are only accepted by live units with 'user' control (or if force=true).
 */
export function issueMoveOrder(
  world: World,
  entityIds: number[],
  targetX: number,
  targetY: number,
  posture?: UnitPosture,
  force = false,
  arrivalRadius = 10 // 10 GEM units = 0.5 m
): number {
  const eligibleEntities = entityIds
    .map((id) => world.getEntity(id))
    .filter((ent): ent is NonNullable<typeof ent> => {
      if (!ent || !ent.health.alive) return false;
      return force || ent.brain.control === 'user';
    });

  if (eligibleEntities.length === 0) return 0;

  const offsets = computeFormationOffsets(eligibleEntities.length, 30);

  for (let i = 0; i < eligibleEntities.length; i++) {
    const ent = eligibleEntities[i];
    const off = offsets[i];
    const destX = targetX + off.dx;
    const destY = targetY + off.dy;

    if (posture) {
      ent.movement.posture = posture;
      ent.fsmState = posture === 'crouch' ? 'squat' : posture === 'prone' ? 'lie' : 'stand';
    }

    // If human was assigned to a vehicle, dismount to move on foot
    if (ent.crew?.vehicleId) {
      const v = world.getEntity(ent.crew.vehicleId);
      if (v && ent.crew.seat) {
        v.crew.passengers.delete(ent.crew.seat);
      }
      ent.crew.vehicleId = undefined;
      ent.crew.seat = undefined;
    }

    let waypoints: Array<{ x: number; y: number }> | undefined;
    let finalX = destX;
    let finalY = destY;

    if (world.navGrid) {
      const path = world.navGrid.findPath(ent.transform.x, ent.transform.y, destX, destY, {
        turnRadius: ent.movement.turnRadius,
      });
      if (path && path.waypoints.length > 0) {
        waypoints = path.waypoints;
        finalX = waypoints[waypoints.length - 1].x;
        finalY = waypoints[waypoints.length - 1].y;
      }
    }

    ent.movement.order = {
      type: 'move',
      targetX: finalX,
      targetY: finalY,
      posture: ent.movement.posture,
      arrivalRadius,
      waypoints,
      waypointIndex: 0,
    };

    world.eventBus.emit(
      'entity:order_issued',
      { entityId: ent.id, order: ent.movement.order },
      world.tickIndex
    );
  }

  return eligibleEntities.length;
}

/**
 * Issue a posture change order (stand, crouch, prone) to units.
 */
export function issuePostureOrder(
  world: World,
  entityIds: number[],
  posture: UnitPosture,
  force = false
): number {
  let count = 0;
  for (const id of entityIds) {
    const ent = world.getEntity(id);
    if (!ent || !ent.health.alive) continue;
    if (!force && ent.brain.control !== 'user') continue;

    ent.movement.posture = posture;
    ent.fsmState = posture === 'crouch' ? 'squat' : posture === 'prone' ? 'lie' : 'stand';
    if (ent.movement.order) {
      ent.movement.order.posture = posture;
    }
    world.eventBus.emit(
      'entity:posture_changed',
      { entityId: ent.id, posture },
      world.tickIndex
    );
    count++;
  }
  return count;
}

/**
 * Stop active orders for units.
 */
export function issueStopOrder(world: World, entityIds: number[], force = false): number {
  let count = 0;
  for (const id of entityIds) {
    const ent = world.getEntity(id);
    if (!ent || !ent.health.alive) continue;
    if (!force && ent.brain.control !== 'user') continue;

    ent.movement.order = undefined;
    ent.movement.currentSpeed = 0;
    if (ent.combat) {
      ent.combat.targetEntityId = undefined;
    }
    world.eventBus.emit('entity:order_stopped', { entityId: ent.id }, world.tickIndex);
    count++;
  }
  return count;
}

/**
 * Issue an attack order against a target entity.
 */
export function issueAttackOrder(
  world: World,
  entityIds: number[],
  targetEntityId: number,
  force = false
): number {
  const target = world.getEntity(targetEntityId);
  if (!target || !target.health.alive) return 0;

  let count = 0;
  for (const id of entityIds) {
    const ent = world.getEntity(id);
    if (!ent || !ent.health.alive) continue;
    if (!force && ent.brain.control !== 'user') continue;

    if (!ent.combat) continue;
    ent.combat.targetEntityId = targetEntityId;

    // If unit has a turret, aim it at target
    if (ent.turret) {
      const dx = target.transform.x - ent.transform.x;
      const dy = target.transform.y - ent.transform.y;
      const worldAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      let relYaw = worldAngleDeg - ent.transform.zl;
      while (relYaw > 180) relYaw -= 360;
      while (relYaw < -180) relYaw += 360;
      ent.turret.targetTurretYaw = relYaw;
    }

    world.eventBus.emit(
      'entity:attack_ordered',
      { entityId: ent.id, targetEntityId },
      world.tickIndex
    );
    count++;
  }
  return count;
}

