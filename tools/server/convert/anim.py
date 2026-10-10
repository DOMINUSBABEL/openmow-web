"""GEM2 EANM animation -> Three.js AnimationClip JSON converter (T06 / Gate G2)."""
from __future__ import annotations
import posixpath
from formats.anm import parse_anm


def anm_to_clip(vfs, anm_path: str, fps: float = 25.0) -> dict:
    raw = vfs.read(anm_path)
    anm = parse_anm(raw)

    clip_name = posixpath.splitext(posixpath.basename(anm_path))[0]
    total_frames = max(anm.frame_count, 1)
    duration = round(total_frames / fps, 4)

    tracks = []
    for bone in anm.bones:
        keys = anm.tracks.get(bone, [])
        if not keys:
            continue

        # Rotation track (quaternion)
        rot_keys = [k for k in keys if k.rot is not None]
        if rot_keys:
            times = [round(k.frame / fps, 4) for k in rot_keys]
            values = [float(comp) for k in rot_keys for comp in k.rot]
            tracks.append({
                "name": f"{bone}.quaternion",
                "type": "quaternion",
                "times": times,
                "values": values,
            })

        # Position track (vector3)
        pos_keys = [k for k in keys if k.pos is not None]
        if pos_keys:
            times = [round(k.frame / fps, 4) for k in pos_keys]
            values = [float(comp) for k in pos_keys for comp in k.pos]
            tracks.append({
                "name": f"{bone}.position",
                "type": "vector",
                "times": times,
                "values": values,
            })

    return {
        "name": clip_name,
        "duration": duration,
        "fps": fps,
        "frameCount": anm.frame_count,
        "bones": anm.bones,
        "tracks": tracks,
    }
