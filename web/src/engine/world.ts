/**
 * OpenMoW-Web Simulation World (T05 / Gate G2).
 * Fixed 20 Hz deterministic simulation loop, pure headless, decoupled from DOM/Three.js.
 */
import type { MissionDoc } from '../contracts/mission';
import type { SimEntity } from './components';
import { PRNG } from './prng';
import { SimEventBus } from './events';
import type { NavGrid } from './nav';
import { setupVehicleEntity, stepVehiclePhysics } from './vehicles';
import { CombatEngine, setupEntityCombat } from './combat';
import { TriggerVM } from '../mission/vm';
import { SkirmishSystem } from '../mission/skirmish';
import { AIEngine } from './ai';

export const TICK_RATE = 20; // 20 Hz
export const TICK_DT = 1.0 / TICK_RATE; // 0.05s

export class World {
  tickIndex = 0;
  time = 0.0;
  prng: PRNG;
  eventBus: SimEventBus;
  entities = new Map<number, SimEntity>();
  tagsIndex = new Map<string, Set<number>>();
  players: any[] = [];
  vars: Record<string, any> = {};
  missionDoc?: MissionDoc;
  navGrid?: NavGrid;
  combatEngine: CombatEngine;
  triggerVm: TriggerVM;
  skirmish: SkirmishSystem;
  ai: AIEngine;

  constructor(seed = 12345678) {
    this.prng = new PRNG(seed);
    this.eventBus = new SimEventBus();
    this.combatEngine = new CombatEngine(this);
    this.triggerVm = new TriggerVM(this);
    this.skirmish = new SkirmishSystem(this);
    this.ai = new AIEngine(this);
  }

  /** Initialize world state from a parsed MissionDoc */
  initFromMission(doc: MissionDoc, seed?: number) {
    if (seed !== undefined) {
      this.prng = new PRNG(seed);
    }
    this.tickIndex = 0;
    this.time = 0.0;
    this.entities.clear();
    this.tagsIndex.clear();
    this.eventBus.reset();
    this.vars = { ...doc.helpers.vars };
    this.players = [...doc.players];
    this.missionDoc = doc;

    // 1. Add Entities
    for (const e of doc.entities) {
      const isStatic = e.proto.includes('_fix') || e.proto.includes('sandbag') || e.proto.includes('flag') || e.proto.includes('fence');
      const ent: SimEntity = {
        id: e.id,
        idHex: e.idHex,
        kind: 'entity',
        proto: e.proto,
        transform: {
          x: e.x,
          y: e.y,
          z: e.z ?? 0,
          zl: e.zl,
          prevX: e.x,
          prevY: e.y,
          prevZ: e.z ?? 0,
          prevZl: e.zl,
        },
        health: { current: 100, max: 100, alive: true },
        owner: { player: e.player ?? 0, mid: e.mid },
        tags: new Set<string>(),
        inventory: [],
        crew: { passengers: new Map() },
        brain: {
          moveMode: 'hold',
          control: 'ai',
          fireMode: isStatic ? 'hold' : 'free',
          lookAround: false,
          aiMoveMode: isStatic ? 'disable' : 'auto',
          props: {},
        },
        movement: {
          currentSpeed: 0,
          maxSpeed: 0,
          posture: 'stand',
        },
        texMod: e.texMod,
        impregnability: e.impregnability,
        fsmState: e.fsmState,
        spawnedInFog: e.spawnedInFog,
      };
      setupVehicleEntity(ent);
      setupEntityCombat(ent);
      this.entities.set(e.id, ent);
    }

    // 2. Add Humans
    for (const h of doc.humans) {
      const ent: SimEntity = {
        id: h.id,
        idHex: h.idHex,
        kind: 'human',
        proto: h.proto,
        transform: {
          x: h.x,
          y: h.y,
          z: h.z ?? 0,
          zl: h.zl,
          prevX: h.x,
          prevY: h.y,
          prevZ: h.z ?? 0,
          prevZl: h.zl,
        },
        health: { current: 100, max: 100, alive: true },
        owner: { player: h.player ?? 0, mid: h.mid },
        tags: new Set<string>(),
        inventory: [],
        crew: { passengers: new Map() },
        brain: {
          moveMode: 'hold',
          control: 'ai',
          fireMode: 'free',
          lookAround: false,
          aiMoveMode: 'auto',
          props: {},
        },
        movement: {
          currentSpeed: 0,
          maxSpeed: 60, // 3 m/s in GEM units
          posture: h.fsmState === 'squat' ? 'crouch' : h.fsmState === 'lie' ? 'prone' : 'stand',
        },
        texMod: h.texMod,
        impregnability: h.impregnability,
        fsmState: h.fsmState,
        spawnedInFog: h.spawnedInFog,
      };
      setupEntityCombat(ent);
      this.entities.set(h.id, ent);
    }

    // 3. Apply Links (crew / vehicle association)
    for (const link of doc.links) {
      const human = this.entities.get(link.humanId);
      const vehicle = this.entities.get(link.vehicleId);
      if (human && vehicle) {
        human.crew.vehicleId = vehicle.id;
        human.crew.seat = link.seat;
        vehicle.crew.passengers.set(link.seat, human.id);
      }
    }

    // 4. Apply Tags
    for (const tagEntry of doc.tags) {
      const ent = this.entities.get(tagEntry.entityId);
      if (ent) {
        const allTags = tagEntry.tags && tagEntry.tags.length > 0 ? tagEntry.tags : [tagEntry.tag];
        for (const t of allTags) {
          if (!t) continue;
          ent.tags.add(t);
          let set = this.tagsIndex.get(t);
          if (!set) {
            set = new Set();
            this.tagsIndex.set(t, set);
          }
          set.add(ent.id);
        }
      }
    }

    // 5. Apply Inventories
    for (const inv of doc.inventories) {
      const ent = this.entities.get(inv.entityId);
      if (ent) {
        ent.inventory = [...inv.items];
      }
    }

    // 6. Apply Brains
    for (const b of doc.brains) {
      const ent = this.entities.get(b.entityId);
      if (ent) {
        ent.brain.moveMode = b.properties.moveMode ?? ent.brain.moveMode;
        ent.brain.control = b.properties.control ?? ent.brain.control;
        ent.brain.fireMode = b.properties.fireMode ?? ent.brain.fireMode;
        ent.brain.lookAround = b.properties.lookAround ?? ent.brain.lookAround;
        ent.brain.aiMoveMode = b.properties.aiMoveMode ?? ent.brain.aiMoveMode;
        ent.brain.props = { ...b.properties };
      }
    }

    // 7. Register initial events
    for (const evName of doc.helpers.events) {
      this.eventBus.setFlag(evName, false);
    }

    // 8. Initialize Trigger VM
    this.triggerVm.init(doc);

    // 9. Initialize Skirmish System
    this.skirmish.init(doc);

    // 10. Initialize AI Engine
    this.ai.init();
  }

  /** Run a single simulation step at fixed TICK_DT (20 Hz) */
  step(dt = TICK_DT) {
    this.tickIndex++;
    this.time += dt;

    // 1. Snapshot previous transforms for smooth rendering interpolation
    for (const ent of this.entities.values()) {
      ent.transform.prevX = ent.transform.x;
      ent.transform.prevY = ent.transform.y;
      ent.transform.prevZ = ent.transform.z;
      ent.transform.prevZl = ent.transform.zl;
    }

    // 2. Deterministic entity logic, movement & brain behavior
    for (const ent of this.entities.values()) {
      if (!ent.health.alive) continue;

      // Movement & order execution
      if (ent.movement.order) {
        const order = ent.movement.order;
        if (order.type === 'move') {
          let targetX = order.targetX;
          let targetY = order.targetY;
          let isFinalWaypoint = true;

          if (order.waypoints && order.waypoints.length > 0) {
            let wpIdx = order.waypointIndex ?? 0;
            if (wpIdx >= order.waypoints.length) {
              wpIdx = order.waypoints.length - 1;
            }
            const currentWp = order.waypoints[wpIdx];
            targetX = currentWp.x;
            targetY = currentWp.y;
            isFinalWaypoint = wpIdx >= order.waypoints.length - 1;
          }

          let dx = targetX - ent.transform.x;
          let dy = targetY - ent.transform.y;
          let dist = Math.hypot(dx, dy);

          const arrivalRadius = order.arrivalRadius ?? 10;
          const waypointThreshold = isFinalWaypoint ? arrivalRadius : 15; // 0.75m transition for intermediate

          if (dist <= waypointThreshold) {
            if (isFinalWaypoint) {
              ent.movement.currentSpeed = 0;
              ent.movement.order = undefined;
              this.eventBus.emit('entity:order_completed', { entityId: ent.id, order }, this.tickIndex);
              continue;
            } else {
              order.waypointIndex = (order.waypointIndex ?? 0) + 1;
              const nextWp = order.waypoints![order.waypointIndex];
              targetX = nextWp.x;
              targetY = nextWp.y;
              dx = targetX - ent.transform.x;
              dy = targetY - ent.transform.y;
              dist = Math.hypot(dx, dy);
            }
          }

          // Heading towards current target (zl in degrees)
          const desiredZl = (Math.atan2(dy, dx) * 180) / Math.PI;
          let diffZl = desiredZl - ent.transform.zl;
          while (diffZl > 180) diffZl -= 360;
          while (diffZl < -180) diffZl += 360;

          let maxTurn = 360 * dt; // turn speed for infantry: 360 deg/sec
          if (ent.movement.turnRadius && ent.movement.turnRadius > 0) {
            // Vehicle turn rate based on turn radius (omega = v / R)
            const angSpeedDeg = (Math.max(10, ent.movement.currentSpeed || ent.movement.maxSpeed) / ent.movement.turnRadius) * (180 / Math.PI);
            maxTurn = Math.max(30, angSpeedDeg) * dt;
          }

          if (Math.abs(diffZl) <= maxTurn) {
            ent.transform.zl = desiredZl;
          } else {
            ent.transform.zl = (ent.transform.zl + Math.sign(diffZl) * maxTurn) % 360;
          }

          let speed = ent.movement.maxSpeed;
          if (ent.movement.posture === 'crouch') speed *= 0.6;
          else if (ent.movement.posture === 'prone') speed *= 0.3;

          const stepDist = Math.min(speed * dt, dist);

          if (ent.movement.turnRadius && ent.movement.turnRadius > 0) {
            // Vehicles steer forward in direction of their current heading
            const headingRad = (ent.transform.zl * Math.PI) / 180;
            ent.transform.x += Math.cos(headingRad) * stepDist;
            ent.transform.y += Math.sin(headingRad) * stepDist;
          } else {
            // Infantry moves along step direction
            const nx = dx / (dist || 1);
            const ny = dy / (dist || 1);
            ent.transform.x += nx * stepDist;
            ent.transform.y += ny * stepDist;
          }
          ent.movement.currentSpeed = speed;
        }
      }

      // Vehicle chassis physics & turret traverse
      stepVehiclePhysics(ent, dt);

      // Passenger position tracking (infantry inside/riding vehicle)
      if (ent.crew.vehicleId && !ent.movement.order) {
        const vehicle = this.entities.get(ent.crew.vehicleId);
        if (vehicle) {
          ent.transform.x = vehicle.transform.x;
          ent.transform.y = vehicle.transform.y;
          ent.transform.z = vehicle.transform.z;
          ent.transform.zl = vehicle.transform.zl;
        }
      }

      // Subtle look_around idle behavior if enabled and not moving
      if (ent.brain.lookAround && !ent.movement.order) {
        if ((this.tickIndex + ent.id) % 40 === 0) {
          const deltaZl = this.prng.nextRange(-8.0, 8.0);
          ent.transform.zl = (ent.transform.zl + deltaZl) % 360;
        }
      }
    }

    // 2.4 AI Engine step
    this.ai.step(dt);

    // 2.5 Combat & Ballistics simulation step
    this.combatEngine.step(dt);

    // 2.6 Trigger VM step
    this.triggerVm.step(dt);

    // 2.7 Skirmish System step
    this.skirmish.step(dt);

    // 3. Emit tick event
    this.eventBus.emit('sim:tick', { tick: this.tickIndex, time: this.time }, this.tickIndex);
  }

  /** Run N steps */
  stepN(n: number) {
    for (let i = 0; i < n; i++) {
      this.step();
    }
  }

  /** Get entity by numeric ID or hex string */
  getEntity(id: number | string): SimEntity | undefined {
    const numId = typeof id === 'string' ? parseInt(id, 16) : id;
    return this.entities.get(numId);
  }

  /** Get all entities matching a tag */
  getEntitiesByTag(tag: string): SimEntity[] {
    const ids = this.tagsIndex.get(tag);
    if (!ids) return [];
    const res: SimEntity[] = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e) res.push(e);
    }
    return res;
  }

  /** Get all entities owned by a player */
  getEntitiesByPlayer(player: number): SimEntity[] {
    const res: SimEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.owner.player === player) res.push(e);
    }
    return res;
  }

  private nextEntityId = 100000;
  generateEntityId(): number {
    while (this.entities.has(this.nextEntityId)) {
      this.nextEntityId++;
    }
    return this.nextEntityId++;
  }

  /**
   * Clone a template entity into a live active entity and place it at spawn coordinates.
   */
  spawnClonedEntity(
    template: SimEntity,
    spawnPos: { x: number; y: number; z?: number; zl?: number }
  ): SimEntity {
    const newId = this.generateEntityId();
    const cloned: SimEntity = {
      id: newId,
      idHex: '0x' + newId.toString(16),
      kind: template.kind,
      proto: template.proto,
      transform: {
        x: spawnPos.x,
        y: spawnPos.y,
        z: spawnPos.z ?? template.transform.z,
        zl: spawnPos.zl ?? template.transform.zl,
        prevX: spawnPos.x,
        prevY: spawnPos.y,
        prevZ: spawnPos.z ?? template.transform.z,
        prevZl: spawnPos.zl ?? template.transform.zl,
      },
      health: { current: template.health.max, max: template.health.max, alive: true },
      owner: { player: template.owner.player, mid: template.owner.mid },
      tags: new Set(template.tags),
      inventory: [...template.inventory],
      crew: { passengers: new Map() },
      brain: {
        moveMode: 'free',
        control: 'user',
        fireMode: 'free',
        lookAround: true,
        aiMoveMode: 'auto',
        props: { ...template.brain.props },
      },
      movement: {
        currentSpeed: 0,
        maxSpeed: template.movement.maxSpeed || 60,
        posture: template.movement.posture,
      },
      texMod: template.texMod,
      impregnability: template.impregnability,
      fsmState: template.fsmState,
      spawnedInFog: template.spawnedInFog,
    };
    cloned.tags.delete('hidden');

    if (cloned.kind === 'entity') {
      setupVehicleEntity(cloned);
    }
    setupEntityCombat(cloned);

    this.entities.set(newId, cloned);
    for (const tag of cloned.tags) {
      let set = this.tagsIndex.get(tag);
      if (!set) {
        set = new Set();
        this.tagsIndex.set(tag, set);
      }
      set.add(newId);
    }

    this.eventBus.emit('entity:spawned', cloned, this.tickIndex);
    return cloned;
  }

  /** Compute deterministic 64-bit FNV-1a hash of the current world state */
  computeStateHash(): string {
    let hash = 0x811c9dc5; // 32-bit FNV offset basis
    const fnv = (val: number) => {
      hash ^= val & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (val >>> 8) & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (val >>> 16) & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (val >>> 24) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    };

    fnv(this.tickIndex);
    fnv(this.entities.size);

    // Sort entity IDs for determinism
    const sortedIds = Array.from(this.entities.keys()).sort((a, b) => a - b);
    for (const id of sortedIds) {
      const e = this.entities.get(id)!;
      fnv(id);
      // Fixed point coordinates
      fnv(Math.round(e.transform.x * 100));
      fnv(Math.round(e.transform.y * 100));
      fnv(Math.round(e.transform.z * 100));
      fnv(Math.round(e.transform.zl * 100));
      fnv(Math.round(e.health.current));
      fnv(e.owner.player);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
  }
}
