import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bindHumanSkin, CORE_ANIMATION_PATHS, HumanAnimationController } from '../src/render/skinning';

describe('Human Skinning & Animation System (T06 / Gate G2)', () => {
  it('declares all 7 core human animation paths', () => {
    const actions = ['idle', 'walk', 'run', 'crouch', 'prone', 'shoot', 'die'] as const;
    for (const a of actions) {
      expect(CORE_ANIMATION_PATHS[a]).toBeDefined();
      expect(typeof CORE_ANIMATION_PATHS[a]).toBe('string');
      expect(CORE_ANIMATION_PATHS[a].startsWith('/properties/animation/human/')).toBe(true);
    }
  });

  it('binds skinned mesh with bone hierarchy and creates THREE.SkinnedMesh', () => {
    const root = new THREE.Object3D();
    root.name = 'root';

    // Create a mock bone hierarchy matching GEM2 human skeleton
    const basis = new THREE.Bone(); basis.name = 'basis';
    const body = new THREE.Bone(); body.name = 'body';
    const head = new THREE.Bone(); head.name = 'head';
    const foot1l = new THREE.Bone(); foot1l.name = 'foot1l';
    const foot1r = new THREE.Bone(); foot1r.name = 'foot1r';

    root.add(basis);
    basis.add(body);
    body.add(head);
    body.add(foot1l);
    body.add(foot1r);

    // Create a mesh with skinIndex and userData.skin
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([
      0, 0, 0,
      0, 10, 0,
      0, 20, 0,
    ]);
    const skinIndices = new Uint16Array([
      0, 0, 0, 0,
      1, 0, 0, 0,
      2, 0, 0, 0,
    ]);
    const skinWeights = new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));

    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'soldier_skin';
    mesh.userData = {
      skin: ['basis', 'body', 'head'],
    };
    body.add(mesh);

    const bound = bindHumanSkin(root);
    expect(bound.length).toBe(1);

    const skinned = bound[0];
    expect(skinned.isSkinnedMesh).toBe(true);
    expect(skinned.skeleton).toBeDefined();
    expect(skinned.skeleton.bones.length).toBeGreaterThanOrEqual(3);
    expect(skinned.skeleton.bones[0].name).toBe('basis');
    expect(skinned.skeleton.bones[1].name).toBe('body');
    expect(skinned.skeleton.bones[2].name).toBe('head');

    // Verify Box3 computeBoundingBox works without undefined matrixWorld errors
    const box = new THREE.Box3().setFromObject(root);
    expect(box.isEmpty()).toBe(false);
  });

  it('safely handles joint indices larger than skin bone count by creating dummy bones', () => {
    const root = new THREE.Object3D();
    const body = new THREE.Bone(); body.name = 'body';
    root.add(body);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    // Index 5 is larger than declared skin array of length 1
    geom.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([5, 0, 0, 0]), 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0]), 4));

    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    mesh.userData = { skin: ['body'] };
    body.add(mesh);

    const bound = bindHumanSkin(root);
    expect(bound.length).toBe(1);
    expect(bound[0].skeleton.bones.length).toBeGreaterThanOrEqual(6);

    // Box calculation must not throw
    expect(() => new THREE.Box3().setFromObject(root)).not.toThrow();
  });
});
