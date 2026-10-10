import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMissionDoc } from '../src/mission/load';
import { World, TICK_RATE } from '../src/engine/world';

describe('Simulation Engine (T05 / Gate G2 Acceptance)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');

  it('runs 5 minutes (6000 ticks at 20 Hz) headless in Node with 100% deterministic state hash', () => {
    const filePath = path.join(fixturesDir, '01_usa-overlord.json');
    const rawJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const doc = parseMissionDoc(rawJson, '01_usa-overlord');

    const TICKS_5_MINUTES = 5 * 60 * TICK_RATE; // 6000 ticks = 300 seconds
    const SEED = 42;

    // Run 1
    const world1 = new World(SEED);
    world1.initFromMission(doc, SEED);
    expect(world1.entities.size).toBe(doc.entities.length + doc.humans.length);
    expect(world1.tickIndex).toBe(0);

    const t0 = Date.now();
    world1.stepN(TICKS_5_MINUTES);
    const durationMs = Date.now() - t0;

    expect(world1.tickIndex).toBe(TICKS_5_MINUTES);
    expect(world1.time).toBeCloseTo(300.0, 3);
    const hash1 = world1.computeStateHash();
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
    console.log(`[T05] Run 1 completed 6,000 ticks in ${durationMs} ms. State Hash: ${hash1}`);

    // Run 2 (identical parameters)
    const world2 = new World(SEED);
    world2.initFromMission(doc, SEED);
    world2.stepN(TICKS_5_MINUTES);
    const hash2 = world2.computeStateHash();

    // Determinism assertion: two independent runs MUST produce identical hash
    expect(hash2).toBe(hash1);

    // Verify entities are alive and valid
    for (const ent of world1.entities.values()) {
      expect(Number.isFinite(ent.transform.x)).toBe(true);
      expect(Number.isFinite(ent.transform.y)).toBe(true);
      expect(Number.isFinite(ent.transform.z)).toBe(true);
      expect(Number.isFinite(ent.transform.zl)).toBe(true);
      expect(typeof ent.health.alive).toBe('boolean');
    }

    // Run 3 with a different seed must produce a different state (sanity check)
    const world3 = new World(999);
    world3.initFromMission(doc, 999);
    world3.stepN(TICKS_5_MINUTES);
    const hash3 = world3.computeStateHash();
    expect(hash3).not.toBe(hash1);
  });

  it('runs 5 minutes deterministically on German Caen skirmish', () => {
    const filePath = path.join(fixturesDir, '01_ger-caen.json');
    const rawJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const doc = parseMissionDoc(rawJson, '01_ger-caen');

    const TICKS_5_MINUTES = 6000;
    const SEED = 19440606;

    const w1 = new World(SEED);
    w1.initFromMission(doc, SEED);
    w1.stepN(TICKS_5_MINUTES);
    const h1 = w1.computeStateHash();

    const w2 = new World(SEED);
    w2.initFromMission(doc, SEED);
    w2.stepN(TICKS_5_MINUTES);
    const h2 = w2.computeStateHash();

    expect(h1).toBe(h2);
    console.log(`[T05] Caen 6,000 ticks Hash: ${h1}`);
  });
});
