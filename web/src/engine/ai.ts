/**
 * OpenMoW-Web AI & Target Acquisition Subsystem (T13 / Gate G4).
 *
 * Implements:
 * 1. Brain behavior evaluation (move_mode, fire_mode, look_around, ai_move, control).
 * 2. Vision & Target Acquisition (perks vision):
 *    - 120-degree frontal vision cone (±60° from heading) + 360-degree close proximity detection (10m).
 *    - Perception range based on unit type (human 50m / 1000 u, vehicle 75m / 1500 u).
 *    - Target prioritization (hostile, alive, distance, threat).
 *    - Autonomous attack orders when in 'free' or 'return' fire mode.
 * 3. Tactical Cover Seeking & Suppression:
 *    - actor_to_cover + Covers/Sector integration.
 *    - Dynamic posture adaptation (crouch/prone) under suppression.
 * 4. Waypoint path following (helpers.waypoints tracks).
 * 5. Enemy AI Wave Coordination & Objective Advance:
 *    - Idle AI units advance towards contested/player flags.
 * 6. PlayerBot harness for headless verification:
 *    - 'idle' mode: player does not act -> AI conquers flags -> loss possible.
 *    - 'defend' mode: player bot commands units to defend -> enemy waves defeated -> win possible.
 *
 * Pure deterministic simulation code, 20 Hz, zero DOM/Three.js dependencies.
 */

import type { World } from './world';
import type { SimEntity } from './components';
import { issueMoveOrder, issueAttackOrder } from './orders';
import type { MissionCoverSector, MissionWaypointTrack } from '../contracts/mission';

export interface VisionPerks {
  range: number; // Detection range in GEM units (20 u = 1 m)
  fovCos: number; // cos(half_fov) -> cos(60 deg) = 0.5
  proximityRange: number; // 360-degree proximity range (200 u = 10 m)
}

export class AIEngine {
  public world: World;
  public covers: MissionCoverSector[] = [];
  public waypoints: Map<string | number, MissionWaypointTrack> = new Map();
  public botMode: 'off' | 'idle' | 'defend' = 'off';

  // Default vision parameters (GEM2 perks vision)
  public humanVision: VisionPerks = {
    range: 1000, // 50 meters
    fovCos: 0.5, // 120-degree FOV cone
    proximityRange: 200, // 10 meters 360-degree awareness
  };

  public vehicleVision: VisionPerks = {
    range: 1500, // 75 meters
    fovCos: 0.35, // ~140-degree FOV
    proximityRange: 240, // 12 meters
  };

  constructor(world: World) {
    this.world = world;
  }

  init() {
    this.covers = [];
    this.waypoints.clear();

    if (this.world.missionDoc) {
      this.covers = this.world.missionDoc.covers ? [...this.world.missionDoc.covers] : [];
      for (const track of this.world.missionDoc.helpers?.waypoints ?? []) {
        this.waypoints.set(track.id, track);
        if (track.name) {
          this.waypoints.set(track.name, track);
        }
      }
    }
  }

  /**
   * Deterministic 20 Hz AI step loop.
   */
  step(dt: number) {
    // 1. Individual entity physical reactions: suppression decay and posture adaptation
    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;

      const suppression = ent.combat?.suppression ?? 0;
      if (ent.combat && suppression > 0) {
        ent.combat.suppression = Math.max(0, suppression - 15 * dt);
      }

      // Process posture adaptation under fire
      if (ent.combat && suppression > 40 && ent.kind === 'human') {
        if (suppression > 80 && ent.movement.posture !== 'prone') {
          ent.movement.posture = 'prone';
          ent.fsmState = 'lie';
        } else if (ent.movement.posture === 'stand') {
          ent.movement.posture = 'crouch';
          ent.fsmState = 'squat';
        }
      }
    }

    // 2. Process tactical AI behaviors and autonomous target acquisition
    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;

      // Process autonomous target acquisition for units in 'free' or 'return' fire mode
      if (ent.brain.fireMode !== 'hold') {
        // Distribute scan queries across ticks by entity ID
        if ((this.world.tickIndex + ent.id) % 4 === 0) {
          this.evaluateTargetAcquisition(ent);
        }
      }

      // Process AI movement & tactical behavior
      if (ent.brain.control === 'ai' && ent.brain.aiMoveMode !== 'disable') {
        if ((this.world.tickIndex + ent.id) % 20 === 0) {
          this.evaluateEntityAIMovement(ent);
        }
      }
    }

    // 2. Player-Bot logic if enabled
    if (this.botMode === 'defend') {
      if (this.world.tickIndex % 20 === 0) {
        this.runPlayerBotDefend();
      }
    }
  }

  /**
   * Evaluate vision cone and acquire hostile targets.
   */
  public evaluateTargetAcquisition(ent: SimEntity): SimEntity | undefined {
    // Check if current target is still valid and alive
    if (ent.combat?.targetEntityId !== undefined) {
      const curTarget = this.world.getEntity(ent.combat.targetEntityId);
      if (curTarget && curTarget.health.alive) {
        const dist = Math.hypot(
          curTarget.transform.x - ent.transform.x,
          curTarget.transform.y - ent.transform.y
        );
        const vision = ent.kind === 'human' ? this.humanVision : this.vehicleVision;
        if (dist <= vision.range) {
          return curTarget; // Target remains valid
        }
      }
      ent.combat.targetEntityId = undefined;
    }

    const vision = ent.kind === 'human' ? this.humanVision : this.vehicleVision;
    const rad = (ent.transform.zl * Math.PI) / 180.0;
    const fwdX = Math.cos(rad);
    const fwdY = Math.sin(rad);

    let bestTarget: SimEntity | undefined;
    let closestDist = vision.range;

    for (const other of this.world.entities.values()) {
      if (!other.health.alive) continue;
      // Must be hostile
      if (other.owner.player === ent.owner.player) continue;

      const dx = other.transform.x - ent.transform.x;
      const dy = other.transform.y - ent.transform.y;
      const dist = Math.hypot(dx, dy);

      if (dist > closestDist) continue;

      // Check perception: within 360-degree proximity or within frontal vision cone
      let visible = false;
      if (dist <= vision.proximityRange) {
        visible = true;
      } else {
        const normDx = dx / dist;
        const normDy = dy / dist;
        const dot = fwdX * normDx + fwdY * normDy;
        if (dot >= vision.fovCos) {
          visible = true;
        }
      }

      if (visible) {
        closestDist = dist;
        bestTarget = other;
      }
    }

    if (bestTarget && ent.combat) {
      issueAttackOrder(this.world, [ent.id], bestTarget.id, true);
    }

    return bestTarget;
  }

  /**
   * Autonomous AI unit movement: advance towards contested or player flags.
   */
  private evaluateEntityAIMovement(ent: SimEntity) {
    if (ent.movement.order) return; // Already moving
    if (ent.combat?.targetEntityId !== undefined) return; // Currently engaging

    // If unit is in advance mode or default AI, push towards nearest non-friendly flag
    const flags = Array.from(this.world.skirmish.flags.values());
    if (flags.length === 0) return;

    let targetFlag = flags.find((f) => f.holder === 'player');
    if (!targetFlag) {
      targetFlag = flags.find((f) => f.holder === 'neutral') || flags[0];
    }

    if (targetFlag) {
      const zonePos = targetFlag.zone.position;
      // Add small deterministic spread based on entity ID
      const spreadX = ((ent.id * 37) % 60) - 30;
      const spreadY = ((ent.id * 53) % 60) - 30;
      issueMoveOrder(
        this.world,
        [ent.id],
        zonePos[0] + spreadX,
        zonePos[1] + spreadY,
        undefined,
        true,
        40
      );
    }
  }

  /**
   * Command entity to seek nearest cover point (actor_to_cover).
   */
  public actorToCover(entityIds: number[], maxDist = 600): number {
    let count = 0;
    for (const id of entityIds) {
      const ent = this.world.getEntity(id);
      if (!ent || !ent.health.alive) continue;

      let nearestCover: MissionCoverSector | undefined;
      let minDist = maxDist;

      for (const cov of this.covers) {
        const dist = Math.hypot(cov.x - ent.transform.x, cov.y - ent.transform.y);
        if (dist < minDist) {
          minDist = dist;
          nearestCover = cov;
        }
      }

      if (nearestCover) {
        issueMoveOrder(
          this.world,
          [ent.id],
          nearestCover.x,
          nearestCover.y,
          'crouch',
          true,
          15
        );
        count++;
      }
    }
    return count;
  }

  /**
   * Execute waypoint path for a squad.
   */
  public executeWaypointTrack(
    entityIds: number[],
    trackId: string | number,
    startNodeId?: number
  ): boolean {
    const track = this.waypoints.get(trackId);
    if (!track || track.nodes.length === 0) return false;

    let startIndex = 0;
    if (startNodeId !== undefined) {
      const foundIdx = track.nodes.findIndex((n) => n.id === startNodeId);
      if (foundIdx !== -1) startIndex = foundIdx;
    }

    const waypoints = track.nodes.slice(startIndex).map((n) => ({
      x: n.position[0],
      y: n.position[1],
    }));

    if (waypoints.length === 0) return false;

    const finalTarget = waypoints[waypoints.length - 1];
    issueMoveOrder(
      this.world,
      entityIds,
      finalTarget.x,
      finalTarget.y,
      undefined,
      true,
      20
    );

    // Attach waypoint track to order
    for (const id of entityIds) {
      const ent = this.world.getEntity(id);
      if (ent && ent.movement.order) {
        ent.movement.order.waypoints = waypoints;
        ent.movement.order.waypointIndex = 0;
      }
    }

    return true;
  }

  /**
   * Player-bot defend routine: commands player combat units to defend flags and engage attackers.
   */
  private runPlayerBotDefend() {
    let playerUnits = Array.from(this.world.entities.values()).filter(
      (e) => (e.brain.control === 'user' || e.owner.player === 2) && e.health.alive
    );
    if (playerUnits.length === 0) {
      playerUnits = this.world.getEntitiesByPlayer(1).filter((e) => e.health.alive);
    }
    if (playerUnits.length === 0) return;

    // Scan for hostile targets
    for (const pUnit of playerUnits) {
      if (!pUnit.combat?.targetEntityId) {
        this.evaluateTargetAcquisition(pUnit);
      }
    }

    // Assign idle player units to defend held flags
    let heldFlags = Array.from(this.world.skirmish.flags.values()).filter(
      (f) => f.holder === 'player'
    );
    if (heldFlags.length === 0) {
      const pBase = this.world.skirmish.flags.get('flag_playerbase');
      if (pBase) heldFlags = [pBase];
    }
    if (heldFlags.length > 0) {
      for (const pUnit of playerUnits) {
        if (!pUnit.movement.order && !pUnit.combat?.targetEntityId) {
          const flag = heldFlags[pUnit.id % heldFlags.length];
          const fx = flag.zone.position[0] + (((pUnit.id * 17) % 40) - 20);
          const fy = flag.zone.position[1] + (((pUnit.id * 23) % 40) - 20);
          issueMoveOrder(this.world, [pUnit.id], fx, fy, 'crouch', true, 30);
        }
      }
    }
  }
}
