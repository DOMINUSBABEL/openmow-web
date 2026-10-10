/**
 * Entity components for the OpenMoW-Web simulation engine.
 * Pure data objects, no DOM/Three.js dependencies.
 */
import type { MissionInventoryItem } from '../contracts/mission';

export interface TransformComponent {
  x: number;
  y: number;
  z: number;
  zl: number; // heading in degrees
  prevX: number;
  prevY: number;
  prevZ: number;
  prevZl: number;
}

export interface HealthComponent {
  current: number;
  max: number;
  alive: boolean;
}

export interface OwnerComponent {
  player: number;
  mid?: number;
}

export interface CrewComponent {
  vehicleId?: number;
  seat?: string;
  passengers: Map<string, number>; // seat -> human entity id
}

export interface BrainComponent {
  moveMode: string;
  control: string;
  fireMode: string;
  lookAround: boolean;
  aiMoveMode: string;
  props: Record<string, any>;
}

export type UnitPosture = 'stand' | 'crouch' | 'prone';
export type OrderType = 'move' | 'attack' | 'hold';

export interface UnitOrder {
  type: OrderType;
  targetX: number;
  targetY: number;
  targetEntityId?: number;
  posture?: UnitPosture;
  arrivalRadius?: number; // GEM units (default 10 = 0.5 m)
  waypoints?: Array<{ x: number; y: number }>;
  waypointIndex?: number;
}

export interface MovementComponent {
  currentSpeed: number; // in GEM units / sec (20 units = 1 m)
  maxSpeed: number;     // e.g. 60 for human run (3 m/s)
  posture: UnitPosture;
  turnRadius?: number;  // in GEM units (0 for infantry, > 0 for vehicles)
  order?: UnitOrder;
}

export interface ChassisComponent {
  maxSpeedKmH: number;     // e.g. 33
  maxSpeed: number;        // in GEM units/sec (33 * 1000 / 3600 * 20 = 183.33)
  startTime: number;       // time to reach max speed in seconds (e.g. 15 s)
  acceleration: number;    // maxSpeed / startTime
  brakeTime: number;       // time to stop from max speed in seconds (e.g. 1.5 s)
  deceleration: number;    // maxSpeed / brakeTime
  turnTime: number;        // time for 360 deg turn in seconds (e.g. 10 s)
  turnSpeedDeg: number;    // 360 / turnTime (deg/s)
  turnRadius: number;      // turn radius in GEM units (e.g. 10m = 200 units)
  currentSpeed: number;    // actual current velocity in GEM units/s
}

export interface TurretComponent {
  turretBone?: string;       // e.g. 'turret'
  gunBone?: string;          // e.g. 'gun_rot'
  turretYaw: number;         // current yaw relative to hull in degrees
  targetTurretYaw: number;   // target yaw relative to hull in degrees
  turretSpeed: number;       // degrees per second
  gunPitch: number;          // current pitch/elevation in degrees
  targetGunPitch: number;    // target pitch in degrees
  gunLimits?: [number, number]; // [minPitch, maxPitch]
  gunSpeed: number;          // degrees per second
}

export interface CombatComponent {
  weapon?: import('../contracts/combat').WeaponSpec;
  ammoCount: number;
  maxAmmo: number;
  reloadTimer: number;       // remaining seconds
  cooldownTimer: number;     // remaining seconds
  targetEntityId?: number;
  shotsFired: number;
  kills: number;
  suppression?: number;      // 0..100 suppression level
}

export interface ArmorComponent {
  settings: Record<string, import('../contracts/combat').ArmorSettings>;
  durability: Record<string, number>; // 1.0 down to 0
}

export interface SimEntity {
  id: number;
  idHex: string;
  kind: 'entity' | 'human';
  proto: string;
  transform: TransformComponent;
  health: HealthComponent;
  owner: OwnerComponent;
  tags: Set<string>;
  inventory: MissionInventoryItem[];
  crew: CrewComponent;
  brain: BrainComponent;
  movement: MovementComponent;
  chassis?: ChassisComponent;
  turret?: TurretComponent;
  combat?: CombatComponent;
  armor?: ArmorComponent;
  texMod?: string;
  impregnability?: string;
  fsmState?: string;
  spawnedInFog?: boolean;
}

