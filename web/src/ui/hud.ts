/**
 * OpenMoW-Web In-Game HUD Subsystem (T14).
 *
 * Implements:
 * 1. Top Bar: Command Points (MP), flag status, time clock, speed multiplier, pause, menu button.
 * 2. Selection Panel: Unit portraits, HP bar, posture buttons, fire mode toggles, basic inventory.
 * 3. Minimap: Canvas rendering with minimap.dds.png background, dynamic flag icons, unit dots, and click-to-pan.
 * 4. Reinforcements Bar: Interactive reinforcement purchase cards with MP costs and cooldown sweeps.
 * 5. Scenario Messages / Toasts: Scenario talk & mission objective notices.
 * 6. Victory & Defeat Modal: Styled game-over screen with stats and restart/menu actions.
 */

import type { World } from '../engine/world';
import type { SimEntity } from '../engine/components';
import { issueMoveOrder } from '../engine/orders';

export interface HUDCallbacks {
  onReturnToMenu?: () => void;
  onRestartMission?: () => void;
  onPanCameraTo?: (gemX: number, gemY: number) => void;
  onSetSimSpeed?: (speed: number) => void;
  onTogglePause?: () => void;
}

export class GameHUD {
  public container: HTMLElement;
  public world: World | null = null;
  public callbacks: HUDCallbacks = {};

  // Minimap cache
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapImage: HTMLImageElement | null = null;
  private minimapBounds = { minX: -6000, maxX: 6000, minY: -6000, maxY: 6000 };

  // UI elements
  private scoreEl: HTMLElement | null = null;
  private flagsEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private pauseBtn: HTMLElement | null = null;
  private botBtn: HTMLElement | null = null;

  // Selection
  private selectionPanel: HTMLElement | null = null;
  private selectionTitle: HTMLElement | null = null;
  private selectionHpFill: HTMLElement | null = null;
  private selectionHpText: HTMLElement | null = null;
  private selectionInventory: HTMLElement | null = null;
  private postureBtns: NodeListOf<HTMLButtonElement> | null = null;
  private fireModeBtns: NodeListOf<HTMLButtonElement> | null = null;

  // Reinforcements
  private reinforcementsBar: HTMLElement | null = null;
  private reinfCards: Map<string, HTMLElement> = new Map();

  // Modals & toasts
  private toastEl: HTMLElement | null = null;
  private toastTimer: any = null;
  private gameOverModal: HTMLElement | null = null;

  public currentSpeed = 1.0;
  public isPaused = false;
  public speedBtns: HTMLElement[] = [];
  public selectionPortrait: HTMLImageElement | null = null;
  private selectedEntities: SimEntity[] = [];

  constructor(callbacks: HUDCallbacks = {}) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.id = 'openmow-game-hud';
    this.buildDom();
  }

  private buildDom() {
    this.container.innerHTML = `
      <!-- TOP STATUS & CONTROLS BAR -->
      <header class="hud-top-bar" id="hud-top-bar">
        <div class="hud-top-left">
          <button class="hud-btn hud-btn-menu" id="btn-hud-menu" title="Volver al Menú">
            <span class="icon">☰</span> MENÚ
          </button>
          <div class="hud-divider"></div>
          <div class="hud-score-display" id="hud-score-display" title="Puntos de Mando (MP)">
            <span class="score-icon">✪</span>
            <span class="score-val" id="hud-score-val">200 / 2000 MP</span>
          </div>
          <div class="hud-flags-status" id="hud-flags-status" title="Banderas Controladas">
            <span class="flag-indicator player-flags" id="hud-player-flags">★ 1</span>
            <span class="flag-separator">:</span>
            <span class="flag-indicator enemy-flags" id="hud-enemy-flags">✠ 10</span>
          </div>
        </div>

        <div class="hud-top-center">
          <div class="hud-timer" id="hud-timer">00:00</div>
          <button class="hud-btn hud-btn-bot" id="btn-toggle-bot" title="Activar/Desactivar IA Jugador-Bot">
            BOT: OFF
          </button>
        </div>

        <div class="hud-top-right">
          <div class="sim-speed-controls">
            <button class="hud-btn-speed active" data-speed="1.0">1x</button>
            <button class="hud-btn-speed" data-speed="2.0">2x</button>
            <button class="hud-btn-speed" data-speed="5.0">5x</button>
          </div>
          <button class="hud-btn hud-btn-pause" id="btn-hud-pause" title="Pausar / Reanudar (Espacio)">
            ❚❚
          </button>
        </div>
      </header>

      <!-- SELECTION & UNIT INSPECTOR PANEL -->
      <aside class="hud-selection-panel" id="hud-selection-panel" style="display: none;">
        <div class="portrait-container">
          <img class="unit-portrait" id="hud-unit-portrait" src="/interface/scene/portrait/corporal.png" alt="Portrait" />
        </div>
        <div class="unit-meta">
          <div class="unit-name" id="hud-unit-name">Pelotón de Infantería</div>
          <div class="hp-bar-track">
            <div class="hp-bar-fill" id="hud-hp-bar-fill" style="width: 100%;"></div>
            <span class="hp-bar-text" id="hud-hp-bar-text">100 / 100 HP</span>
          </div>
          
          <!-- Posture & Fire Controls -->
          <div class="unit-tactical-controls">
            <div class="posture-group">
              <button class="tactical-btn" data-posture="stand" title="De pie">⇑</button>
              <button class="tactical-btn" data-posture="crouch" title="Agachado">⇕</button>
              <button class="tactical-btn" data-posture="prone" title="Cuerpo a tierra">⇓</button>
            </div>
            <div class="firemode-group">
              <button class="tactical-btn" data-firemode="free" title="Fuego a discreción">🔥</button>
              <button class="tactical-btn" data-firemode="return" title="Fuego de respuesta">🛡</button>
              <button class="tactical-btn" data-firemode="hold" title="Alto el fuego">⛔</button>
            </div>
          </div>

          <!-- Basic Inventory -->
          <div class="unit-inventory" id="hud-unit-inventory">
            <!-- Weapon & Ammo badges -->
          </div>
        </div>
      </aside>

      <!-- REINFORCEMENTS ACTION BAR -->
      <nav class="hud-reinforcements-bar" id="hud-reinforcements-bar" aria-label="Refuerzos">
        <div class="reinforcements-scroll" id="reinforcements-cards-container">
          <!-- Reinforcement cards dynamically populated -->
        </div>
      </nav>

      <!-- MINIMAP RADAR PANEL -->
      <div class="hud-minimap-panel" id="hud-minimap-panel">
        <canvas id="hud-minimap-canvas" width="220" height="220"></canvas>
        <div class="minimap-overlay-label">TÁCTICO</div>
      </div>

      <!-- TOAST NOTIFICATION BANNER -->
      <div class="hud-toast" id="hud-toast" style="display: none;"></div>

      <!-- GAME OVER MODAL -->
      <div class="hud-gameover-modal" id="hud-gameover-modal" style="display: none;">
        <div class="modal-dialog">
          <h2 class="modal-title" id="gameover-title">¡VICTORIA!</h2>
          <p class="modal-subtitle" id="gameover-subtitle">Todas las posiciones enemigas han sido aseguradas.</p>
          <div class="modal-stats" id="gameover-stats">
            <!-- Dynamic stats -->
          </div>
          <div class="modal-actions">
            <button class="modal-btn btn-restart" id="btn-modal-restart">REINTENTAR</button>
            <button class="modal-btn btn-menu" id="btn-modal-menu">MENÚ PRINCIPAL</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    this.scoreEl = this.container.querySelector('#hud-score-val');
    this.flagsEl = this.container.querySelector('#hud-flags-status');
    this.clockEl = this.container.querySelector('#hud-timer');
    this.pauseBtn = this.container.querySelector('#btn-hud-pause');
    this.botBtn = this.container.querySelector('#btn-toggle-bot');
    this.selectionPanel = this.container.querySelector('#hud-selection-panel');
    this.selectionPortrait = this.container.querySelector('#hud-unit-portrait');
    this.selectionTitle = this.container.querySelector('#hud-unit-name');
    this.selectionHpFill = this.container.querySelector('#hud-hp-bar-fill');
    this.selectionHpText = this.container.querySelector('#hud-hp-bar-text');
    this.selectionInventory = this.container.querySelector('#hud-unit-inventory');
    this.reinforcementsBar = this.container.querySelector('#reinforcements-cards-container');
    this.toastEl = this.container.querySelector('#hud-toast');
    this.gameOverModal = this.container.querySelector('#hud-gameover-modal');

    // Minimap
    this.minimapCanvas = this.container.querySelector('#hud-minimap-canvas');
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
      this.minimapCanvas.addEventListener('click', (e) => this.handleMinimapClick(e));
    }

    // Menu button
    const btnMenu = this.container.querySelector('#btn-hud-menu');
    btnMenu?.addEventListener('click', () => {
      if (this.callbacks.onReturnToMenu) this.callbacks.onReturnToMenu();
    });

    // Pause button
    this.pauseBtn?.addEventListener('click', () => {
      this.togglePause();
    });

    // Bot toggle
    this.botBtn?.addEventListener('click', () => {
      if (!this.world) return;
      if (this.world.ai.botMode === 'defend') {
        this.world.ai.botMode = 'off';
        if (this.botBtn) this.botBtn.textContent = 'BOT: OFF';
        this.showToast('Jugador-Bot desactivado (Modo manual)');
      } else {
        this.world.ai.botMode = 'defend';
        if (this.botBtn) this.botBtn.textContent = 'BOT: DEFEND';
        this.showToast('Jugador-Bot activado (Defendiendo posiciones)');
      }
    });

    // Speed controls
    const speedButtons = this.container.querySelectorAll<HTMLButtonElement>('.hud-btn-speed');
    this.speedBtns = Array.from(speedButtons);
    speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed || '1.0');
        this.setSpeed(speed);
        speedButtons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // Posture buttons
    this.postureBtns = this.container.querySelectorAll<HTMLButtonElement>('.posture-group .tactical-btn');
    this.postureBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const posture = btn.dataset.posture as 'stand' | 'crouch' | 'prone';
        if (this.world && this.selectedEntities.length > 0 && posture) {
          const ids = this.selectedEntities.map((e) => e.id);
          issueMoveOrder(this.world, ids, undefined as any, undefined as any, posture, false);
          this.updateSelectionPanel();
        }
      });
    });

    // FireMode buttons
    this.fireModeBtns = this.container.querySelectorAll<HTMLButtonElement>('.firemode-group .tactical-btn');
    this.fireModeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.firemode as 'free' | 'return' | 'hold';
        if (mode && this.selectedEntities.length > 0) {
          for (const ent of this.selectedEntities) {
            ent.brain.fireMode = mode;
          }
          this.updateSelectionPanel();
        }
      });
    });

    // Modal buttons
    this.container.querySelector('#btn-modal-restart')?.addEventListener('click', () => {
      if (this.callbacks.onRestartMission) this.callbacks.onRestartMission();
    });
    this.container.querySelector('#btn-modal-menu')?.addEventListener('click', () => {
      if (this.callbacks.onReturnToMenu) this.callbacks.onReturnToMenu();
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && this.container.style.display !== 'none') {
        this.togglePause();
      }
    });
  }

  public setWorld(world: World, minimapUrl?: string) {
    this.world = world;
    this.isPaused = false;
    this.currentSpeed = 1.0;
    this.selectedEntities = [];
    if (this.pauseBtn) this.pauseBtn.textContent = '❚❚';
    if (this.gameOverModal) this.gameOverModal.style.display = 'none';

    // Calculate map bounds from flags and entities for minimap projection
    let minX = -4000;
    let maxX = 4000;
    let minY = -4000;
    let maxY = 4000;

    for (const flag of world.skirmish.flags.values()) {
      const px = flag.zone.position[0];
      const py = flag.zone.position[1];
      minX = Math.min(minX, px - 1500);
      maxX = Math.max(maxX, px + 1500);
      minY = Math.min(minY, py - 1500);
      maxY = Math.max(maxY, py + 1500);
    }
    this.minimapBounds = { minX, maxX, minY, maxY };

    // Load Minimap background texture
    if (minimapUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = minimapUrl;
      img.onload = () => {
        this.minimapImage = img;
      };
      img.onerror = () => {
        this.minimapImage = null;
      };
    } else {
      this.minimapImage = null;
    }

    this.rebuildReinforcements();
    this.update();
  }

  public setSelectedEntities(entities: SimEntity[]) {
    this.selectedEntities = entities;
    this.updateSelectionPanel();
  }

  public updateSelectionPanel() {
    if (!this.selectionPanel) return;

    if (this.selectedEntities.length === 0) {
      this.selectionPanel.style.display = 'none';
      return;
    }

    this.selectionPanel.style.display = 'flex';
    const primary = this.selectedEntities[0];

    if (this.selectionTitle) {
      const count = this.selectedEntities.length;
      this.selectionTitle.textContent =
        count > 1 ? `${primary.proto} (${count} unidades)` : primary.proto;
    }

    if (this.selectionHpFill && this.selectionHpText) {
      const pct = Math.max(0, Math.min(100, (primary.health.current / primary.health.max) * 100));
      this.selectionHpFill.style.width = `${pct}%`;
      this.selectionHpFill.style.backgroundColor =
        pct > 50 ? '#4fe736' : pct > 20 ? '#e7c436' : '#e74236';
      this.selectionHpText.textContent = `${Math.ceil(primary.health.current)} / ${primary.health.max} HP`;
    }

    // Highlight current posture
    if (this.postureBtns) {
      this.postureBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.posture === primary.movement.posture);
      });
    }

    // Highlight current fire mode
    if (this.fireModeBtns) {
      this.fireModeBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.firemode === primary.brain.fireMode);
      });
    }

    // Update inventory badges
    if (this.selectionInventory) {
      this.selectionInventory.innerHTML = '';
      if (primary.inventory && primary.inventory.length > 0) {
        for (const item of primary.inventory.slice(0, 5)) {
          const badge = document.createElement('span');
          badge.className = 'inv-badge';
          badge.textContent = `${item.name}${item.amount ? ` (${item.amount})` : ''}`;
          this.selectionInventory.appendChild(badge);
        }
      } else {
        const empty = document.createElement('span');
        empty.className = 'inv-badge empty';
        empty.textContent = primary.kind === 'entity' ? 'Munición de a bordo' : 'Equipo de combate';
        this.selectionInventory.appendChild(empty);
      }
    }
  }

  public getReinforcementCard(itemId: string): HTMLElement | undefined {
    return this.reinfCards.get(itemId);
  }

  public rebuildReinforcements() {
    if (!this.reinforcementsBar || !this.world) return;
    this.reinforcementsBar.innerHTML = '';
    this.reinfCards.clear();

    const slots = Array.from(this.world.skirmish.reinforcements.values()).filter(
      (slot) => !slot.item.id.startsWith('menu:') && slot.item.id !== 'player_flag'
    );
    slots.forEach((slot) => {
      const card = document.createElement('button');
      card.className = 'reinf-card';
      card.id = `reinf-${slot.item.id}`;
      card.dataset.itemId = slot.item.id;
      card.dataset.id = slot.item.id;
      card.setAttribute('data-id', slot.item.id);

      card.innerHTML = `
        <div class="reinf-header">
          <span class="reinf-name">${slot.item.id.replace(/^(player_|enemy_)/, '')}</span>
          <span class="reinf-cost">${slot.item.score ?? 0} MP</span>
        </div>
        <div class="reinf-count">${slot.countRemaining === -1 ? '∞' : slot.countRemaining} disp.</div>
        <div class="reinf-cooldown-overlay" style="height: 0%;"></div>
      `;

      card.addEventListener('click', () => {
        if (!this.world) return;
        const bought = this.world.skirmish.buyReinforcement(slot.item.id);
        if (bought) {
          this.showToast(`¡Refuerzos solicitados: ${slot.item.id}!`);
        } else {
          this.showToast(`Puntos insuficientes o en enfriamiento.`);
        }
      });

      this.reinfCards.set(slot.item.id, card);
      if (this.reinforcementsBar) {
        this.reinforcementsBar.appendChild(card);
      }
    });
  }

  public update() {
    if (!this.world) return;

    // 1. Update score
    if (this.scoreEl) {
      this.scoreEl.textContent = `${this.world.skirmish.scoreCurrent} / ${this.world.skirmish.scoreTotal} MP`;
    }

    // 2. Update flags count
    if (this.flagsEl) {
      let playerFlags = 0;
      let enemyFlags = 0;
      for (const flag of this.world.skirmish.flags.values()) {
        if (flag.holder === 'player') playerFlags++;
        else enemyFlags++;
      }
      const pEl = this.flagsEl.querySelector('#hud-player-flags');
      const eEl = this.flagsEl.querySelector('#hud-enemy-flags');
      if (pEl) pEl.textContent = `★ ${playerFlags}`;
      if (eEl) eEl.textContent = `✠ ${enemyFlags}`;
    }

    // 3. Update timer
    if (this.clockEl) {
      const totalSec = Math.floor(this.world.time);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      this.clockEl.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // 4. Update reinforcement card states (cooldown and affordability)
    if (this.reinforcementsBar) {
      for (const slot of this.world.skirmish.reinforcements.values()) {
        const card = this.reinfCards.get(slot.item.id);
        if (!card) continue;

        const maxDelay = slot.item.delay ?? 1;
        const cdPct = maxDelay > 0 ? (slot.cooldownRemaining / maxDelay) * 100 : 0;
        const overlay = card.querySelector<HTMLElement>('.reinf-cooldown-overlay');
        if (overlay) {
          overlay.style.height = `${cdPct}%`;
        }

        const canAfford = this.world.skirmish.scoreCurrent >= (slot.item.score ?? 0);
        const hasCount = slot.countRemaining !== 0;
        const isReady = slot.cooldownRemaining <= 0;

        card.classList.toggle('disabled', !canAfford || !hasCount || !isReady);
      }
    }

    // 5. Check Game Over
    if (this.world.skirmish.gameOver && this.gameOverModal && this.gameOverModal.style.display === 'none') {
      this.showGameOverModal(this.world.skirmish.gameOver.result, this.world.skirmish.gameOver.message);
    }

    // 6. Redraw Minimap
    this.renderMinimap();
  }

  private renderMinimap() {
    if (!this.minimapCanvas || !this.minimapCtx || !this.world) return;
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Background terrain image or dark radar grid
    if (this.minimapImage && this.minimapImage.complete && this.minimapImage.naturalWidth > 0) {
      ctx.drawImage(this.minimapImage, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#111822';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= w; i += 25) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(w, i);
        ctx.stroke();
      }
    }

    // Project world coordinates to canvas
    const { minX, maxX, minY, maxY } = this.minimapBounds;
    const scaleX = w / (maxX - minX || 1);
    const scaleY = h / (maxY - minY || 1);

    const toCanvasX = (gemX: number) => (gemX - minX) * scaleX;
    const toCanvasY = (gemY: number) => h - (gemY - minY) * scaleY;

    // 2. Draw Skirmish Flags
    for (const flag of this.world.skirmish.flags.values()) {
      const cx = toCanvasX(flag.zone.position[0]);
      const cy = toCanvasY(flag.zone.position[1]);

      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = flag.holder === 'player' ? '#2ea043' : '#da3633';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 3. Draw Units
    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;
      if (ent.proto.includes('sandbag') || ent.proto.includes('flag')) continue;

      const cx = toCanvasX(ent.transform.x);
      const cy = toCanvasY(ent.transform.y);

      const isPlayer = ent.brain.control === 'user' || ent.owner.player === 2;
      ctx.fillStyle = isPlayer ? '#58a6ff' : '#f85149';
      ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    }
  }

  private handleMinimapClick(e: MouseEvent) {
    if (!this.minimapCanvas || !this.callbacks.onPanCameraTo) return;
    const rect = this.minimapCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const { minX, maxX, minY, maxY } = this.minimapBounds;

    const gemX = minX + (clickX / w) * (maxX - minX);
    const gemY = minY + ((h - clickY) / h) * (maxY - minY);

    this.callbacks.onPanCameraTo(gemX, gemY);
  }

  public showToast(message: string, durationMs = 3500) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.style.display = 'block';

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.style.display = 'none';
    }, durationMs);
  }

  public showGameOverModal(result: 'win' | 'lose', message?: string) {
    if (!this.gameOverModal) return;
    const titleEl = this.gameOverModal.querySelector('#gameover-title');
    const subEl = this.gameOverModal.querySelector('#gameover-subtitle');
    const statsEl = this.gameOverModal.querySelector('#gameover-stats');

    if (titleEl) {
      titleEl.textContent = result === 'win' ? '¡VICTORIA DECISIVA!' : '¡DERROTA!';
      titleEl.className = `modal-title ${result === 'win' ? 'win-title' : 'lose-title'}`;
    }
    if (subEl) {
      subEl.textContent =
        message || (result === 'win' ? 'Todas las posiciones estratégicas han sido aseguradas.' : 'Tus fuerzas han sido aniquiladas.');
    }
    if (statsEl && this.world) {
      const timeStr = this.clockEl?.textContent || '00:00';
      let flagsCount = 0;
      for (const f of this.world.skirmish.flags.values()) if (f.holder === 'player') flagsCount++;

      statsEl.innerHTML = `
        <div class="stat-row"><span>Tiempo de combate:</span> <strong>${timeStr}</strong></div>
        <div class="stat-row"><span>Banderas conquistadas:</span> <strong>${flagsCount} de 11</strong></div>
        <div class="stat-row"><span>Puntos de mando finales:</span> <strong>${this.world.skirmish.scoreCurrent} MP</strong></div>
      `;
    }

    this.gameOverModal.style.display = 'flex';
  }

  public togglePause() {
    this.isPaused = !this.isPaused;
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.isPaused ? '▶' : '❚❚';
    }
    if (this.callbacks.onTogglePause) this.callbacks.onTogglePause();
  }

  public setSpeed(speed: number) {
    this.currentSpeed = speed;
    if (this.callbacks.onSetSimSpeed) this.callbacks.onSetSimSpeed(speed);
  }

  public show() {
    this.container.style.display = 'block';
  }

  public hide() {
    this.container.style.display = 'none';
  }
}
