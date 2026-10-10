/**
 * FROZEN CONTRACT: Prototype metadata (T01).
 * Schema returned by /conv/proto/<kind>/<name>.json
 */

export type ProtoKind = 'entity' | 'human' | 'item';

export interface ProtoVolume {
  name: string;
  tags?: string[];
  component?: string;
  thickness?: number | number[];
  material?: string;
  bone?: string;
}

export interface ProtoWeaponMount {
  place: string;
  type?: string;
  weapon?: string;
  filling?: { ammo: string; count?: number } | string;
  gunner?: string;
  charger?: string;
  foresight?: string;
  barrel?: string;
  accuracy_by_motion?: Record<string, number>;
}

export interface ProtoInventoryItem {
  name: string;
  count?: number;
  filled?: boolean;
  user?: string;
  cell?: [number, number];
}

export interface ProtoLocomotion {
  MaxSpeed?: number;
  StartTime?: number;
  TurnTime?: number;
  TurnRadius?: number;
  BrakeTime?: number;
  StopTime?: number;
  Gears?: number[];
  RearGears?: number[];
  [key: string]: any;
}

export interface ProtoChassis {
  Locomotion?: ProtoLocomotion;
  Track?: Record<string, any>;
  FuelBag?: { volume?: number; rate?: number; remain?: number; fuel?: string };
  speed?: { Normal?: number; Slow?: number; [key: string]: any };
  [key: string]: any;
}

export interface ProtoBreed {
  skin: string;
  armors?: Record<string, string>;
  perks?: Record<string, any>;
  veterancy?: any;
  inventory?: ProtoInventoryItem[];
}

export interface ProtoStuff {
  tag?: string;
  entity?: string;
  filling?: { ammo?: string; count?: number } | string;
  range?: number | [number, number];
  healthDamage?: number;
  rechargeTime?: number;
  recoveryTime?: number;
  speed?: number;
  burst?: { short?: number[]; long?: number[] };
  fireSound?: string;
  reloadSound?: string;
  projectileDamageTable?: number[][];
  mass?: number;
  [key: string]: any;
}

export interface ProtoDoc {
  kind: ProtoKind;
  name: string;
  source: string;
  files: string[];
  model: string | null;
  props: string[];
  volumes: ProtoVolume[];
  weaponry: ProtoWeaponMount[];
  inventory: ProtoInventoryItem[];
  chassis: ProtoChassis;
  armor: Record<string, any>;
  breed: ProtoBreed | null;
  stuff: ProtoStuff | null;
  raw: any;
}
