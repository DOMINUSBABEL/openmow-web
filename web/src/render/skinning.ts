/**
 * Human Skinning & Animation System (T06 / Gate G2).
 * Binds GEM2 EPLYBNDS skinned meshes with bone hierarchies and plays EANM clips via Three.js.
 */
import * as THREE from 'three';

export const CORE_ANIMATION_PATHS = {
  idle: '/properties/animation/human/idle_stand_1',
  walk: '/properties/animation/human/walk_gun_up',
  run: '/properties/animation/human/run_gun_up',
  crouch: '/properties/animation/human/squat_fire_gun',
  prone: '/properties/animation/human/crawl_gun',
  shoot: '/properties/animation/human/stand_fire_gun_up',
  die: '/properties/animation/human/stand_die_front_1',
} as const;

export type CoreAnimAction = keyof typeof CORE_ANIMATION_PATHS;

/**
 * Searches the object hierarchy for skinned meshes and binds them to the skeleton.
 * Replaces static THREE.Mesh instances that possess skinIndex and extras.skin with THREE.SkinnedMesh.
 */
export function bindHumanSkin(root: THREE.Object3D): THREE.SkinnedMesh[] {
  root.updateMatrixWorld(true);

  // Map all bones/nodes by name
  const boneMap = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (obj.name) {
      boneMap.set(obj.name, obj);
    }
  });

  const boundMeshes: THREE.SkinnedMesh[] = [];
  const meshesToReplace: THREE.Mesh[] = [];

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const skinBoneNames: string[] | undefined = mesh.userData?.skin;
      if (skinBoneNames && Array.isArray(skinBoneNames) && mesh.geometry.attributes.skinIndex) {
        meshesToReplace.push(mesh);
      }
    }
  });

  for (const mesh of meshesToReplace) {
    const skinBoneNames: string[] = mesh.userData.skin;
    const bones: THREE.Bone[] = [];
    const invBindMatrices: THREE.Matrix4[] = [];

    // Find bones in exact order declared in mesh.userData.skin
    for (const bName of skinBoneNames) {
      let boneNode = boneMap.get(bName);
      if (!boneNode) {
        // Fallback: create empty bone under root if missing
        boneNode = new THREE.Bone();
        boneNode.name = bName;
        root.add(boneNode);
        boneMap.set(bName, boneNode);
      }

      // Convert to THREE.Bone if it's a generic Object3D
      if (!(boneNode as THREE.Bone).isBone) {
        (boneNode as any).isBone = true;
      }
      bones.push(boneNode as THREE.Bone);

      // Compute inverse bind matrix from bind-pose world transform
      boneNode.updateWorldMatrix(true, false);
      const invBind = boneNode.matrixWorld.clone().invert();
      invBindMatrices.push(invBind);
    }

    // Defensive check: ensure skeleton has at least as many bones as the max skinIndex
    const skinIndexAttr = mesh.geometry.attributes.skinIndex;
    if (skinIndexAttr) {
      let maxIdx = 0;
      for (let i = 0; i < skinIndexAttr.count; i++) {
        maxIdx = Math.max(maxIdx, skinIndexAttr.getX(i), skinIndexAttr.getY(i), skinIndexAttr.getZ(i), skinIndexAttr.getW(i));
      }
      while (bones.length <= maxIdx) {
        const dummyBone = new THREE.Bone();
        dummyBone.name = `dummy_bone_${bones.length}`;
        root.add(dummyBone);
        bones.push(dummyBone);
        dummyBone.updateWorldMatrix(true, false);
        invBindMatrices.push(dummyBone.matrixWorld.clone().invert());
      }
    }

    const skeleton = new THREE.Skeleton(bones, invBindMatrices);
    const skinnedMesh = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
    skinnedMesh.name = mesh.name + '_skinned';
    skinnedMesh.userData = { ...mesh.userData };
    skinnedMesh.position.copy(mesh.position);
    skinnedMesh.quaternion.copy(mesh.quaternion);
    skinnedMesh.scale.copy(mesh.scale);
    skinnedMesh.frustumCulled = false;

    const parent = mesh.parent ?? root;
    parent.add(skinnedMesh);
    parent.remove(mesh);

    root.updateMatrixWorld(true);
    skinnedMesh.bind(skeleton, skinnedMesh.matrixWorld);
    boundMeshes.push(skinnedMesh);
  }

  return boundMeshes;
}

const animClipCache = new Map<string, THREE.AnimationClip>();

/**
 * Fetch and parse an EANM animation clip from the asset server.
 */
export async function loadAnimationClip(pathOrAction: string, fps = 25.0): Promise<THREE.AnimationClip> {
  const urlPath = CORE_ANIMATION_PATHS[pathOrAction as CoreAnimAction] ?? pathOrAction;
  const cleanPath = urlPath.replace(/\.anm$|\.json$/, '');
  const cacheKey = `${cleanPath}?fps=${fps}`;

  if (animClipCache.has(cacheKey)) {
    return animClipCache.get(cacheKey)!;
  }

  const res = await fetch(`/conv/anim${cleanPath}.json?fps=${fps}`);
  if (!res.ok) {
    throw new Error(`Failed to load animation ${cleanPath}: HTTP ${res.status}`);
  }

  const json = await res.json();
  const clip = THREE.AnimationClip.parse(json);
  animClipCache.set(cacheKey, clip);
  return clip;
}

export class HumanAnimationController {
  mixer: THREE.AnimationMixer;
  currentAction: THREE.AnimationAction | null = null;
  currentActionName = '';
  clips = new Map<string, THREE.AnimationClip>();
  private existingNodes = new Set<string>();

  constructor(public root: THREE.Object3D) {
    bindHumanSkin(root);
    this.mixer = new THREE.AnimationMixer(root);
    root.traverse((o) => {
      if (o.name) {
        this.existingNodes.add(o.name);
      }
    });
  }

  async play(actionName: CoreAnimAction | string, crossFadeDuration = 0.25): Promise<THREE.AnimationAction> {
    let clip = this.clips.get(actionName);
    if (!clip) {
      const rawClip = await loadAnimationClip(actionName);
      // Filter out tracks for non-existent nodes (e.g. ik_chain*) to prevent Three.js PropertyBinding warnings
      const validTracks = rawClip.tracks.filter((t) => {
        const dotIdx = t.name.indexOf('.');
        const nodeName = dotIdx >= 0 ? t.name.slice(0, dotIdx) : t.name;
        return this.existingNodes.has(nodeName);
      });
      clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, validTracks);
      this.clips.set(actionName, clip);
    }

    const nextAction = this.mixer.clipAction(clip);
    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(crossFadeDuration);
      nextAction.reset().fadeIn(crossFadeDuration).play();
    } else {
      nextAction.reset().play();
    }

    this.currentAction = nextAction;
    this.currentActionName = actionName;
    return nextAction;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}
