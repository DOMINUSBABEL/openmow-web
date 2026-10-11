/** Model viewer: /viewer.html?model=/entity/.../x.def  (dev tool, gate G0/G1/G2). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGemRoot } from '../contracts/coords';
import { HumanAnimationController } from '../render/skinning';

const params = new URLSearchParams(location.search);
const input = document.getElementById('model') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const animSelect = document.getElementById('anim-select') as HTMLSelectElement;

input.value = params.get('model') ?? '/entity/-vehicle/tank_heavy/jagdtiger/jagdtiger.def';
const defaultAnim = params.get('anim') ?? 'idle';
if (animSelect) {
  animSelect.value = defaultAnim;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10161d);
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3226, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(300, 500, 200);
scene.add(sun);
const grid = new THREE.GridHelper(400, 20, 0x2c3a4a, 0x1b2430); // 20 units = 1 m
scene.add(grid);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 20000);
camera.position.set(120, 90, 160);
const controls = new OrbitControls(camera, renderer.domElement);

const gemRoot = createGemRoot();
scene.add(gemRoot);
const loader = new GLTFLoader();
loader.setResourcePath(location.origin);

let animController: HumanAnimationController | null = null;
const clock = new THREE.Clock();

async function load(path: string) {
  statusEl.textContent = 'cargando ' + path;
  gemRoot.clear();
  animController = null;
  const t0 = performance.now();
  try {
    const gltf = await loader.loadAsync('/conv/model' + path + '.glb');
    let meshes = 0;
    let hidden = 0;
    let hasSkin = false;
    const only = params.get('only');

    gltf.scene.traverse((o) => {
      if (o.userData?.hidden) { o.visible = false; hidden++; }
      if ((o as THREE.Mesh).isMesh) {
        meshes++;
        if (o.userData?.skin || (o as THREE.Mesh).geometry?.attributes?.skinIndex) {
          hasSkin = true;
        }
        if (only) {
          let p: THREE.Object3D | null = o;
          let hit = false;
          while (p) { if (p.name.includes(only)) hit = true; p = p.parent; }
          if (!hit) o.visible = false;
        }
      }
    });

    gemRoot.add(gltf.scene);
    gemRoot.updateMatrixWorld(true);

    if (hasSkin) {
      animController = new HumanAnimationController(gltf.scene);
      const chosenAnim = animSelect ? animSelect.value : 'idle';
      if (chosenAnim && chosenAnim !== 'none') {
        try {
          await animController.play(chosenAnim);
        } catch (err) {
          console.warn('Could not auto-play animation:', err);
        }
      }
    }

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    const r = Math.max(size.x, size.y, size.z, 20);
    const az = (Number(params.get('az') ?? '40') * Math.PI) / 180;
    const el = (Number(params.get('el') ?? '30') * Math.PI) / 180;
    const d = r * 1.8;
    camera.position.copy(center).add(new THREE.Vector3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d));
    controls.update();

    const ms = (performance.now() - t0).toFixed(0);
    const skinStatus = hasSkin ? ` · Skinned (${animController?.currentActionName || 'pose base'})` : '';
    statusEl.textContent = `${path}\nmeshes ${meshes} · ocultos ${hidden}${skinStatus} · tamaño ${(size.x / 20).toFixed(2)}×${(size.y / 20).toFixed(2)}×${(size.z / 20).toFixed(2)} m · ${ms} ms`;
    document.body.dataset.loaded = '1';
  } catch (e: any) {
    statusEl.textContent = 'ERROR ' + (e?.stack || String(e));
    document.body.dataset.loaded = 'error';
  }
}

animSelect?.addEventListener('change', () => {
  if (animController) {
    if (animSelect.value === 'none') {
      animController.currentAction?.stop();
      animController.currentAction = null;
      animController.currentActionName = 'pose base';
    } else {
      void animController.play(animSelect.value);
    }
  }
});

document.getElementById('f')!.addEventListener('submit', (ev) => {
  ev.preventDefault();
  history.replaceState(null, '', '?model=' + encodeURIComponent(input.value) + '&anim=' + encodeURIComponent(animSelect.value));
  void load(input.value);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (animController) {
    animController.update(dt);
  }
  controls.update();
  renderer.render(scene, camera);
});

void load(input.value);
