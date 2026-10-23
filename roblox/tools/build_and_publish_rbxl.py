#!/usr/bin/env python3
"""
War of Men — Binary .rbxl Compiler & Cloud Publisher
Compiles WarOfMen_Roblox.rbxl (Roblox Binary Place format) with all Shared, Server,
and Client Luau modules, RemoteEvents, and Battlefield folders, then publishes
it directly to RootPlaceId 133837357200651 (UniverseId 10772595182) via Roblox Cloud.
"""
import os
import sys
import json
import gzip
import time
import struct
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from publish_to_roblox import get_studio_cookie, RobloxStudioClient


def read_src(rel: str) -> str:
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8") as f:
        return f.read()


def lz4_decompress(src: bytes, uncomp_len: int) -> bytes:
    out = bytearray()
    i = 0
    n = len(src)
    while i < n:
        token = src[i]
        i += 1
        lit_len = token >> 4
        if lit_len == 15:
            while i < n:
                b = src[i]
                i += 1
                lit_len += b
                if b != 255:
                    break
        out.extend(src[i : i + lit_len])
        i += lit_len
        if i >= n:
            break
        offset = src[i] | (src[i + 1] << 8)
        i += 2
        match_len = (token & 0x0F) + 4
        if (token & 0x0F) == 15:
            while i < n:
                b = src[i]
                i += 1
                match_len += b
                if b != 255:
                    break
        start = len(out) - offset
        for j in range(match_len):
            out.append(out[start + j])
    return bytes(out)


def lz4_compress_literals(raw: bytes) -> bytes:
    n = len(raw)
    if n < 15:
        return bytes([n << 4]) + raw
    rem = n - 15
    ext = bytes([255] * (rem // 255)) + bytes([rem % 255])
    return b"\xf0" + ext + raw


def read_referents(buf: bytes, count: int) -> list:
    ints = []
    for i in range(count):
        u = (
            (buf[i] << 24)
            | (buf[count + i] << 16)
            | (buf[2 * count + i] << 8)
            | buf[3 * count + i]
        )
        val = (u >> 1) ^ (-(u & 1))
        ints.append(val)
    out = []
    acc = 0
    for v in ints:
        acc += v
        out.append(acc)
    return out


def encode_referents(refs: list) -> bytes:
    deltas = []
    prev = 0
    for r in refs:
        d = r - prev
        prev = r
        u = ((d << 1) ^ (d >> 31)) & 0xFFFFFFFF
        deltas.append(u)
    b0 = bytes((u >> 24) & 0xFF for u in deltas)
    b1 = bytes((u >> 16) & 0xFF for u in deltas)
    b2 = bytes((u >> 8) & 0xFF for u in deltas)
    b3 = bytes(u & 0xFF for u in deltas)
    return b0 + b1 + b2 + b3


def make_chunk(cname: bytes, raw: bytes) -> bytes:
    if cname == b"END\x00":
        return cname + struct.pack("<III", 0, len(raw), 0) + raw
    comp = lz4_compress_literals(raw)
    return cname + struct.pack("<III", len(comp), len(raw), 0) + comp


def make_inst_chunk(tid: int, class_name: str, refs: list) -> bytes:
    cb = class_name.encode("utf-8")
    raw = (
        struct.pack("<II", tid, len(cb))
        + cb
        + b"\x00"
        + struct.pack("<I", len(refs))
        + encode_referents(refs)
    )
    return make_chunk(b"INST", raw)


def make_prop_string_chunk(tid: int, prop_name: str, values: list) -> bytes:
    pb = prop_name.encode("utf-8")
    body = bytearray()
    for v in values:
        vb = v.encode("utf-8")
        body.extend(struct.pack("<I", len(vb)))
        body.extend(vb)
    raw = struct.pack("<II", tid, len(pb)) + pb + b"\x01" + bytes(body)
    return make_chunk(b"PROP", raw)


def main():
    client = RobloxStudioClient(get_studio_cookie())
    place_id = 133837357200651
    universe_id = 10772595182

    # Fetch clean template version 1 of the place
    s, r = client.request("GET", f"https://assetdelivery.roblox.com/v2/assetId/{place_id}/version/1")
    d = json.loads(r)
    raw_dl = urllib.request.urlopen(d["locations"][0]["location"]).read()
    rbxl = gzip.decompress(raw_dl) if raw_dl[:2] == b"\x1f\x8b" else raw_dl

    ver, num_types, num_insts, res = struct.unpack("<HIIQ", rbxl[14:32])
    pos = 32
    inst_chunks = []
    prop_chunks = []
    other_before_inst = []
    prnt_raw = None
    end_chunk = None

    while pos < len(rbxl):
        cname = rbxl[pos : pos + 4]
        clen, ulen, r2 = struct.unpack("<III", rbxl[pos + 4 : pos + 16])
        full_chunk = rbxl[pos : pos + 16 + (clen if clen else ulen)]
        data = rbxl[pos + 16 : pos + 16 + (clen if clen else ulen)]
        pos += 16 + (clen if clen else ulen)
        if cname == b"SSTR":
            other_before_inst.append(full_chunk)
        elif cname == b"INST":
            inst_chunks.append(full_chunk)
        elif cname == b"PROP":
            prop_chunks.append(full_chunk)
        elif cname == b"PRNT":
            prnt_raw = lz4_decompress(data, ulen) if clen else data
        elif cname == b"END\x00":
            end_chunk = full_chunk

    cnt = struct.unpack("<I", prnt_raw[1:5])[0]
    children = read_referents(prnt_raw[5 : 5 + 4 * cnt], cnt)
    parents = read_referents(prnt_raw[5 + 4 * cnt : 5 + 8 * cnt], cnt)
    assert read_referents(encode_referents(children), cnt) == children
    assert read_referents(encode_referents(parents), cnt) == parents

    # 74: Folder (refs 74, 75, 76)
    folder_refs = [74, 75, 76]
    folder_names = ["Shared", "WarOfMenRemotes", "WarOfMenBattlefield"]
    folder_parents = [57, 57, 0]

    # 75: RemoteEvent (refs 77..90)
    remote_names = [
        "IssueMoveOrder",
        "IssueAttackOrder",
        "SetPostureOrder",
        "SetFireModeOrder",
        "CallReinforcementOrder",
        "SelectMissionOrder",
        "ToggleBotModeOrder",
        "DirectControlFireOrder",
        "DirectControlMoveOrder",
        "ResetSkirmishOrder",
        "SyncBattleState",
        "CombatShotBroadcast",
        "BattleBannerBroadcast",
        "SyncPlayerProfile",
    ]
    remote_refs = list(range(77, 77 + len(remote_names)))
    remote_parents = [75] * len(remote_names)

    # 76: ModuleScript (refs 91..96)
    mod_refs = [91, 92, 93, 94, 95, 96]
    mod_names = [
        "WarOfMenCatalog",
        "NetProtocol",
        "ProfileStoreService",
        "BallisticsCombatService",
        "WorldSimService",
        "TacticalAIService",
    ]
    mod_sources = [
        read_src("src/Shared/WarOfMenCatalog.luau"),
        read_src("src/Shared/NetProtocol.luau"),
        read_src("src/Server/ProfileStoreService.luau"),
        read_src("src/Server/BallisticsCombatService.luau"),
        read_src("src/Server/WorldSimService.luau"),
        read_src("src/Server/TacticalAIService.luau"),
    ]
    mod_parents = [74, 74, 58, 58, 58, 58]

    # 77: Script (ref 97)
    scr_refs = [97]
    scr_names = ["GameServer"]
    scr_sources = [read_src("src/Server/GameServer.server.luau")]
    scr_parents = [58]

    # 78: LocalScript (refs 98, 99)
    lscr_refs = [98, 99]
    lscr_names = ["WarOfMenClientStarter", "WarOfMenClient"]
    lscr_sources = [
        read_src("src/Client/WarOfMenClient.client.luau"),
        read_src("src/Client/WarOfMenClient.client.luau"),
    ]
    lscr_parents = [23, 20]

    inst_chunks.append(make_inst_chunk(74, "Folder", folder_refs))
    inst_chunks.append(make_inst_chunk(75, "RemoteEvent", remote_refs))
    inst_chunks.append(make_inst_chunk(76, "ModuleScript", mod_refs))
    inst_chunks.append(make_inst_chunk(77, "Script", scr_refs))
    inst_chunks.append(make_inst_chunk(78, "LocalScript", lscr_refs))

    prop_chunks.append(make_prop_string_chunk(74, "Name", folder_names))
    prop_chunks.append(make_prop_string_chunk(75, "Name", remote_names))
    prop_chunks.append(make_prop_string_chunk(76, "Name", mod_names))
    prop_chunks.append(make_prop_string_chunk(76, "Source", mod_sources))
    prop_chunks.append(make_prop_string_chunk(77, "Name", scr_names))
    prop_chunks.append(make_prop_string_chunk(77, "Source", scr_sources))
    prop_chunks.append(make_prop_string_chunk(78, "Name", lscr_names))
    prop_chunks.append(make_prop_string_chunk(78, "Source", lscr_sources))

    new_children = folder_refs + remote_refs + mod_refs + scr_refs + lscr_refs
    new_parents = (
        folder_parents + remote_parents + mod_parents + scr_parents + lscr_parents
    )

    all_children = new_children + children
    all_parents = new_parents + parents
    total_insts = len(all_children)
    total_types = num_types + 5

    new_prnt_raw = (
        b"\x00"
        + struct.pack("<I", total_insts)
        + encode_referents(all_children)
        + encode_referents(all_parents)
    )
    new_prnt_chunk = make_chunk(b"PRNT", new_prnt_raw)

    new_header = rbxl[:14] + struct.pack("<HIIQ", ver, total_types, total_insts, res)
    out_rbxl = (
        new_header
        + b"".join(other_before_inst)
        + b"".join(inst_chunks)
        + b"".join(prop_chunks)
        + new_prnt_chunk
        + end_chunk
    )

    out_rbxl_path = os.path.join(ROOT, "WarOfMen_Roblox.rbxl")
    with open(out_rbxl_path, "wb") as f:
        f.write(out_rbxl)
    print(f"Wrote binary RBXL: {out_rbxl_path} ({len(out_rbxl)} bytes)")

    s2, r2 = client.patch_place_user_auth(place_id, out_rbxl_path, True)
    print(f"PATCH binary RBXL status: HTTP {s2}: {r2}")
    if s2 == 200:
        op = json.loads(r2).get("operationId")
        for _ in range(12):
            time.sleep(2)
            so, ro = client.request(
                "GET", f"https://apis.roblox.com/assets/user-auth/v1/operations/{op}"
            )
            print(f"Operation poll: HTTP {so}: {ro}")
            try:
                od = json.loads(ro)
                if od.get("done"):
                    break
            except Exception:
                pass


if __name__ == "__main__":
    main()
