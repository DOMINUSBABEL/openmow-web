import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMissionDoc } from '../src/mission/load';
import { World, TICK_RATE, TICK_DT } from '../src/engine/world';
import {
  issueMoveOrder,
  issuePostureOrder,
  issueStopOrder,
  computeFormationOffsets,
} from '../src/engine/orders';

describe('RTS Unit Control & Movement (T07 Acceptance)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const overlordPath = path.join(fixturesDir, '01_usa-overlord.json');
  const rawJson = JSON.parse(fs.readFileSync(overlordPath, 'utf-8'));
  const doc = parseMissionDoc(rawJson, '01_usa-overlord');

  it('computes symmetric squad formation offsets around destination', () => {
    const single = computeFormationOffsets(1);
    expect(single).toEqual([{ dx: 0, dy: 0 }]);

    const four = computeFormationOffsets(4, 30);
    expect(four.length).toBe(4);
    // Centered around 0, 0
    const avgX = four.reduce((acc, p) => acc + p.dx, 0) / 4;
    const avgY = four.reduce((acc, p) => acc + p.dy, 0) / 4;
    expect(avgX).toBeCloseTo(0, 5);
    expect(avgY).toBeCloseTo(0, 5);
  });

  it('selects initial Overlord squad, issues move order, and arrives within 2 meters of target', () => {
    const world = new World(19440606);
    world.initFromMission(doc, 19440606);

    // Find initial USA human units in Overlord (player 2 allied faction)
    const usaSoldiers = Array.from(world.entities.values()).filter(
      (e) => e.kind === 'human' && (e.owner.player === 2 || e.proto.includes('usa'))
    );
    expect(usaSoldiers.length).toBeGreaterThanOrEqual(4);

    // Take squad of 4 soldiers
    const squad = usaSoldiers.slice(0, 4);
    const squadIds = squad.map((e) => e.id);

    // In GEM2 missions, triggers grant 'user' control to active squad
    for (const soldier of squad) {
      soldier.brain.control = 'user';
    }

    const startX = squad[0].transform.x;
    const startY = squad[0].transform.y;

    // Target point 300 GEM units (~15 meters) away
    const targetX = startX + 250;
    const targetY = startY + 180;
    const totalDist = Math.hypot(targetX - startX, targetY - startY);
    expect(totalDist).toBeGreaterThan(200);

    const orderedCount = issueMoveOrder(world, squadIds, targetX, targetY, 'stand', false);
    expect(orderedCount).toBe(4);

    // Verify orders are set
    for (const soldier of squad) {
      expect(soldier.movement.order).toBeDefined();
      expect(soldier.movement.order?.type).toBe('move');
    }

    // Step simulation for 15 seconds (300 ticks at 20 Hz)
    const SIM_SECONDS = 15;
    const TOTAL_TICKS = SIM_SECONDS * TICK_RATE;

    let orderCompletedFired = false;
    world.eventBus.on('entity:order_completed', () => {
      orderCompletedFired = true;
    });

    for (let t = 0; t < TOTAL_TICKS; t++) {
      world.step(TICK_DT);
    }

    expect(orderCompletedFired).toBe(true);

    // Acceptance condition: squad members are within 2.0 meters (40 GEM units) of target formation
    const offsets = computeFormationOffsets(squad.length, 30);
    for (let i = 0; i < squad.length; i++) {
      const soldier = squad[i];
      const expectedX = targetX + offsets[i].dx;
      const expectedY = targetY + offsets[i].dy;
      const distFromTarget = Math.hypot(soldier.transform.x - expectedX, soldier.transform.y - expectedY);

      // 40 GEM units = 2.0 meters (20 units/meter)
      expect(distFromTarget).toBeLessThanOrEqual(40.0);

      // Order should be completed and speed zeroed
      expect(soldier.movement.order).toBeUndefined();
      expect(soldier.movement.currentSpeed).toBe(0);
    }
  });

  it('switches postures (stand -> crouch -> prone) and adjusts movement speed accordingly', () => {
    const world = new World(19440606);
    world.initFromMission(doc, 19440606);

    const soldier = Array.from(world.entities.values()).find(
      (e) => e.kind === 'human' && (e.owner.player === 2 || e.proto.includes('usa'))
    )!;
    expect(soldier).toBeDefined();
    soldier.brain.control = 'user';

    // Stand posture
    issuePostureOrder(world, [soldier.id], 'stand');
    expect(soldier.movement.posture).toBe('stand');
    expect(soldier.fsmState).toBe('stand');

    // Move in stand (full speed = 60 units/s)
    issueMoveOrder(world, [soldier.id], soldier.transform.x + 500, soldier.transform.y);
    world.step(1.0); // 1 second
    const distStand = soldier.transform.x;

    // Crouch posture (0.6x speed = 36 units/s)
    issuePostureOrder(world, [soldier.id], 'crouch');
    expect(soldier.movement.posture).toBe('crouch');
    expect(soldier.fsmState).toBe('squat');

    const startX = soldier.transform.x;
    world.step(1.0); // 1 second
    const distCrouch = soldier.transform.x - startX;

    // Prone posture (0.3x speed = 18 units/s)
    issuePostureOrder(world, [soldier.id], 'prone');
    expect(soldier.movement.posture).toBe('prone');
    expect(soldier.fsmState).toBe('lie');

    const startXProne = soldier.transform.x;
    console.log('Before prone step:', { x: soldier.transform.x, order: soldier.movement.order, posture: soldier.movement.posture });
    world.step(1.0); // 1 second
    console.log('After prone step:', { x: soldier.transform.x, order: soldier.movement.order, posture: soldier.movement.posture });
    const distProne = soldier.transform.x - startXProne;

    expect(distCrouch).toBeLessThan(60);
    expect(distProne).toBeLessThan(distCrouch);
    expect(distProne).toBeCloseTo(18, 1);
  });

  it('stops unit movement on issueStopOrder', () => {
    const world = new World(19440606);
    world.initFromMission(doc, 19440606);

    const soldier = Array.from(world.entities.values()).find(
      (e) => e.kind === 'human' && (e.owner.player === 2 || e.proto.includes('usa'))
    )!;
    expect(soldier).toBeDefined();
    soldier.brain.control = 'user';

    issueMoveOrder(world, [soldier.id], soldier.transform.x + 1000, soldier.transform.y + 1000);
    expect(soldier.movement.order).toBeDefined();

    world.step(0.5);
    expect(soldier.movement.currentSpeed).toBeGreaterThan(0);

    const stoppedCount = issueStopOrder(world, [soldier.id]);
    expect(stoppedCount).toBe(1);
    expect(soldier.movement.order).toBeUndefined();
    expect(soldier.movement.currentSpeed).toBe(0);

    const posX = soldier.transform.x;
    const posY = soldier.transform.y;
    world.step(1.0);
    expect(soldier.transform.x).toBe(posX);
    expect(soldier.transform.y).toBe(posY);
  });
});
