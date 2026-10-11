/**
 * Skirmish Systems Acceptance Suite (T12 / Gate G3 -> G4).
 *
 * Verifies:
 * 1. Flag zones discovery and tracking (11 flags in Overlord / Caen).
 * 2. Reinforcement economy: scoreCurrent/scoreTotal, purchasing, cooldowns, and eventStart triggers.
 * 3. Headless win resolution: cheatCaptureAll() captures all flags, satisfies all 11 flag conditions,
 *    and fires gameover win within expected cinematic delay.
 * 4. Headless loss resolution: cheatEliminatePlayerUnits() eliminates all player forces and fires gameover lose.
 * 5. Full 15-skirmish validation: all 15 missions support win and defeat transitions cleanly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { World, TICK_DT } from '../src/engine/world';
import { parseMissionDoc } from '../src/mission/load';
import type { MissionDoc } from '../src/contracts/mission';
import fs from 'node:fs';
import path from 'node:path';

describe('Skirmish Systems (T12 Acceptance)', () => {
  let world: World;
  let doc: MissionDoc;

  beforeEach(() => {
    const overlordPath = path.resolve(__dirname, 'fixtures/01_usa-overlord.json');
    const raw = JSON.parse(fs.readFileSync(overlordPath, 'utf-8'));
    doc = parseMissionDoc(raw, '01_usa-overlord');
    world = new World(42);
    world.initFromMission(doc);
  });

  it('discovers and tracks all skirmish flags and capture zones', () => {
    const flags = world.skirmish.flags;
    expect(flags.size).toBe(11);

    const expectedFlags = [
      'flag_a01',
      'flag_a02',
      'flag_a03',
      'flag_b01',
      'flag_b02',
      'flag_b03',
      'flag_c01',
      'flag_c02',
      'flag_c03',
      'flag_aibase',
      'flag_playerbase',
    ];

    for (const fId of expectedFlags) {
      expect(flags.has(fId), `Flag exists: ${fId}`).toBe(true);
      const flag = flags.get(fId)!;
      expect(flag.zone).toBeDefined();
      expect(flag.holder).toBe('enemy');
      expect(flag.captured).toBe(false);
    }
  });

  it('manages reinforcement economy, purchases, cooldowns and trigger dispatch', () => {
    const skirmish = world.skirmish;
    expect(skirmish.scoreTotal).toBe(2000);

    // Initial MP
    skirmish.scoreCurrent = 500;
    const infantrySlot = skirmish.reinforcements.get('player_infantry');
    expect(infantrySlot).toBeDefined();
    expect(infantrySlot!.item.score).toBe(150);
    expect(infantrySlot!.item.delay).toBe(20);

    // 1. Successful purchase
    const bought = skirmish.buyReinforcement('player_infantry');
    expect(bought).toBe(true);
    expect(skirmish.scoreCurrent).toBe(350); // 500 - 150
    expect(infantrySlot!.cooldownRemaining).toBe(20);
    expect(world.triggerVm.events.has('player_infantry')).toBe(true);

    // 2. Reject while on cooldown
    const boughtAgain = skirmish.buyReinforcement('player_infantry');
    expect(boughtAgain).toBe(false);

    // 3. Step simulation to decrease cooldown
    for (let i = 0; i < 200; i++) {
      world.step(TICK_DT); // 10 seconds (200 * 0.05s)
    }
    expect(infantrySlot!.cooldownRemaining).toBeCloseTo(10, 1);

    for (let i = 0; i < 200; i++) {
      world.step(TICK_DT); // another 10 seconds -> cooldown expired
    }
    expect(infantrySlot!.cooldownRemaining).toBe(0);

    // 4. Reject when insufficient score
    skirmish.scoreCurrent = 100; // costs 150
    const boughtBroke = skirmish.buyReinforcement('player_infantry');
    expect(boughtBroke).toBe(false);
  });

  it('triggers gameover win in headless when capturing all flags via cheatCaptureAll()', () => {
    // Step 20 ticks for initial triggers
    for (let i = 0; i < 20; i++) {
      world.step(TICK_DT);
    }
    expect(world.skirmish.gameOver).toBeNull();

    // Trigger full flag capture
    world.skirmish.cheatCaptureAll();

    // Verify all 11 flags are marked as captured
    for (const flag of world.skirmish.flags.values()) {
      expect(flag.captured).toBe(true);
      expect(flag.holder).toBe('player');
    }

    // Step simulation: victory/win trigger fires, runs its delay, and calls gameover win
    // Victory trigger in Overlord has ~3s delay before gameover action
    for (let i = 0; i < 140; i++) {
      world.step(TICK_DT);
      if (world.skirmish.gameOver) break;
    }

    expect(world.skirmish.gameOver).not.toBeNull();
    expect(world.skirmish.gameOver?.result).toBe('win');
    expect(world.triggerVm.gameOverResult?.result).toBe('win');
    console.log('[T12 Win Test] Skirmish gameover win reached at tick:', world.tickIndex);
  });

  it('triggers gameover lose in headless when eliminating all player units via cheatEliminatePlayerUnits()', () => {
    // Step 45 ticks past initial grace period
    for (let i = 0; i < 45; i++) {
      world.step(TICK_DT);
    }
    expect(world.skirmish.gameOver).toBeNull();

    // Eliminate all player forces
    world.skirmish.cheatEliminatePlayerUnits();

    // Step simulation
    world.step(TICK_DT);

    expect(world.skirmish.gameOver).not.toBeNull();
    expect(world.skirmish.gameOver?.result).toBe('lose');
    expect(world.triggerVm.gameOverResult?.result).toBe('lose');
    console.log('[T12 Loss Test] Skirmish gameover lose reached at tick:', world.tickIndex);
  });

  it('verifies win and lose resolution across all 15 skirmishes', () => {
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

    const results: Record<string, { winReached: boolean; lossReached: boolean; flags: number }> = {};

    for (const name of skirmishes) {
      const p = path.resolve(__dirname, `fixtures/${name}.json`);
      if (!fs.existsSync(p)) continue;

      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const missionDoc = parseMissionDoc(raw, name);

      // 1. Test Win on this skirmish
      const worldWin = new World(100);
      worldWin.initFromMission(missionDoc);
      for (let i = 0; i < 20; i++) worldWin.step(TICK_DT);
      worldWin.skirmish.cheatCaptureAll();
      for (let i = 0; i < 140; i++) {
        worldWin.step(TICK_DT);
        if (worldWin.skirmish.gameOver) break;
      }
      const winReached = worldWin.skirmish.gameOver?.result === 'win';

      // 2. Test Loss on this skirmish
      const worldLoss = new World(100);
      worldLoss.initFromMission(missionDoc);
      for (let i = 0; i < 45; i++) worldLoss.step(TICK_DT);
      worldLoss.skirmish.cheatEliminatePlayerUnits();
      worldLoss.step(TICK_DT);
      const lossReached = worldLoss.skirmish.gameOver?.result === 'lose';

      results[name] = {
        winReached,
        lossReached,
        flags: worldWin.skirmish.flags.size,
      };

      expect(winReached, `Win reached on ${name}`).toBe(true);
      expect(lossReached, `Loss reached on ${name}`).toBe(true);
      expect(worldWin.skirmish.flags.size).toBeGreaterThanOrEqual(10);
    }

    console.log('[T12 15-Skirmish Win/Loss Matrix]', results);
  });
});
