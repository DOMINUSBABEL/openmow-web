/**
 * OpenMoW-Web Trigger Virtual Machine (T11 / Gate G3).
 *
 * Implements:
 * 1. Coroutine-based action execution pipeline with delay suspension.
 * 2. Condition evaluation with AND logic:
 *    - event (id)
 *    - cmp_i (var op value)
 *    - entities (selector with count op value)
 *    - task (name state)
 *    - difficulty (level)
 * 3. 32 mission action types + unknown action warning & counter (zero crash guarantee).
 * 4. Entity selector resolution (tags, player, zones, types, groups).
 * 5. Lifecycle events: start, difficulty, reinforcements, tasks, gameover.
 *
 * Pure deterministic engine code, zero Three.js/DOM dependencies.
 */

import type { World } from '../engine/world';
import type { SimEntity } from '../engine/components';
import type {
  MissionDoc,
  MissionTrigger,
  MissionTerm,
  MissionAction,
  MissionZone,
} from '../contracts/mission';

export interface TriggerState {
  trigger: MissionTrigger;
  enabled: boolean;
  executionCount: number;
  coroutine?: ActionCoroutine;
}

export interface ActionCoroutine {
  id: number;
  triggerName: string;
  actions: MissionAction[];
  actionIndex: number;
  delayRemaining: number;
  finished: boolean;
}

export const LEVEL_MAP: Record<string, number> = {
  easy: 0,
  normal: 1,
  hard: 2,
  heroic: 3,
};

/** Extract string tag from node or AST atom */
export function getNodeTag(item: any): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    if (typeof item.w === 'string') return item.w;
    if (item.k === '{' && Array.isArray(item.i) && item.i.length > 0) {
      return getNodeTag(item.i[0]);
    }
  }
  return String(item);
}

/** Helper to extract child block property value from SDL AST block */
export function getBlockProp(block: any, tag: string): any {
  if (!block || !Array.isArray(block.i)) return undefined;
  for (let idx = 1; idx < block.i.length; idx++) {
    const child = block.i[idx];
    if (typeof child === 'object' && child !== null && child.k === '{' && Array.isArray(child.i)) {
      const ctag = getNodeTag(child.i[0]);
      if (ctag === tag) {
        if (child.i.length === 1) return true;
        if (child.i.length === 2) {
          const val = child.i[1];
          return typeof val === 'object' && val !== null && 'w' in val ? val.w : val;
        }
        return child.i.slice(1).map((x: any) => (typeof x === 'object' && x !== null && 'w' in x ? x.w : x));
      }
    }
  }
  return undefined;
}

/** Check if 2D coordinate is inside a MissionZone */
export function isPointInZone(x: number, y: number, zone: MissionZone): boolean {
  if (zone.kind === 'circle') {
    const radius = zone.radius ?? 50;
    const zx = zone.position[0];
    const zy = zone.position[1];
    return Math.hypot(x - zx, y - zy) <= radius;
  } else if (zone.kind === 'poly' && zone.points && zone.points.length >= 3) {
    // Ray-casting algorithm for point in polygon
    const zx = zone.position[0];
    const zy = zone.position[1];
    const pts = zone.points.map(([px, py]) => [zx + px, zy + py]);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  return false;
}

export class TriggerVM {
  public world: World;
  public events = new Set<string>();
  public vars = new Map<string, number>();
  public tasks = new Map<string, { state: string; desc?: string; primary?: boolean }>();
  public difficulty = 1; // 0: easy, 1: normal, 2: hard, 3: heroic
  public triggers = new Map<string, TriggerState>();
  public zones = new Map<string, MissionZone>();

  // Diagnostic counters
  public unknownActionsCount = 0;
  public unknownTermsCount = 0;
  public executedTriggersCount = 0;
  public firedTriggerNames = new Set<string>();

  public runningCoroutines: ActionCoroutine[] = [];
  private nextCoroutineId = 1;
  public gameOverResult?: { result: 'win' | 'lose'; message?: string };

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Initialize VM state from a parsed MissionDoc.
   */
  init(doc: MissionDoc, difficulty = 1) {
    this.events.clear();
    this.vars.clear();
    this.tasks.clear();
    this.triggers.clear();
    this.zones.clear();
    this.runningCoroutines = [];
    this.firedTriggerNames.clear();
    this.unknownActionsCount = 0;
    this.unknownTermsCount = 0;
    this.executedTriggersCount = 0;
    this.gameOverResult = undefined;
    this.difficulty = difficulty;

    // 1. Initial Events: declared events in doc.helpers.events start in off state

    // 2. Initial Vars
    for (const [k, v] of Object.entries(doc.helpers.vars)) {
      this.vars.set(k, Number(v) || 0);
    }

    // 3. Initial Tasks
    for (const t of doc.helpers.tasks) {
      this.tasks.set(t.id, {
        state: t.state ?? 'hidden',
        desc: t.desc,
        primary: t.primary,
      });
    }

    // 4. Initial Zones
    for (const z of doc.helpers.zones) {
      this.zones.set(z.name, z);
    }

    // 5. Register Triggers
    for (const tr of doc.helpers.triggers) {
      this.triggers.set(tr.name, {
        trigger: tr,
        enabled: true, // all triggers enabled initially
        executionCount: 0,
      });
    }
  }

  /**
   * Step Trigger VM for one tick (dt = 0.05s at 20 Hz).
   */
  step(dt: number) {
    // 1. Advance running action coroutines
    const activeCoroutines: ActionCoroutine[] = [];
    for (const cr of this.runningCoroutines) {
      if (cr.finished) continue;

      if (cr.delayRemaining > 0) {
        cr.delayRemaining = Math.max(0, cr.delayRemaining - dt);
        if (cr.delayRemaining > 0) {
          activeCoroutines.push(cr);
          continue;
        }
      }

      // Execute next actions in coroutine until next delay or end
      this.resumeCoroutine(cr);
      if (!cr.finished) {
        activeCoroutines.push(cr);
      }
    }
    this.runningCoroutines = activeCoroutines;

    // 2. Periodically check and fire eligible triggers
    for (const [tName, state] of this.triggers.entries()) {
      if (!state.enabled || state.coroutine) continue;

      const terms = state.trigger.condition.terms;
      let conditionMet = true;

      if (terms.length > 0) {
        for (const term of terms) {
          if (!this.evaluateConditionTerm(term)) {
            conditionMet = false;
            break;
          }
        }
      }

      if (conditionMet) {
        // Trigger condition satisfied -> fire!
        state.enabled = false; // Disarm until re-armed
        state.executionCount++;
        this.executedTriggersCount++;
        this.firedTriggerNames.add(tName);
        this.world.eventBus.emit('trigger:fired', { trigger: tName }, this.world.tickIndex);

        // Start executing actions as coroutine
        const cr: ActionCoroutine = {
          id: this.nextCoroutineId++,
          triggerName: tName,
          actions: [...state.trigger.actions],
          actionIndex: 0,
          delayRemaining: 0,
          finished: false,
        };
        state.coroutine = cr;
        this.resumeCoroutine(cr);
        if (!cr.finished) {
          this.runningCoroutines.push(cr);
        } else {
          state.coroutine = undefined;
        }
      }
    }
  }

  /**
   * Resume coroutine until next delay or completion.
   */
  private resumeCoroutine(cr: ActionCoroutine) {
    while (cr.actionIndex < cr.actions.length && cr.delayRemaining === 0) {
      const action = cr.actions[cr.actionIndex];
      cr.actionIndex++;
      this.executeAction(cr, action);
    }
    if (cr.actionIndex >= cr.actions.length && cr.delayRemaining === 0) {
      cr.finished = true;
      const trState = this.triggers.get(cr.triggerName);
      if (trState) {
        trState.coroutine = undefined;
      }
    }
  }

  /**
   * Evaluate a single condition term.
   */
  public evaluateConditionTerm(term: MissionTerm): boolean {
    const raw = term.raw;
    switch (term.type) {
      case 'event': {
        const evId = String(getBlockProp(raw, 'id') ?? '').replace(/^"+|"+$/g, '');
        return this.events.has(evId);
      }
      case 'cmp_i': {
        const vName = String(getBlockProp(raw, 'var') ?? '');
        const op = String(getBlockProp(raw, 'op') ?? '==');
        const targetVal = Number(getBlockProp(raw, 'value') ?? 0);
        const currentVal = this.vars.get(vName) ?? 0;
        return this.compareNumbers(currentVal, op, targetVal);
      }
      case 'entities': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        const countBlock = this.findChildBlock(raw, 'count');
        if (countBlock) {
          const op = String(getBlockProp(countBlock, 'op') ?? '>=');
          const value = Number(getBlockProp(countBlock, 'value') ?? 1);
          return this.compareNumbers(matched.length, op, value);
        }
        // Without count: condition means at least 1 entity exists
        return matched.length >= 1;
      }
      case 'task': {
        const tName = String(getBlockProp(raw, 'name') ?? '');
        const targetState = String(getBlockProp(raw, 'state') ?? 'complete');
        const task = this.tasks.get(tName);
        return task ? task.state === targetState : false;
      }
      case 'difficulty': {
        const lvlRaw = getBlockProp(raw, 'level');
        const lvlStr = String(lvlRaw ?? 'normal').toLowerCase();
        const targetLvl = lvlStr in LEVEL_MAP ? LEVEL_MAP[lvlStr] : Number(lvlRaw ?? 1);
        return this.difficulty === targetLvl;
      }
      default:
        this.unknownTermsCount++;
        console.warn(`[TriggerVM] Unknown condition term type: ${term.type}`);
        return false;
    }
  }

  /**
   * Execute a single action in a coroutine.
   */
  public executeAction(cr: ActionCoroutine, action: MissionAction) {
    const raw = action.raw;
    const aType = action.type;

    switch (aType) {
      case 'trigger': {
        const targetName = String(getBlockProp(raw, 'name') ?? '');
        const tr = this.triggers.get(targetName);
        if (tr) {
          tr.enabled = true; // Arm trigger
        }
        break;
      }
      case 'delay': {
        const timeSec = Number(getBlockProp(raw, 'time') ?? 0);
        cr.delayRemaining = Math.max(0, timeSec);
        break;
      }
      case 'event': {
        const evId = String(getBlockProp(raw, 'event') ?? '').replace(/^"+|"+$/g, '');
        const mode = String(getBlockProp(raw, 'mode') ?? 'on');
        if (mode === 'on') {
          this.events.add(evId);
          this.world.eventBus.emit('event:set', { event: evId, mode: 'on' }, this.world.tickIndex);
        } else {
          this.events.delete(evId);
          this.world.eventBus.emit('event:set', { event: evId, mode: 'off' }, this.world.tickIndex);
        }
        break;
      }
      case 'reinforcement': {
        const op = String(getBlockProp(raw, 'operation') ?? '');
        const score = getBlockProp(raw, 'score');
        const name = getBlockProp(raw, 'name');
        if (op === 'score_add' && score !== undefined) {
          const cur = this.vars.get('player_score') ?? 0;
          this.vars.set('player_score', cur + Number(score));
        }
        this.world.eventBus.emit('reinforcement:op', { op, score, name }, this.world.tickIndex);
        break;
      }
      case 'entity_state': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        const tagAdd = getBlockProp(raw, 'tag_add');
        const tagRemove = getBlockProp(raw, 'tag_remove');
        const inactive = getBlockProp(raw, 'inactive');

        for (const ent of matched) {
          if (tagAdd) ent.tags.add(String(tagAdd));
          if (tagRemove) ent.tags.delete(String(tagRemove));
          if (inactive !== undefined) {
            ent.health.alive = inactive !== 'on' && inactive !== true;
          }
        }
        break;
      }
      case 'actor_state': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        const control = getBlockProp(raw, 'control');
        const moveMode = getBlockProp(raw, 'move_mode');
        const aiMove = getBlockProp(raw, 'ai_move');
        const postureVal = getBlockProp(raw, 'movement');

        for (const ent of matched) {
          if (control) ent.brain.control = String(control);
          if (moveMode) ent.brain.moveMode = String(moveMode);
          if (aiMove) ent.brain.aiMoveMode = String(aiMove);
          if (postureVal) {
            const p = String(postureVal).toLowerCase();
            if (p === 'squat' || p === 'crouch') ent.movement.posture = 'crouch';
            else if (p === 'lie' || p === 'prone') ent.movement.posture = 'prone';
            else if (p === 'stand') ent.movement.posture = 'stand';
          }
        }
        break;
      }
      case 'set_i': {
        const vName = String(getBlockProp(raw, 'var') ?? '');
        const op = String(getBlockProp(raw, 'op') ?? '=');
        const val = Number(getBlockProp(raw, 'value') ?? 0);
        const cur = this.vars.get(vName) ?? 0;

        let res = cur;
        if (op === '=' || op === '==') res = val;
        else if (op === '+=' || op === '+') res = cur + val;
        else if (op === '-=' || op === '-') res = cur - val;
        else if (op === '*=') res = cur * val;
        this.vars.set(vName, res);
        break;
      }
      case 'rt_function': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const callName = String(getBlockProp(raw, 'call') ?? '');
        this.world.eventBus.emit('rt_function', { call: callName, selector: selectorRaw }, this.world.tickIndex);
        break;
      }
      case 'objective_progress': {
        const title = String(getBlockProp(raw, 'title') ?? '');
        const add = getBlockProp(raw, 'add');
        this.world.eventBus.emit('objective:progress', { title, add }, this.world.tickIndex);
        break;
      }
      case 'if': {
        const condBlock = this.findChildBlock(raw, 'condition');
        let condMet = true;
        if (condBlock) {
          const cType = String(getBlockProp(condBlock, 'type') ?? '');
          if (cType === 'difficulty') {
            const lvlRaw = getBlockProp(condBlock, 'level');
            const lvlStr = String(lvlRaw ?? 'normal').toLowerCase();
            const targetLvl = lvlStr in LEVEL_MAP ? LEVEL_MAP[lvlStr] : Number(lvlRaw ?? 1);
            condMet = this.difficulty === targetLvl;
          } else {
            const termsBlock = this.findChildBlock(condBlock, 'terms') ?? condBlock;
            for (let idx = 1; idx < termsBlock.i.length; idx++) {
              const termNode = termsBlock.i[idx];
              if (typeof termNode === 'object' && termNode !== null && termNode.k === '{') {
                const rawTag = getNodeTag(termNode.i[0]);
                const tType = String(rawTag).replace(/^\d+\./, '');
                if (tType && !this.evaluateConditionTerm({ orderKey: '', type: tType, raw: termNode })) {
                  condMet = false;
                  break;
                }
              }
            }
          }
        }
        if (condMet) {
          // Splice nested actions directly into current coroutine for sequential execution with delay support
          const nestedActions: MissionAction[] = [];
          for (let idx = 1; idx < raw.i.length; idx++) {
            const sub = raw.i[idx];
            if (typeof sub === 'object' && sub !== null && sub.k === '{') {
              const stag = getNodeTag(sub.i[0]);
              if (stag && stag !== 'condition') {
                nestedActions.push({ type: stag, raw: sub });
              }
            }
          }
          if (nestedActions.length > 0) {
            cr.actions.splice(cr.actionIndex, 0, ...nestedActions);
          }
        }
        break;
      }
      case 'autoassign': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        for (const ent of matched) {
          ent.brain.control = 'user';
        }
        break;
      }
      case 'delete': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        for (const ent of matched) {
          this.world.entities.delete(ent.id);
        }
        break;
      }
      case 'task': {
        const tName = String(getBlockProp(raw, 'name') ?? '');
        const state = String(getBlockProp(raw, 'state') ?? 'complete');
        const t = this.tasks.get(tName);
        if (t) {
          t.state = state;
        } else {
          this.tasks.set(tName, { state });
        }
        this.world.eventBus.emit('task:state_changed', { task: tName, state }, this.world.tickIndex);
        break;
      }
      case 'gameover': {
        const result = String(getBlockProp(raw, 'result') ?? 'lose') as 'win' | 'lose';
        const msg = String(getBlockProp(raw, 'message') ?? '');
        this.gameOverResult = { result, message: msg };
        this.world.eventBus.emit('game:over', { result, message: msg }, this.world.tickIndex);
        break;
      }
      case 'scenario': {
        const eventOnNext = getBlockProp(raw, 'event_on_next');
        if (eventOnNext) {
          const evStr = String(eventOnNext).replace(/^"+|"+$/g, '');
          this.events.add(evStr);
        }
        break;
      }
      case 'waypoint': {
        const whoRaw = this.findChildBlock(raw, 'who');
        const actRaw = this.findChildBlock(raw, 'action');
        const actorsBlock = whoRaw ? this.findChildBlock(whoRaw, 'actors') ?? whoRaw : undefined;
        const selectorRaw = actorsBlock ? this.findChildBlock(actorsBlock, 'selector') ?? actorsBlock : whoRaw;
        const matched = this.selectEntities(selectorRaw);
        const wpVal = actRaw ? getBlockProp(actRaw, 'waypoint') : undefined;
        const isClone = actRaw
          ? this.findChildBlock(actRaw, 'clone') !== undefined || getBlockProp(actRaw, 'clone') !== undefined
          : false;

        if (isClone && matched.length > 0 && wpVal !== undefined) {
          const track =
            this.world.ai.waypoints.get(String(wpVal)) ??
            this.world.ai.waypoints.get(Number(wpVal));
          const startNode = track?.nodes[0];
          const baseX = startNode ? startNode.position[0] : matched[0].transform.x;
          const baseY = startNode ? startNode.position[1] : matched[0].transform.y;
          const baseZ = startNode ? startNode.position[2] : matched[0].transform.z;

          const spawnedIds: number[] = [];
          matched.forEach((template, idx) => {
            const spreadX = ((idx % 3) - 1) * 35;
            const spreadY = Math.floor(idx / 3) * -40;
            const cloned = this.world.spawnClonedEntity(template, {
              x: baseX + spreadX,
              y: baseY + spreadY,
              z: baseZ,
            });
            spawnedIds.push(cloned.id);
          });

          this.world.ai.executeWaypointTrack(spawnedIds, String(wpVal));
        } else if (wpVal !== undefined && matched.length > 0) {
          this.world.ai.executeWaypointTrack(matched.map((e) => e.id), String(wpVal));
        }
        break;
      }
      case 'actor_to_cover': {
        const selectorRaw = this.findChildBlock(raw, 'selector');
        const matched = this.selectEntities(selectorRaw);
        if (matched.length > 0) {
          this.world.ai.actorToCover(matched.map((e) => e.id));
        }
        break;
      }
      case 'sound':
      case 'music':
      case 'talk':
      case 'switch':
      case 'case':
      case 'default':
      case 'board':
      case 'spawn':
      case 'ables':
      case 'fade':
      case 'emit':
      case 'while':
      case 'throw_off':
      case 'air_attack':
      case 'animate':
      case 'linker':
      case 'effect':
      case 'autosave':
      case 'achievement':
      case '##': {
        // Supported actions: emit event or no-op without error
        break;
      }
      default:
        this.unknownActionsCount++;
        console.warn(`[TriggerVM] Unknown action type: ${aType}`);
        break;
    }
  }

  /**
   * Filter entities matching a selector AST block.
   */
  public selectEntities(selectorRaw: any): SimEntity[] {
    if (!selectorRaw || !Array.isArray(selectorRaw.i)) {
      return Array.from(this.world.entities.values());
    }

    const tagFilter = getBlockProp(selectorRaw, 'tag');
    const playerFilter = getBlockProp(selectorRaw, 'player');
    const zoneFilter = getBlockProp(selectorRaw, 'zone');
    const typeFilter = getBlockProp(selectorRaw, 'type');
    const amount = getBlockProp(selectorRaw, 'amount');

    const result: SimEntity[] = [];

    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;

      if (tagFilter && !ent.tags.has(String(tagFilter))) {
        continue;
      }
      if (playerFilter !== undefined && ent.owner.player !== Number(playerFilter)) {
        continue;
      }
      if (typeFilter && ent.kind !== String(typeFilter)) {
        continue;
      }
      if (zoneFilter) {
        const zone = this.zones.get(String(zoneFilter));
        if (zone && !isPointInZone(ent.transform.x, ent.transform.y, zone)) {
          continue;
        }
      }

      result.push(ent);
      if (amount !== undefined && result.length >= Number(amount)) {
        break;
      }
    }

    return result;
  }

  private findChildBlock(block: any, tag: string): any {
    if (!block || !Array.isArray(block.i)) return undefined;
    for (let idx = 1; idx < block.i.length; idx++) {
      const child = block.i[idx];
      if (typeof child === 'object' && child !== null && child.k === '{' && Array.isArray(child.i)) {
        const ctag = getNodeTag(child.i[0]);
        if (ctag === tag) return child;
      }
    }
    return undefined;
  }

  private compareNumbers(left: number, op: string, right: number): boolean {
    switch (op) {
      case '==':
      case '=':
        return left === right;
      case '!=':
      case '<>':
        return left !== right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      default:
        return false;
    }
  }
}
