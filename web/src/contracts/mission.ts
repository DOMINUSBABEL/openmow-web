/**
 * Mission contract (T04 / Gate G1 -> G2).
 * Strongly-typed representation of Men of War: Assault Squad 2 0.mi mission files.
 */

export interface MissionEntity {
  kind: 'entity';
  proto: string;
  id: number;
  idHex: string;
  x: number;
  y: number;
  z?: number;
  zl: number;
  player?: number;
  mid?: number;
  texMod?: string;
  impregnability?: string;
  fsmState?: string;
  spawnedInFog?: boolean;
  able?: string[];
  raw?: any;
}

export interface MissionHuman {
  kind: 'human';
  proto: string;
  id: number;
  idHex: string;
  x: number;
  y: number;
  z?: number;
  zl: number;
  player?: number;
  mid?: number;
  texMod?: string;
  impregnability?: string;
  fsmState?: string;
  spawnedInFog?: boolean;
  able?: string[];
  raw?: any;
}

export interface MissionLink {
  humanId: number;
  humanIdHex: string;
  vehicleId: number;
  vehicleIdHex: string;
  seat: string;
}

export interface MissionTag {
  tag: string;
  tags?: string[];
  entityId: number;
  entityIdHex: string;
}

export interface MissionInventoryItem {
  name: string;
  amount?: number;
  ammo?: number | string;
  filled?: boolean;
  cell?: [number, number];
  user?: string;
}

export interface MissionInventory {
  entityId: number;
  entityIdHex: string;
  items: MissionInventoryItem[];
}

export interface MissionBrainProperties {
  moveMode?: string;
  control?: string;
  fireMode?: string;
  lookAround?: boolean;
  aiMoveMode?: string;
  [key: string]: any;
}

export interface MissionBrain {
  entityId: number;
  entityIdHex: string;
  properties: MissionBrainProperties;
}

export interface MissionPlayer {
  id: number;
  alias?: string;
  user?: boolean;
}

export interface MissionDiplomacy {
  matrix: number[][];
}

export interface MissionCoverSector {
  name: string;
  automaticId: number;
  x: number;
  y: number;
}

export interface MissionZone {
  kind: 'circle' | 'poly';
  name: string;
  position: [number, number, number];
  radius?: number;
  points?: [number, number][];
}

export interface MissionTask {
  id: string;
  desc?: string;
  primary?: boolean;
  state?: string;
  point?: [number, number, number];
}

export interface MissionReinforcementItem {
  id: string;
  state?: string;
  text?: string;
  image?: string;
  hint?: string;
  count?: number;
  score?: number;
  delay?: number;
  eventStart?: string;
  waypoint?: string;
  menu?: string;
}

export interface MissionReinforcements {
  scoreTotal: number;
  scoreCurrent: number;
  items: MissionReinforcementItem[];
}

export interface MissionWaypointNode {
  id: number;
  position: [number, number, number];
  flags?: any;
}

export interface MissionWaypointTrack {
  id: number;
  name?: string;
  nodes: MissionWaypointNode[];
}

export interface MissionTerm {
  orderKey: string;
  type: string;
  raw: any;
  selector?: any;
  count?: { op: string; value: number };
  id?: string;
  varName?: string;
  op?: string;
  value?: any;
}

export interface MissionAction {
  type: string;
  raw: any;
}

export interface MissionTrigger {
  name: string;
  condition: {
    terms: MissionTerm[];
  };
  actions: MissionAction[];
}

export interface MissionHelpers {
  events: string[];
  zones: MissionZone[];
  tasks: MissionTask[];
  reinforcements: MissionReinforcements;
  cameras: Record<string, any>;
  vars: Record<string, any>;
  waypoints: MissionWaypointTrack[];
  triggers: MissionTrigger[];
}

export interface MissionDoc {
  source: string;
  environment?: string;
  fog?: number;
  entityManagerEnabled?: boolean;
  players: MissionPlayer[];
  diplomacy?: MissionDiplomacy;
  entities: MissionEntity[];
  humans: MissionHuman[];
  links: MissionLink[];
  tags: MissionTag[];
  inventories: MissionInventory[];
  brains: MissionBrain[];
  covers: MissionCoverSector[];
  helpers: MissionHelpers;
}
