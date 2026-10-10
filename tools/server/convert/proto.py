"""OpenMoW-Web prototype resolver and converter (T01).

Converts GEM2 entity definitions (.def), human breeds (.set), and item/stuff definitions
into flat, structured JSON conforming to web/src/contracts/proto.ts.
Supports {from ...} inheritance via block merging (merge_blocks).
"""
from __future__ import annotations
import collections
import posixpath
import re
from typing import Any

from formats.gem_pre import Pre
from formats.sdl import Node, Atom, to_json


def _atom_val(a: Any) -> Any:
    if isinstance(a, Atom):
        n = a.num()
        return n if n is not None else a.value
    return a


def _get_node_tag(n: Node) -> str | None:
    if not n.items:
        return None
    first = n.items[0]
    return first.value if isinstance(first, Atom) else None


def _node_to_dict_or_val(n: Node) -> Any:
    """Helper to convert simple nested key-value nodes into python dicts/values."""
    children = n.children
    if not children:
        args = [_atom_val(a) for a in n.args]
        if len(args) == 0:
            return True
        if len(args) == 1:
            return args[0]
        return args
    res = {}
    for c in children:
        tag = _get_node_tag(c)
        if tag:
            val = _node_to_dict_or_val(c)
            res[tag] = val
    return res


class ProtoResolver:
    def __init__(self, vfs):
        self.vfs = vfs
        self._index_vfs()

    def _index_vfs(self):
        self.defs_by_base: dict[str, list[str]] = collections.defaultdict(list)
        for f in self.vfs.files:
            if f.startswith('/entity/') and f.endswith('.def'):
                base = posixpath.splitext(posixpath.basename(f))[0].lower()
                self.defs_by_base[base].append(f)

        self.stuff_by_name: dict[str, list[str]] = collections.defaultdict(list)
        for f in self.vfs.files:
            if f.startswith('/set/stuff/') and not f.endswith('.fsm') and not f.endswith('.presets'):
                base = posixpath.basename(f).lower()
                self.stuff_by_name[base].append(f)
                raw_base = posixpath.splitext(base)[0]
                if raw_base != base:
                    self.stuff_by_name[raw_base].append(f)

    def resolve_entity_path(self, name: str) -> str:
        n = name.lower()
        cands = self.defs_by_base.get(n)
        if not cands:
            # Try direct path
            if self.vfs.exists(name):
                return name
            if self.vfs.exists(f'/entity/{name}'):
                return f'/entity/{name}'
            raise FileNotFoundError(f"Entity prototype not found: {name}")
        if len(cands) == 1:
            return cands[0]
        # Resolve collisions: radio_station -> /entity/inventory/radio_station/
        if n == 'radio_station':
            rs = [c for c in cands if '/inventory/' in c]
            if rs:
                return rs[0]
        # Prefer non-fx for solid entities
        non_fx = [c for c in cands if '/fx/' not in c]
        return non_fx[0] if non_fx else cands[0]

    def resolve_human_path(self, name: str) -> str:
        cands = [f'/set/breed/{name}.set', f'/set/breed/{name}']
        for c in cands:
            if self.vfs.exists(c):
                return c
        raise FileNotFoundError(f"Human breed prototype not found: {name}")

    def resolve_stuff_path(self, name: str) -> str:
        name_clean = name.strip('"').lower()
        if name_clean in self.stuff_by_name:
            return self.stuff_by_name[name_clean][0]
        tokens = name_clean.split()
        if len(tokens) >= 2:
            w0, w1 = tokens[0], tokens[1]
            cands = [
                f"{w1}.{w0}",
                f"{w0}.{w1}",
                f"{w0}.{w1}.ammo",
                f"{w1}.{w0}.ammo",
                f"{w0}",
                f"{w1}",
                f"{tokens[-1]}",
                f"{tokens[-1]}.weapon",
                f"{tokens[-1]}.ammo",
                f"{tokens[-1]}.grenade",
                f"{w0}_{w1}",
                f"{w1}_{w0}",
            ]
            if len(tokens) >= 3:
                wlast = tokens[-1]
                cands.extend([
                    f"{wlast}",
                    f"{wlast}.weapon",
                    f"{wlast}.ammo",
                    f"{wlast}.grenade",
                ])
            for c in cands:
                if c in self.stuff_by_name:
                    return self.stuff_by_name[c][0]
        for ext in ('.ammo', '.grenade', '.pattern', '.weapon'):
            if name_clean + ext in self.stuff_by_name:
                return self.stuff_by_name[name_clean + ext][0]
        # Caliber fallback e.g. bullet88 -> bullet88.ap.ammo
        for ext in ('.ap.ammo', '.fg.ammo', '.ammo'):
            if name_clean + ext in self.stuff_by_name:
                return self.stuff_by_name[name_clean + ext][0]
        # Direct check
        cand_p = f"/set/stuff/{name_clean}"
        if self.vfs.exists(cand_p):
            return cand_p
        raise FileNotFoundError(f"Stuff/item prototype not found: {name}")

    def resolve_from_ref(self, ref_str: str) -> str:
        s = ref_str.strip('"').lower()
        parts = s.split()
        if 'pattern' in parts:
            other = [p for p in parts if p != 'pattern']
            if other:
                cand = other[0]
                if f"{cand}.pattern" in self.stuff_by_name:
                    return self.stuff_by_name[f"{cand}.pattern"][0]
                for f in self.vfs.files:
                    if f.startswith('/set/stuff/') and f.endswith('.pattern'):
                        pbase = posixpath.splitext(posixpath.basename(f))[0].lower()
                        if cand in pbase or pbase in cand:
                            return f
        # Exact basename in stuff
        if s in self.stuff_by_name:
            return self.stuff_by_name[s][0]
        if parts:
            for p in (parts[-1], parts[0]):
                if p in self.stuff_by_name:
                    return self.stuff_by_name[p][0]
            if len(parts) >= 2:
                for c in (f"{parts[0]}.{parts[1]}.ammo", f"{parts[1]}.{parts[0]}", f"{parts[0]}.{parts[1]}"):
                    if c in self.stuff_by_name:
                        return self.stuff_by_name[c][0]
        raise FileNotFoundError(f"Could not resolve {{from}} reference: {ref_str}")


def _extract_stuff_local_blocks(nodes: list) -> tuple[str | None, list[Node]]:
    """Extract (parent_from_reference, blocks) from loaded stuff nodes."""
    for n in nodes:
        if isinstance(n, Node) and n.items:
            k = _get_node_tag(n)
            if k == 'from' and len(n.items) > 1:
                from_ref = getattr(n.items[1], 'value', str(n.items[1]))
                return from_ref, n.children
            if k in ('weapon_bullet', 'weapon_throwable', 'item', 'tag'):
                return None, n.children
    return None, [n for n in nodes if isinstance(n, Node)]


def merge_blocks(parent_blocks: list[Node], child_blocks: list[Node]) -> list[Node]:
    """Merge child blocks over parent blocks preserving order and replacing matching tags."""
    merged_map = {}
    order = []
    for n in parent_blocks:
        k = _get_node_tag(n)
        if k:
            merged_map[k] = n
            if k not in order:
                order.append(k)
        else:
            order.append(id(n))
            merged_map[id(n)] = n
    for n in child_blocks:
        k = _get_node_tag(n)
        if k:
            merged_map[k] = n
            if k not in order:
                order.append(k)
        else:
            order.append(id(n))
            merged_map[id(n)] = n
    return [merged_map[k] for k in order]


def build_entity_proto(resolver: ProtoResolver, name: str) -> dict[str, Any]:
    vfs = resolver.vfs
    vpath = resolver.resolve_entity_path(name)
    pre = Pre(vfs)
    nodes = pre.load(vpath)

    # 1. Properties
    props = []
    for n in nodes:
        if isinstance(n, Node):
            for c in n.find_all('props'):
                for a in c.args:
                    val = str(a.value).strip('"')
                    if val and val not in props:
                        props.append(val)

    # 2. Volumes
    volumes = []
    for n in nodes:
        if isinstance(n, Node):
            for vnode in n.find_all('Volume'):
                if vnode.args:
                    vname = str(vnode.args[0].value).strip('"')
                    vol: dict[str, Any] = {'name': vname}
                    tags = []
                    for t in vnode.find_all('tags'):
                        tags.extend(str(a.value).strip('"') for a in t.args)
                    if tags:
                        vol['tags'] = tags
                    comp = vnode.find('component')
                    if comp and comp.args:
                        vol['component'] = str(comp.args[0].value).strip('"')
                    thick = vnode.find('Thickness')
                    if thick and thick.args:
                        vol['thickness'] = _atom_val(thick.args[0])
                    volumes.append(vol)

    # 3. Weaponry
    weaponry_by_place: dict[str, dict[str, Any]] = {}
    for n in nodes:
        if isinstance(n, Node):
            for w_block in n.find_all('Weaponry'):
                for place_node in w_block.find_all('place'):
                    if place_node.args:
                        pname = str(place_node.args[0].value).strip('"')
                        mount = weaponry_by_place.setdefault(pname, {'place': pname})
                        type_node = place_node.find('type')
                        if type_node and type_node.args:
                            mount['type'] = str(type_node.args[0].value).strip('"')
                        weap_node = place_node.find('weapon')
                        if weap_node and weap_node.args:
                            mount['weapon'] = str(weap_node.args[0].value).strip('"')
                            filling_node = place_node.find('filling')
                            if filling_node and filling_node.args:
                                f_ammo = str(filling_node.args[0].value).strip('"')
                                f_count = int(filling_node.args[1].num() or 1) if len(filling_node.args) > 1 else 1
                                mount['filling'] = {'ammo': f_ammo, 'count': f_count}
                        gunner_node = place_node.find('gunner')
                        if gunner_node and gunner_node.args:
                            mount['gunner'] = str(gunner_node.args[0].value).strip('"')
                        charger_node = place_node.find('charger')
                        if charger_node and charger_node.args:
                            mount['charger'] = str(charger_node.args[0].value).strip('"')
                        foresight_node = place_node.find('foresight')
                        if foresight_node and foresight_node.args:
                            mount['foresight'] = str(foresight_node.args[0].value).strip('"')
                        barrel_node = place_node.find('barrel')
                        if barrel_node and barrel_node.args:
                            mount['barrel'] = str(barrel_node.args[0].value).strip('"')
                        abm = place_node.find('AccuracyByMotion')
                        if abm:
                            mount['accuracy_by_motion'] = _node_to_dict_or_val(abm)
    weaponry = list(weaponry_by_place.values())

    # 4. Inventory
    inventory = []
    for n in nodes:
        if isinstance(n, Node):
            for ext in n.find_all('extender'):
                if ext.args and ext.args[0].value == 'inventory':
                    box = ext.find('box')
                    if box:
                        for it in box.children:
                            if it.tag == 'item' and it.args:
                                item_info: dict[str, Any] = {'name': str(it.args[0].value).strip('"')}
                                if len(it.args) > 1:
                                    cnt = it.args[1].num()
                                    if cnt is not None:
                                        item_info['count'] = int(cnt)
                                    elif it.args[1].value == 'filled':
                                        item_info['filled'] = True
                                user_node = it.find('user')
                                if user_node and user_node.args:
                                    item_info['user'] = str(user_node.args[0].value).strip('"')
                                cell_node = it.find('cell')
                                if cell_node and len(cell_node.args) >= 2:
                                    item_info['cell'] = [int(cell_node.args[0].num() or 0), int(cell_node.args[1].num() or 0)]
                                inventory.append(item_info)

    # 5. Chassis
    chassis: dict[str, Any] = {}
    for n in nodes:
        if isinstance(n, Node):
            for c_block in n.find_all('Chassis'):
                loc = c_block.find('Locomotion')
                if loc:
                    if 'Locomotion' not in chassis:
                        chassis['Locomotion'] = {}
                    loc_dict = _node_to_dict_or_val(loc)
                    if isinstance(loc_dict, dict):
                        chassis['Locomotion'].update(loc_dict)
                fbag = c_block.find('FuelBag')
                if fbag:
                    chassis['FuelBag'] = _node_to_dict_or_val(fbag)
                sp = c_block.find('speed')
                if sp:
                    chassis['speed'] = _node_to_dict_or_val(sp)

    # 6. Model path
    has_mdl = False
    stack = [n for n in nodes if isinstance(n, Node)]
    while stack:
        it = stack.pop(0)
        t = (it.tag or '').lower()
        if t == 'extension' and it.args:
            has_mdl = True
            break
        if t == 'skeleton':
            has_mdl = True
            break
        stack[0:0] = it.children
    model = vpath if has_mdl else None

    # 7. Armor summary (from {armor {setting ...}} blocks and volumes)
    armor: dict[str, Any] = {}
    for n in nodes:
        if isinstance(n, Node):
            for a_block in n.find_all('armor'):
                for s_node in a_block.find_all('setting'):
                    if s_node.args:
                        sname = str(s_node.args[0].value).strip('"')
                        thick_node = s_node.find('thickness')
                        if thick_node and thick_node.args:
                            vals = [_atom_val(a) for a in thick_node.args]
                            armor[sname] = vals if len(vals) > 1 else vals[0]

    for vol in volumes:
        comp = vol.get('component')
        if comp and 'thickness' not in vol and comp in armor:
            vol['thickness'] = armor[comp]
        elif comp and 'thickness' in vol and comp not in armor:
            armor[comp] = vol['thickness']

    return {
        'kind': 'entity',
        'name': name,
        'source': vpath,
        'files': list(pre.files),
        'model': model,
        'props': props,
        'volumes': volumes,
        'weaponry': weaponry,
        'inventory': inventory,
        'chassis': chassis,
        'armor': armor,
        'breed': None,
        'stuff': None,
        'raw': [to_json(n) for n in nodes]
    }


def build_human_proto(resolver: ProtoResolver, name: str) -> dict[str, Any]:
    vfs = resolver.vfs
    vpath = resolver.resolve_human_path(name)
    pre = Pre(vfs)
    nodes = pre.load(vpath)

    breed_node = next((n for n in nodes if isinstance(n, Node) and n.tag == 'breed'), None)
    if not breed_node:
        raise ValueError(f"No {{breed}} root found in {vpath}")

    skin = ''
    skin_node = breed_node.find('skin')
    if skin_node and skin_node.args:
        skin = str(skin_node.args[0].value).strip('"')

    armors: dict[str, str] = {}
    arm_node = breed_node.find('armors')
    if arm_node:
        for c in arm_node.children:
            tag = _get_node_tag(c)
            if tag and c.args:
                armors[tag] = str(c.args[0].value).strip('"')

    perks = {}
    perk_node = breed_node.find('perks')
    if perk_node:
        perks = _node_to_dict_or_val(perk_node)

    veterancy = {}
    vet_node = breed_node.find('veterancy')
    if vet_node:
        veterancy = _node_to_dict_or_val(vet_node)

    inventory = []
    inv_node = breed_node.find('inventory')
    if inv_node:
        for it in inv_node.children:
            if it.tag == 'item' and it.args:
                item_info: dict[str, Any] = {'name': str(it.args[0].value).strip('"')}
                if len(it.args) > 1:
                    cnt = it.args[1].num()
                    if cnt is not None:
                        item_info['count'] = int(cnt)
                    elif it.args[1].value == 'filled':
                        item_info['filled'] = True
                user_node = it.find('user')
                if user_node and user_node.args:
                    item_info['user'] = str(user_node.args[0].value).strip('"')
                cell_node = it.find('cell')
                if cell_node and len(cell_node.args) >= 2:
                    item_info['cell'] = [int(cell_node.args[0].num() or 0), int(cell_node.args[1].num() or 0)]
                inventory.append(item_info)

    # Model: resolve skin .def
    model = None
    if skin:
        try:
            model = resolver.resolve_entity_path(skin)
        except Exception:
            skin_cand = f'/entity/humanskin/{skin}/{skin}.def'
            if vfs.exists(skin_cand):
                model = skin_cand

    breed_info = {
        'skin': skin,
        'armors': armors,
        'perks': perks,
        'veterancy': veterancy,
        'inventory': inventory
    }

    return {
        'kind': 'human',
        'name': name,
        'source': vpath,
        'files': list(pre.files),
        'model': model,
        'props': ['human'],
        'volumes': [],
        'weaponry': [],
        'inventory': inventory,
        'chassis': {'speed': {'walk': 2.5, 'run': 5.0, 'crouch': 1.8, 'crawl': 1.0}},
        'armor': armors,
        'breed': breed_info,
        'stuff': None,
        'raw': [to_json(n) for n in nodes]
    }


def build_item_proto(resolver: ProtoResolver, name: str) -> dict[str, Any]:
    vfs = resolver.vfs
    vpath = resolver.resolve_stuff_path(name)

    # Chain of inheritance: from child to root
    chain: list[tuple[str, list[Node], str | None]] = []
    cur_path = vpath
    visited = set()
    pre = Pre(vfs)

    while cur_path and cur_path not in visited:
        visited.add(cur_path)
        nodes = pre.load(cur_path)
        from_ref, blocks = _extract_stuff_local_blocks(nodes)
        chain.append((cur_path, blocks, from_ref))
        if from_ref:
            try:
                cur_path = resolver.resolve_from_ref(from_ref)
            except Exception:
                break
        else:
            break

    # Accumulate merge from root to child
    chain.reverse()
    merged_blocks: list[Node] = []
    for _, blocks, _ in chain:
        merged_blocks = merge_blocks(merged_blocks, blocks)

    # Extract stuff properties
    stuff: dict[str, Any] = {}
    for b in merged_blocks:
        tag = _get_node_tag(b)
        if not tag:
            continue
        val = _node_to_dict_or_val(b)
        stuff[tag] = val

    # Entity visual
    entity_name = None
    if 'entity' in stuff:
        e_val = stuff['entity']
        entity_name = str(e_val[0] if isinstance(e_val, list) else e_val).strip('"')

    model = None
    if entity_name:
        try:
            model = resolver.resolve_entity_path(entity_name)
        except Exception:
            pass

    props = []
    if 'tag' in stuff:
        t_val = stuff['tag']
        if isinstance(t_val, str):
            props = t_val.split()
        elif isinstance(t_val, list):
            for item in t_val:
                props.extend(str(item).split())

    return {
        'kind': 'item',
        'name': name,
        'source': vpath,
        'files': list(pre.files),
        'model': model,
        'props': props,
        'volumes': [],
        'weaponry': [],
        'inventory': stuff.get('inventory', {}),
        'chassis': {},
        'armor': {},
        'breed': None,
        'stuff': stuff,
        'raw': [to_json(n) for n in merged_blocks]
    }


def resolve_proto(vfs, kind: str, name: str) -> dict[str, Any]:
    resolver = ProtoResolver(vfs)
    if kind == 'entity':
        return build_entity_proto(resolver, name)
    elif kind == 'human':
        return build_human_proto(resolver, name)
    elif kind == 'item':
        return build_item_proto(resolver, name)
    else:
        raise ValueError(f"Unknown prototype kind: {kind}. Expected entity, human, or item.")
