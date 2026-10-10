import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  console.log('Launching Chrome...');
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
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = `[Browser ${msg.type()}] ${msg.text()}`;
    console.log(text);
    consoleLogs.push(text);
  });

  page.on('pageerror', (err) => {
    console.error('[Browser PageError]', err);
    consoleLogs.push(`[PageError] ${err.toString()}`);
  });

  page.on('requestfailed', (req) => {
    console.warn(`[Browser RequestFailed] ${req.url()} (${req.failure()?.errorText})`);
  });

  console.log('Navigating to http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/01_usa-overlord&autoplay=1 ...');
  await page.goto('http://127.0.0.1:8080/?m=map/single/01_usa-skirmish/01_usa-overlord&autoplay=1', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  console.log('Waiting for load or up to 8 seconds...');
  try {
    await page.waitForFunction(() => document.body.dataset.loaded === '1', { timeout: 15000 });
    console.log('document.body.dataset.loaded is "1"!');
  } catch (e) {
    console.warn('Timeout waiting for dataset.loaded === "1", current dataset.loaded:', await page.evaluate(() => document.body.dataset.loaded));
  }

  // Take screenshot 1
  await page.screenshot({ path: 'shot_inspect_1_loaded.png' });
  console.log('Saved shot_inspect_1_loaded.png');

  // Inspect global game object and DOM state
  const state = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    const hud = document.getElementById('game-hud');
    const menu = document.getElementById('main-menu');
    const canvas = document.querySelector('canvas');
    const overlay = document.getElementById('debug-overlay');
    
    // Check entities and players
    let playerUnitsCount = 0;
    let enemyUnitsCount = 0;
    let neutralCount = 0;
    let controllableCount = 0;
    const playerDistribution = {};

    if (g && g.world) {
      for (const ent of g.world.entities.values()) {
        playerDistribution[ent.owner] = (playerDistribution[ent.owner] || 0) + 1;
        if (ent.brain?.control === 'user') {
          controllableCount++;
        }
      }
    }

    return {
      hasGameGlobal: !!g,
      menuVisible: menu ? menu.style.display !== 'none' : false,
      hudVisible: hud ? hud.style.display !== 'none' : false,
      debugText: overlay ? overlay.textContent : null,
      entitiesCount: g?.world?.entities?.size ?? 0,
      visualsCount: g?.visualsCount ?? 0,
      playerDistribution,
      controllableCount,
      rtsPlayerIndex: g?.rtsControls?.playerIndex,
      selectedCount: g?.rtsControls?.selectedIds?.size ?? 0,
      cameraPos: [g?.rtsControls?.camera?.position?.x, g?.rtsControls?.camera?.position?.y, g?.rtsControls?.camera?.position?.z],
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
    };
  });

  console.log('Inspected State:', JSON.stringify(state, null, 2));

  // Try clicking in the center of the canvas to see if units get selected
  console.log('Attempting drag selection on screen...');
  await page.mouse.move(500, 300);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(1400, 800);
  await page.mouse.up({ button: 'left' });

  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'shot_inspect_2_drag_select.png' });

  const selectionState = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    return {
      selectedCount: g?.rtsControls?.selectedIds?.size ?? 0,
      selectedIds: Array.from(g?.rtsControls?.selectedIds ?? []),
    };
  });
  console.log('Selection State after drag:', JSON.stringify(selectionState, null, 2));

  // Try ordering right click
  if (selectionState.selectedCount > 0) {
    console.log('Issuing move order via right click...');
    await page.mouse.click(960, 540, { button: 'right' });
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: 'shot_inspect_3_after_move.png' });
  }

  // Check reinforcements panel
  const reinfButtons = await page.evaluate(() => {
    const cards = document.querySelectorAll('.reinf-card');
    return Array.from(cards).map(c => ({
      title: c.querySelector('.reinf-title')?.textContent,
      cost: c.querySelector('.reinf-cost')?.textContent,
      disabled: c.classList.contains('disabled'),
      id: c.getAttribute('data-id'),
    }));
  });
  console.log('Reinforcements in HUD:', JSON.stringify(reinfButtons.slice(0, 5), null, 2));

  // Try calling a reinforcement if available
  const clickedCard = await page.evaluate(() => {
    const card = document.querySelector('.reinf-card:not(.disabled)');
    if (card) {
      card.click();
      return card.getAttribute('data-id');
    }
    return null;
  });
  console.log('Clicked reinforcement card:', clickedCard);

  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: 'shot_inspect_4_after_reinf.png' });

  const finalCheck = await page.evaluate(() => {
    const g = window.__OPENMOW_GAME__;
    return {
      entitiesNow: g?.world?.entities?.size ?? 0,
      time: g?.world?.time,
      fps: document.getElementById('debug-overlay')?.textContent,
    };
  });
  console.log('Final Check:', finalCheck);

  await browser.close();
}

main().catch(console.error);
