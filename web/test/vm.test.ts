import { describe, it, expect, beforeEach } from 'vitest';
import { World, TICK_DT } from '../src/engine/world';
import { TriggerVM, isPointInZone } from '../src/mission/vm';
import { parseMissionDoc } from '../src/mission/load';
import type { MissionDoc, MissionTrigger, MissionZone } from '../src/contracts/mission';
import fs from 'node:fs';
import path from 'node:path';

describe('Trigger Virtual Machine (T11 Acceptance)', () => {
  let world: World;
  let vm: TriggerVM;

  beforeEach(() => {
    world = new World(42);
    vm = world.triggerVm;
  });

  it('evaluates condition terms accurately (event, cmp_i, task, difficulty)', () => {
    // 1. Event condition
    const eventTerm = {
      orderKey: '0',
      type: 'event',
      raw: { k: '{', i: ['event', { k: '{', i: ['id', '"intro_complete"'] }] },
    };
    expect(vm.evaluateConditionTerm(eventTerm)).toBe(false);
    vm.events.add('intro_complete');
    expect(vm.evaluateConditionTerm(eventTerm)).toBe(true);

    // 2. cmp_i condition
    vm.vars.set('reinforcements_called', 3);
    const cmpTermGte = {
      orderKey: '1',
      type: 'cmp_i',
      raw: {
        k: '{',
        i: [
          'cmp_i',
          { k: '{', i: ['var', 'reinforcements_called'] },
          { k: '{', i: ['op', '>='] },
          { k: '{', i: ['value', 3] },
        ],
      },
    };
    expect(vm.evaluateConditionTerm(cmpTermGte)).toBe(true);

    const cmpTermLt = {
      orderKey: '2',
      type: 'cmp_i',
      raw: {
        k: '{',
        i: [
          'cmp_i',
          { k: '{', i: ['var', 'reinforcements_called'] },
          { k: '{', i: ['op', '<'] },
          { k: '{', i: ['value', 3] },
        ],
      },
    };
    expect(vm.evaluateConditionTerm(cmpTermLt)).toBe(false);

    // 3. Task condition
    vm.tasks.set('capture_flag_a', { state: 'active' });
    const taskTerm = {
      orderKey: '3',
      type: 'task',
      raw: {
        k: '{',
        i: [
          'task',
          { k: '{', i: ['name', 'capture_flag_a'] },
          { k: '{', i: ['state', 'active'] },
        ],
      },
    };
    expect(vm.evaluateConditionTerm(taskTerm)).toBe(true);

    // 4. Difficulty condition
    vm.difficulty = 2; // Hard
    const diffTermHard = {
      orderKey: '4',
      type: 'difficulty',
      raw: { k: '{', i: ['difficulty', { k: '{', i: ['level', 2] }] },
    };
    expect(vm.evaluateConditionTerm(diffTermHard)).toBe(true);

    const diffTermEasy = {
      orderKey: '5',
      type: 'difficulty',
      raw: { k: '{', i: ['difficulty', { k: '{', i: ['level', 0] }] },
    };
    expect(vm.evaluateConditionTerm(diffTermEasy)).toBe(false);
  });

  it('evaluates entity selectors with spatial zones and tags', () => {
    // Register circle and poly zones
    const circleZone: MissionZone = {
      name: 'zone_town',
      kind: 'circle',
      position: [100, 200],
      radius: 50,
    };
    const polyZone: MissionZone = {
      name: 'zone_bunker',
      kind: 'poly',
      position: [0, 0],
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    };
    vm.zones.set(circleZone.name, circleZone);
    vm.zones.set(polyZone.name, polyZone);

    expect(isPointInZone(110, 210, circleZone)).toBe(true);
    expect(isPointInZone(200, 300, circleZone)).toBe(false);
    expect(isPointInZone(0, 0, polyZone)).toBe(true);
    expect(isPointInZone(50, 50, polyZone)).toBe(false);

    // Add dummy entities to world
    world.entities.set(101, {
      id: 101,
      idHex: '0x65',
      kind: 'human',
      proto: 'mp40',
      transform: { x: 105, y: 205, z: 0, zl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 1 },
      tags: new Set(['elite', 'frontline']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'ai', fireMode: 'free', lookAround: false, aiMoveMode: 'enable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    });

    world.entities.set(102, {
      id: 102,
      idHex: '0x66',
      kind: 'human',
      proto: 'rifle',
      transform: { x: 500, y: 500, z: 0, zl: 0 },
      health: { current: 100, max: 100, alive: true },
      owner: { player: 2 },
      tags: new Set(['conscript']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: { moveMode: 'hold', control: 'ai', fireMode: 'free', lookAround: false, aiMoveMode: 'enable', props: {} },
      movement: { currentSpeed: 0, maxSpeed: 60, posture: 'stand' },
    });

    // Test entity condition: player 1 inside zone_town with tag 'elite'
    const entitiesTerm = {
      orderKey: '0',
      type: 'entities',
      raw: {
        k: '{',
        i: [
          'entities',
          {
            k: '{',
            i: [
              'selector',
              { k: '{', i: ['player', 1] },
              { k: '{', i: ['zone', 'zone_town'] },
              { k: '{', i: ['tag', 'elite'] },
            ],
          },
          {
            k: '{',
            i: [
              'count',
              { k: '{', i: ['op', '>='] },
              { k: '{', i: ['value', 1] },
            ],
          },
        ],
      },
    };
    expect(vm.evaluateConditionTerm(entitiesTerm)).toBe(true);

    // Conscript selector should return 0 in zone_town
    const conscriptTerm = {
      orderKey: '1',
      type: 'entities',
      raw: {
        k: '{',
        i: [
          'entities',
          {
            k: '{',
            i: [
              'selector',
              { k: '{', i: ['zone', 'zone_town'] },
              { k: '{', i: ['tag', 'conscript'] },
            ],
          },
          {
            k: '{',
            i: [
              'count',
              { k: '{', i: ['op', '>='] },
              { k: '{', i: ['value', 1] },
            ],
          },
        ],
      },
    };
    expect(vm.evaluateConditionTerm(conscriptTerm)).toBe(false);
  });

  it('suspends and resumes action coroutines across ticks via delay', () => {
    // Construct a synthetic trigger with:
    // 1. set_i var=counter op='=' val=1
    // 2. delay time=0.1s (2 ticks at 20 Hz dt=0.05s)
    // 3. set_i var=counter op='=' val=2
    // 4. delay time=0.05s (1 tick)
    // 5. set_i var=counter op='=' val=3
    const trig: MissionTrigger = {
      name: 'coroutine_test',
      condition: { terms: [] }, // fires immediately
      actions: [
        {
          type: 'set_i',
          raw: {
            k: '{',
            i: ['set_i', { k: '{', i: ['var', 'counter'] }, { k: '{', i: ['op', '='] }, { k: '{', i: ['value', 1] }],
          },
        },
        {
          type: 'delay',
          raw: {
            k: '{',
            i: ['delay', { k: '{', i: ['time', 0.1] }],
          },
        },
        {
          type: 'set_i',
          raw: {
            k: '{',
            i: ['set_i', { k: '{', i: ['var', 'counter'] }, { k: '{', i: ['op', '='] }, { k: '{', i: ['value', 2] }],
          },
        },
        {
          type: 'delay',
          raw: {
            k: '{',
            i: ['delay', { k: '{', i: ['time', 0.05] }],
          },
        },
        {
          type: 'set_i',
          raw: {
            k: '{',
            i: ['set_i', { k: '{', i: ['var', 'counter'] }, { k: '{', i: ['op', '='] }, { k: '{', i: ['value', 3] }],
          },
        },
      ],
    };

    const doc: MissionDoc = {
      entities: [],
      humans: [],
      links: [],
      tags: [],
      inventories: [],
      brains: [],
      players: [],
      helpers: {
        events: [],
        vars: { counter: 0 },
        tasks: [],
        zones: [],
        triggers: [trig],
      },
    };

    world.initFromMission(doc);
    expect(vm.vars.get('counter')).toBe(0);

    // Tick 1 (t = 0.05s): Trigger fires!
    // Action 1 executes (counter = 1), hits delay(0.1s), remaining delay = 0.1s
    world.step(TICK_DT);
    expect(vm.vars.get('counter')).toBe(1);
    expect(vm.runningCoroutines.length).toBe(1);
    expect(vm.runningCoroutines[0].delayRemaining).toBeCloseTo(0.1, 4);

    // Tick 2 (t = 0.10s): delay decreases by 0.05s -> remaining 0.05s, counter still 1
    world.step(TICK_DT);
    expect(vm.vars.get('counter')).toBe(1);
    expect(vm.runningCoroutines[0].delayRemaining).toBeCloseTo(0.05, 4);

    // Tick 3 (t = 0.15s): delay reaches 0!
    // Action 3 executes (counter = 2), hits delay(0.05s)
    world.step(TICK_DT);
    expect(vm.vars.get('counter')).toBe(2);
    expect(vm.runningCoroutines[0].delayRemaining).toBeCloseTo(0.05, 4);

    // Tick 4 (t = 0.20s): delay reaches 0!
    // Action 5 executes (counter = 3), coroutine completes!
    world.step(TICK_DT);
    expect(vm.vars.get('counter')).toBe(3);
    expect(vm.runningCoroutines.length).toBe(0);
  });

  it('runs Overlord mission initialization, fires start triggers with 0 unknown terms and actions', () => {
    const overlordJsonPath = path.resolve(__dirname, 'fixtures/01_usa-overlord.json');
    expect(fs.existsSync(overlordJsonPath), `Fixture exists: ${overlordJsonPath}`).toBe(true);

    const rawData = JSON.parse(fs.readFileSync(overlordJsonPath, 'utf-8'));
    const doc: MissionDoc = parseMissionDoc(rawData, '01_usa-overlord');

    world.initFromMission(doc);
    expect(vm.triggers.size).toBeGreaterThan(0);
    expect(vm.vars.size).toBeGreaterThan(0);

    // Step 20 ticks (1.0s of simulation)
    for (let i = 0; i < 20; i++) {
      world.step(TICK_DT);
    }

    // Verify trigger lifecycle:
    // 1. "start" trigger fired
    expect(vm.firedTriggerNames.has('start')).toBe(true);
    // 2. Event "start" was set by scenario action
    expect(vm.events.has('start')).toBe(true);
    // 3. Difficulty trigger fired
    expect(vm.firedTriggerNames.has('difficulty')).toBe(true);
    // 4. Initial reinforcement triggers fired
    expect(vm.firedTriggerNames.has('reinforcements:player/start')).toBe(true);

    // 5. Zero unknown condition terms and zero unknown actions
    expect(vm.unknownTermsCount).toBe(0);
    expect(vm.unknownActionsCount).toBe(0);

    console.log(
      `[T11 Overlord VM Check] Triggers registered: ${vm.triggers.size}, Fired: ${vm.firedTriggerNames.size}, Unknown terms: ${vm.unknownTermsCount}, Unknown actions: ${vm.unknownActionsCount}`
    );
  });

  it('maintains bit-level multi-tick determinism across Trigger VM runs', () => {
    const overlordJsonPath = path.resolve(__dirname, 'fixtures/01_usa-overlord.json');
    const rawData = JSON.parse(fs.readFileSync(overlordJsonPath, 'utf-8'));
    const doc: MissionDoc = parseMissionDoc(rawData, '01_usa-overlord');

    // Run 1
    const world1 = new World(12345);
    world1.initFromMission(doc);
    for (let i = 0; i < 200; i++) {
      world1.step(TICK_DT);
    }
    const hash1 = world1.computeStateHash();
    const fired1 = Array.from(world1.triggerVm.firedTriggerNames).sort();

    // Run 2 (identical seed & inputs)
    const world2 = new World(12345);
    world2.initFromMission(doc);
    for (let i = 0; i < 200; i++) {
      world2.step(TICK_DT);
    }
    const hash2 = world2.computeStateHash();
    const fired2 = Array.from(world2.triggerVm.firedTriggerNames).sort();

    expect(hash1).toBe(hash2);
    expect(fired1).toEqual(fired2);
    expect(fired1.length).toBeGreaterThan(0);
    console.log(`[T11 Determinism] Hash: ${hash1}, Fired triggers count: ${fired1.length}`);
  });

  it('initializes and steps Trigger VM across all 15 skirmishes with 0 unknown terms, 0 unknown actions and zero crashes', () => {
    const skirmishes = [
      '01_usa-overlord',
      '02_usa-carentan',
      '03_usa-ardennes',
      '01_ger-caen',
      '02_ger-sthilaire',
      '03_ger-marketgarden',
      '01_eng-battleaxe',
      '02_eng-torch',
      '03_eng-arnhem',
      '01_rus-smolensk',
      '02_rus-koenigsberg',
      '03_rus-manchuria',
      '01_jap-khalkhingol',
      '02_jap-singapore',
      '03_jap-iwojima',
    ];

    const results: Record<string, { triggers: number; fired: number; unknownTerms: number; unknownActions: number }> = {};

    for (const name of skirmishes) {
      const p = path.resolve(__dirname, `fixtures/${name}.json`);
      if (!fs.existsSync(p)) continue;

      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const doc = parseMissionDoc(raw, name);
      const testWorld = new World(999);
      testWorld.initFromMission(doc);

      // Step 20 ticks (1.0s)
      for (let t = 0; t < 20; t++) {
        testWorld.step(TICK_DT);
      }

      const tvm = testWorld.triggerVm;
      results[name] = {
        triggers: tvm.triggers.size,
        fired: tvm.firedTriggerNames.size,
        unknownTerms: tvm.unknownTermsCount,
        unknownActions: tvm.unknownActionsCount,
      };

      expect(tvm.triggers.size).toBeGreaterThan(0);
      expect(tvm.firedTriggerNames.size).toBeGreaterThan(0);
      expect(tvm.unknownTermsCount).toBe(0);
      expect(tvm.unknownActionsCount).toBe(0);
      expect(tvm.firedTriggerNames.has('start')).toBe(true);
    }

    console.log('[T11 15-Skirmish Census]', results);
  });
});
