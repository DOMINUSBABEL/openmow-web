/**
 * RTS Control System & Unit Selection (T07 / Gate G2).
 * Handles click, marquee box selection, double-click type selection,
 * control groups Ctrl+1..9, right-click move orders, and stance keybindings.
 */
import * as THREE from 'three';
import type { World } from '../engine/world';
import type { SimEntity } from '../engine/components';
import { issueMoveOrder, issueAttackOrder, issuePostureOrder, issueStopOrder } from '../engine/orders';
import { gemToThree, threeToGem } from '../contracts/coords';

export interface RtsControlOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  gemRoot: THREE.Object3D;
  world: World;
  terrainScene: THREE.Object3D;
  playerIndex?: number;
  onSelectionChanged?: (selected: SimEntity[]) => void;
  onCameraFocus?: (target: THREE.Vector3) => void;
}

export class RtsControls {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  gemRoot: THREE.Object3D;
  world: World;
  terrainScene: THREE.Object3D;
  playerIndex: number;
  onSelectionChanged?: (selected: SimEntity[]) => void;
  onCameraFocus?: (target: THREE.Vector3) => void;

  selectedIds = new Set<number>();
  controlGroups = new Map<number, Set<number>>();

  // Drag box selection state
  isBoxSelecting = false;
  boxStartX = 0;
  boxStartY = 0;
  boxCurrentX = 0;
  boxCurrentY = 0;
  boxElement: HTMLDivElement;

  // Selection rings in 3D scene
  selectionRings = new Map<number, THREE.Mesh>();
  ringGeometry: THREE.RingGeometry;
  ringMaterial: THREE.MeshBasicMaterial;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor(opts: RtsControlOptions) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.scene = opts.scene;
    this.gemRoot = opts.gemRoot;
    this.world = opts.world;
    this.terrainScene = opts.terrainScene;
    this.playerIndex = opts.playerIndex ?? 0;
    this.onSelectionChanged = opts.onSelectionChanged;
    this.onCameraFocus = opts.onCameraFocus;

    // DOM Drag box element
    this.boxElement = document.createElement('div');
    this.boxElement.id = 'rts-selection-box';
    this.boxElement.style.position = 'fixed';
    this.boxElement.style.border = '1px solid #48dbfb';
    this.boxElement.style.backgroundColor = 'rgba(72, 219, 251, 0.15)';
    this.boxElement.style.pointerEvents = 'none';
    this.boxElement.style.display = 'none';
    this.boxElement.style.zIndex = '999';
    document.body.appendChild(this.boxElement);

    // 3D Selection Ring (flat ring decal on ground)
    this.ringGeometry = new THREE.RingGeometry(10, 13, 32);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x48dbfb,
      side: THREE.DoubleSide,
      depthTest: true,
      transparent: true,
      opacity: 0.85,
    });

    this.bindEvents();
  }

  private bindEvents() {
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button === 0) {
      // Left click / start box selection
      this.isBoxSelecting = true;
      this.boxStartX = e.clientX;
      this.boxStartY = e.clientY;
      this.boxCurrentX = e.clientX;
      this.boxCurrentY = e.clientY;
      this.updateBoxElement();
    } else if (e.button === 2) {
      // Right click / Move order
      this.handleRightClickOrder(e);
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isBoxSelecting) {
      this.boxCurrentX = e.clientX;
      this.boxCurrentY = e.clientY;
      const dx = Math.abs(this.boxCurrentX - this.boxStartX);
      const dy = Math.abs(this.boxCurrentY - this.boxStartY);
      if (dx > 4 || dy > 4) {
        this.boxElement.style.display = 'block';
        this.updateBoxElement();
      }
    }
  }

  private updateBoxElement() {
    const left = Math.min(this.boxStartX, this.boxCurrentX);
    const top = Math.min(this.boxStartY, this.boxCurrentY);
    const width = Math.abs(this.boxCurrentX - this.boxStartX);
    const height = Math.abs(this.boxCurrentY - this.boxStartY);

    this.boxElement.style.left = `${left}px`;
    this.boxElement.style.top = `${top}px`;
    this.boxElement.style.width = `${width}px`;
    this.boxElement.style.height = `${height}px`;
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 0 && this.isBoxSelecting) {
      this.isBoxSelecting = false;
      this.boxElement.style.display = 'none';

      const dx = Math.abs(this.boxCurrentX - this.boxStartX);
      const dy = Math.abs(this.boxCurrentY - this.boxStartY);

      if (dx > 6 || dy > 6) {
        // Drag box selection finished
        this.finishBoxSelection(e.shiftKey);
      } else {
        // Single click selection
        this.handleSingleClickSelection(e);
      }
    }
  }

  private handleSingleClickSelection(e: MouseEvent) {
    this.updateRaycaster(e.clientX, e.clientY);

    // 1. Check screen-space proximity to player units (crisp, pixel-based picking)
    const proj = new THREE.Vector3();
    let nearestEnt: SimEntity | null = null;
    let minScreenDist = 28; // pixels

    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;
      if (ent.owner.player !== this.playerIndex) continue;

      const worldPos = gemToThree(ent.transform.x, ent.transform.y, ent.transform.z + 10);
      proj.copy(worldPos).project(this.camera);
      if (proj.z > 1.0) continue; // Behind camera

      const sx = ((proj.x + 1) * innerWidth) / 2;
      const sy = ((-proj.y + 1) * innerHeight) / 2;
      const dist = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (dist < minScreenDist) {
        minScreenDist = dist;
        nearestEnt = ent;
      }
    }

    // 2. Fallback to raycast on ground if no direct screen click
    if (!nearestEnt) {
      const hits = this.raycaster.intersectObject(this.terrainScene, true);
      if (hits.length > 0) {
        const gemPt = threeToGem(hits[0].point);
        let minDist = 80; // 4 meters
        for (const ent of this.world.entities.values()) {
          if (!ent.health.alive || ent.owner.player !== this.playerIndex) continue;
          const d = Math.hypot(ent.transform.x - gemPt[0], ent.transform.y - gemPt[1]);
          if (d < minDist) {
            minDist = d;
            nearestEnt = ent;
          }
        }
      }
    }

    if (nearestEnt) {
      if (e.shiftKey) {
        this.toggleSelect(nearestEnt.id);
      } else {
        this.select([nearestEnt.id]);
      }
    } else if (!e.shiftKey) {
      this.deselectAll();
    }
  }

  private finishBoxSelection(shiftKey: boolean) {
    const minX = Math.min(this.boxStartX, this.boxCurrentX);
    const maxX = Math.max(this.boxStartX, this.boxCurrentX);
    const minY = Math.min(this.boxStartY, this.boxCurrentY);
    const maxY = Math.max(this.boxStartY, this.boxCurrentY);

    const newlySelected: number[] = [];
    const proj = new THREE.Vector3();

    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;
      if (ent.owner.player !== this.playerIndex) continue;

      // Project entity position to screen coordinates
      const worldPos = gemToThree(ent.transform.x, ent.transform.y, ent.transform.z);
      proj.copy(worldPos).project(this.camera);

      // Convert NDC (-1..1) to screen pixels
      const sx = ((proj.x + 1) * innerWidth) / 2;
      const sy = ((-proj.y + 1) * innerHeight) / 2;

      // Check if behind camera
      if (proj.z > 1.0) continue;

      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        newlySelected.push(ent.id);
      }
    }

    if (shiftKey) {
      for (const id of newlySelected) {
        this.selectedIds.add(id);
      }
      this.syncSelectionVisuals();
    } else {
      this.select(newlySelected);
    }
  }

  private onDoubleClick(e: MouseEvent) {
    this.updateRaycaster(e.clientX, e.clientY);
    const hits = this.raycaster.intersectObject(this.terrainScene, true);
    if (hits.length === 0) return;

    const gemPt = threeToGem(hits[0].point);
    let targetProto: string | null = null;
    let minDist = 30;

    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive || ent.owner.player !== this.playerIndex) continue;
      const d = Math.hypot(ent.transform.x - gemPt[0], ent.transform.y - gemPt[1]);
      if (d < minDist) {
        minDist = d;
        targetProto = ent.proto;
      }
    }

    if (targetProto) {
      const matchingIds: number[] = [];
      for (const ent of this.world.entities.values()) {
        if (!ent.health.alive || ent.owner.player !== this.playerIndex) continue;
        if (ent.proto === targetProto) {
          matchingIds.push(ent.id);
        }
      }
      this.select(matchingIds);
    }
  }

  private handleRightClickOrder(e: MouseEvent) {
    if (this.selectedIds.size === 0) return;

    this.updateRaycaster(e.clientX, e.clientY);

    // 1. Check if clicking on or near an ENEMY unit (Attack Order!)
    const proj = new THREE.Vector3();
    let enemyTarget: SimEntity | null = null;
    let minEnemyDist = 32; // pixels

    for (const ent of this.world.entities.values()) {
      if (!ent.health.alive) continue;
      if (ent.owner.player === this.playerIndex) continue; // Friendly

      const worldPos = gemToThree(ent.transform.x, ent.transform.y, ent.transform.z + 10);
      proj.copy(worldPos).project(this.camera);
      if (proj.z > 1.0) continue;

      const sx = ((proj.x + 1) * innerWidth) / 2;
      const sy = ((-proj.y + 1) * innerHeight) / 2;
      const dist = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (dist < minEnemyDist) {
        minEnemyDist = dist;
        enemyTarget = ent;
      }
    }

    const hits = this.raycaster.intersectObject(this.terrainScene, true);

    // Ground distance fallback for enemy check
    if (!enemyTarget && hits.length > 0) {
      const gemPt = threeToGem(hits[0].point);
      let minGDist = 120; // 6 meters
      for (const ent of this.world.entities.values()) {
        if (!ent.health.alive || ent.owner.player === this.playerIndex) continue;
        const d = Math.hypot(ent.transform.x - gemPt[0], ent.transform.y - gemPt[1]);
        if (d < minGDist) {
          minGDist = d;
          enemyTarget = ent;
        }
      }
    }

    if (enemyTarget) {
      issueAttackOrder(
        this.world,
        Array.from(this.selectedIds),
        enemyTarget.id,
        false
      );
      const enemyPos = gemToThree(enemyTarget.transform.x, enemyTarget.transform.y, enemyTarget.transform.z);
      this.showAttackOrderMarker(enemyPos);
      return;
    }

    // 2. Otherwise: Move Order!
    if (hits.length === 0) return;

    const hitGem = threeToGem(hits[0].point);
    issueMoveOrder(
      this.world,
      Array.from(this.selectedIds),
      hitGem[0],
      hitGem[1],
      undefined,
      false
    );

    // Show temporary order click indicator
    this.showOrderClickMarker(hits[0].point);
  }

  private showAttackOrderMarker(worldPos: THREE.Vector3) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(6, 10, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff3838, side: THREE.DoubleSide })
    );
    marker.position.copy(worldPos).add(new THREE.Vector3(0, 4, 0));
    this.scene.add(marker);

    let scale = 1.0;
    const fadeInterval = setInterval(() => {
      scale += 0.12;
      marker.scale.set(scale, scale, scale);
      if (scale >= 2.2) {
        clearInterval(fadeInterval);
        this.scene.remove(marker);
        marker.geometry.dispose();
      }
    }, 20);
  }

  private showOrderClickMarker(worldPos: THREE.Vector3) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(4, 7, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2ed573, side: THREE.DoubleSide })
    );
    marker.position.copy(worldPos).add(new THREE.Vector3(0, 2, 0));
    this.scene.add(marker);

    let scale = 1.0;
    const fadeInterval = setInterval(() => {
      scale += 0.1;
      marker.scale.set(scale, scale, scale);
      if (scale >= 2.0) {
        clearInterval(fadeInterval);
        this.scene.remove(marker);
        marker.geometry.dispose();
      }
    }, 20);
  }

  private onKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();

    // Control groups (1..9 and Ctrl+1..9)
    if (/^[1-9]$/.test(e.key)) {
      const groupNum = parseInt(e.key, 10);
      if (e.ctrlKey) {
        this.assignControlGroup(groupNum);
      } else {
        this.recallControlGroup(groupNum);
      }
      return;
    }

    // Posture orders: Z (stand), X (crouch), C (prone)
    if (key === 'z') {
      issuePostureOrder(this.world, Array.from(this.selectedIds), 'stand');
    } else if (key === 'x') {
      issuePostureOrder(this.world, Array.from(this.selectedIds), 'crouch');
    } else if (key === 'c') {
      issuePostureOrder(this.world, Array.from(this.selectedIds), 'prone');
    } else if (key === 's') {
      issueStopOrder(this.world, Array.from(this.selectedIds));
    }
  }

  private updateRaycaster(clientX: number, clientY: number) {
    this.mouse.x = (clientX / innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }

  // Selection state operations
  select(ids: number[]) {
    this.selectedIds.clear();
    for (const id of ids) {
      this.selectedIds.add(id);
    }
    this.syncSelectionVisuals();
  }

  toggleSelect(id: number) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.syncSelectionVisuals();
  }

  deselectAll() {
    this.selectedIds.clear();
    this.syncSelectionVisuals();
  }

  assignControlGroup(groupNum: number) {
    if (this.selectedIds.size === 0) return;
    this.controlGroups.set(groupNum, new Set(this.selectedIds));
  }

  recallControlGroup(groupNum: number) {
    const group = this.controlGroups.get(groupNum);
    if (!group || group.size === 0) return;

    this.select(Array.from(group));

    if (this.onCameraFocus) {
      // Find average position
      let sumX = 0, sumY = 0, count = 0;
      for (const id of group) {
        const ent = this.world.getEntity(id);
        if (ent) {
          sumX += ent.transform.x;
          sumY += ent.transform.y;
          count++;
        }
      }
      if (count > 0) {
        const center = gemToThree(sumX / count, sumY / count, 0);
        this.onCameraFocus(center);
      }
    }
  }

  getSelectedEntities(): SimEntity[] {
    const list: SimEntity[] = [];
    for (const id of this.selectedIds) {
      const e = this.world.getEntity(id);
      if (e) list.push(e);
    }
    return list;
  }

  /** Update selection rings on ground in Three.js */
  syncSelectionVisuals() {
    // Remove rings for unselected
    for (const [id, ring] of this.selectionRings.entries()) {
      if (!this.selectedIds.has(id)) {
        this.scene.remove(ring);
        this.selectionRings.delete(id);
      }
    }

    // Add rings for newly selected
    for (const id of this.selectedIds) {
      const ent = this.world.getEntity(id);
      if (!ent) continue;

      let ring = this.selectionRings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
        this.scene.add(ring);
        this.selectionRings.set(id, ring);
      }
      const pos = gemToThree(ent.transform.x, ent.transform.y, ent.transform.z + 1);
      ring.position.copy(pos);
    }

    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelectedEntities());
    }
  }

  /** Called each frame to update ring positions */
  update() {
    for (const [id, ring] of this.selectionRings.entries()) {
      const ent = this.world.getEntity(id);
      if (ent && ent.health.alive) {
        const pos = gemToThree(ent.transform.x, ent.transform.y, ent.transform.z + 1);
        ring.position.copy(pos);
      } else {
        this.scene.remove(ring);
        this.selectionRings.delete(id);
      }
    }
  }

  dispose() {
    this.boxElement.remove();
    for (const ring of this.selectionRings.values()) {
      this.scene.remove(ring);
    }
    this.selectionRings.clear();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}
