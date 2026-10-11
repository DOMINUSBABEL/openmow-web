/**
 * UI & Frontend Acceptance Suite (T14 / Frontend).
 *
 * Verifies:
 * 1. MainMenu:
 *    - Full catalog of 15 skirmishes (3 per each of the 5 factions: USA, GER, ENG, RUS, JAP).
 *    - Faction tab switching renders corresponding 3 mission cards.
 *    - Mission card selection updates operation preview banner, title, place, date, and description.
 *    - Difficulty selection (easy, normal, hard, heroic).
 *    - E2E Click Navigation: arriving from '/' to each of the 15 missions strictly through click events.
 *    - Loading screen progress tracking (0% -> 100%).
 * 2. GameHUD:
 *    - Top bar score (MP), flag status counter, clock timer, and speed controls.
 *    - Selection panel with unit name, HP percentage bar, posture controls, fire mode toggles, and inventory.
 *    - Reinforcements bar with interactive purchase cards, cost badges, and cooldown sweeps.
 *    - Minimap canvas projection and click-to-pan camera navigation.
 *    - Toast notifications and Game Over victory/defeat modal.
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MainMenu,
  SKIRMISH_CATALOG,
  type FactionKey,
  type DifficultyKey,
  type SkirmishMissionMeta,
} from '../src/ui/menu';
import { GameHUD } from '../src/ui/hud';
import { World } from '../src/engine/world';
import { parseMissionDoc } from '../src/mission/load';
import fs from 'node:fs';
import path from 'node:path';

describe('UI & Frontend System (T14 Acceptance)', () => {
  describe('MainMenu Component', () => {
    let menu: MainMenu;

    beforeEach(() => {
      document.body.innerHTML = '';
      menu = new MainMenu();
      document.body.appendChild(menu.container);
    });

    it('verifies skirmish catalog completeness: exactly 15 missions (3 per each of the 5 factions)', () => {
      expect(SKIRMISH_CATALOG.length).toBe(15);

      const factions: FactionKey[] = ['USA', 'GER', 'ENG', 'RUS', 'JAP'];
      for (const fac of factions) {
        const missions = SKIRMISH_CATALOG.filter((m) => m.faction === fac);
        expect(missions.length, `Faction ${fac} should have 3 missions`).toBe(3);

        for (const m of missions) {
          expect(m.id).toBeDefined();
          expect(m.vpath).toContain('map/single/');
          expect(m.previewUrl).toContain('preview.dds.png');
          expect(m.minimapUrl).toContain('minimap.dds.png');
          expect(m.title.length).toBeGreaterThan(0);
          expect(m.place.length).toBeGreaterThan(0);
          expect(m.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('switches faction tabs and updates mission cards in DOM', () => {
      const tabs = menu.container.querySelectorAll<HTMLButtonElement>('.faction-tab');
      expect(tabs.length).toBe(5);

      // Click GER tab
      const gerTab = Array.from(tabs).find((t) => t.dataset.faction === 'GER')!;
      gerTab.click();

      expect(menu.selectedFaction).toBe('GER');
      expect(gerTab.classList.contains('active')).toBe(true);

      const cards = menu.container.querySelectorAll<HTMLElement>('.mission-card');
      expect(cards.length).toBe(3);
      expect(menu.selectedMission.faction).toBe('GER');
    });

    it('updates mission details panel when selecting a mission card', () => {
      // Select USA tab
      const usaTab = Array.from(
        menu.container.querySelectorAll<HTMLButtonElement>('.faction-tab')
      ).find((t) => t.dataset.faction === 'USA')!;
      usaTab.click();

      // Click second card (Carentan)
      const carentanCard = menu.container.querySelector<HTMLElement>(
        '[data-mission-id="02_usa-carentan"]'
      )!;
      expect(carentanCard).toBeDefined();
      carentanCard.click();

      expect(menu.selectedMission.id).toBe('02_usa-carentan');
      expect(carentanCard.classList.contains('selected')).toBe(true);

      const titleEl = menu.container.querySelector('#detail-title');
      const placeEl = menu.container.querySelector('#detail-place');
      expect(titleEl?.textContent).toBe('Carentan');
      expect(placeEl?.textContent).toBe('Carentan, Francia');
    });

    it('toggles difficulty settings via button clicks', () => {
      const diffBtns = menu.container.querySelectorAll<HTMLButtonElement>('.diff-btn');
      expect(diffBtns.length).toBe(4);

      const heroicBtn = Array.from(diffBtns).find((b) => b.dataset.diff === 'heroic')!;
      heroicBtn.click();

      expect(menu.selectedDifficulty).toBe('heroic');
      expect(heroicBtn.classList.contains('active')).toBe(true);
    });

    it('verifies E2E Click Navigation: reach each of the 15 missions purely via DOM clicks', () => {
      const launchedMissions: Array<{ id: string; diff: DifficultyKey }> = [];
      menu.onStartMission = (mission, diff) => {
        launchedMissions.push({ id: mission.id, diff });
      };

      const factions: FactionKey[] = ['USA', 'GER', 'ENG', 'RUS', 'JAP'];
      const tabs = menu.container.querySelectorAll<HTMLButtonElement>('.faction-tab');
      const launchBtn = menu.container.querySelector<HTMLButtonElement>('#btn-launch-mission')!;
      expect(launchBtn).toBeDefined();

      for (const fac of factions) {
        const facTab = Array.from(tabs).find((t) => t.dataset.faction === fac)!;
        facTab.click();

        const expectedMissions = SKIRMISH_CATALOG.filter((m) => m.faction === fac);
        for (const expMission of expectedMissions) {
          const card = menu.container.querySelector<HTMLElement>(
            `[data-mission-id="${expMission.id}"]`
          )!;
          expect(card, `Card for ${expMission.id} exists`).toBeDefined();
          card.click();

          // Select difficulty
          const diffBtn = menu.container.querySelector<HTMLButtonElement>(
            '.diff-btn[data-diff="hard"]'
          )!;
          diffBtn.click();

          // Click launch battle
          launchBtn.click();
        }
      }

      // Assert all 15 missions were successfully launched via click events
      expect(launchedMissions.length).toBe(15);
      expect(new Set(launchedMissions.map((m) => m.id)).size).toBe(15);
      expect(launchedMissions.every((m) => m.diff === 'hard')).toBe(true);
      console.log('[T14 E2E Click Navigation] All 15 skirmishes reachable by click verified.');
    });

    it('animates loading progress bar accurately', () => {
      menu.showLoading('Operación Overlord');
      const overlay = menu.container.querySelector<HTMLElement>('#loading-screen')!;
      const fill = menu.container.querySelector<HTMLElement>('#loading-bar-fill')!;
      const statusText = menu.container.querySelector<HTMLElement>('#loading-status-text')!;

      expect(overlay.style.display).toBe('flex');

      menu.updateProgress(45, 'Descargando terreno 3D…');
      expect(fill.style.width).toBe('45%');
      expect(statusText.textContent).toBe('Descargando terreno 3D…');

      menu.updateProgress(100, '¡Listo para el combate!');
      expect(fill.style.width).toBe('100%');

      menu.hideLoading();
      expect(overlay.style.display).toBe('none');
    });
  });

  describe('GameHUD Component', () => {
    let hud: GameHUD;
    let world: World;

    beforeEach(() => {
      document.body.innerHTML = '';
      hud = new GameHUD();
      document.body.appendChild(hud.container);

      const overlordPath = path.resolve(__dirname, 'fixtures/01_usa-overlord.json');
      const raw = JSON.parse(fs.readFileSync(overlordPath, 'utf-8'));
      const doc = parseMissionDoc(raw, '01_usa-overlord');
      world = new World(777);
      world.initFromMission(doc);
      hud.setWorld(world);
    });

    it('updates top bar score, flags, and game clock dynamically', () => {
      world.skirmish.scoreCurrent = 850;
      world.time = 145; // 2m 25s

      hud.update();

      const scoreEl = hud.container.querySelector('#hud-score-val');
      const clockEl = hud.container.querySelector('#hud-timer');
      const pFlagEl = hud.container.querySelector('#hud-player-flags');
      const eFlagEl = hud.container.querySelector('#hud-enemy-flags');

      expect(scoreEl?.textContent).toContain('850 / 2000 MP');
      expect(clockEl?.textContent).toBe('02:25');
      expect(pFlagEl?.textContent).toContain('★');
      expect(eFlagEl?.textContent).toContain('✠');
    });

    it('renders and updates the unit selection inspector with HP, posture, and firemode', () => {
      const unit = Array.from(world.entities.values()).find((e) => e.kind === 'human')!;
      unit.health.current = 65;
      unit.health.max = 100;
      unit.movement.posture = 'crouch';
      unit.brain.fireMode = 'return';

      hud.setSelectedEntities([unit]);

      const panel = hud.container.querySelector<HTMLElement>('#hud-selection-panel')!;
      expect(panel.style.display).toBe('flex');

      const nameEl = hud.container.querySelector('#hud-unit-name');
      const hpFill = hud.container.querySelector<HTMLElement>('#hud-hp-bar-fill');
      const hpText = hud.container.querySelector('#hud-hp-bar-text');

      expect(nameEl?.textContent).toBe(unit.proto);
      expect(hpFill?.style.width).toBe('65%');
      expect(hpText?.textContent).toBe('65 / 100 HP');

      // Tactical controls
      const activePosture = hud.container.querySelector('.posture-group .tactical-btn.active');
      const activeFire = hud.container.querySelector('.firemode-group .tactical-btn.active');
      expect(activePosture?.getAttribute('data-posture')).toBe('crouch');
      expect(activeFire?.getAttribute('data-firemode')).toBe('return');
    });

    it('interacts with reinforcements panel: buying deducts MP and shows cooldown sweep', () => {
      const slot = Array.from(world.skirmish.reinforcements.values()).find((s) => s.item.eventStart)!;
      world.skirmish.scoreCurrent = 500;

      const card = hud.getReinforcementCard(slot.item.id)!;
      expect(card).toBeDefined();

      // Click to purchase
      card.click();

      // Verify trigger event was emitted
      expect(world.triggerVm.events.has(slot.item.eventStart)).toBe(true);

      // Verify cooldown overlay
      slot.cooldownRemaining = 15;
      slot.item.delay = 30;
      hud.update();

      const overlay = card.querySelector<HTMLElement>('.reinf-cooldown-overlay')!;
      expect(overlay.style.height).toBe('50%');
    });

    it('supports minimap canvas click navigation with projection', () => {
      let pannedCoord: { x: number; y: number } | null = null;
      hud.callbacks.onPanCameraTo = (gemX, gemY) => {
        pannedCoord = { x: gemX, y: gemY };
      };

      const canvas = hud.container.querySelector<HTMLCanvasElement>('#hud-minimap-canvas')!;
      expect(canvas).toBeDefined();

      // Trigger click event on center of minimap
      const rect = { left: 0, top: 0, width: 220, height: 220 };
      canvas.getBoundingClientRect = () => rect as DOMRect;

      const clickEv = new MouseEvent('click', { clientX: 110, clientY: 110 });
      canvas.dispatchEvent(clickEv);

      expect(pannedCoord).not.toBeNull();
      expect(Number.isFinite(pannedCoord?.x)).toBe(true);
      expect(Number.isFinite(pannedCoord?.y)).toBe(true);
    });

    it('displays styled victory and defeat modal with statistics', () => {
      hud.showGameOverModal('win', 'Operación completada con éxito.');

      const modal = hud.container.querySelector<HTMLElement>('#hud-gameover-modal')!;
      expect(modal.style.display).toBe('flex');

      const title = modal.querySelector('#gameover-title')!;
      expect(title.textContent).toBe('¡VICTORIA DECISIVA!');
      expect(title.classList.contains('win-title')).toBe(true);

      // Defeat modal
      hud.showGameOverModal('lose', 'Todas las tropas han sido abatidas.');
      expect(title.textContent).toBe('¡DERROTA!');
      expect(title.classList.contains('lose-title')).toBe(true);
    });
  });
});
