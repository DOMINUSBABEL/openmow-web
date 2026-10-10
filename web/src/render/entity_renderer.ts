/**
 * Entity & Model Renderer for OpenMoW-Web.
 * Loads, caches, and instantiates Three.js representations of GEM2 prototypes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { gemHeadingRadians } from '../contracts/coords';
import type { ProtoDoc } from '../contracts/proto';
import type { SimEntity } from '../engine/components';
import { bindHumanSkin } from './skinning';

export class EntityRenderer {
  private loader: GLTFLoader;
  private protoCache = new Map<string, ProtoDoc>();
  private modelCache = new Map<string, THREE.Group>();
  private modelPromises = new Map<string, Promise<THREE.Group | null>>();

  constructor() {
    this.loader = new GLTFLoader();
    this.loader.setResourcePath(location.origin);
  }

  async getProto(kind: 'entity' | 'human', name: string): Promise<ProtoDoc | null> {
    const key = `${kind}:${name}`;
    if (this.protoCache.has(key)) return this.protoCache.get(key)!;
    try {
      const res = await fetch(`/conv/proto/${kind}/${name}.json`);
      if (!res.ok) return null;
      const doc = (await res.json()) as ProtoDoc;
      this.protoCache.set(key, doc);
      return doc;
    } catch {
      return null;
    }
  }

  async getModel(modelPath: string): Promise<THREE.Group | null> {
    if (this.modelCache.has(modelPath)) return this.modelCache.get(modelPath)!;
    if (this.modelPromises.has(modelPath)) return this.modelPromises.get(modelPath)!;

    const promise = (async () => {
      try {
        const gltf = await this.loader.loadAsync('/conv/model' + modelPath + '.glb');
        gltf.scene.traverse((o) => {
          if (o.userData?.hidden) o.visible = false;
        });
        this.modelCache.set(modelPath, gltf.scene);
        return gltf.scene;
      } catch {
        return null;
      }
    })();

    this.modelPromises.set(modelPath, promise);
    return promise;
  }

  createInstance(entity: SimEntity): THREE.Group | null {
    const protoDoc = this.protoCache.get(`${entity.kind}:${entity.proto}`);
    if (!protoDoc?.model || !this.modelCache.has(protoDoc.model)) return null;

    const baseModel = this.modelCache.get(protoDoc.model)!;
    const instance = SkeletonUtils.clone(baseModel) as THREE.Group;
    instance.name = `${entity.proto}#${entity.id}`;
    instance.position.set(entity.transform.x, entity.transform.y, entity.transform.z);
    instance.rotation.z = gemHeadingRadians(entity.transform.zl);

    if (entity.kind === 'human') {
      bindHumanSkin(instance);
    }
    return instance;
  }

  getProtoDoc(kind: 'entity' | 'human', name: string): ProtoDoc | undefined {
    return this.protoCache.get(`${kind}:${name}`);
  }

  getLoadedModelCount(): number {
    return this.modelCache.size;
  }
}
