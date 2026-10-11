/**
 * OpenMoW-Web Main Menu & Mission Selector (T14).
 *
 * Implements:
 * 1. Faction selector: USA, GER, ENG, RUS, JAP.
 * 2. 15 Skirmish missions catalog (3 per faction) with preview images and localized metadata.
 * 3. Difficulty selector (easy, normal, hard, heroic).
 * 4. Responsive loading screen with progress bar (0-100%).
 * 5. Direct click navigation for all 15 missions.
 */

export interface SkirmishMissionMeta {
  id: string;
  name: string;
  title: string;
  faction: 'USA' | 'GER' | 'ENG' | 'RUS' | 'JAP';
  vpath: string;
  previewUrl: string;
  minimapUrl: string;
  lngUrl: string;
  place: string;
  date: string;
  description: string;
}

export const SKIRMISH_CATALOG: SkirmishMissionMeta[] = [
  // USA
  {
    id: '01_usa-overlord',
    name: '01_usa-overlord',
    title: 'Operación Overlord',
    faction: 'USA',
    vpath: 'map/single/01_usa-skirmish/01_usa-overlord',
    previewUrl: '/conv/tex/map/single/01_usa-skirmish/01_usa-overlord/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/01_usa-skirmish/01_usa-overlord/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/01_usa-skirmish/01_usa-overlord.lng.json',
    place: 'Normandía, Francia',
    date: 'Junio de 1944',
    description: 'Desembarco en Normandía. Captura las tres líneas de trincheras alemanas y la base costera.',
  },
  {
    id: '02_usa-carentan',
    name: '02_usa-carentan',
    title: 'Carentan',
    faction: 'USA',
    vpath: 'map/single/01_usa-skirmish/02_usa-carentan',
    previewUrl: '/conv/tex/map/single/01_usa-skirmish/02_usa-carentan/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/01_usa-skirmish/02_usa-carentan/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/01_usa-skirmish/02_usa-carentan.lng.json',
    place: 'Carentan, Francia',
    date: 'Junio de 1944',
    description: 'Combate urbano en los cruces de carreteras estratégicos para conectar las playas Utah y Omaha.',
  },
  {
    id: '03_usa-ardennes',
    name: '03_usa-ardennes',
    title: 'Las Ardenas',
    faction: 'USA',
    vpath: 'map/single/01_usa-skirmish/03_usa-ardennes',
    previewUrl: '/conv/tex/map/single/01_usa-skirmish/03_usa-ardennes/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/01_usa-skirmish/03_usa-ardennes/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/01_usa-skirmish/03_usa-ardennes.lng.json',
    place: 'Ardenas, Bélgica',
    date: 'Diciembre de 1944',
    description: 'Batalla de las Ardenas. Resiste la contraofensiva acorazada alemana bajo la nieve.',
  },

  // GER
  {
    id: '01_ger-caen',
    name: '01_ger-caen',
    title: 'Caen',
    faction: 'GER',
    vpath: 'map/single/02_ger-skirmish/01_ger-caen',
    previewUrl: '/conv/tex/map/single/02_ger-skirmish/01_ger-caen/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/02_ger-skirmish/01_ger-caen/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/02_ger-skirmish/01_ger-caen.lng.json',
    place: 'Caen, Normandía',
    date: 'Junio de 1944',
    description: 'Defensa acorazada alemana frente a la ofensiva británica y canadiense en las ruinas de Caen.',
  },
  {
    id: '02_ger-sthilaire',
    name: '02_ger-sthilaire',
    title: 'St. Hilaire-du-Harcouët',
    faction: 'GER',
    vpath: 'map/single/02_ger-skirmish/02_ger-sthilaire',
    previewUrl: '/conv/tex/map/single/02_ger-skirmish/02_ger-sthilaire/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/02_ger-skirmish/02_ger-sthilaire/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/02_ger-skirmish/02_ger-sthilaire.lng.json',
    place: 'St. Hilaire, Francia',
    date: 'Agosto de 1944',
    description: 'Emboscada táctica y defensa elástica en el sector de bocage normando.',
  },
  {
    id: '03_ger-marketgarden',
    name: '03_ger-marketgarden',
    title: 'Market Garden',
    faction: 'GER',
    vpath: 'map/single/02_ger-skirmish/03_ger-marketgarden',
    previewUrl: '/conv/tex/map/single/02_ger-skirmish/03_ger-marketgarden/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/02_ger-skirmish/03_ger-marketgarden/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/02_ger-skirmish/03_ger-marketgarden.lng.json',
    place: 'Arnhem / Nimega, Holanda',
    date: 'Septiembre de 1944',
    description: 'Intercepción de las divisiones aerotransportadas aliadas y blindaje de los puentes del Rin.',
  },

  // ENG
  {
    id: '01_eng-battleaxe',
    name: '01_eng-battleaxe',
    title: 'Operación Battleaxe',
    faction: 'ENG',
    vpath: 'map/single/03_eng-skirmish/01_eng-battleaxe',
    previewUrl: '/conv/tex/map/single/03_eng-skirmish/01_eng-battleaxe/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/03_eng-skirmish/01_eng-battleaxe/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/03_eng-skirmish/01_eng-battleaxe.lng.json',
    place: 'Cirenaica, Norte de África',
    date: 'Junio de 1941',
    description: 'Ofensiva del ejército británico en el desierto para romper el cerco sobre Tobruk.',
  },
  {
    id: '02_eng-torch',
    name: '02_eng-torch',
    title: 'Operación Torch',
    faction: 'ENG',
    vpath: 'map/single/03_eng-skirmish/02_eng-torch',
    previewUrl: '/conv/tex/map/single/03_eng-skirmish/02_eng-torch/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/03_eng-skirmish/02_eng-torch/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/03_eng-skirmish/02_eng-torch.lng.json',
    place: 'Norte de África',
    date: 'Noviembre de 1942',
    description: 'Desembarcos anfibios combinados en el litoral norteafricano para consolidar el avance aliado.',
  },
  {
    id: '03_eng-arnhem',
    name: '03_eng-arnhem',
    title: 'Arnhem',
    faction: 'ENG',
    vpath: 'map/single/03_eng-skirmish/03_eng-arnhem',
    previewUrl: '/conv/tex/map/single/03_eng-skirmish/03_eng-arnhem/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/03_eng-skirmish/03_eng-arnhem/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/03_eng-skirmish/03_eng-arnhem.lng.json',
    place: 'Arnhem, Países Bajos',
    date: 'Septiembre de 1944',
    description: 'Un puente demasiado lejos. Los paracaidistas británicos de la 1st Airborne defienden el puente.',
  },

  // RUS
  {
    id: '01_rus-smolensk',
    name: '01_rus-smolensk',
    title: 'Smolensk',
    faction: 'RUS',
    vpath: 'map/single/04_rus-skirmish/01_rus-smolensk',
    previewUrl: '/conv/tex/map/single/04_rus-skirmish/01_rus-smolensk/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/04_rus-skirmish/01_rus-smolensk/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/04_rus-skirmish/01_rus-smolensk.lng.json',
    place: 'Smolensk, Unión Soviética',
    date: 'Julio de 1941',
    description: 'Resistencia encarnizada del Ejército Rojo para frenar el avance del Grupo de Ejércitos Centro.',
  },
  {
    id: '02_rus-koenigsberg',
    name: '02_rus-koenigsberg',
    title: 'Königsberg',
    faction: 'RUS',
    vpath: 'map/single/04_rus-skirmish/02_rus-koenigsberg',
    previewUrl: '/conv/tex/map/single/04_rus-skirmish/02_rus-koenigsberg/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/04_rus-skirmish/02_rus-koenigsberg/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/04_rus-skirmish/02_rus-koenigsberg.lng.json',
    place: 'Prusia Oriental',
    date: 'Abril de 1945',
    description: 'Asalto masivo de artillería e infantería soviética a la fortaleza de Königsberg.',
  },
  {
    id: '03_rus-manchuria',
    name: '03_rus-manchuria',
    title: 'Manchuria',
    faction: 'RUS',
    vpath: 'map/single/04_rus-skirmish/03_rus-manchuria',
    previewUrl: '/conv/tex/map/single/04_rus-skirmish/03_rus-manchuria/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/04_rus-skirmish/03_rus-manchuria/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/04_rus-skirmish/03_rus-manchuria.lng.json',
    place: 'Manchuria, Lejano Oriente',
    date: 'Agosto de 1945',
    description: 'Operación Tormenta de Agosto. Rápido avance mecanizado contra el ejército de Kwantung.',
  },

  // JAP
  {
    id: '01_jap-khalkhingol',
    name: '01_jap-khalkhingol',
    title: 'Khalkhin Gol',
    faction: 'JAP',
    vpath: 'map/single/05_jap-skirmish/01_jap-khalkhingol',
    previewUrl: '/conv/tex/map/single/05_jap-skirmish/01_jap-khalkhingol/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/05_jap-skirmish/01_jap-khalkhingol/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/05_jap-skirmish/01_jap-khalkhingol.lng.json',
    place: 'Frontera de Manchuria y Mongolia',
    date: 'Agosto de 1939',
    description: 'Conflicto fronterizo soviético-japonés en las estepas mongolas del río Khalkhin Gol.',
  },
  {
    id: '02_jap-singapore',
    name: '02_jap-singapore',
    title: 'Singapur',
    faction: 'JAP',
    vpath: 'map/single/05_jap-skirmish/02_jap-singapore',
    previewUrl: '/conv/tex/map/single/05_jap-skirmish/02_jap-singapore/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/05_jap-skirmish/02_jap-singapore/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/05_jap-skirmish/02_jap-singapore.lng.json',
    place: 'Singapur / Malasia',
    date: 'Febrero de 1942',
    description: 'Asalto anfibio y avance a través de la jungla hacia la fortaleza británica de Singapur.',
  },
  {
    id: '03_jap-iwojima',
    name: '03_jap-iwojima',
    title: 'Iwo Jima',
    faction: 'JAP',
    vpath: 'map/single/05_jap-skirmish/03_jap-iwojima',
    previewUrl: '/conv/tex/map/single/05_jap-skirmish/03_jap-iwojima/preview.dds.png',
    minimapUrl: '/conv/tex/map/single/05_jap-skirmish/03_jap-iwojima/minimap.dds.png',
    lngUrl: '/conv/sdl/localization/mission/single/05_jap-skirmish/03_jap-iwojima.lng.json',
    place: 'Isla de Iwo Jima',
    date: 'Febrero de 1945',
    description: 'Defensa subterránea en cuevas y búnkeres de arena volcánica en el monte Suribachi.',
  },
];

export type FactionKey = 'USA' | 'GER' | 'ENG' | 'RUS' | 'JAP';
export type DifficultyKey = 'easy' | 'normal' | 'hard' | 'heroic';

export class MainMenu {
  public container: HTMLElement;
  public selectedFaction: FactionKey = 'USA';
  public selectedMission: SkirmishMissionMeta;
  public selectedDifficulty: DifficultyKey = 'normal';
  public onStartMission?: (mission: SkirmishMissionMeta, difficulty: DifficultyKey) => void;

  private loadingOverlay: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;

  constructor() {
    this.selectedMission = SKIRMISH_CATALOG[0];
    this.container = document.createElement('div');
    this.container.id = 'openmow-main-menu';
    this.buildDom();
  }

  private buildDom() {
    this.container.innerHTML = `
      <div class="menu-backdrop"></div>
      <div class="menu-window">
        <header class="menu-header">
          <div class="brand">
            <h1 class="logo-title">MEN OF WAR</h1>
            <span class="logo-subtitle">ASSAULT SQUAD 2 · WEB EDITION</span>
          </div>
          <div class="version-tag">OpenMoW-Web v0.1 · 20 Hz Deterministic</div>
        </header>

        <div class="menu-body">
          <!-- 1. Faction Tabs -->
          <nav class="faction-nav" aria-label="Facciones">
            <button class="faction-tab active" data-faction="USA">
              <span class="flag-icon">★</span>
              <span class="faction-name">USA</span>
            </button>
            <button class="faction-tab" data-faction="GER">
              <span class="flag-icon">✠</span>
              <span class="faction-name">ALEMANIA</span>
            </button>
            <button class="faction-tab" data-faction="ENG">
              <span class="flag-icon">✦</span>
              <span class="faction-name">COMMONWEALTH</span>
            </button>
            <button class="faction-tab" data-faction="RUS">
              <span class="flag-icon">☭</span>
              <span class="faction-name">URSS</span>
            </button>
            <button class="faction-tab" data-faction="JAP">
              <span class="flag-icon">✹</span>
              <span class="faction-name">JAPÓN</span>
            </button>
          </nav>

          <!-- 2. Missions List & Details -->
          <div class="content-row">
            <div class="missions-list-panel">
              <h3 class="panel-heading">SELECCIONAR ESCARAMUZA</h3>
              <div class="missions-grid" id="missions-list-container">
                <!-- Dynamically rendered mission cards -->
              </div>
            </div>

            <div class="mission-details-panel">
              <h3 class="panel-heading">DETALLES DE LA OPERACIÓN</h3>
              <div class="preview-container">
                <img id="detail-preview-img" src="${this.selectedMission.previewUrl}" alt="Preview" />
                <div class="preview-gradient"></div>
                <div class="preview-overlay-info">
                  <div class="preview-place" id="detail-place">${this.selectedMission.place}</div>
                  <div class="preview-title" id="detail-title">${this.selectedMission.title}</div>
                  <div class="preview-date" id="detail-date">${this.selectedMission.date}</div>
                </div>
              </div>

              <div class="description-box" id="detail-desc">
                ${this.selectedMission.description}
              </div>

              <!-- Difficulty selection -->
              <div class="difficulty-section">
                <span class="difficulty-label">DIFICULTAD:</span>
                <div class="diff-buttons" id="diff-buttons-group">
                  <button class="diff-btn" data-diff="easy">FÁCIL</button>
                  <button class="diff-btn active" data-diff="normal">NORMAL</button>
                  <button class="diff-btn" data-diff="hard">DIFÍCIL</button>
                  <button class="diff-btn" data-diff="heroic">HEROICO</button>
                </div>
              </div>

              <!-- Launch Action -->
              <button class="btn-launch-battle" id="btn-launch-mission">
                <span class="launch-icon">▶</span> DESPLEGAR TROPAS
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading Overlay -->
      <div id="loading-screen" class="loading-overlay" style="display: none;">
        <div class="loading-content">
          <h2 class="loading-title" id="loading-mission-name">CARGANDO OPERACIÓN…</h2>
          <div class="loading-bar-track">
            <div class="loading-bar-fill" id="loading-bar-fill" style="width: 0%;"></div>
          </div>
          <div class="loading-status-text" id="loading-status-text">Inicializando simulación…</div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderMissionsForCurrentFaction();
  }

  private bindEvents() {
    // Faction tabs
    const tabs = this.container.querySelectorAll<HTMLButtonElement>('.faction-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const fac = tab.dataset.faction as FactionKey;
        if (fac && fac !== this.selectedFaction) {
          this.selectedFaction = fac;
          tabs.forEach((t) => t.classList.toggle('active', t === tab));
          this.renderMissionsForCurrentFaction();
        }
      });
    });

    // Difficulty buttons
    const diffBtns = this.container.querySelectorAll<HTMLButtonElement>('.diff-btn');
    diffBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const diff = btn.dataset.diff as DifficultyKey;
        if (diff) {
          this.selectedDifficulty = diff;
          diffBtns.forEach((b) => b.classList.toggle('active', b === btn));
        }
      });
    });

    // Launch mission button
    const launchBtn = this.container.querySelector<HTMLButtonElement>('#btn-launch-mission');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        if (this.onStartMission) {
          this.onStartMission(this.selectedMission, this.selectedDifficulty);
        }
      });
    }

    this.loadingOverlay = this.container.querySelector('#loading-screen');
    this.progressBar = this.container.querySelector('#loading-bar-fill');
    this.progressText = this.container.querySelector('#loading-status-text');
  }

  public renderMissionsForCurrentFaction() {
    const listContainer = this.container.querySelector('#missions-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    const missions = SKIRMISH_CATALOG.filter((m) => m.faction === this.selectedFaction);

    missions.forEach((m, idx) => {
      const card = document.createElement('div');
      card.className = `mission-card ${m.id === this.selectedMission.id ? 'selected' : ''}`;
      card.dataset.missionId = m.id;
      card.innerHTML = `
        <div class="card-thumb" style="background-image: url('${m.previewUrl}')">
          <span class="card-number">0${idx + 1}</span>
        </div>
        <div class="card-info">
          <div class="card-title">${m.title}</div>
          <div class="card-sub">${m.place}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectMission(m);
      });

      listContainer.appendChild(card);
    });

    // Auto-select first mission of faction if current selected isn't in this faction
    if (this.selectedMission.faction !== this.selectedFaction && missions.length > 0) {
      this.selectMission(missions[0]);
    }
  }

  public selectMission(m: SkirmishMissionMeta) {
    this.selectedMission = m;

    // Update cards visual selection
    const cards = this.container.querySelectorAll<HTMLElement>('.mission-card');
    cards.forEach((c) => {
      c.classList.toggle('selected', c.dataset.missionId === m.id);
    });

    // Update details view
    const previewImg = this.container.querySelector<HTMLImageElement>('#detail-preview-img');
    const placeEl = this.container.querySelector('#detail-place');
    const titleEl = this.container.querySelector('#detail-title');
    const dateEl = this.container.querySelector('#detail-date');
    const descEl = this.container.querySelector('#detail-desc');

    if (previewImg) previewImg.src = m.previewUrl;
    if (placeEl) placeEl.textContent = m.place;
    if (titleEl) titleEl.textContent = m.title;
    if (dateEl) dateEl.textContent = m.date;
    if (descEl) descEl.textContent = m.description;
  }

  public show() {
    this.container.style.display = 'block';
  }

  public hide() {
    this.container.style.display = 'none';
  }

  public showLoading(title: string) {
    if (this.loadingOverlay) {
      const nameEl = this.loadingOverlay.querySelector('#loading-mission-name');
      if (nameEl) nameEl.textContent = `CARGANDO ${title.toUpperCase()}…`;
      this.loadingOverlay.style.display = 'flex';
      this.updateProgress(0, 'Iniciando carga de assets…');
    }
  }

  public updateProgress(percent: number, status: string) {
    if (this.progressBar) {
      this.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    if (this.progressText) {
      this.progressText.textContent = status;
    }
  }

  public hideLoading() {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = 'none';
    }
  }
}
