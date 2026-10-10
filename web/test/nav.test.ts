/**
 * Navigation & Pathfinding Automated Acceptance Suite (T08).
 * Acceptance criteria from docs/TASKS.md:
 * 1. 1000 random queries across maps with average time < 5 ms.
 * 2. 0 units crossing through buildings/obstacles in a 60-second simulation test.
 * 3. Vehicles obey turn radius steering.
 */
import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/engine/nav';
import type { NavGridDoc } from '../src/contracts/nav';
import { World, TICK_RATE, TICK_DT } from '../src/engine/world';
import { issueMoveOrder } from '../src/engine/orders';

describe('Navigation & Pathfinding Engine (T08 Acceptance)', () => {
  // Mock a synthetic 240x720 1m map with building clusters, walls and sandbags
  function createSyntheticNavDoc(): NavGridDoc {
    const width = 240;
    const height = 720;
    const total = width * height;
    const rawGrid = new Uint8Array(total);

    // Place several rectangular buildings / obstacles
    const obstacles = [
      { x: 30, y: 50, w: 20, h: 30 },
      { x: 80, y: 120, w: 40, h: 25 },
      { x: 150, y: 200, w: 35, h: 35 },
      { x: 50, y: 300, w: 50, h: 20 },
      { x: 120, y: 400, w: 60, h: 40 },
      { x: 70, y: 550, w: 30, h: 50 },
      { x: 160, y: 600, w: 40, h: 30 },
      // Long defensive wall with narrow gap
      { x: 20, y: 250, w: 80, h: 3 },
      { x: 110, y: 250, w: 110, h: 3 }, // gap at x=[100..110]
    ];

    let blockedCount = 0;
    for (const obs of obstacles) {
      for (let y = obs.y; y < obs.y + obs.h && y < height; y++) {
        for (let x = obs.x; x < obs.x + obs.w && x < width; x++) {
          const idx = y * width + x;
          if (rawGrid[idx] === 0) {
            rawGrid[idx] = 1;
            blockedCount++;
          }
        }
      }
    }

    // Convert rawGrid to RLE
    const rle: number[] = [];
    let curVal = 0;
    let runLen = 0;
    for (let i = 0; i < total; i++) {
      if (rawGrid[i] === curVal) {
        runLen++;
      } else {
        rle.push(runLen);
        curVal = rawGrid[i];
        runLen = 1;
      }
    }
    rle.push(runLen);

    return {
      mission: 'test/synthetic-map',
      originX: -2400,
      originY: -7200,
      cellSize: 20,
      width,
      height,
      blockedCount,
      totalCells: total,
      rle,
    };
  }

  it('decodes RLE correctly and identifies walkable vs blocked cells', () => {
    const doc = createSyntheticNavDoc();
    const nav = new NavGrid(doc);

    expect(nav.width).toBe(240);
    expect(nav.height).toBe(720);

    // Walkable open area
    expect(nav.isWalkable(10, 10)).toBe(true);

    // Inside building at (35, 60)
    expect(nav.isWalkable(35, 60)).toBe(false);

    // In the defensive wall at (50, 251)
    expect(nav.isWalkable(50, 251)).toBe(false);

    // In the wall gap at (105, 251)
    expect(nav.isWalkable(105, 251)).toBe(true);
  });

  it('1000 random path queries benchmark: average time < 5 ms', () => {
    const doc = createSyntheticNavDoc();
    const nav = new NavGrid(doc);

    const queryCount = 1000;
    let foundCount = 0;
    let totalPathLength = 0;

    // Deterministic pseudo-random seed
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const t0 = performance.now();

    for (let q = 0; q < queryCount; q++) {
      const sx = nav.originX + rng() * (nav.width * nav.cellSize);
      const sy = nav.originY + rng() * (nav.height * nav.cellSize);
      const tx = nav.originX + rng() * (nav.width * nav.cellSize);
      const ty = nav.originY + rng() * (nav.height * nav.cellSize);

      const path = nav.findPath(sx, sy, tx, ty);
      if (path && path.waypoints.length > 0) {
        foundCount++;
        totalPathLength += path.totalDistance;
      }
    }

    const elapsed = performance.now() - t0;
    const avgMs = elapsed / queryCount;

    console.log(
      `[T08 Benchmark] 1,000 queries completed in ${elapsed.toFixed(1)} ms. ` +
        `Avg per query: ${avgMs.toFixed(3)} ms. Paths found: ${foundCount}/${queryCount}.`
    );

    // Requirement: < 5 ms average
    expect(avgMs).toBeLessThan(5.0);
    expect(foundCount).toBeGreaterThan(900);
  });

  it('path smoothing navigates cleanly around obstacles through narrow corridors', () => {
    const doc = createSyntheticNavDoc();
    const nav = new NavGrid(doc);

    // Path from south of wall (x=105, y=200) to north of wall (x=105, y=300) through gap at (105, 250)
    const [startX, startY] = nav.cellToWorld(105, 200);
    const [targetX, targetY] = nav.cellToWorld(105, 300);

    const path = nav.findPath(startX, startY, targetX, targetY);
    expect(path).not.toBeNull();
    expect(path!.waypoints.length).toBeGreaterThan(0);

    // Verify no waypoint is inside a blocked cell
    for (const wp of path!.waypoints) {
      expect(nav.isWalkableWorld(wp.x, wp.y)).toBe(true);
    }
  });

  it('60-second simulation test (1200 ticks at 20 Hz): 0 units cross into buildings/obstacles', () => {
    const doc = createSyntheticNavDoc();
    const nav = new NavGrid(doc);

    const world = new World(1944);
    world.navGrid = nav;

    // Spawn 10 soldiers south of the building cluster
    const entityIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [wx, wy] = nav.cellToWorld(20 + i * 2, 20);
      const id = 1000 + i;
      entityIds.push(id);
      world.entities.set(id, {
        id,
        idHex: `0x${id.toString(16)}`,
        kind: 'human',
        proto: 'mp/usa/rifle',
        transform: {
          x: wx,
          y: wy,
          z: 0,
          zl: 0,
          prevX: wx,
          prevY: wy,
          prevZ: 0,
          prevZl: 0,
        },
        health: { current: 100, max: 100, alive: true },
        owner: { player: 0 },
        tags: new Set(['player', 'infantry']),
        inventory: [],
        crew: { passengers: new Map() },
        brain: {
          moveMode: 'hold',
          control: 'user',
          fireMode: 'hold',
          lookAround: false,
          aiMoveMode: 'disable',
          props: {},
        },
        movement: {
          currentSpeed: 0,
          maxSpeed: 60, // 3 m/s
          posture: 'stand',
        },
      });
    }

    // Issue move order to north side across multiple buildings and walls
    const [targetX, targetY] = nav.cellToWorld(105, 400);
    const issued = issueMoveOrder(world, entityIds, targetX, targetY, 'stand', true);
    expect(issued).toBe(10);

    let buildingViolations = 0;
    const totalTicks = 60 * TICK_RATE; // 1200 ticks = 60 seconds

    for (let tick = 0; tick < totalTicks; tick++) {
      world.step();

      // Check all 10 units at every tick: MUST NEVER be inside any obstacle
      for (const id of entityIds) {
        const ent = world.getEntity(id)!;
        if (!nav.isWalkableWorld(ent.transform.x, ent.transform.y)) {
          buildingViolations++;
        }
      }
    }

    console.log(`[T08 60s Simulation] 1200 ticks evaluated across 10 units. Building violations: ${buildingViolations}`);

    // Acceptance requirement: 0 units traversing buildings
    expect(buildingViolations).toBe(0);
  });

  it('vehicles obey turn radius constraints without snapping rotation', () => {
    const doc = createSyntheticNavDoc();
    const nav = new NavGrid(doc);
    const world = new World(1944);
    world.navGrid = nav;

    // Spawn a tank with turn radius = 80 GEM units (4 meters)
    const tankId = 5001;
    const [startX, startY] = nav.cellToWorld(50, 50);
    world.entities.set(tankId, {
      id: tankId,
      idHex: '0x1389',
      kind: 'entity',
      proto: 'm4a3_75',
      transform: {
        x: startX,
        y: startY,
        z: 0,
        zl: 0, // facing east (0 deg)
        prevX: startX,
        prevY: startY,
        prevZ: 0,
        prevZl: 0,
      },
      health: { current: 500, max: 500, alive: true },
      owner: { player: 0 },
      tags: new Set(['player', 'tank']),
      inventory: [],
      crew: { passengers: new Map() },
      brain: {
        moveMode: 'hold',
        control: 'user',
        fireMode: 'hold',
        lookAround: false,
        aiMoveMode: 'disable',
        props: {},
      },
      movement: {
        currentSpeed: 0,
        maxSpeed: 80, // 4 m/s
        posture: 'stand',
        turnRadius: 80, // 4m turn radius
      },
    });

    // Order tank to make a 90-degree left turn (north: y increases)
    const [destX, destY] = nav.cellToWorld(50, 100);
    issueMoveOrder(world, [tankId], destX, destY, 'stand', true);

    let maxRotationStep = 0;
    let prevZl = 0;

    for (let t = 0; t < 40; t++) { // 2 seconds
      world.step();
      const tank = world.getEntity(tankId)!;
      const dZl = Math.abs(tank.transform.zl - prevZl);
      if (dZl > maxRotationStep) {
        maxRotationStep = dZl;
      }
      prevZl = tank.transform.zl;
    }

    console.log(`[T08 Turn Radius] Max turn delta per tick: ${maxRotationStep.toFixed(2)} deg`);

    // In a single 50ms tick, a tank with turnRadius must not snap instantaneously 90 degrees
    expect(maxRotationStep).toBeLessThan(45.0);
    expect(maxRotationStep).toBeGreaterThan(0.0);
  });

  it('runs 1000 queries on real Overlord skirmish battlefield (Normandy) with < 5 ms avg', async () => {
    const res = await fetch('http://127.0.0.1:8080/conv/nav/map/single/01_usa-skirmish/01_usa-overlord.json');
    if (!res.ok) {
      console.warn('Server not available for live Overlord nav test');
      return;
    }
    const navDoc = (await res.json()) as NavGridDoc;
    expect(navDoc.width).toBeGreaterThan(200);
    expect(navDoc.blockedCount).toBeGreaterThan(1000);

    const nav = new NavGrid(navDoc);

    const queryCount = 1000;
    let foundCount = 0;
    let seed = 19440606;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const t0 = performance.now();
    for (let q = 0; q < queryCount; q++) {
      const sx = nav.originX + rng() * (nav.width * nav.cellSize);
      const sy = nav.originY + rng() * (nav.height * nav.cellSize);
      const tx = nav.originX + rng() * (nav.width * nav.cellSize);
      const ty = nav.originY + rng() * (nav.height * nav.cellSize);

      const path = nav.findPath(sx, sy, tx, ty);
      if (path && path.waypoints.length > 0) {
        foundCount++;
      }
    }

    const elapsed = performance.now() - t0;
    const avgMs = elapsed / queryCount;

    console.log(
      `[T08 Live Overlord] 1,000 queries completed in ${elapsed.toFixed(1)} ms. ` +
        `Avg per query: ${avgMs.toFixed(3)} ms. Paths found: ${foundCount}/${queryCount}. ` +
        `Grid: ${nav.width}x${nav.height}, Blocked: ${navDoc.blockedCount}.`
    );

    expect(avgMs).toBeLessThan(5.0);
    expect(foundCount).toBeGreaterThan(900);
  });
});
