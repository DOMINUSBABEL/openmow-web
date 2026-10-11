/**
 * MissionDoc Loader (T04 / Gate G1 -> G2).
 * Converts GEM2 0.mi SDL AST into strongly-typed MissionDoc.
 */
import type {
  MissionBrain,
  MissionBrainProperties,
  MissionCoverSector,
  MissionDiplomacy,
  MissionDoc,
  MissionEntity,
  MissionHelpers,
  MissionHuman,
  MissionInventory,
  MissionInventoryItem,
  MissionLink,
  MissionPlayer,
  MissionReinforcementItem,
  MissionTag,
  MissionTrigger,
  MissionWaypointNode,
} from '../contracts/mission';

function getTag(item: any): string | null {
  if (item === null || item === undefined) return null;
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    if (typeof item.w === 'string') return item.w;
    if (item.k === '{' && Array.isArray(item.i) && item.i.length > 0) {
      return getTag(item.i[0]);
    }
  }
  return null;
}

function getAtomValue(item: any): any {
  if (item === null || item === undefined) return null;
  if (typeof item === 'object' && 'w' in item) return item.w;
  return item;
}

function cleanStr(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(getAtomValue(val));
  return s.replace(/^"+|"+$/g, '');
}

function asNum(val: any, fallback = 0): number {
  const v = getAtomValue(val);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toHexId(id: number): string {
  return '0x' + (id >>> 0).toString(16);
}

function isBlock(item: any): boolean {
  return typeof item === 'object' && item !== null && item.k === '{' && Array.isArray(item.i);
}

export function parseMissionDoc(sdlAst: any, source = ''): MissionDoc {
  const items: any[] = sdlAst.items ?? (Array.isArray(sdlAst) ? sdlAst : []);

  // Locate the {mission ...} node
  let missionNode: any = null;
  for (const it of items) {
    if (isBlock(it) && getTag(it.i[0]) === 'mission') {
      missionNode = it;
      break;
    }
  }
  if (!missionNode) {
    if (isBlock(sdlAst) && getTag(sdlAst.i[0]) === 'mission') {
      missionNode = sdlAst;
    } else {
      throw new Error(`No {mission} node found in SDL AST for ${source}`);
    }
  }

  const children: any[] = missionNode.i.slice(1);

  const entities: MissionEntity[] = [];
  const humans: MissionHuman[] = [];
  const links: MissionLink[] = [];
  const tags: MissionTag[] = [];
  const inventories: MissionInventory[] = [];
  const brains: MissionBrain[] = [];
  const players: MissionPlayer[] = [];
  const covers: MissionCoverSector[] = [];
  let environment: string | undefined;
  let fog: number | undefined;
  let entityManagerEnabled: boolean | undefined;
  let diplomacy: MissionDiplomacy | undefined;

  const helpers: MissionHelpers = {
    events: [],
    zones: [],
    tasks: [],
    reinforcements: { scoreTotal: 0, scoreCurrent: 0, items: [] },
    cameras: {},
    vars: {},
    waypoints: [],
    triggers: [],
  };

  for (const child of children) {
    if (!isBlock(child) || child.i.length === 0) continue;
    const tag = getTag(child.i[0]);

    if (tag === 'Entity' || tag === 'Human') {
      const isHuman = tag === 'Human';
      const proto = cleanStr(child.i[1]);
      const id = asNum(child.i[2]);
      const idHex = toHexId(id);

      let x = 0;
      let y = 0;
      let z: number | undefined;
      let zl = 0;
      let player: number | undefined;
      let mid: number | undefined;
      let texMod: string | undefined;
      let impregnability: string | undefined;
      let fsmState: string | undefined;
      let spawnedInFog: boolean | undefined;
      const ables: string[] = [];

      for (let pIdx = 3; pIdx < child.i.length; pIdx++) {
        const prop = child.i[pIdx];
        if (!isBlock(prop) || prop.i.length === 0) continue;
        const ptag = getTag(prop.i[0]);

        if (ptag === 'Position' && prop.i.length >= 3) {
          x = asNum(prop.i[1]);
          y = asNum(prop.i[2]);
          if (prop.i.length >= 4) {
            z = asNum(prop.i[3]);
          }
        } else if (ptag === 'xform' && prop.i.length >= 3) {
          const xtag = getTag(prop.i[1]);
          if (xtag === 'zl') {
            zl = asNum(prop.i[2]);
          }
        } else if (ptag === 'Player' && prop.i.length >= 2) {
          player = asNum(prop.i[1]);
        } else if (ptag === 'MID' && prop.i.length >= 2) {
          mid = asNum(prop.i[1]);
        } else if (ptag === 'TexMod' && prop.i.length >= 2) {
          texMod = cleanStr(prop.i[1]);
        } else if (ptag === 'Impregnability' && prop.i.length >= 2) {
          impregnability = cleanStr(prop.i[1]);
        } else if (ptag === 'FsmState' && prop.i.length >= 2) {
          fsmState = cleanStr(prop.i[1]);
        } else if (ptag === 'SpawnedInFog') {
          spawnedInFog = true;
        } else if (ptag === 'Able' && prop.i.length >= 2) {
          ables.push(cleanStr(prop.i[1]));
        }
      }

      if (isHuman) {
        humans.push({
          kind: 'human',
          proto,
          id,
          idHex,
          x,
          y,
          z,
          zl,
          player,
          mid,
          texMod,
          impregnability,
          fsmState,
          spawnedInFog,
          able: ables.length ? ables : undefined,
          raw: child,
        });
      } else {
        entities.push({
          kind: 'entity',
          proto,
          id,
          idHex,
          x,
          y,
          z,
          zl,
          player,
          mid,
          texMod,
          impregnability,
          fsmState,
          spawnedInFog,
          able: ables.length ? ables : undefined,
          raw: child,
        });
      }
    } else if (tag === 'Link') {
      const humanId = asNum(child.i[1]);
      let vehicleId = 0;
      let seat = 'seat';
      if (child.i.length >= 3 && isBlock(child.i[2])) {
        const sub = child.i[2].i;
        if (sub.length >= 1) vehicleId = asNum(sub[0]);
        if (sub.length >= 2) seat = cleanStr(sub[1]);
      }
      links.push({
        humanId,
        humanIdHex: toHexId(humanId),
        vehicleId,
        vehicleIdHex: toHexId(vehicleId),
        seat,
      });
    } else if (tag === 'Tags') {
      const lastItem = child.i[child.i.length - 1];
      const entityId = asNum(lastItem);
      const tagList: string[] = [];
      for (let k = 1; k < child.i.length - 1; k++) {
        const tStr = cleanStr(child.i[k]);
        if (tStr) tagList.push(tStr);
      }
      const primaryTag = tagList.length > 0 ? tagList[0] : '';
      tags.push({
        tag: primaryTag,
        tags: tagList,
        entityId,
        entityIdHex: toHexId(entityId),
      });
    } else if (tag === 'Inventory') {
      const entityId = asNum(child.i[1]);
      const itemsList: MissionInventoryItem[] = [];

      for (let j = 2; j < child.i.length; j++) {
        const boxBlock = child.i[j];
        if (!isBlock(boxBlock)) continue;
        for (const it of boxBlock.i) {
          if (!isBlock(it) || it.i.length === 0) continue;
          if (getTag(it.i[0]) === 'item' && it.i.length >= 2) {
            const iname = cleanStr(it.i[1]);
            const itemObj: MissionInventoryItem = { name: iname };
            for (let k = 2; k < it.i.length; k++) {
              const arg = it.i[k];
              if (isBlock(arg) && arg.i.length > 0) {
                const atag = getTag(arg.i[0]);
                if (atag === 'cell' && arg.i.length >= 3) {
                  itemObj.cell = [asNum(arg.i[1]), asNum(arg.i[2])];
                } else if (atag === 'user' && arg.i.length >= 2) {
                  itemObj.user = cleanStr(arg.i[1]);
                }
              } else {
                const s = cleanStr(arg);
                if (s === 'filled') {
                  itemObj.filled = true;
                } else if (typeof getAtomValue(arg) === 'number') {
                  itemObj.amount = asNum(arg);
                }
              }
            }
            itemsList.push(itemObj);
          }
        }
      }

      inventories.push({
        entityId,
        entityIdHex: toHexId(entityId),
        items: itemsList,
      });
    } else if (tag === 'Brain') {
      const entityId = asNum(child.i[1]);
      const props: MissionBrainProperties = {};
      for (let j = 2; j < child.i.length; j++) {
        const propBlock = child.i[j];
        if (!isBlock(propBlock) || getTag(propBlock.i[0]) !== 'Properties') continue;
        for (const p of propBlock.i.slice(1)) {
          if (!isBlock(p) || p.i.length === 0) continue;
          const pName = getTag(p.i[0]);
          if (pName === 'move_mode' && p.i.length >= 2) {
            props.moveMode = cleanStr(p.i[1]);
          } else if (pName === 'control' && p.i.length >= 2) {
            props.control = cleanStr(p.i[1]);
          } else if (pName === 'fire_mode' && p.i.length >= 2) {
            props.fireMode = cleanStr(p.i[1]);
          } else if (pName === 'look_around') {
            props.lookAround = true;
          } else if (pName === 'ai_move') {
            if (p.i.length >= 2) {
              if (isBlock(p.i[1])) {
                const sub = p.i[1].i;
                if (sub.length >= 2 && getTag(sub[0]) === 'mode') {
                  props.aiMoveMode = cleanStr(sub[1]);
                } else if (sub.length >= 1) {
                  props.aiMoveMode = cleanStr(sub[0]);
                } else {
                  props.aiMoveMode = 'disable';
                }
              } else {
                props.aiMoveMode = cleanStr(p.i[1]);
              }
            } else {
              props.aiMoveMode = 'disable';
            }
          } else if (pName) {
            props[pName] = p.i.length >= 2 ? cleanStr(p.i[1]) : true;
          }
        }
      }
      brains.push({
        entityId,
        entityIdHex: toHexId(entityId),
        properties: props,
      });
    } else if (tag === 'Players') {
      for (const p of child.i.slice(1)) {
        if (!isBlock(p) || p.i.length === 0) continue;
        const ptag = getTag(p.i[0]);
        if (ptag === 'user' && p.i.length >= 2) {
          const uId = asNum(p.i[1]);
          let pl = players.find((x) => x.id === uId);
          if (!pl) {
            pl = { id: uId, user: true };
            players.push(pl);
          } else {
            pl.user = true;
          }
        } else if (ptag === 'alias' && p.i.length >= 3) {
          const aId = asNum(p.i[1]);
          const aName = cleanStr(p.i[2]);
          let pl = players.find((x) => x.id === aId);
          if (!pl) {
            pl = { id: aId, alias: aName };
            players.push(pl);
          } else {
            pl.alias = aName;
          }
        } else if (ptag === 'diplomacy') {
          // Diplomacy block
          diplomacy = { matrix: [] };
        }
      }
    } else if (tag === 'Environment' && child.i.length >= 2) {
      environment = cleanStr(child.i[1]);
    } else if (tag === 'Fog' && child.i.length >= 2) {
      fog = asNum(child.i[1]);
    } else if (tag === 'EntityManager') {
      entityManagerEnabled = true;
    } else if (tag === 'Covers') {
      for (const sec of child.i.slice(1)) {
        if (!isBlock(sec) || getTag(sec.i[0]) !== 'Sector') continue;
        let automaticId = 0;
        let sx = 0;
        let sy = 0;
        let sname = '';
        for (const sp of sec.i.slice(1)) {
          if (!isBlock(sp) || sp.i.length === 0) continue;
          const sptag = getTag(sp.i[0]);
          if (sptag === 'Automatic' && sp.i.length >= 4) {
            automaticId = asNum(sp.i[1]);
            sx = asNum(sp.i[2]);
            sy = asNum(sp.i[3]);
          } else if (sptag === 'Name' && sp.i.length >= 2) {
            sname = cleanStr(sp.i[1]);
          }
        }
        covers.push({ automaticId, x: sx, y: sy, name: sname });
      }
    } else if (tag === 'Helpers') {
      parseHelpers(child, helpers);
    }
  }

  return {
    source,
    environment,
    fog,
    entityManagerEnabled,
    players,
    diplomacy,
    entities,
    humans,
    links,
    tags,
    inventories,
    brains,
    covers,
    helpers,
  };
}

function parseHelpers(helpersNode: any, helpers: MissionHelpers) {
  for (const item of helpersNode.i.slice(1)) {
    if (!isBlock(item) || item.i.length === 0) continue;
    const tag = getTag(item.i[0]);

    if (tag === 'event' && item.i.length >= 2) {
      helpers.events.push(cleanStr(item.i[1]));
    } else if (tag === 'zone' && item.i.length >= 2) {
      const zKind = cleanStr(item.i[1]) === 'poly' ? 'poly' : 'circle';
      let zName = '';
      let pos: [number, number, number] = [0, 0, 0];
      let radius: number | undefined;
      const points: [number, number][] = [];

      for (const zp of item.i.slice(2)) {
        if (!isBlock(zp) || zp.i.length === 0) continue;
        const zptag = getTag(zp.i[0]);
        if (zptag === 'position' && zp.i.length >= 3) {
          pos = [asNum(zp.i[1]), asNum(zp.i[2]), asNum(zp.i[3] ?? 0)];
        } else if (zptag === 'Name' && zp.i.length >= 2) {
          zName = cleanStr(zp.i[1]);
        } else if (zptag === 'Radius' && zp.i.length >= 2) {
          radius = asNum(zp.i[1]);
        } else if (zptag === 'Point' && zp.i.length >= 3) {
          points.push([asNum(zp.i[1]), asNum(zp.i[2])]);
        }
      }
      helpers.zones.push({
        kind: zKind,
        name: zName,
        position: pos,
        radius,
        points: points.length ? points : undefined,
      });
    } else if (tag === 'tasks') {
      for (const t of item.i.slice(1)) {
        if (!isBlock(t) || t.i.length === 0) continue;
        const tId = cleanStr(t.i[0]);
        let desc: string | undefined;
        let primary = false;
        let state: string | undefined;
        let point: [number, number, number] | undefined;

        for (const tp of t.i.slice(1)) {
          if (!isBlock(tp) || tp.i.length === 0) continue;
          const tptag = getTag(tp.i[0]);
          if (tptag === 'desc' && tp.i.length >= 2) {
            desc = cleanStr(tp.i[1]);
          } else if (tptag === 'primary') {
            primary = true;
          } else if (tptag === 'state' && tp.i.length >= 2) {
            state = cleanStr(tp.i[1]);
          } else if (tptag === 'point' && tp.i.length >= 4) {
            point = [asNum(tp.i[1]), asNum(tp.i[2]), asNum(tp.i[3])];
          }
        }
        helpers.tasks.push({ id: tId, desc, primary, state, point });
      }
    } else if (tag === 'reinforcements') {
      for (const r of item.i.slice(1)) {
        if (!isBlock(r) || r.i.length === 0) continue;
        const rtag = getTag(r.i[0]);
        if (rtag === 'scoreTotal' && r.i.length >= 2) {
          helpers.reinforcements.scoreTotal = asNum(r.i[1]);
        } else if (rtag === 'scoreCurrent' && r.i.length >= 2) {
          helpers.reinforcements.scoreCurrent = asNum(r.i[1]);
        } else {
          // Reinforcement item
          const rId = cleanStr(r.i[0]);
          const rItem: MissionReinforcementItem = { id: rId };
          for (const rp of r.i.slice(1)) {
            if (!isBlock(rp) || rp.i.length === 0) continue;
            const rptag = getTag(rp.i[0]);
            if (rptag === 'state' && rp.i.length >= 2) rItem.state = cleanStr(rp.i[1]);
            else if (rptag === 'text' && rp.i.length >= 2) rItem.text = cleanStr(rp.i[1]);
            else if (rptag === 'image' && rp.i.length >= 2) rItem.image = cleanStr(rp.i[1]);
            else if (rptag === 'hint' && rp.i.length >= 2) rItem.hint = cleanStr(rp.i[1]);
            else if (rptag === 'count' && rp.i.length >= 2) rItem.count = asNum(rp.i[1]);
            else if (rptag === 'score' && rp.i.length >= 2) rItem.score = asNum(rp.i[1]);
            else if (rptag === 'delay' && rp.i.length >= 2) rItem.delay = asNum(rp.i[1]);
            else if (rptag === 'eventStart' && rp.i.length >= 2) rItem.eventStart = cleanStr(rp.i[1]);
            else if (rptag === 'waypoint' && rp.i.length >= 2) rItem.waypoint = cleanStr(rp.i[1]);
            else if (rptag === 'menu' && rp.i.length >= 2) rItem.menu = cleanStr(rp.i[1]);
          }
          helpers.reinforcements.items.push(rItem);
        }
      }
    } else if (tag === 'cameras') {
      helpers.cameras = item;
    } else if (tag === 'vars') {
      for (const v of item.i.slice(1)) {
        if (isBlock(v) && v.i.length > 0) {
          const varName = cleanStr(v.i[0]);
          helpers.vars[varName] = v.i.length >= 2 ? cleanStr(v.i[1]) : 0;
        }
      }
    } else if (tag === 'waypoints') {
      // Waypoint blocks
      const wId = asNum(item.i[1] ?? 0);
      const nodes: MissionWaypointNode[] = [];
      for (const w of item.i.slice(2)) {
        if (isBlock(w) && w.i.length >= 4) {
          const nid = asNum(w.i[0]);
          const pos: [number, number, number] = [asNum(w.i[1]), asNum(w.i[2]), asNum(w.i[3])];
          nodes.push({ id: nid, position: pos });
        }
      }
      helpers.waypoints.push({ id: wId, nodes });
    } else if (tag === 'triggers') {
      for (const tr of item.i.slice(1)) {
        if (!isBlock(tr) || tr.i.length === 0) continue;
        const trName = cleanStr(tr.i[0]);
        const trDoc: MissionTrigger = {
          name: trName,
          condition: { terms: [] },
          actions: [],
        };
        for (const sub of tr.i.slice(1)) {
          if (!isBlock(sub) || sub.i.length === 0) continue;
          const stag = getTag(sub.i[0]);
          if (stag === 'condition') {
            for (const cBlock of sub.i.slice(1)) {
              if (isBlock(cBlock) && getTag(cBlock.i[0]) === 'terms') {
                for (const term of cBlock.i.slice(1)) {
                  if (isBlock(term) && term.i.length > 0) {
                    const orderKey = cleanStr(term.i[0]);
                    const termType = orderKey.replace(/^\d+\./, '');
                    trDoc.condition.terms.push({
                      orderKey,
                      type: termType,
                      raw: term,
                    });
                  }
                }
              }
            }
          } else if (stag === 'actions') {
            for (const act of sub.i.slice(1)) {
              if (isBlock(act) && act.i.length > 0) {
                const actType = cleanStr(act.i[0]);
                trDoc.actions.push({
                  type: actType,
                  raw: act,
                });
              }
            }
          }
        }
        helpers.triggers.push(trDoc);
      }
    }
  }
}

export async function loadMissionDoc(urlOrPath: string): Promise<MissionDoc> {
  const url = urlOrPath.startsWith('http') || urlOrPath.startsWith('/')
    ? urlOrPath
    : `/conv/sdl/${urlOrPath}/0.mi.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
  const json = await res.json();
  return parseMissionDoc(json, urlOrPath);
}
