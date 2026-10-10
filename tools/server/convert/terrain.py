"""GEM2 terrain (map.ply + mtl*.mtl) -> glTF 2.0 binary (GLB) converter (T02).

Coordinate contract (docs/CONTRACTS.md §coords):
  Terrain coordinates are emitted raw in GEM2 space (z-up, left-handed, units = 5 cm).
  The client applies createGemRoot() on scene root once for both models and terrain.
"""
from __future__ import annotations
import json
import posixpath
import struct
from typing import Any
import numpy as np

from formats.bply import parse_bply
from formats.sdl import parse_sdl, decode, Node


class TerrainError(ValueError):
    pass


def parse_terrain_mtl(vfs, mtl_path: str) -> dict[str, Any]:
    """Parse terrain .mtl file and extract all layers with resolved textures."""
    out = {
        'name': mtl_path,
        'diffuse': None,
        'bump': None,
        'layers': [],
    }
    if not vfs.exists(mtl_path):
        return out

    base = posixpath.dirname(mtl_path)
    items = parse_sdl(decode(vfs.read(mtl_path), mtl_path))
    for it in items:
        if isinstance(it, Node) and it.tag == 'material':
            for c in it.children:
                if c.tag == 'layer':
                    lay: dict[str, Any] = {}
                    for prop in c.children:
                        tag = prop.tag
                        if tag and prop.args:
                            val = prop.args[0].value
                            if tag in ('diffuse', 'bump'):
                                resolved = vfs.resolve(val, base, ('.dds', '.tga', ''))
                                lay[tag] = resolved
                                lay[tag + '_raw'] = val
                            else:
                                lay[tag] = val
                    out['layers'].append(lay)

    if out['layers']:
        out['diffuse'] = out['layers'][0].get('diffuse')
        out['bump'] = out['layers'][0].get('bump')

    return out


class TerrainGlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.gltf = {
            'asset': {'version': '2.0', 'generator': 'openmow-web-terrain'},
            'scenes': [{'nodes': [0]}],
            'scene': 0,
            'nodes': [],
            'meshes': [],
            'accessors': [],
            'bufferViews': [],
            'materials': [],
            'textures': [],
            'images': [],
            'samplers': [{
                'magFilter': 9729,  # LINEAR
                'minFilter': 9987,  # LINEAR_MIPMAP_LINEAR
                'wrapS': 10497,     # REPEAT
                'wrapT': 10497      # REPEAT
            }]
        }
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

        m: dict[str, Any] = {
            'name': posixpath.basename(key),
            'doubleSided': True,
            'pbrMetallicRoughness': {
                'metallicFactor': 0.0,
                'roughnessFactor': 0.9
            },
            'extras': {
                'layers': mtl.get('layers', [])
            }
        }

        diffuse_path = mtl.get('diffuse')
        if diffuse_path:
            url = tex_url(diffuse_path)
            if url not in self._img_cache:
                self.gltf['images'].append({'uri': url})
                self.gltf['textures'].append({'source': len(self.gltf['images']) - 1, 'sampler': 0})
                self._img_cache[url] = len(self.gltf['textures']) - 1
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': self._img_cache[url]}
        else:
            m['pbrMetallicRoughness']['baseColorFactor'] = [0.4, 0.4, 0.4, 1.0]

        self.gltf['materials'].append(m)
        idx = len(self.gltf['materials']) - 1
        self._mat_cache[key] = idx
        return idx

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


def terrain_to_glb(vfs, mission_vpath: str, tex_url=lambda p: '/conv/tex' + p + '.png') -> tuple[bytes, dict]:
    """Convert terrain of a mission into glTF 2.0 binary (GLB)."""
    clean = '/' + mission_vpath.strip('/')
    ply_path = clean + '/map.ply'
    if not vfs.exists(ply_path):
        raise FileNotFoundError(f"Terrain mesh not found: {ply_path}")

    t = parse_bply(vfs.read(ply_path))
    g = TerrainGlbBuilder()
    report = {
        'mission': mission_vpath,
        'vertices': t.vertex_count,
        'submeshes': len(t.submeshes),
        'triangles': len(t.indices) // 12,
        'bbox': list(t.bbox)
    }

    # Extract vertex buffers
    raw = np.frombuffer(t.vertices, np.uint8).reshape(t.vertex_count, t.stride)
    pos = np.ascontiguousarray(raw[:, :12]).view('<f4').reshape(-1, 3)
    nrm = np.ascontiguousarray(raw[:, 12:24]).view('<f4').reshape(-1, 3)
    # Convert BGRA (D3D) to RGBA (glTF)
    rgba = np.ascontiguousarray(raw[:, [26, 25, 24, 27]])
    uv0 = np.ascontiguousarray(raw[:, 28:36]).view('<f4').reshape(-1, 2)

    pos_acc = g.accessor(pos, 'VEC3', 5126, 34962, minmax=True)
    nrm_acc = g.accessor(nrm, 'VEC3', 5126, 34962)
    col_acc = g.accessor(rgba, 'VEC4', 5121, 34962, normalized=True)
    uv0_acc = g.accessor(uv0, 'VEC2', 5126, 34962)

    attrs = {
        'POSITION': pos_acc,
        'NORMAL': nrm_acc,
        'TEXCOORD_0': uv0_acc
    }

    if t.stride >= 44:
        uv1 = np.ascontiguousarray(raw[:, 36:44]).view('<f4').reshape(-1, 2)
        attrs['TEXCOORD_1'] = g.accessor(uv1, 'VEC2', 5126, 34962)

    idx_all = np.frombuffer(t.indices, '<u4')
    prims = []

    for sm in t.submeshes:
        start = sm.first_tri * 3
        end = (sm.first_tri + sm.tri_count) * 3
        sub_idx = np.ascontiguousarray(idx_all[start:end])
        if len(sub_idx) == 0:
            continue
        idx_acc = g.accessor(sub_idx.reshape(-1, 1), 'SCALAR', 5125, 34963)
        mtl_file = clean + '/' + sm.material
        mtl_data = parse_terrain_mtl(vfs, mtl_file)
        mat_id = g.material(mtl_data, tex_url)
        prims.append({
            'attributes': attrs,
            'indices': idx_acc,
            'material': mat_id
        })

    mesh_name = posixpath.basename(clean) + '_terrain'
    g.gltf['meshes'].append({
        'name': mesh_name,
        'primitives': prims,
        'extras': {
            'bbox': list(t.bbox)
        }
    })

    g.gltf['nodes'].append({
        'name': mesh_name,
        'mesh': 0
    })

    return g.glb(), report
