"""GEM2 1m Navigation Grid Converter (T08).

Precomputes a 1-meter (20 GEM units) resolution navigation grid for a mission:
1. Derives grid bounds from map.ply.
2. Marks terrain slope > 45 degrees (surface normal nz < 0.7071) as impassable.
3. Resolves static entity placements from both 0.mi and map, rasterizing their
   MDL collision obstacle shapes (Obb2, Circle2, Polygon2) onto the grid.
4. Encodes walkable/blocked mask using Run-Length Encoding (RLE) for minimal payload.
"""
from __future__ import annotations
import math
import posixpath
import time
from typing import Any
import numpy as np

from formats.bply import parse_bply
from formats.sdl import parse_sdl, decode, Node, Atom


def find_nodes(node, tag: str) -> list[Node]:
    out = []
    if isinstance(node, Node):
        if node.tag == tag:
            out.append(node)
        for c in node.children:
            out.extend(find_nodes(c, tag))
    return out


class ObstacleCatalog:
    """Caches resolved obstacle geometry per prototype."""

    def __init__(self, vfs):
        self.vfs = vfs
        self.proto_cache: dict[str, list[dict[str, Any]]] = {}
        self._def_index: dict[str, str] = {}
        for p in vfs.files:
            if p.endswith('.def'):
                base = posixpath.basename(p)[:-4].lower()
                if base not in self._def_index:
                    self._def_index[base] = p

    def get_def_path(self, proto: str) -> str | None:
        if not proto:
            return None
        proto = proto.replace('\\', '/').strip('/').lower()
        cands = [
            f"/entity/{proto}.def",
            f"/entity/-vehicle/{proto}.def",
            f"/entity/construction/{proto}.def",
            f"/entity/landscape/{proto}.def",
            f"/entity/flora/{proto}.def",
            f"/entity/inventory/{proto}.def",
            f"/entity/service/{proto}.def",
        ]
        for c in cands:
            if self.vfs.exists(c):
                return c
        base = posixpath.basename(proto)
        return self._def_index.get(base)

    def get_obstacles(self, proto: str) -> list[dict[str, Any]]:
        if proto in self.proto_cache:
            return self.proto_cache[proto]

        def_path = self.get_def_path(proto)
        if not def_path:
            self.proto_cache[proto] = []
            return []

        obs_list: list[dict[str, Any]] = []
        try:
            def_nodes = parse_sdl(decode(self.vfs.read(def_path), def_path))
            ext = None
            for e_n in find_nodes(def_nodes[0], 'Extension'):
                if e_n.args:
                    ext = e_n.args[0].value
            mdl_path = None
            if ext:
                mdl_path = posixpath.normpath(posixpath.join(posixpath.dirname(def_path), ext))
            if not mdl_path or not self.vfs.exists(mdl_path):
                mdl_path = posixpath.splitext(def_path)[0] + '.mdl'

            if self.vfs.exists(mdl_path):
                mdl_nodes = parse_sdl(decode(self.vfs.read(mdl_path), mdl_path))
                for m_it in mdl_nodes:
                    for obs in find_nodes(m_it, 'Obstacle'):
                        obb2 = obs.find('Obb2')
                        c2 = obs.find('Circle2')
                        p2 = obs.find('Polygon2')
                        rot = obs.find('Rotate') is not None
                        if obb2:
                            c_n = obb2.find('Center')
                            e_n = obb2.find('Extent')
                            a_n = obb2.find('Axis')
                            if c_n and e_n:
                                obs_list.append({
                                    'type': 'obb2',
                                    'center': [float(a.value) for a in c_n.args],
                                    'extent': [float(a.value) for a in e_n.args],
                                    'axis': [float(a.value) for a in a_n.args] if a_n else [1.0, 0.0],
                                    'rotate': rot,
                                })
                        elif c2:
                            r_n = c2.find('Radius')
                            c_n = c2.find('Center')
                            if r_n and r_n.args:
                                obs_list.append({
                                    'type': 'circle2',
                                    'radius': float(r_n.args[0].value),
                                    'center': [float(a.value) for a in c_n.args] if c_n else [0.0, 0.0],
                                    'rotate': rot,
                                })
                        elif p2:
                            verts = []
                            for v_n in p2.find_all('Vertex'):
                                if len(v_n.args) >= 2:
                                    verts.append([float(v_n.args[0].value), float(v_n.args[1].value)])
                            if len(verts) >= 3:
                                obs_list.append({
                                    'type': 'polygon2',
                                    'vertices': verts,
                                    'rotate': rot,
                                })
        except Exception:
            pass

        self.proto_cache[proto] = obs_list
        return obs_list


def rasterize_polygon(poly: np.ndarray, grid: np.ndarray, origin_x: float, origin_y: float, cell_size: float):
    """Rasterize a convex/simple polygon into a 2D binary grid."""
    # poly is shape (N, 2) in GEM units
    gx = (poly[:, 0] - origin_x) / cell_size
    gy = (poly[:, 1] - origin_y) / cell_size

    min_x = max(0, int(np.floor(gx.min())))
    max_x = min(grid.shape[1] - 1, int(np.ceil(gx.max())))
    min_y = max(0, int(np.floor(gy.min())))
    max_y = min(grid.shape[0] - 1, int(np.ceil(gy.max())))

    if min_x > max_x or min_y > max_y:
        return

    # Point-in-polygon test for candidate grid cells
    # Use ray casting or cross-product winding
    xs = np.arange(min_x, max_x + 1) + 0.5
    ys = np.arange(min_y, max_y + 1) + 0.5
    grid_x, grid_y = np.meshgrid(xs, ys)
    pts = np.stack([grid_x.ravel(), grid_y.ravel()], axis=-1)

    # Ray-casting algorithm in vectorized form
    inside = np.zeros(len(pts), dtype=bool)
    n = len(gx)
    for i in range(n):
        j = (i + 1) % n
        x1, y1 = gx[i], gy[i]
        x2, y2 = gx[j], gy[j]
        cond = ((y1 > pts[:, 1]) != (y2 > pts[:, 1])) & \
               (pts[:, 0] < (x2 - x1) * (pts[:, 1] - y1) / (y2 - y1 + 1e-12) + x1)
        inside ^= cond

    inside_grid = inside.reshape(grid_y.shape)
    grid[min_y:max_y + 1, min_x:max_x + 1] |= inside_grid


def encode_rle(grid: np.ndarray) -> list[int]:
    """Run-length encode flattened 2D binary grid: [count0, count1, count0, ...]."""
    flat = grid.ravel()
    if len(flat) == 0:
        return []

    # Find run changes
    diffs = np.diff(flat)
    change_indices = np.nonzero(diffs)[0] + 1
    split_indices = np.concatenate([[0], change_indices, [len(flat)]])
    run_lengths = np.diff(split_indices).tolist()

    # Ensure first run corresponds to 0 (walkable)
    if flat[0] == 1:
        run_lengths = [0] + run_lengths

    return run_lengths


def mission_nav_grid(vfs, mission_vpath: str, cell_size: float = 20.0) -> dict[str, Any]:
    """Generate 1m navigation grid for a mission."""
    clean = '/' + mission_vpath.strip('/')
    ply_path = clean + '/map.ply'
    if not vfs.exists(ply_path):
        raise FileNotFoundError(f"Terrain mesh not found: {ply_path}")

    # 1. Terrain Bounds and Mesh
    b = parse_bply(vfs.read(ply_path))
    raw = np.frombuffer(b.vertices, np.uint8).reshape(b.vertex_count, b.stride)
    pos = np.ascontiguousarray(raw[:, :12]).view('<f4').reshape(-1, 3)
    nrm = np.ascontiguousarray(raw[:, 12:24]).view('<f4').reshape(-1, 3)
    idx = np.frombuffer(b.indices, '<u4')

    min_p = pos.min(axis=0)
    max_p = pos.max(axis=0)

    origin_x = float(math.floor(min_p[0] / cell_size) * cell_size)
    origin_y = float(math.floor(min_p[1] / cell_size) * cell_size)
    width = int(math.ceil((max_p[0] - origin_x) / cell_size)) + 1
    height = int(math.ceil((max_p[1] - origin_y) / cell_size)) + 1

    grid = np.zeros((height, width), dtype=np.uint8)

    # 2. Terrain Slope: steep faces (> 45 deg, nz < 0.7071)
    # Triangles with steep normals
    tri_normals = nrm.reshape(-1, 3)
    tri_nz = tri_normals[:, 2]
    # Check triangles where any vertex has nz < 0.7071
    steep_tri_mask = (tri_nz < 0.7071)
    if steep_tri_mask.any():
        steep_verts = pos[steep_tri_mask]
        gx = np.clip(((steep_verts[:, 0] - origin_x) / cell_size).astype(int), 0, width - 1)
        gy = np.clip(((steep_verts[:, 1] - origin_y) / cell_size).astype(int), 0, height - 1)
        grid[gy, gx] = 1

    # 3. Obstacle Catalog and Entities
    catalog = ObstacleCatalog(vfs)
    placed_entities: list[tuple[str, float, float, float]] = []

    for f_name in ['0.mi', 'map']:
        f_path = clean + '/' + f_name
        if not vfs.exists(f_path):
            continue
        try:
            items = parse_sdl(decode(vfs.read(f_path), f_path))
            root = items[0]
            for it in root.children:
                if it.tag in ('Entity', 'Human'):
                    proto = it.args[0].value if it.args else None
                    if not proto:
                        continue
                    pos_node = it.find('Position')
                    x, y = 0.0, 0.0
                    if pos_node and len(pos_node.args) >= 2:
                        x = float(pos_node.args[0].value)
                        y = float(pos_node.args[1].value)
                    xform = it.find('xform')
                    zl = 0.0
                    if xform:
                        for idx_arg, a in enumerate(xform.args):
                            if a.value == 'zl' and idx_arg + 1 < len(xform.args):
                                zl = float(xform.args[idx_arg + 1].value)
                    placed_entities.append((proto, x, y, zl))
        except Exception:
            pass

    # Rasterize obstacles
    for proto, ex, ey, zl in placed_entities:
        obs_list = catalog.get_obstacles(proto)
        if not obs_list:
            continue

        rad_zl = -zl * math.pi / 180.0
        cos_zl = math.cos(rad_zl)
        sin_zl = math.sin(rad_zl)

        for obs in obs_list:
            obs_type = obs['type']
            rotate = obs.get('rotate', True)

            if obs_type == 'obb2':
                cx, cy = obs['center']
                ext_x, ext_y = obs['extent']
                ax, ay = obs['axis']

                if rotate:
                    # Rotate local center
                    rcx = cx * cos_zl - cy * sin_zl
                    rcy = cx * sin_zl + cy * cos_zl
                    # Rotate axis
                    rax = ax * cos_zl - ay * sin_zl
                    ray = ax * sin_zl + ay * cos_zl
                else:
                    rcx, rcy = cx, cy
                    rax, ray = ax, ay

                # Normalize axis
                alen = math.hypot(rax, ray) or 1.0
                u_x, u_y = (rax / alen) * ext_x, (ray / alen) * ext_x
                v_x, v_y = (-ray / alen) * ext_y, (rax / alen) * ext_y

                center_x = ex + rcx
                center_y = ey + rcy

                poly = np.array([
                    [center_x - u_x - v_x, center_y - u_y - v_y],
                    [center_x + u_x - v_x, center_y + u_y - v_y],
                    [center_x + u_x + v_x, center_y + u_y + v_y],
                    [center_x - u_x + v_x, center_y - u_y + v_y],
                ])
                rasterize_polygon(poly, grid, origin_x, origin_y, cell_size)

            elif obs_type == 'circle2':
                cx, cy = obs['center']
                radius = obs['radius']
                if rotate:
                    rcx = cx * cos_zl - cy * sin_zl
                    rcy = cx * sin_zl + cy * cos_zl
                else:
                    rcx, rcy = cx, cy

                world_cx = ex + rcx
                world_cy = ey + rcy

                gcx = (world_cx - origin_x) / cell_size
                gcy = (world_cy - origin_y) / cell_size
                gr = radius / cell_size

                min_x = max(0, int(math.floor(gcx - gr)))
                max_x = min(width - 1, int(math.ceil(gcx + gr)))
                min_y = max(0, int(math.floor(gcy - gr)))
                max_y = min(height - 1, int(math.ceil(gcy + gr)))

                xs = np.arange(min_x, max_x + 1)
                ys = np.arange(min_y, max_y + 1)
                gx_m, gy_m = np.meshgrid(xs, ys)
                dist_sq = (gx_m + 0.5 - gcx) ** 2 + (gy_m + 0.5 - gcy) ** 2
                mask = dist_sq <= (gr ** 2)
                grid[min_y:max_y + 1, min_x:max_x + 1] |= mask.astype(np.uint8)

            elif obs_type == 'polygon2':
                verts = np.array(obs['vertices'])
                if rotate:
                    vx = verts[:, 0] * cos_zl - verts[:, 1] * sin_zl
                    vy = verts[:, 0] * sin_zl + verts[:, 1] * cos_zl
                else:
                    vx = verts[:, 0]
                    vy = verts[:, 1]
                world_poly = np.stack([vx + ex, vy + ey], axis=-1)
                rasterize_polygon(world_poly, grid, origin_x, origin_y, cell_size)

    # 4. Run-length encode
    rle = encode_rle(grid)
    blocked_count = int(np.sum(grid))

    return {
        'mission': mission_vpath,
        'originX': origin_x,
        'originY': origin_y,
        'cellSize': cell_size,
        'width': width,
        'height': height,
        'blockedCount': blocked_count,
        'totalCells': width * height,
        'rle': rle,
    }
