import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  console.log('Launching Chrome for deep live inspection...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=default',
      '--enable-webgl',
      '--window-size=1920,1080',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('Failed to load resource') && !text.includes('AudioContext')) {
      console.log(`[Browser ${msg.type()}] ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[Browser PageError]', err);
  });

  console.log('Navigating to game URL with autoplay...');
  await page.goto('http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/01_usa-overlord&autoplay=1', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log('Waiting for mission to load completely...');
  await page.waitForFunction(() => {
    const s = document.body.dataset.loaded;
    if (s === 'error') throw new Error('Mission failed to load in browser!');
    return s === '1';
  }, { timeout: 45000 });
  console.log('✓ Mission loaded successfully!');

  // Check state after load
  const loadState = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    return {
      entitiesCount: g?.world?.entities?.size ?? 0,
      visualsCount: g?.visualsCount ?? 0,
      playerUnits: Array.from(g?.world?.entities?.values() ?? []).filter(e => e.owner.player === 2 && e.health.alive).length,
      enemyUnits: Array.from(g?.world?.entities?.values() ?? []).filter(e => e.owner.player !== 2 && e.health.alive).length,
    };
  });
  console.log('State at load:', loadState);

  // 1. Test Selection of Troops (click near player troops)
  console.log('Testing troop selection...');
  // Click on the screen where player troops are located
  const selectResult = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const playerTroops = Array.from(g?.world?.entities?.values() ?? []).filter(e => e.owner.player === 2 && e.health.alive && e.brain.control === 'user');
    if (playerTroops.length > 0) {
      g.rtsControls.select(playerTroops.slice(0, 5).map(e => e.id));
      return {
        selected: playerTroops.slice(0, 5).map(e => ({ id: e.id, proto: e.proto, kind: e.kind, pos: [e.transform.x, e.transform.y] })),
        selectedCount: g.rtsControls.selectedIds.size,
      };
    }
    return { selectedCount: 0 };
  });
  console.log('Selected troops:', selectResult);

  // Take screenshot 1: initial loaded with troops selected
  await page.screenshot({ path: '../shot_inspect_gameplay_1.png' });

  // 2. Test Movement Order
  console.log('Testing movement order with animation...');
  await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const selIds = Array.from(g.rtsControls.selectedIds);
    if (selIds.length > 0) {
      // Order move 20 meters forward
      const leader = g.world.getEntity(selIds[0]);
      if (leader) {
        g.rtsControls.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 960, clientY: 540 }));
      }
    }
  });

  // Wait 1.5 seconds and inspect animations of moving troops
  await new Promise(r => setTimeout(r, 1500));
  const animState = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const humans = Array.from(g?.world?.entities?.values() ?? []).filter(e => e.kind === 'human' && e.health.alive);
    return humans.slice(0, 5).map(h => ({
      id: h.id,
      proto: h.proto,
      speed: h.movement.currentSpeed,
      posture: h.movement.posture,
    }));
  });
  console.log('Human movement status during walk:', animState);
  await page.screenshot({ path: '../shot_inspect_gameplay_2_move.png' });

  // 3. Test Calling Reinforcements (spawn new troops)
  console.log('Testing reinforcement call from HUD...');
  const reinfResult = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const entsBefore = g.world.entities.size;
    const card = document.querySelector('.reinf-card:not(.disabled)');
    let clickedId = null;
    if (card) {
      clickedId = card.getAttribute('data-id') || card.getAttribute('data-item-id') || card.id;
      card.click();
    }
    return {
      clickedId,
      entsBefore,
      scoreCurrent: g.world.skirmish.scoreCurrent,
      availableCardsCount: document.querySelectorAll('.reinf-card:not(.disabled)').length,
      totalCardsCount: document.querySelectorAll('.reinf-card').length,
    };
  });
  console.log('Called reinforcement card:', reinfResult);

  // Advance simulation 3 seconds to let reinforcement trigger spawn units
  console.log('Waiting 3 seconds for reinforcement squad to arrive and spawn...');
  await new Promise(r => setTimeout(r, 3500));

  const afterReinfState = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const playerTroopsNow = Array.from(g?.world?.entities?.values() ?? []).filter(e => e.owner.player === 2 && e.health.alive);
    return {
      entsAfter: g.world.entities.size,
      playerTroopsCount: playerTroopsNow.length,
      recentPlayerTroops: playerTroopsNow.slice(-5).map(e => ({ id: e.id, proto: e.proto, kind: e.kind, pos: [Math.round(e.transform.x), Math.round(e.transform.y)] })),
    };
  });
  console.log('State after reinforcement call:', afterReinfState);
  await page.screenshot({ path: '../shot_inspect_gameplay_3_spawn.png' });

  // 4. Test Combat Engagement
  console.log('Testing combat engagement between player and hostile units...');
  const combatResult = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const playerUnits = Array.from(g.world.entities.values()).filter(e => e.owner.player === 2 && e.health.alive && e.combat?.weapon);
    const enemyUnits = Array.from(g.world.entities.values()).filter(e => e.owner.player !== 2 && e.health.alive && e.combat?.weapon);
    
    if (playerUnits.length > 0 && enemyUnits.length > 0) {
      // Place player unit close to enemy unit to test direct attack
      const p = playerUnits[0];
      const e = enemyUnits[0];
      p.transform.x = e.transform.x + 300; // 15 meters away
      p.transform.y = e.transform.y;
      p.transform.prevX = p.transform.x;
      p.transform.prevY = p.transform.y;
      
      // Select player unit and order attack against enemy
      g.rtsControls.select([p.id]);
      p.combat.targetEntityId = e.id;
      
      return {
        orderedAttack: true,
        shooter: { id: p.id, proto: p.proto, weapon: p.combat.weapon.name },
        target: { id: e.id, proto: e.proto, hp: e.health.current },
      };
    }
    return { orderedAttack: false };
  });
  console.log('Combat engagement order:', combatResult);

  // Wait 2 seconds for shots, tracers, and damage
  await new Promise(r => setTimeout(r, 2000));

  const combatAfter = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const playerUnits = Array.from(g.world.entities.values()).filter(e => e.owner.player === 2 && e.combat?.weapon);
    const enemyUnits = Array.from(g.world.entities.values()).filter(e => e.owner.player !== 2 && e.combat?.weapon);
    const p = playerUnits[0];
    const e = enemyUnits[0];
    return {
      shooterShots: p?.combat?.shotsFired ?? 0,
      shooterKills: p?.combat?.kills ?? 0,
      targetHp: e?.health?.current ?? 0,
      targetAlive: e?.health?.alive ?? false,
      activeProjectiles: g.world.combatEngine.activeProjectiles.length,
      hudSelectedHp: document.querySelector('.selected-hp-bar')?.textContent,
    };
  });
  console.log('Combat state after firing:', combatAfter);
  await page.screenshot({ path: '../shot_inspect_gameplay_4_combat.png' });

  await browser.close();
  console.log('Inspection complete! All screenshots saved.');
}

main().catch(console.error);
