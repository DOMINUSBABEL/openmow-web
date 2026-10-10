"""Vehicle Census & Locomotion Probe across the 15 in-scope skirmish missions (T09).

Investigates:
1. All vehicles placed in 0.mi across 15 missions.
2. Locomotion properties (MaxSpeed km/h, StartTime, TurnTime, TurnRadius) in .def / properties.
3. Turret and gun bone names, revolute kind, limits, speed in MDL skeletons.
4. Crew Links in 0.mi (driver, gunner, commander, charger, seatN).
"""
import os
import sys
import posixpath
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node, Atom
from convert.proto import resolve_proto

MISSIONS = [
    'map/single/01_usa-skirmish/01_usa-overlord',
    'map/single/01_usa-skirmish/02_usa-carentan',
    'map/single/01_usa-skirmish/03_usa-ardennes',
    'map/single/02_ger-skirmish/01_ger-caen',
    'map/single/02_ger-skirmish/02_ger-sthilaire',
    'map/single/02_ger-skirmish/03_ger-marketgarden',
    'map/single/03_eng-skirmish/01_eng-battleaxe',
    'map/single/03_eng-skirmish/02_eng-torch',
    'map/single/03_eng-skirmish/03_eng-arnhem',
    'map/single/04_rus-skirmish/01_rus-smolensk',
    'map/single/04_rus-skirmish/02_rus-koenigsberg',
    'map/single/04_rus-skirmish/03_rus-manchuria',
    'map/single/05_jap-skirmish/01_jap-khalkhingol',
    'map/single/05_jap-skirmish/02_jap-singapore',
    'map/single/05_jap-skirmish/03_jap-iwojima',
]

def find_nodes(node, tag: str) -> list[Node]:
    out = []
    if isinstance(node, Node):
        if node.tag == tag:
            out.append(node)
        for c in node.children:
            out.extend(find_nodes(c, tag))
    return out

def get_def_path(vfs, proto: str) -> str | None:
    if not proto:
        return None
    proto = proto.replace('\\', '/').strip('/')
    cands = [
        f"/entity/{proto}.def",
        f"/entity/-vehicle/{proto}.def",
        f"/entity/construction/{proto}.def",
    ]
    for c in cands:
        if vfs.exists(c):
            return c
    base = posixpath.basename(proto)
    for p in vfs.files:
        if p.endswith(f"/{base}.def"):
            return p
    return None

def main():
    vfs = VFS()
    print("VFS loaded.")

    vehicle_protos = set()
    links_by_role = Counter()
    total_vehicles_placed = 0
    mission_vehicle_counts = {}

    for m in MISSIONS:
        mi_path = m + '/0.mi'
        items = parse_sdl(decode(vfs.read(mi_path), mi_path))
        root = items[0]
        m_vehicles = 0
        for it in root.children:
            if it.tag == 'Entity':
                proto = it.args[0].value if it.args else ''
                # Check if entity is vehicle / cannon
                def_path = get_def_path(vfs, proto)
                if def_path and ('/-vehicle/' in def_path or '/tank' in def_path or '/car' in def_path or '/cannon' in def_path or '/airborne' in def_path):
                    vehicle_protos.add(proto)
                    m_vehicles += 1
            elif it.tag == 'Link':
                # e.g. {Link 0x8001 {0x8002 "driver"}}
                if len(it.args) >= 1 and len(it.children) >= 1:
                    child = it.children[0]
                    role = child.args[0].value if child.args else 'unknown'
                    links_by_role[role] += 1

        mission_vehicle_counts[posixpath.basename(m)] = m_vehicles
        total_vehicles_placed += m_vehicles

    print(f"Total unique vehicle/cannon prototypes in 15 missions: {len(vehicle_protos)}")
    print(f"Total vehicle/cannon instances placed: {total_vehicles_placed}")
    print("\nMission vehicle counts:")
    for m, c in mission_vehicle_counts.items():
        print(f"  {m:<25}: {c}")

    print("\nCrew link roles in 0.mi:")
    for r, cnt in links_by_role.most_common(20):
        print(f"  {r:<20}: {cnt}")

    # Inspect locomotion parameters & revolute turret bones
    print("\n--- Locomotion & Turret Details ---")
    proto_locomotion = {}

    for proto in sorted(vehicle_protos):
        def_path = get_def_path(vfs, proto)
        if not def_path:
            continue
        try:
            p_data = resolve_proto(vfs, 'entity', proto)
            loco = p_data.get('locomotion', {})
            # Also parse MDL for bones
            mdl_path = p_data.get('model')
            bones_info = []
            if mdl_path and vfs.exists(mdl_path):
                mdl_nodes = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
                for m_it in mdl_nodes:
                    for b_node in find_nodes(m_it, 'bone'):
                        b_name = b_node.args[0].value if b_node.args else ''
                        is_revolute = any(a.value == 'revolute' for a in b_node.args)
                        limits = b_node.find('limits')
                        speed = b_node.find('speed')
                        lim_vals = [float(a.value) for a in limits.args] if limits else None
                        spd_val = float(speed.args[0].value) if speed and speed.args else None
                        if is_revolute or 'turret' in b_name.lower() or 'gun' in b_name.lower():
                            bones_info.append({
                                'name': b_name,
                                'revolute': is_revolute,
                                'limits': lim_vals,
                                'speed': spd_val,
                            })

            proto_locomotion[proto] = {
                'def': def_path,
                'loco': loco,
                'bones': bones_info,
            }
        except Exception as e:
            print(f"Error inspecting {proto}: {e}")

    # Print representative sample
    for proto in ['m4a3_75', 'pz6e', 'stug3g', 'flak41', 'willysmb', 'blitz3_6']:
        if proto in proto_locomotion:
            d = proto_locomotion[proto]
            print(f"\nProto: {proto}")
            print(f"  Locomotion: {d['loco']}")
            print(f"  Turret/Gun bones: {d['bones']}")

if __name__ == '__main__':
    main()
