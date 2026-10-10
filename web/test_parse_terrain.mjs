import fs from 'fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const buf = fs.readFileSync('C:/Users/jegom/.gemini/antigravity/scratch/openmow-web/.cache/terrain/30/30deaed9fe9afa998a3c0f0abd7f77c24caea7ca.glb');
console.log('Read cached GLB bytes:', buf.length);

const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader();

loader.parse(
  arrayBuffer,
  '',
  (gltf) => {
    console.log('SUCCESS! Loaded terrain scene with children:', gltf.scene.children.length);
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        console.log('Mesh found:', o.name, 'geometry:', o.geometry.attributes, 'indices count:', o.geometry.index?.count);
      }
    });
  },
  (err) => {
    console.error('ERROR parsing GLB:', err);
  }
);
