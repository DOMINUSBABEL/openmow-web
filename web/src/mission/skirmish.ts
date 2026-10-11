/**
 * OpenMoW-Web Skirmish System (T12 / Gate G3 -> G4).
 *
 * Implements:
 * 1. Skirmish Flag management: flag zones, capture zones, status, and tag 'captured'.
 * 2. Reinforcement economy: scoreCurrent / scoreTotal, purchasing, cooldowns, and eventStart dispatch.
 * 3. Objective & Task integration.
 * 4. Win / Loss resolution:
 *    - Win when all flags recaptured (via natural capture triggers or cheat '?cheat=capture')
 *    - Loss when all player combat units eliminated without remaining resources
 * 5. Deterministic simulation updates at 20 Hz.
 */

import type { World } from '../engine/world';
import type {
  MissionDoc,
  MissionZone,
  MissionReinforcementItem,
} from '../contracts/mission';
import { isPointInZone } from './vm';

export interface SkirmishFlag {
  id: string; // e.g. "flag_a01"
  name: string;
  zone: MissionZone;
  captureZone?: MissionZone;
  holder: 'player' | 'enemy' | 'neutral';
  captured: boolean;
}

export interface ReinforcementSlot {
  item: MissionReinforcementItem;
  countRemaining: number; // -1 for infinite
  cooldownRemaining: number;
  available: boolean;
}

export class SkirmishSystem {
  public world: World;
  public flags: Map<string, SkirmishFlag> = new Map();
  public scoreTotal = 2000;
  public scoreCurrent = 200; // Starting MP
  public reinforcements: Map<string, ReinforcementSlot> = new Map();
  public incomeTimer = 0;
  public gameOver: { result: 'win' | 'lose'; message?: string } | null = null;

  // Flag capture constants
  private static readonly FLAG_INCOME_INTERVAL = 10.0; // Seconds per score tick
  private static readonly FLAG_INCOME_AMOUNT = 5; // MP per held flag per interval

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Initialize skirmish state from MissionDoc.
   */
  init(doc: MissionDoc) {
    this.flags.clear();
    this.reinforcements.clear();
    this.incomeTimer = 0;
    this.gameOver = null;

    // 1. Initialize Reinforcements & Score
    this.scoreTotal = doc.helpers?.reinforcements?.scoreTotal || 2000;
    const initialScore = doc.helpers?.reinforcements?.scoreCurrent;
    this.scoreCurrent = initialScore !== undefined && initialScore > 0 ? initialScore : 500;

    for (const item of doc.helpers?.reinforcements?.items ?? []) {
      const isMenuOrFlag = item.id.startsWith('menu:') || item.id === 'player_flag';
      this.reinforcements.set(item.id, {
        item,
        countRemaining: item.count !== undefined ? item.count : -1,
        cooldownRemaining: 0,
        available: !isMenuOrFlag,
      });
    }

    // 1b. Listen to TriggerVM reinforcement operations (economy and visibility)
    this.world.eventBus.on('reinforcement:op', (ev: any) => {
      const data = ev.data ?? ev;
      if (!data) return;
      if (data.op === 'score_add' && data.score !== undefined) {
        this.scoreCurrent = Math.min(this.scoreTotal, this.scoreCurrent + Number(data.score));
      } else if (data.op === 'show' && data.name) {
        const slot = this.reinforcements.get(data.name);
        if (slot) slot.available = true;
      } else if (data.op === 'hide' && data.name) {
        const slot = this.reinforcements.get(data.name);
        if (slot) slot.available = false;
      }
    });

    // 2. Discover Flags and Capture Zones
    const zonesMap = new Map<string, MissionZone>();
    for (const z of doc.helpers?.zones ?? []) {
      zonesMap.set(z.name, z);
    }

    for (const z of doc.helpers?.zones ?? []) {
      if (z.name.startsWith('flag_') && !z.name.endsWith('_capture')) {
        const flagId = z.name;
        const captureZone = zonesMap.get(`${flagId}_capture`);
        this.flags.set(flagId, {
          id: flagId,
          name: flagId,
          zone: z,
          captureZone,
          holder: 'enemy', // Skirmishes start with enemy holding defensive flags
          captured: false,
        });
      }
    }

    // Check query params if in browser
    if (typeof window !== 'undefined' && window.location?.search) {
      if (window.location.search.includes('cheat=capture')) {
        this.cheatCaptureAll();
      }
    }
  }

  /**
   * Deterministic step loop (called from world.step(dt) at 20 Hz).
   */
  step(dt: number) {
    if (this.gameOver) return;

    // 1. Advance reinforcement cooldowns
    for (const slot of this.reinforcements.values()) {
      if (slot.cooldownRemaining > 0) {
        slot.cooldownRemaining = Math.max(0, slot.cooldownRemaining - dt);
      }
    }

    // 2. Sync flag states from Trigger VM events and tags
    for (const flag of this.flags.values()) {
      const recaptureEv = `${flag.id}_checker_recapture`;
      const captureEv = `${flag.id}_checker_capture`;

      if (this.world.triggerVm.events.has(recaptureEv)) {
        flag.holder = 'player';
        flag.captured = true;
      } else if (this.world.triggerVm.events.has(captureEv)) {
        flag.holder = 'enemy';
        flag.captured = false;
      }
    }

    // 3. Check unit presence in flag zones for active contest
    for (const flag of this.flags.values()) {
      if (flag.captured) continue;
      const zone = flag.captureZone ?? flag.zone;
      let playerInZone = 0;
      let enemyInZone = 0;

      for (const ent of this.world.entities.values()) {
        if (!ent.health.alive) continue;
        if (isPointInZone(ent.transform.x, ent.transform.y, zone)) {
          if (ent.owner.player === 1) playerInZone++;
          else if (ent.owner.player === 2) enemyInZone++;
        }
      }

      if (playerInZone > 0 && enemyInZone === 0) {
        this.world.eventBus.emit('flag:securing', { flag: flag.id, player: 1 }, this.world.tickIndex);
      }
    }

    // 4. Periodic income from captured flags
    this.incomeTimer += dt;
    if (this.incomeTimer >= SkirmishSystem.FLAG_INCOME_INTERVAL) {
      this.incomeTimer -= SkirmishSystem.FLAG_INCOME_INTERVAL;
      let heldCount = 0;
      for (const flag of this.flags.values()) {
        if (flag.holder === 'player') heldCount++;
      }
      if (heldCount > 0) {
        this.scoreCurrent = Math.min(
          this.scoreTotal,
          this.scoreCurrent + heldCount * SkirmishSystem.FLAG_INCOME_AMOUNT
        );
      }
    }

    // 4. Sync Game Over from Trigger VM
    if (this.world.triggerVm.gameOverResult) {
      this.gameOver = this.world.triggerVm.gameOverResult;
      return;
    }

    // 5. Check Defeat Condition (0 alive player combat units)
    this.checkDefeatCondition();
  }

  /**
   * Purchase a reinforcement item.
   */
  buyReinforcement(itemId: string): boolean {
    const slot = this.reinforcements.get(itemId);
    if (!slot) return false;

    const cost = slot.item.score ?? 0;
    if (this.scoreCurrent < cost) return false;
    if (slot.cooldownRemaining > 0) return false;
    if (slot.countRemaining === 0) return false;

    // Deduct cost and set cooldown
    this.scoreCurrent -= cost;
    slot.cooldownRemaining = slot.item.delay ?? 20;
    if (slot.countRemaining > 0) {
      slot.countRemaining--;
    }

    // Fire the reinforcement event to wake up the mission trigger
    if (slot.item.eventStart) {
      this.world.triggerVm.events.add(slot.item.eventStart);
      this.world.eventBus.emit(
        'reinforcement:called',
        { id: itemId, eventStart: slot.item.eventStart, cost },
        this.world.tickIndex
      );
    }

    return true;
  }

  /**
   * Cheat: Instantly capture all flags for the player.
   * Sets all `flag_*_checker_recapture` events, marks tags, and triggers `victory/win`.
   */
  cheatCaptureAll() {
    for (const flag of this.flags.values()) {
      flag.holder = 'player';
      flag.captured = true;

      // Set trigger VM events
      this.world.triggerVm.events.add(`${flag.id}_checker_recapture`);
      this.world.triggerVm.events.delete(`${flag.id}_checker_capture`);

      // Add 'captured' tag to player flag entities
      const pFlagEnts = this.world.getEntitiesByTag(`${flag.id}_player`);
      for (const ent of pFlagEnts) {
        ent.tags.add('captured');
        ent.health.alive = true;
      }
    }

    // Also set all mission declared recapture events
    if (this.world.missionDoc) {
      for (const ev of this.world.missionDoc.helpers.events) {
        if (ev.endsWith('_checker_recapture')) {
          this.world.triggerVm.events.add(ev);
        }
      }
    }

    this.world.eventBus.emit('cheat:capture_all', {}, this.world.tickIndex);
  }

  /**
   * Cheat: Eliminate all player-controlled units to trigger defeat.
   */
  cheatEliminatePlayerUnits() {
    for (const ent of this.world.entities.values()) {
      if (ent.owner.player === 1) {
        ent.health.current = 0;
        ent.health.alive = false;
      }
    }
    this.scoreCurrent = 0;
    this.checkDefeatCondition(true);
  }

  /**
   * Check if player has suffered complete defeat.
   */
  public checkDefeatCondition(force = false) {
    if (this.gameOver) return;

    // Give 40 ticks (2.0s) initial grace period for mission setup triggers
    if (this.world.tickIndex < 40 && !force) return;

    let alivePlayerUnits = 0;
    for (const ent of this.world.entities.values()) {
      if (ent.owner.player === 1 && ent.health.alive) {
        if (ent.kind === 'human') {
          alivePlayerUnits++;
        } else if (ent.kind === 'entity' && ent.crew && ent.crew.passengers.size > 0) {
          alivePlayerUnits++;
        }
      }
    }

    if (alivePlayerUnits === 0) {
      // Check if player has enough score to buy any reinforcement
      let canAffordAny = false;
      for (const slot of this.reinforcements.values()) {
        const cost = slot.item.score ?? 0;
        if (this.scoreCurrent >= cost && slot.countRemaining !== 0) {
          canAffordAny = true;
          break;
        }
      }

      if (!canAffordAny || force) {
        this.triggerGameOver('lose', 'All player units have been eliminated');
      }
    }
  }

  /**
   * Trigger GameOver state.
   */
  public triggerGameOver(result: 'win' | 'lose', message?: string) {
    this.gameOver = { result, message };
    this.world.triggerVm.gameOverResult = { result, message };
    this.world.eventBus.emit('game:over', { result, message }, this.world.tickIndex);
  }
}
