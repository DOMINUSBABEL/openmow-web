import * as THREE from 'three';
import { gemHeadingRadians } from '../contracts/coords';
import type { World } from '../engine/world';
import type { HumanAnimationController } from './skinning';

export function lerpAngleDegrees(a: number, b: number, t: number): number {
  let diff = (b - a) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return a + diff * t;
}

export class SceneSynchronizer {
  private meshMap = new Map<number, THREE.Object3D>();
  private humanAnimators = new Map<number, HumanAnimationController>();

  /** Register a Three.js scene object associated with an entity ID */
  registerObject(entityId: number, object: THREE.Object3D) {
    this.meshMap.set(entityId, object);
  }

  /** Register a human animation controller associated with an entity ID */
  registerHumanAnimator(entityId: number, animator: HumanAnimationController) {
    this.humanAnimators.set(entityId, animator);
  }

  /** Trigger shoot animation on a specific human entity */
  playShoot(entityId: number) {
    const animator = this.humanAnimators.get(entityId);
    if (animator) {
      void animator.play('shoot', 0.08);
      setTimeout(() => {
        if (animator.currentActionName === 'shoot') {
          void animator.play('idle', 0.2);
        }
      }, 450);
    }
  }

  /** Unregister an entity object and its animator */
  unregisterObject(entityId: number) {
    this.meshMap.delete(entityId);
    this.humanAnimators.delete(entityId);
  }

  /** Clear all object bindings */
  clear() {
    this.meshMap.clear();
    this.humanAnimators.clear();
  }

  /**
   * Update visual transforms in the Three.js scene using linear interpolation between
   * previous tick and current tick transforms, and advance skeletal animation.
   * @param world The simulation world
   * @param alpha Interpolation factor in [0, 1]
   * @param dt Frame time in seconds for animation mixer advancement
   */
  interpolate(world: World, alpha: number, dt = 0.016) {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    for (const [id, obj] of this.meshMap.entries()) {
      const ent = world.entities.get(id);
      if (!ent) continue;

      const tf = ent.transform;
      // Interpolate in GEM2 coordinate space
      const ix = tf.prevX + (tf.x - tf.prevX) * clampedAlpha;
      const iy = tf.prevY + (tf.y - tf.prevY) * clampedAlpha;
      const iz = tf.prevZ + (tf.z - tf.prevZ) * clampedAlpha;
      const izl = lerpAngleDegrees(tf.prevZl, tf.zl, clampedAlpha);

      obj.position.set(ix, iy, iz);
      obj.rotation.z = gemHeadingRadians(izl);

      // Vehicle turret & gun rotation
      if (ent.turret) {
        const turretName = ent.turret.turretBone ?? 'turret';
        const turretBone = obj.getObjectByName(turretName);
        if (turretBone) {
          turretBone.rotation.z = -ent.turret.turretYaw * (Math.PI / 180);
        }
        const gunName = ent.turret.gunBone ?? 'gun_rot';
        const gunBone = obj.getObjectByName(gunName);
        if (gunBone) {
          gunBone.rotation.x = -ent.turret.gunPitch * (Math.PI / 180);
        }
      }

      // Visibility: hide units tagged 'hidden' (reinforcement templates)
      if (ent.tags.has('hidden')) {
        obj.visible = false;
      } else if (ent.crew?.vehicleId) {
        const seat = ent.crew.seat ?? '';
        const isEnclosed = ['driver', 'gunner', 'commander', 'charger', 'gunner2', 'gunner3'].includes(seat);
        obj.visible = !isEnclosed;
      } else {
        obj.visible = true;
      }

      // Human skeletal animation updates
      const animator = this.humanAnimators.get(id);
      if (animator) {
        const isMoving = ent.movement.currentSpeed > 0.5 || ent.movement.order !== undefined;
        if (!ent.health.alive) {
          if (animator.currentActionName !== 'die') {
            void animator.play('die', 0.1);
          }
        } else if (isMoving) {
          if (ent.movement.posture === 'prone') {
            if (animator.currentActionName !== 'prone') void animator.play('prone', 0.2);
          } else if (ent.movement.currentSpeed > 35 || ent.brain.aiMoveMode === 'assault') {
            if (animator.currentActionName !== 'run') void animator.play('run', 0.2);
          } else {
            if (animator.currentActionName !== 'walk') void animator.play('walk', 0.2);
          }
        } else {
          if (ent.movement.posture === 'prone') {
            if (animator.currentActionName !== 'prone') void animator.play('prone', 0.2);
          } else if (ent.movement.posture === 'crouch') {
            if (animator.currentActionName !== 'crouch') void animator.play('crouch', 0.2);
          } else {
            if (animator.currentActionName !== 'idle' && animator.currentActionName !== 'shoot') {
              void animator.play('idle', 0.25);
            }
          }
        }
        animator.update(dt);
      }
    }
  }
}
