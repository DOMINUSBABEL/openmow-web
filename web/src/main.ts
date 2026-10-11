/**
 * OpenMoW-Web Game Client Main Entry Point (T14 / Frontend & UI).
 * Integrates 20 Hz deterministic simulation engine with interpolated Three.js rendering,
 * Full Main Menu (15 Skirmishes), and interactive Game HUD.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGemRoot, gemToThree, threeToGem } from './contracts/coords';
import { World, TICK_RATE, TICK_DT } from './engine/world';
import { SceneSynchronizer } from './render/interpolator';
import { EntityRenderer } from './render/entity_renderer';
import { loadMissionDoc } from './mission/load';
import { RtsControls } from './ui/rts_controls';
import { NavGrid } from './engine/nav';
import type { NavGridDoc } from './contracts/nav';
import './ui/styles.css';
import {
  MainMenu,
  SKIRMISH_CATALOG,
  type SkirmishMissionMeta,
  type DifficultyKey,
} from './ui/menu';
import { GameHUD } from './ui/hud';
import { AudioEngine, MUSIC_TRACKS } from './audio/audio_engine';
import { HumanAnimationController, CORE_ANIMATION_PATHS, loadAnimationClip } from './render/skinning';
import type { SimEntity } from './engine/components';

const params = new URLSearchParams(location.search);
const debugOverlay = document.getElementById('debug-overlay') as HTMLDivElement;

// 1. Three.js Renderer & Scene
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x445566, 1.0));
const sun = new THREE.DirectionalLight(0xfffaed, 1.8);
sun.position.set(600, 1500, 800);
scene.add(sun);
scene.add(sun.target);

const gemRoot = createGemRoot();
scene.add(gemRoot);

// Camera & RTS View Controls
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1.0, 50000);
camera.position.set(0, 300, 400);

const camTarget = new THREE.Vector3(0, 0, 0);
let camDistance = 350;
let camAzimuth = Math.PI / 4;
let camElevation = Math.PI / 4;

function updateCamera() {
  const cosEl = Math.cos(camElevation);
  const sinEl = Math.sin(camElevation);
  const x = camTarget.x + camDistance * cosEl * Math.sin(camAzimuth);
  const y = camTarget.y + camDistance * sinEl;
  const z = camTarget.z + camDistance * cosEl * Math.cos(camAzimuth);
  camera.position.set(x, y, z);
  camera.lookAt(camTarget);
}
updateCamera();

const keys: Record<string, boolean> = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

window.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});
window.addEventListener('mouseup', () => {
  isDragging = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    camAzimuth -= dx * 0.005;
    camElevation = Math.max(0.1, Math.min(Math.PI / 2.1, camElevation + dy * 0.005));
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    updateCamera();
  }
});

window.addEventListener(
  'wheel',
  (e) => {
    camDistance = Math.max(30, Math.min(3000, camDistance * (1 + e.deltaY * 0.001)));
    updateCamera();
  },
  { passive: true }
);

// 2. Simulation Engine & Subsystems
const world = new World(19440606);
const synchronizer = new SceneSynchronizer();
const entityRenderer = new EntityRenderer();
const gltfLoader = new GLTFLoader();
gltfLoader.setResourcePath(location.origin);

let terrainScene: THREE.Group | null = null;
let isLoaded = false;
let isSimulationPaused = false;
let simSpeedMultiplier = 1.0;
let rtsControls: RtsControls | null = null;

let activeMissionMeta: SkirmishMissionMeta = SKIRMISH_CATALOG[0];
let activeDifficulty: DifficultyKey = 'normal';

// 3. Audio & UI: Main Menu & Game HUD
const audioEngine = new AudioEngine();

const mainMenu = new MainMenu();
document.body.appendChild(mainMenu.container);

const gameHud = new GameHUD({
  onReturnToMenu: () => {
    isSimulationPaused = true;
    gameHud.hide();
    mainMenu.show();
    audioEngine.playMusic(MUSIC_TRACKS.mainTheme, true, 1.0);
  },
  onRestartMission: () => {
    if (activeMissionMeta) {
      void loadGameMission(activeMissionMeta.vpath, activeDifficulty);
    }
  },
  onPanCameraTo: (gemX, gemY) => {
    const pos = gemToThree(gemX, gemY, 0);
    camTarget.x = pos.x;
    camTarget.z = pos.z;
    audioEngine.listenerPos = [gemX, gemY];
    updateCamera();
  },
  onSetSimSpeed: (speed) => {
    simSpeedMultiplier = speed;
  },
  onTogglePause: () => {
    isSimulationPaused = !isSimulationPaused;
  },
});
document.body.appendChild(gameHud.container);
gameHud.hide();

mainMenu.onStartMission = (mission, difficulty) => {
  activeMissionMeta = mission;
  activeDifficulty = difficulty;
  history.replaceState(null, '', `?m=${encodeURIComponent(mission.vpath)}&diff=${difficulty}`);
  void loadGameMission(mission.vpath, difficulty);
};

export async function loadGameMission(missionPath: string, difficulty: DifficultyKey = 'normal') {
  isLoaded = false;
  isSimulationPaused = true;
  document.body.dataset.loaded = 'loading';
  gemRoot.clear();
  synchronizer.clear();

  mainMenu.showLoading(activeMissionMeta?.title || missionPath);
  mainMenu.updateProgress(10, 'Descargando terreno 3D…');

  const t0 = performance.now();
  try {
    // A. Load Terrain
    const terrainGltf = await gltfLoader.loadAsync(`/conv/terrain/${missionPath}.glb`);
    terrainScene = terrainGltf.scene;
    terrainScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) {
          m.forEach((mat) => {
            mat.side = THREE.DoubleSide;
          });
        } else if (m) {
          m.side = THREE.DoubleSide;
        }
      }
    });
    gemRoot.add(terrainScene);

    // Frame camera on terrain center
    gemRoot.updateMatrixWorld(true);
    const tBox = new THREE.Box3().setFromObject(terrainScene);
    const tCenter = tBox.getCenter(new THREE.Vector3());
    camTarget.copy(tCenter);
    camDistance = Math.min(Math.max(tBox.getSize(new THREE.Vector3()).x * 0.25, 250), 900);
    sun.position.set(tCenter.x + 1500, tCenter.y + 3000, tCenter.z + 1500);
    sun.target.position.copy(tCenter);
    updateCamera();

    // B. Load MissionDoc & Init Engine World
    mainMenu.updateProgress(35, 'Cargando documento de misión (0.mi)…');
    const doc = await loadMissionDoc(missionPath);
    world.initFromMission(doc, 19440606);
    const diffMap: Record<DifficultyKey, number> = { easy: 0, normal: 1, hard: 2, heroic: 3 };
    world.triggerVm.difficulty = diffMap[difficulty] ?? 1;

    // B2. Load 1m Navigation Grid (T08)
    try {
      mainMenu.updateProgress(50, 'Descargando rejilla de navegación 1 m…');
      const navRes = await fetch(`/conv/nav/${missionPath}.json`);
      if (navRes.ok) {
        const navDoc = (await navRes.json()) as NavGridDoc;
        world.navGrid = new NavGrid(navDoc);
      }
    } catch (e) {
      console.warn('[Nav] Failed to load navigation grid:', e);
    }

    // C. Pre-load Prototypes and Unique Models
    mainMenu.updateProgress(65, 'Resolviendo prototipos de unidades…');
    const uniqueProtos = new Map<string, { kind: 'entity' | 'human'; name: string }>();
    for (const ent of world.entities.values()) {
      uniqueProtos.set(`${ent.kind}:${ent.proto}`, { kind: ent.kind, name: ent.proto });
    }

    await Promise.all(
      Array.from(uniqueProtos.values()).map(async (p) => {
        await entityRenderer.getProto(p.kind, p.name);
      })
    );

    const uniqueModelPaths = new Set<string>();
    for (const p of uniqueProtos.values()) {
      const pDoc = entityRenderer.getProtoDoc(p.kind, p.name);
      if (pDoc?.model) uniqueModelPaths.add(pDoc.model);
    }

    mainMenu.updateProgress(80, 'Cargando mallas 3D y esqueletos…');
    await Promise.all(
      Array.from(uniqueModelPaths).map(async (mPath) => {
        await entityRenderer.getModel(mPath);
      })
    );

    // Preload all 7 core human animation clips into cache
    mainMenu.updateProgress(88, 'Precargando animaciones esqueléticas…');
    await Promise.all(
      Object.keys(CORE_ANIMATION_PATHS).map((k) =>
        loadAnimationClip(k).catch(() => null)
      )
    );

    // D. Raycast height & Create Visual Instances
    mainMenu.updateProgress(92, 'Desplegando tropas y blindados…');
    const raycaster = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);
    let visualInstancesCount = 0;

    for (const ent of world.entities.values()) {
      if (ent.transform.z === 0) {
        const rayOrigin = gemToThree(ent.transform.x, ent.transform.y, 5000);
        raycaster.set(rayOrigin, downDir);
        const hits = raycaster.intersectObject(terrainScene, true);
        if (hits.length > 0) {
          const hitGem = threeToGem(hits[0].point);
          ent.transform.z = hitGem[2];
          ent.transform.prevZ = hitGem[2];
        }
      }

      const instance = entityRenderer.createInstance(ent);
      if (instance) {
        gemRoot.add(instance);
        synchronizer.registerObject(ent.id, instance);
        if (ent.kind === 'human') {
          const animator = new HumanAnimationController(instance);
          void animator.play('idle');
          synchronizer.registerHumanAnimator(ent.id, animator);
        }
        visualInstancesCount++;
      }
    }

    // Dynamic spawner for newly called reinforcements and cloned squads
    world.eventBus.on('entity:spawned', async (ev: any) => {
      const ent = (ev.data ?? ev) as SimEntity;
      await entityRenderer.getProto(ent.kind, ent.proto);
      const protoDoc = entityRenderer.getProtoDoc(ent.kind, ent.proto);
      if (protoDoc?.model) {
        await entityRenderer.getModel(protoDoc.model);
      }
      if (terrainScene) {
        const rayOrigin = gemToThree(ent.transform.x, ent.transform.y, 5000);
        raycaster.set(rayOrigin, downDir);
        const hits = raycaster.intersectObject(terrainScene, true);
        if (hits.length > 0) {
          const hitGem = threeToGem(hits[0].point);
          ent.transform.z = hitGem[2];
          ent.transform.prevZ = hitGem[2];
        }
      }
      const instance = entityRenderer.createInstance(ent);
      if (instance) {
        gemRoot.add(instance);
        synchronizer.registerObject(ent.id, instance);
        if (ent.kind === 'human') {
          const animator = new HumanAnimationController(instance);
          void animator.play('idle');
          synchronizer.registerHumanAnimator(ent.id, animator);
        }
      }
    });

    gemRoot.updateMatrixWorld(true);

    if (rtsControls) {
      rtsControls.dispose();
    }
    rtsControls = new RtsControls({
      canvas: renderer.domElement,
      camera,
      scene,
      gemRoot,
      world,
      terrainScene: terrainScene!,
      playerIndex: 2, // Player side is Player 2 in skirmishes
      onSelectionChanged: (selected) => {
        gameHud.setSelectedEntities(selected);
      },
      onCameraFocus: (target) => {
        camTarget.copy(target);
        updateCamera();
      },
    });

    // Combat visual tracers and hit sparks
    world.eventBus.on('combat:fire', (ev: any) => {
      const data = ev.data ?? ev;
      if (!data) return;
      synchronizer.playShoot(data.shooterId);
      const s = world.getEntity(data.shooterId);
      const t = world.getEntity(data.targetId);
      if (s && t) {
        const p1 = gemToThree(s.transform.x, s.transform.y, s.transform.z + 15);
        const p2 = gemToThree(t.transform.x, t.transform.y, t.transform.z + 15);
        const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const mat = new THREE.LineBasicMaterial({ color: 0xffd32a, linewidth: 2 });
        const line = new THREE.Line(geom, mat);
        scene.add(line);
        setTimeout(() => {
          scene.remove(line);
          geom.dispose();
          mat.dispose();
        }, 300);
      }
    });

    world.eventBus.on('combat:hit', (ev: any) => {
      const hit = ev.data ?? ev;
      if (!hit || !hit.point) return;
      const p = gemToThree(hit.point[0], hit.point[1], hit.point[2] + 15);
      const sparkGeom = new THREE.SphereGeometry(hit.penetrated ? 4 : 2, 8, 8);
      const sparkMat = new THREE.MeshBasicMaterial({
        color: hit.penetrated ? 0xff3838 : 0xff9f1a,
      });
      const spark = new THREE.Mesh(sparkGeom, sparkMat);
      spark.position.copy(p);
      scene.add(spark);
      setTimeout(() => {
        scene.remove(spark);
        sparkGeom.dispose();
        sparkMat.dispose();
      }, 400);
    });

    // Skirmish events toasts
    world.eventBus.on('flag:securing', (ev: any) => {
      const data = ev.data ?? ev;
      if (data?.flag) {
        gameHud.showToast(`Capturando posición: ${data.flag}…`);
      }
    });
    world.eventBus.on('game:over', (ev: any) => {
      const data = ev.data ?? ev;
      if (!data) return;
      gameHud.showGameOverModal(data.result, data.message);
      if (data.result === 'win') {
        audioEngine.playMusic(MUSIC_TRACKS.victory, false, 0.5);
      } else {
        audioEngine.playMusic(MUSIC_TRACKS.defeat, false, 0.5);
      }
    });

    // Attach audio engine to simulation events
    audioEngine.attachToWorld(world);
    const factionTracks: Record<string, string> = {
      USA: MUSIC_TRACKS.usa,
      GER: MUSIC_TRACKS.ger,
      ENG: MUSIC_TRACKS.eng,
      RUS: MUSIC_TRACKS.rus,
      JAP: MUSIC_TRACKS.jap,
    };
    const factionTrack = factionTracks[activeMissionMeta?.faction || 'USA'] || MUSIC_TRACKS.bg1;
    audioEngine.playMusic(factionTrack, true, 1.5);

    mainMenu.updateProgress(100, '¡Listo para el combate!');
    setTimeout(() => {
      mainMenu.hideLoading();
      mainMenu.hide();
      gameHud.show();
      gameHud.setWorld(world, activeMissionMeta?.minimapUrl);
      isSimulationPaused = false;
      document.body.dataset.loaded = '1';
      isLoaded = true;
    }, 250);

    const ms = (performance.now() - t0).toFixed(0);
    console.log(`[OpenMoW-Web] Mission ${missionPath} loaded in ${ms} ms (${world.entities.size} entities)`);

    (window as any).__OPENMOW_GAME__ = {
      mission: missionPath,
      world,
      rtsControls,
      gameHud,
      mainMenu,
      audioEngine,
      entitiesCount: world.entities.size,
      visualsCount: visualInstancesCount,
      modelsLoaded: entityRenderer.getLoadedModelCount(),
      durationMs: Number(ms),
    };
  } catch (err) {
    mainMenu.updateProgress(100, `ERROR: ${String(err)}`);
    document.body.dataset.loaded = 'error';
    console.error(err);
  }
}

// 4. Fixed Timestep Simulation & Rendering Loop
let lastTimestamp = performance.now();
let accumulator = 0.0;
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 60;

renderer.setAnimationLoop((timestamp) => {
  const frameDt = Math.min((timestamp - lastTimestamp) / 1000.0, 0.1);
  lastTimestamp = timestamp;

  // FPS tracking
  frameCount++;
  if (timestamp - lastFpsTime >= 500) {
    currentFps = Math.round((frameCount * 1000) / (timestamp - lastFpsTime));
    frameCount = 0;
    lastFpsTime = timestamp;
  }

  // Camera Pan
  const moveSpeed = camDistance * 0.015;
  if (keys['w'] || keys['arrowup']) {
    camTarget.x -= Math.sin(camAzimuth) * moveSpeed;
    camTarget.z -= Math.cos(camAzimuth) * moveSpeed;
    updateCamera();
  }
  if (keys['s'] || keys['arrowdown']) {
    camTarget.x += Math.sin(camAzimuth) * moveSpeed;
    camTarget.z += Math.cos(camAzimuth) * moveSpeed;
    updateCamera();
  }
  if (keys['a'] || keys['arrowleft']) {
    camTarget.x -= Math.cos(camAzimuth) * moveSpeed;
    camTarget.z += Math.sin(camAzimuth) * moveSpeed;
    updateCamera();
  }
  if (keys['d'] || keys['arrowright']) {
    camTarget.x += Math.cos(camAzimuth) * moveSpeed;
    camTarget.z -= Math.sin(camAzimuth) * moveSpeed;
    updateCamera();
  }
  if (keys['q']) {
    camAzimuth += 0.02;
    updateCamera();
  }
  if (keys['e']) {
    camAzimuth -= 0.02;
    updateCamera();
  }

  if (isLoaded) {
    if (!isSimulationPaused) {
      accumulator += frameDt * simSpeedMultiplier;
      while (accumulator >= TICK_DT) {
        world.step(TICK_DT);
        accumulator -= TICK_DT;
      }
    }

    const alpha = accumulator / TICK_DT;
    synchronizer.interpolate(world, alpha, frameDt);
    rtsControls?.update();
    gameHud.update();

    if (debugOverlay && frameCount % 6 === 0) {
      debugOverlay.textContent = `Tick: ${world.tickIndex} (${TICK_RATE} Hz) · Sim: ${world.time.toFixed(1)}s · FPS: ${currentFps} · Entidades: ${world.entities.size} · Audio: ${audioEngine.decodedSoundsCount} dec / ${audioEngine.decoderErrors} err · Hash: ${world.computeStateHash()}`;
    }
  }

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Initialization
const initialMissionPath = params.get('m');
const shouldAutoplay = params.get('autoplay') === '1' || initialMissionPath !== null;

if (shouldAutoplay) {
  const match = SKIRMISH_CATALOG.find((m) => m.vpath === initialMissionPath) || SKIRMISH_CATALOG[0];
  activeMissionMeta = match;
  mainMenu.selectMission(match);
  void loadGameMission(match.vpath, (params.get('diff') as DifficultyKey) || 'normal');
} else {
  mainMenu.show();
  document.body.dataset.loaded = 'menu';
  audioEngine.playMusic(MUSIC_TRACKS.mainTheme, true, 1.0);
}
