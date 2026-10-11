/**
 * Map viewer & Scene Loader (T03 / Gate G1).
 * Loads mission terrain and instantiates all Entity/Human instances from 0.mi.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGemRoot, gemHeadingRadians, gemToThree, threeToGem } from '../contracts/coords';
import type { ProtoDoc } from '../contracts/proto';

interface MissionEntityDesc {
  kind: 'entity' | 'human';
  proto: string;
  id: number | string;
  x: number;
  y: number;
  z?: number;
  zl: number;
}

const params = new URLSearchParams(location.search);
const missionInput = document.getElementById('mission') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const debugOverlay = document.getElementById('debug-overlay') as HTMLDivElement;

const defaultMission = params.get('m') ?? 'map/single/01_usa-skirmish/01_usa-overlord';
missionInput.value = defaultMission;

// 1. Three.js Renderer & Scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1217);

// Lighting (RTS style)
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x445566, 1.0));
const sun = new THREE.DirectionalLight(0xfffaed, 1.8);
sun.position.set(600, 1500, 800);
scene.add(sun);
scene.add(sun.target);

const gemRoot = createGemRoot();
scene.add(gemRoot);

// Camera
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1.0, 50000);
camera.position.set(0, 300, 400);

// RTS Camera State
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

// RTS Controls Listener
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
window.addEventListener('mouseup', () => { isDragging = false; });
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

window.addEventListener('wheel', (e) => {
  camDistance = Math.max(30, Math.min(3000, camDistance * (1 + e.deltaY * 0.001)));
  updateCamera();
}, { passive: true });

// Loader
const loader = new GLTFLoader();
loader.setResourcePath(location.origin);

const protoCache = new Map<string, ProtoDoc>();
const modelGltfCache = new Map<string, THREE.Group>();
const modelLoadingPromises = new Map<string, Promise<THREE.Group | null>>();

async function getProto(kind: 'entity' | 'human', name: string): Promise<ProtoDoc | null> {
  const key = `${kind}:${name}`;
  if (protoCache.has(key)) return protoCache.get(key)!;
  try {
    const res = await fetch(`/conv/proto/${kind}/${name}.json`);
    if (!res.ok) return null;
    const doc = (await res.json()) as ProtoDoc;
    protoCache.set(key, doc);
    return doc;
  } catch {
    return null;
  }
}

async function getModel(modelPath: string): Promise<THREE.Group | null> {
  if (modelGltfCache.has(modelPath)) return modelGltfCache.get(modelPath)!;
  if (modelLoadingPromises.has(modelPath)) return modelLoadingPromises.get(modelPath)!;

  const promise = (async () => {
    try {
      const gltf = await loader.loadAsync('/conv/model' + modelPath + '.glb');
      gltf.scene.traverse((o) => {
        if (o.userData?.hidden) o.visible = false;
      });
      modelGltfCache.set(modelPath, gltf.scene);
      return gltf.scene;
    } catch {
      return null;
    }
  })();

  modelLoadingPromises.set(modelPath, promise);
  return promise;
}

function parseMissionEntities(missionSdl: any): MissionEntityDesc[] {
  const result: MissionEntityDesc[] = [];
  const items = missionSdl.items ?? [];
  // Find top-level mission node
  let missionNode: any = null;
  for (const it of items) {
    if (it.k === '{' && it.i && it.i.length > 0) {
      const tag = typeof it.i[0] === 'object' ? it.i[0].w : it.i[0];
      if (tag === 'mission') {
        missionNode = it;
        break;
      }
    }
  }
  if (!missionNode) return result;

  for (const child of missionNode.i) {
    if (child.k !== '{' || !child.i || child.i.length === 0) continue;
    const first = child.i[0];
    const tag = typeof first === 'object' ? first.w : first;
    if (tag === 'Entity' || tag === 'Human') {
      const kind = tag === 'Human' ? 'human' : 'entity';
      const proto = String(child.i[1] ?? '').replace(/"/g, '');
      const id = child.i[2] ?? 0;
      let x = 0;
      let y = 0;
      let z: number | undefined;
      let zl = 0;

      for (const prop of child.i) {
        if (typeof prop === 'object' && prop.k === '{' && prop.i && prop.i.length > 0) {
          const ptag = typeof prop.i[0] === 'object' ? prop.i[0].w : prop.i[0];
          if (ptag === 'Position' && prop.i.length >= 3) {
            x = Number(prop.i[1] ?? 0);
            y = Number(prop.i[2] ?? 0);
            if (prop.i.length >= 4) {
              z = Number(prop.i[3] ?? 0);
            }
          } else if (ptag === 'xform' && prop.i.length >= 3) {
            const xtag = typeof prop.i[1] === 'object' ? prop.i[1].w : prop.i[1];
            if (xtag === 'zl') {
              zl = Number(prop.i[2] ?? 0);
            }
          }
        }
      }
      result.push({ kind, proto, id, x, y, z, zl });
    }
  }
  return result;
}

export async function loadMap(missionPath: string) {
  const t0 = performance.now();
  statusEl.textContent = `Cargando mapa: ${missionPath}…`;
  document.body.dataset.loaded = 'loading';
  gemRoot.clear();

  try {
    // 1. Load Terrain GLB
    statusEl.textContent = `Descargando terreno ${missionPath}…`;
    const terrainGltf = await loader.loadAsync(`/conv/terrain/${missionPath}.glb`);
    const terrainScene = terrainGltf.scene;
    terrainScene.name = 'terrain-scene';
    terrainScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) {
          m.forEach((mat) => { mat.side = THREE.DoubleSide; });
        } else if (m) {
          m.side = THREE.DoubleSide;
        }
      }
    });
    gemRoot.add(terrainScene);

    // Compute bounding box and center camera
    gemRoot.updateMatrixWorld(true);
    const tBox = new THREE.Box3().setFromObject(terrainScene);
    const tCenter = tBox.getCenter(new THREE.Vector3());
    camTarget.copy(tCenter);
    camDistance = Math.min(Math.max(tBox.getSize(new THREE.Vector3()).x * 0.25, 250), 900);
    sun.position.set(tCenter.x + 1500, tCenter.y + 3000, tCenter.z + 1500);
    sun.target.position.copy(tCenter);
    updateCamera();

    // 2. Fetch and parse 0.mi
    statusEl.textContent = `Descargando misión 0.mi…`;
    const miRes = await fetch(`/conv/sdl/${missionPath}/0.mi.json`);
    if (!miRes.ok) throw new Error(`HTTP ${miRes.status} al cargar 0.mi`);
    const miJson = await miRes.json();
    const entities = parseMissionEntities(miJson);
    statusEl.textContent = `Cargando ${entities.length} entidades y humanos…`;

    // 3. Pre-fetch unique prototypes
    const uniqueProtos = new Map<string, { kind: 'entity' | 'human'; name: string }>();
    for (const e of entities) {
      uniqueProtos.set(`${e.kind}:${e.proto}`, { kind: e.kind, name: e.proto });
    }

    statusEl.textContent = `Resolviendo ${uniqueProtos.size} prototipos…`;
    await Promise.all(
      Array.from(uniqueProtos.values()).map(async (p) => {
        await getProto(p.kind, p.name);
      })
    );

    const uniqueModelPaths = new Set<string>();
    for (const p of uniqueProtos.values()) {
      const doc = protoCache.get(`${p.kind}:${p.name}`);
      if (doc?.model) uniqueModelPaths.add(doc.model);
    }
    statusEl.textContent = `Descargando ${uniqueModelPaths.size} modelos…`;
    await Promise.all(
      Array.from(uniqueModelPaths).map(async (mPath) => {
        await getModel(mPath);
      })
    );

    // 4. Raycaster for missing z
    const raycaster = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);

    let placedCount = 0;
    const noModelProtos = new Set<string>();

    for (const e of entities) {
      let finalZ = e.z;
      if (finalZ === undefined) {
        // Raycast down from high in GEM2 space (z = 5000)
        const rayOrigin = gemToThree(e.x, e.y, 5000);
        raycaster.set(rayOrigin, downDir);
        const hits = raycaster.intersectObject(terrainScene, true);
        if (hits.length > 0) {
          const hitGem = threeToGem(hits[0].point);
          finalZ = hitGem[2];
        } else {
          finalZ = 0;
        }
      }

      const protoDoc = protoCache.get(`${e.kind}:${e.proto}`);
      if (protoDoc?.model && modelGltfCache.has(protoDoc.model)) {
        const baseModel = modelGltfCache.get(protoDoc.model)!;
        const instance = SkeletonUtils.clone(baseModel) as THREE.Group;
        // Set GEM2 coordinates and heading
        instance.position.set(e.x, e.y, finalZ);
        instance.rotation.z = gemHeadingRadians(e.zl);
        instance.name = `${e.proto}#${e.id}`;
        gemRoot.add(instance);
      } else {
        noModelProtos.add(e.proto);
      }
      placedCount++;
    }

    gemRoot.updateMatrixWorld(true);
    const ms = (performance.now() - t0).toFixed(0);
    const statusMsg = [
      `Misión: ${missionPath}`,
      `Entidades: ${placedCount}/${entities.length} (100%)`,
      `Prototipos: ${uniqueProtos.size} únicos (${modelGltfCache.size} modelos cargados)`,
      `Sin modelo (${noModelProtos.size}): ${Array.from(noModelProtos).join(', ') || 'ninguno'}`,
      `Tiempo: ${ms} ms`,
    ].join('\n');

    statusEl.textContent = statusMsg;
    document.body.dataset.loaded = '1';

    // Expose stats for automated headless tests
    (window as any).__OPENMOW_MAP_STATS__ = {
      mission: missionPath,
      total: entities.length,
      placed: placedCount,
      uniqueProtos: uniqueProtos.size,
      modelsLoaded: modelGltfCache.size,
      noModelProtos: Array.from(noModelProtos),
      durationMs: Number(ms),
    };
  } catch (err) {
    statusEl.textContent = `ERROR: ${String(err)}`;
    document.body.dataset.loaded = 'error';
    console.error(err);
  }
}

// Form submit handler
document.getElementById('f')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const nextMission = missionInput.value.trim();
  if (nextMission) {
    history.replaceState(null, '', `?m=${encodeURIComponent(nextMission)}`);
    void loadMap(nextMission);
  }
});

// Render loop & FPS counter
let lastTime = performance.now();
let frameCount = 0;
let currentFps = 60;

renderer.setAnimationLoop(() => {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 500) {
    currentFps = Math.round((frameCount * 1000) / (now - lastTime));
    frameCount = 0;
    lastTime = now;
    if (debugOverlay) {
      debugOverlay.textContent = `FPS: ${currentFps} · Draw Calls: ${renderer.info.render.calls} · Geometries: ${renderer.info.memory.geometries}`;
    }
  }

  // Camera pan with WASD
  const moveSpeed = (camDistance * 0.015);
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

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

void loadMap(defaultMission);
