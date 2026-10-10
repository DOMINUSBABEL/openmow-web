"""Deep probe into Obstacle and Area across all MDL files, plus terrain slope analysis."""
import os
import sys
import posixpath
import numpy as np
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node, Atom
from formats.bply import parse_bply

def find_nodes(node, tag):
    out = []
    if isinstance(node, Node):
        if node.tag == tag:
            out.append(node)
        for c in node.children:
            out.extend(find_nodes(c, tag))
    return out

def main():
    vfs = VFS()
    mdl_files = [p for p in vfs.files if p.endswith('.mdl')]

    shapes_in_obstacle = Counter()
    shapes_in_area = Counter()
    obstacle_tags = Counter()

    for p in mdl_files:
        try:
            items = parse_sdl(decode(vfs.read(p), p))
            for it in items:
                for obs in find_nodes(it, 'Obstacle'):
                    for c in obs.children:
                        shapes_in_obstacle[c.tag] += 1
                        if c.tag == 'Tags':
                            for a in c.args:
                                obstacle_tags[a.value] += 1
                for area in find_nodes(it, 'Area'):
                    for c in area.children:
                        shapes_in_area[c.tag] += 1
        except Exception:
            pass

    print("Shapes in Obstacle:")
    for k, v in shapes_in_obstacle.most_common(20):
        print(f"  {k}: {v}")

    print("\nObstacle tags:")
    for k, v in obstacle_tags.most_common(20):
        print(f"  {k}: {v}")

    print("\nShapes in Area:")
    for k, v in shapes_in_area.most_common(20):
        print(f"  {k}: {v}")

    # Inspect terrain slope
    print("\n--- Terrain slope analysis on 01_usa-overlord ---")
    b = parse_bply(vfs.read('map/single/01_usa-skirmish/01_usa-overlord/map.ply'))
    raw = np.frombuffer(b.vertices, np.uint8).reshape(b.vertex_count, b.stride)
    pos = np.ascontiguousarray(raw[:, :12]).view('<f4').reshape(-1, 3)
    nrm = np.ascontiguousarray(raw[:, 12:24]).view('<f4').reshape(-1, 3)
    
    # In GEM2, normal is (nx, ny, nz) where z is up.
    # nz is cos(slope_angle) where nz = 1 is completely flat, nz = 0 is vertical wall.
    nz = nrm[:, 2]
    # slope angle in degrees:
    # angle = arccos(clamp(nz, -1, 1)) * 180 / pi
    angles = np.arccos(np.clip(nz, -1.0, 1.0)) * 180.0 / np.pi
    print(f"nz min: {nz.min():.3f}, max: {nz.max():.3f}, median: {np.median(nz):.3f}")
    print(f"Slope angles: min {angles.min():.1f} deg, 50% {np.percentile(angles, 50):.1f} deg, 90% {np.percentile(angles, 90):.1f} deg, max {angles.max():.1f} deg")
    steep_30 = (angles > 30).sum() / len(angles) * 100
    steep_45 = (angles > 45).sum() / len(angles) * 100
    steep_60 = (angles > 60).sum() / len(angles) * 100
    print(f"Triangles with slope > 30 deg: {steep_30:.1f}%, > 45 deg: {steep_45:.1f}%, > 60 deg: {steep_60:.1f}%")

if __name__ == '__main__':
    main()
