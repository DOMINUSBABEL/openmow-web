"""GEM2 entity (.def/.mdl/.ply/.mtl) -> glTF 2.0 binary (GLB) converter.

Coordinate contract (docs/CONTRACTS.md §coords):
  GEM2 data is z-up, left-handed (Direct3D), 1 unit = 5 cm.
  The GLB keeps GEM2 units and node matrices untouched; the client applies ONE scene
  root transform (mirror Y, then z-up -> y-up) shared by models and terrain.
Skinned meshes (PLY with SKIN) are emitted in bind pose with JOINTS_0/WEIGHTS_0 and the
joint names in mesh.extras.skin (skin binding is a client task, F3).
"""
from __future__ import annotations
import json
import struct
import posixpath
import numpy as np

from formats.sdl import parse_sdl, decode, Node, Atom
from formats.gem_pre import Pre
from formats.ply import parse_ply, used_index_ranges


class ModelError(ValueError):
    pass


def _nodes(items):
    return [i for i in items if isinstance(i, Node)]


def _first(node: Node, tag: str):
    for c in node.children:
        if c.kind == '{' and c.tag and c.tag.lower() == tag.lower():
            return c
    return None


def _nums(node: Node) -> list[float]:
    out = []
    for a in node.items[1:]:
        if isinstance(a, Atom):
            v = a.num()
            if v is not None:
                out.append(float(v))
    return out


def def_to_mdl(vfs, def_path: str) -> str:
    """Resolve the model referenced by an entity .def ({Extension "x.mdl"})."""
    pre = Pre(vfs)
    try:
        nodes = pre.load(def_path)
    except Exception:
        nodes = parse_sdl(decode(vfs.read(def_path), def_path))
    base = posixpath.dirname(def_path)
    stack = list(nodes)
    while stack:
        it = stack.pop(0)
        if isinstance(it, Node):
            t = (it.tag or '').lower()
            if it.kind == '{' and t == 'extension' and it.args:
                ref = str(it.args[0].value).strip('"')
                if ref.lower().endswith('.mdl'):
                    p = vfs.resolve(ref, base)
                    if p:
                        return p
            stack[0:0] = it.children
    raise ModelError(f'no Extension .mdl in {def_path}')


def bone_name_kind(b: Node) -> tuple[str, str | None]:
    """`{bone [kind] "name" ...}` -> (name, kind). Name is the first quoted atom."""
    kind = None
    for a in b.args:
        if a.quoted:
            return a.value, kind
        kind = a.value
    return (kind or '?'), None


def parse_params(s: str) -> dict:
    """'ID=body;WheelRadius=0.7;' -> {'ID': 'body', 'WheelRadius': '0.7'} (flags w/o '=' -> True)."""
    out: dict = {}
    for part in s.split(';'):
        part = part.strip()
        if not part:
            continue
        if '=' in part:
            k, v = part.split('=', 1)
            out[k.strip()] = v.strip()
        else:
            out[part] = True
    return out


def bone_matrix(b: Node) -> list[float]:
    """Row-vector 4x4 (D3D) flattened row-major == glTF column-major array."""
    m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    o = _first(b, 'Orientation')
    m34 = _first(b, 'Matrix34')
    pos = _first(b, 'Position')
    if m34 is not None:
        v = _nums(m34)
        if len(v) >= 12:
            m = [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1]
    elif o is not None:
        v = _nums(o)
        if len(v) >= 9:
            m = [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, 0, 0, 0, 1]
    if pos is not None and m34 is None:
        v = _nums(pos)
        if len(v) >= 3:
            m[12], m[13], m[14] = v[0], v[1], v[2]
    return [float(x) for x in m]


def mat3_to_quat(m: np.ndarray) -> list[float]:
    trace = m[0, 0] + m[1, 1] + m[2, 2]
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (m[2, 1] - m[1, 2]) * s
        y = (m[0, 2] - m[2, 0]) * s
        z = (m[1, 0] - m[0, 1]) * s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2.0 * np.sqrt(max(1e-9, 1.0 + m[0, 0] - m[1, 1] - m[2, 2]))
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = 2.0 * np.sqrt(max(1e-9, 1.0 + m[1, 1] - m[0, 0] - m[2, 2]))
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(max(1e-9, 1.0 + m[2, 2] - m[0, 0] - m[1, 1]))
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    l = np.sqrt(x * x + y * y + z * z + w * w)
    if l > 0:
        x, y, z, w = x / l, y / l, z / l, w / l
    return [float(x), float(y), float(z), float(w)]


def bone_transform(b: Node) -> dict:
    m = bone_matrix(b)
    r3 = np.array([
        [m[0], m[1], m[2]],
        [m[4], m[5], m[6]],
        [m[8], m[9], m[10]],
    ], dtype=np.float64)
    det = np.linalg.det(r3)
    if det < 0:
        # Negative determinant (mirrored Y axis in GEM2 conventions)
        # Decompose with scale.y = -1 so glTF/Three.js keeps exact orientation without flipping
        r_ortho = r3 @ np.diag([1.0, -1.0, 1.0])
        q = mat3_to_quat(r_ortho)
        t = [m[12], m[13], m[14]]
        return {'translation': t, 'rotation': q, 'scale': [1.0, -1.0, 1.0]}
    return {'matrix': m}


def parse_mtl(vfs, path: str) -> dict:
    out = {'type': 'simple', 'diffuse': None, 'blend': None, 'alpharef': None, 'color': None, 'name': path}
    try:
        items = parse_sdl(decode(vfs.read(path), path))
    except FileNotFoundError:
        out['missing'] = True
        return out
    base = posixpath.dirname(path)
    for it in _nodes(items):
        if it.tag != 'material':
            continue
        if it.args:
            out['type'] = it.args[0].value
        for c in it.children:
            t = (c.tag or '').lower()
            a = c.args
            if t in ('diffuse', 'bump', 'specular', 'mask', 'diffuse1') and a:
                out[t] = vfs.resolve(a[0].value, base, ('.dds', '.tga', ''))
                out[t + '_ref'] = a[0].value
            elif t == 'blend' and a:
                out['blend'] = a[0].value
            elif t == 'alpharef' and a:
                out['alpharef'] = a[0].num()
            elif t == 'color' and a:
                out['color'] = a[0].value
        # terrain style layered material: first layer diffuse
        lay = _first(it, 'layer')
        if lay is not None and out.get('diffuse') is None:
            d = _first(lay, 'diffuse')
            if d is not None and d.args:
                out['diffuse'] = vfs.resolve(d.args[0].value, base, ('.dds', '.tga', ''))
    return out


class GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.gltf = {'asset': {'version': '2.0', 'generator': 'openmow-web'}, 'scenes': [{'nodes': [0]}],
                     'scene': 0, 'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [],
                     'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987,
                                                                                  'wrapS': 10497, 'wrapT': 10497}]}
        self._mat_cache: dict[str, int] = {}
        self._img_cache: dict[str, int] = {}

    def view(self, data: bytes, target: int | None = None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        bv = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.bin += data
        self.gltf['bufferViews'].append(bv)
        return len(self.gltf['bufferViews']) - 1

    def accessor(self, arr: np.ndarray, typ: str, ctype: int, target: int | None, minmax=False, normalized=False) -> int:
        bv = self.view(arr.tobytes(), target)
        acc = {'bufferView': bv, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in arr.min(axis=0)]
            acc['max'] = [float(x) for x in arr.max(axis=0)]
        self.gltf['accessors'].append(acc)
        return len(self.gltf['accessors']) - 1

    def material(self, mtl: dict, tex_url) -> int:
        key = mtl['name']
        if key in self._mat_cache:
            return self._mat_cache[key]
        m = {'name': posixpath.basename(key), 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.9},
             'extras': {k: v for k, v in mtl.items() if isinstance(v, (str, int, float)) or v is None}}
        if mtl.get('diffuse'):
            url = tex_url(mtl['diffuse'])
            if url not in self._img_cache:
                self.gltf['images'].append({'uri': url})
                self.gltf['textures'].append({'source': len(self.gltf['images']) - 1, 'sampler': 0})
                self._img_cache[url] = len(self.gltf['textures']) - 1
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': self._img_cache[url]}
        else:
            m['pbrMetallicRoughness']['baseColorFactor'] = [0.6, 0.6, 0.6, 1]
        blend = (mtl.get('blend') or '').lower()
        if blend in ('test', 'alphatest') or mtl.get('alpharef') is not None:
            m['alphaMode'] = 'MASK'
            ar = mtl.get('alpharef')
            m['alphaCutoff'] = (ar / 255.0) if isinstance(ar, (int, float)) and ar > 1 else 0.5
        elif blend in ('blend', 'add', 'alpha'):
            m['alphaMode'] = 'BLEND'
        self.gltf['materials'].append(m)
        self._mat_cache[key] = len(self.gltf['materials']) - 1
        return self._mat_cache[key]

    def mesh_from_ply(self, ply, mtl_for, name: str, host_bone: str = 'basis') -> int:
        lay = ply.layout
        v = np.frombuffer(ply.vertices, np.uint8).reshape(ply.vertex_count, lay.stride)

        def f32(off, n):
            return np.ascontiguousarray(v[:, off:off + 4 * n]).view('<f4').reshape(-1, n)

        attrs = {'POSITION': self.accessor(f32(lay.pos, 3).astype('<f4'), 'VEC3', 5126, 34962, minmax=True)}
        if lay.normal is not None:
            attrs['NORMAL'] = self.accessor(f32(lay.normal, 3).astype('<f4'), 'VEC3', 5126, 34962)
        if lay.uv0 is not None:
            attrs['TEXCOORD_0'] = self.accessor(f32(lay.uv0, 2).astype('<f4'), 'VEC2', 5126, 34962)
        extras = {}
        idx_all = np.frombuffer(ply.indices, '<u2')
        prims = []
        skinned = ply.skin is not None and lay.bones is not None
        if skinned:
            skin_palette = [host_bone] + ply.skin
        for sm, (a, b) in zip(ply.submeshes, used_index_ranges(ply)):
            if b <= a:
                continue
            pattrs = dict(attrs)
            if skinned:
                # palette-local indices -> SKIN indices, per submesh remap
                remap = np.array(sm.bone_remap or list(range(256)), dtype=np.uint16)
                local = np.ascontiguousarray(v[:, lay.bones:lay.bones + 4])
                j = remap[np.minimum(local, len(remap) - 1)].astype('<u2')
                w0 = f32(lay.weight, 1)[:, 0]
                w = np.zeros((ply.vertex_count, 4), '<f4'); w[:, 0] = w0; w[:, 1] = 1 - w0
                pattrs['JOINTS_0'] = self.accessor(j, 'VEC4', 5123, 34962)
                pattrs['WEIGHTS_0'] = self.accessor(w, 'VEC4', 5126, 34962)
            idx = idx_all[a:b].astype('<u2')
            prims.append({'attributes': pattrs, 'indices': self.accessor(idx.reshape(-1, 1), 'SCALAR', 5123, 34963),
                          'material': self.material(*mtl_for(sm.material))})
        if skinned:
            extras['skin'] = skin_palette
        self.gltf['meshes'].append({'name': name, 'primitives': prims, 'extras': extras})
        return len(self.gltf['meshes']) - 1

    def glb(self) -> bytes:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.gltf['buffers'] = [{'byteLength': len(self.bin)}]
        for k in ('images', 'textures', 'materials', 'meshes'):
            if not self.gltf[k]:
                del self.gltf[k]
        if 'textures' not in self.gltf:
            self.gltf.pop('samplers', None)
        js = json.dumps(self.gltf, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js +
                struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))


def mdl_to_glb(vfs, mdl_path: str, tex_url=lambda p: '/conv/tex' + p + '.png', lod: int = 0) -> tuple[bytes, dict]:
    base = posixpath.dirname(mdl_path)
    items = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
    skel = next((n for n in _nodes(items) if n.tag == 'Skeleton'), None)
    if skel is None:
        raise ModelError(f'no Skeleton in {mdl_path}')
    g = GlbBuilder()
    report = {'missing': [], 'meshes': 0, 'bones': 0, 'hidden': []}
    g.gltf['nodes'].append({'name': posixpath.basename(mdl_path), 'children': []})
    ply_cache: dict[str, int] = {}

    def mtl_for(name):
        p = vfs.resolve(name, base) or norm_join(base, name)
        m = parse_mtl(vfs, p)
        if m.get('missing'):
            report['missing'].append(p)
        return (m, tex_url)

    def add_view(ref: str, node: dict):
        p = vfs.resolve(ref, base)
        if not p:
            report['missing'].append(norm_join(base, ref)); return
        host_name = node.get('name', 'basis')
        cache_key = (p, host_name)
        if cache_key not in ply_cache:
            ply = parse_ply(vfs.read(p))
            ply_cache[cache_key] = g.mesh_from_ply(ply, mtl_for, posixpath.basename(p), host_bone=host_name)
            report['meshes'] += 1
        mesh_i = ply_cache[cache_key]
        node['mesh'] = mesh_i
        if 'skin' in g.gltf['meshes'][mesh_i]['extras']:
            # skinned PLY: vertices live in the declaring bone's space (bind pose); joints = extras.skin names
            node.setdefault('extras', {})['skinned'] = True

    def walk(b: Node, parent: int):
        name, kind = bone_name_kind(b)
        nd = {'name': name, **bone_transform(b)}
        ex = {}
        if kind:
            ex['kind'] = kind
        par = _first(b, 'parameters')
        if par is not None and par.args:
            ex['parameters'] = parse_params(par.args[0].value)
        lim = _first(b, 'limits')
        if lim is not None:
            ex['limits'] = _nums(lim)
        spd = _first(b, 'speed')
        if spd is not None:
            ex['speed'] = (_nums(spd) or [None])[0]
        anim = _first(b, 'animation')
        if anim is not None:
            seqs = {}
            for s in anim.children:
                if s.tag == 'sequence' and s.args:
                    f = _first(s, 'file')
                    sp = _first(s, 'speed')
                    seqs[s.args[0].value] = {
                        'file': vfs.resolve(f.args[0].value, base) if f is not None and f.args else None,
                        'speed': (_nums(sp) or [1.0])[0] if sp is not None else 1.0,
                        'resume': _first(s, 'resume') is not None,
                    }
            ex['anims'] = seqs
        vis = _first(b, 'visibility')
        if vis is not None and _nums(vis)[:1] == [0.0]:
            ex['hidden'] = True
            report['hidden'].append(name)
        if ex:
            nd['extras'] = ex
        g.gltf['nodes'].append(nd)
        me = len(g.gltf['nodes']) - 1
        g.gltf['nodes'][parent].setdefault('children', []).append(me)
        report['bones'] += 1
        vv = _first(b, 'VolumeView')
        if vv is not None and vv.args:
            add_view(vv.args[0].value, nd)
        lv = _first(b, 'LODView')
        if lv is not None:
            views = [c for c in lv.children if c.tag == 'VolumeView' and c.args]
            if views:
                add_view(views[min(lod, len(views) - 1)].args[0].value, nd)
        for c in b.children:
            if c.kind == '{' and c.tag == 'bone':
                walk(c, me)

    for b in skel.children:
        if b.kind == '{' and b.tag == 'bone':
            walk(b, 0)
    return g.glb(), report


def norm_join(base, ref):
    return posixpath.normpath(base + '/' + ref).lower()
