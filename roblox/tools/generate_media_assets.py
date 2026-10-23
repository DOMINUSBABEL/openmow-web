#!/usr/bin/env python3
"""
generate_media_assets.py
Generates promotional media for "War of Men" (Roblox):
  1. WarOfMen_Icon_512x512.png (512x512 Official Game Icon)
  2. WarOfMen_Thumb_1_Normandy.png (1920x1080 HD Thumbnail 1 - Combined Arms RTS)
  3. WarOfMen_Thumb_2_ArmorClash.png (1920x1080 HD Thumbnail 2 - GEM2 Armor Penetration)
  4. WarOfMen_Thumb_3_DirectControl.png (1920x1080 HD Thumbnail 3 - 3rd Person Direct Control)
  5. WarOfMen_Trailer_1080p.mp4 (1920x1080 @ 30fps Promotional Gameplay Trailer with Audio)
"""
import os
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_ROOT = os.path.dirname(ROOT)
ASSETS_DIR = os.path.join(ROOT, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)


def load_font(size: int, bold: bool = True):
    candidates = [
        r"C:\Windows\Fonts\impact.ttf" if bold else r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_tank_silhouette(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: float, color: tuple, facing_right: bool = True, highlight: tuple = (255, 255, 255)):
    d = 1 if facing_right else -1
    # Tracks
    tw, th = int(150 * scale), int(38 * scale)
    draw.rounded_rectangle([cx - tw // 2, cy, cx + tw // 2, cy + th], radius=int(14 * scale), fill=(28, 32, 36), outline=(70, 78, 86), width=2)
    # Roadwheels
    for i in range(-2, 3):
        wx = cx + int(i * 26 * scale)
        wy = cy + th // 2
        r = int(11 * scale)
        draw.ellipse([wx - r, wy - r, wx + r, wy + r], fill=(52, 58, 64), outline=(90, 96, 104))
    # Hull
    hw, hh = int(162 * scale), int(34 * scale)
    draw.polygon([
        (cx - hw // 2, cy + 4),
        (cx - int(hw * 0.42), cy - hh),
        (cx + int(hw * 0.44), cy - hh),
        (cx + hw // 2, cy + 4),
    ], fill=color, outline=highlight)
    # Turret
    tur_w, tur_h = int(78 * scale), int(28 * scale)
    draw.rounded_rectangle(
        [cx - tur_w // 2 - int(d * 6 * scale), cy - hh - tur_h + 4, cx + tur_w // 2 - int(d * 6 * scale), cy - hh + 6],
        radius=int(6 * scale),
        fill=color,
        outline=highlight,
        width=2,
    )
    # Main Gun Barrel
    bx0 = cx + int(d * (tur_w // 2 - 4 * scale))
    bx1 = bx0 + int(d * 98 * scale)
    by = cy - hh - tur_h // 2 + 2
    left_x, right_x = min(bx0, bx1), max(bx0, bx1)
    draw.rectangle([left_x, by - int(4 * scale), right_x, by + int(4 * scale)], fill=(64, 70, 76), outline=highlight)


def generate_icon_512():
    img = Image.new("RGB", (512, 512), (14, 22, 30))
    draw = ImageDraw.Draw(img)

    # Tactical radial gradient & grid
    for y in range(512):
        ratio = y / 512.0
        r = int(16 + 28 * (1 - abs(ratio - 0.45)))
        g = int(28 + 42 * (1 - abs(ratio - 0.45)))
        b = int(38 + 46 * (1 - abs(ratio - 0.45)))
        draw.line([(0, y), (512, y)], fill=(r, g, b))

    for g_pos in range(0, 512, 32):
        draw.line([(g_pos, 0), (g_pos, 512)], fill=(28, 44, 56), width=1)
        draw.line([(0, g_pos), (512, g_pos)], fill=(28, 44, 56), width=1)

    # Diagonal explosion / combat glow
    glow = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([90, 90, 422, 422], fill=(255, 135, 40, 85))
    gdraw.ellipse([150, 140, 362, 352], fill=(255, 210, 80, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    img.paste(glow, (0, 0), glow)
    draw = ImageDraw.Draw(img)

    # Two clashing tanks (Allied Sherman vs Axis Tiger)
    draw_tank_silhouette(draw, 148, 295, 1.05, (68, 96, 62), True, (134, 239, 172))
    draw_tank_silhouette(draw, 372, 295, 1.05, (92, 102, 114), False, (248, 113, 113))

    # Ballistic Tracer Beams crossing center
    draw.line([(235, 240), (355, 252)], fill=(255, 230, 110), width=5)
    draw.line([(285, 232), (165, 250)], fill=(255, 110, 60), width=5)
    draw.ellipse([240, 224, 272, 256], fill=(255, 245, 180))

    # Top badge
    draw.rounded_rectangle([96, 22, 416, 60], radius=10, fill=(18, 28, 38), outline=(74, 222, 128), width=2)
    f_small = load_font(20, False)
    draw.text((256, 41), "5 FACTIONS • 15 MAPS • RTS", fill=(134, 239, 172), font=f_small, anchor="mm")

    # Main Title Banner
    draw.rounded_rectangle([24, 362, 488, 488], radius=16, fill=(12, 18, 26), outline=(250, 204, 21), width=3)
    f_title = load_font(66, True)
    f_sub = load_font(22, False)
    draw.text((256, 408), "WAR OF MEN", fill=(255, 255, 255), font=f_title, anchor="mm")
    draw.text((256, 458), "ASSAULT SQUAD • DIRECT CONTROL", fill=(250, 204, 21), font=f_sub, anchor="mm")

    out = os.path.join(ASSETS_DIR, "WarOfMen_Icon_512x512.png")
    img.save(out, "PNG")
    print(f"Generated Icon: {out}")
    return out


def make_thumbnail_base(bg_screenshot_path: str, tint_rgb: tuple) -> Image.Image:
    base = Image.new("RGB", (1920, 1080), (14, 20, 28))
    if bg_screenshot_path and os.path.exists(bg_screenshot_path):
        try:
            shot = Image.open(bg_screenshot_path).convert("RGB").resize((1920, 1080), Image.Resampling.LANCZOS)
            overlay = Image.new("RGB", (1920, 1080), tint_rgb)
            base = Image.blend(shot, overlay, 0.32)
        except Exception:
            pass
    else:
        draw = ImageDraw.Draw(base)
        for y in range(1080):
            t = y / 1080.0
            draw.line([(0, y), (1920, y)], fill=(
                int(tint_rgb[0] * (1.2 - 0.5 * t)),
                int(tint_rgb[1] * (1.2 - 0.5 * t)),
                int(tint_rgb[2] * (1.2 - 0.5 * t)),
            ))
    return base


def generate_thumbnails():
    s1 = os.path.join(WEB_ROOT, "test-results", "combat-live-verified.png")
    s2 = os.path.join(WEB_ROOT, "test-results", "mowas2-parity-verified.png")

    f_hero = load_font(96, True)
    f_sub = load_font(38, False)
    f_pill = load_font(28, False)

    # THUMBNAIL 1: Normandy Combined Arms & 5 Factions
    t1 = make_thumbnail_base(s1, (16, 32, 28))
    d1 = ImageDraw.Draw(t1)
    draw_tank_silhouette(d1, 460, 690, 2.2, (74, 98, 64), True, (134, 239, 172))
    draw_tank_silhouette(d1, 1460, 690, 2.2, (94, 104, 116), False, (248, 113, 113))
    d1.line([(720, 565), (1240, 595)], fill=(255, 225, 100), width=8)
    d1.line([(1180, 545), (680, 585)], fill=(255, 100, 55), width=8)

    d1.rounded_rectangle([80, 60, 1840, 250], radius=22, fill=(12, 18, 26), outline=(74, 222, 128), width=4)
    d1.text((960, 126), "WAR OF MEN: ASSAULT SQUAD", fill=(255, 255, 255), font=f_hero, anchor="mm")
    d1.text((960, 204), "5 HISTORICAL FACTIONS (USA • GER • ENG • RUS • JAP) • 15 SKIRMISH MAPS", fill=(134, 239, 172), font=f_sub, anchor="mm")

    d1.rounded_rectangle([240, 880, 1680, 995], radius=18, fill=(16, 24, 34), outline=(250, 204, 21), width=3)
    d1.text((960, 938), "⚡ DEPLOY 20 SQUADS & TANKS • CAPTURE SECTORS • DETERMINISTIC 20HZ SIM", fill=(250, 204, 21), font=f_pill, anchor="mm")
    out1 = os.path.join(ASSETS_DIR, "WarOfMen_Thumb_1_Normandy.png")
    t1.save(out1, "PNG")

    # THUMBNAIL 2: GEM2 Ballistics & Armor Penetration
    t2 = make_thumbnail_base(s2, (34, 22, 20))
    d2 = ImageDraw.Draw(t2)
    draw_tank_silhouette(d2, 520, 660, 2.35, (68, 88, 56), True, (134, 239, 172))
    draw_tank_silhouette(d2, 1400, 660, 2.45, (108, 112, 118), False, (248, 113, 113))
    # Ballistic impact & ricochet diagram vectors
    d2.line([(810, 535), (1215, 555)], fill=(255, 110, 40), width=10)
    d2.line([(1215, 555), (1390, 390)], fill=(250, 204, 21), width=7)
    d2.ellipse([1185, 525, 1245, 585], fill=(255, 230, 110), outline=(255, 90, 30), width=4)

    d2.rounded_rectangle([80, 60, 1840, 250], radius=22, fill=(14, 18, 26), outline=(248, 113, 113), width=4)
    d2.text((960, 126), "REAL GEM2 ARMOR BALLISTICS", fill=(255, 255, 255), font=f_hero, anchor="mm")
    d2.text((960, 204), "DIRECTIONAL ARMOR (FRONT/SIDE/REAR) • DISTANCE DROPOFF • >=70° RICOCHETS", fill=(252, 165, 165), font=f_sub, anchor="mm")

    d2.rounded_rectangle([240, 880, 1680, 995], radius=18, fill=(18, 22, 30), outline=(250, 204, 21), width=3)
    d2.text((960, 938), "💥 88MM KWK 36 VS T-34/85 & SHERMAN • COVER & POSTURE SYSTEM (STAND/CROUCH/PRONE)", fill=(250, 204, 21), font=f_pill, anchor="mm")
    out2 = os.path.join(ASSETS_DIR, "WarOfMen_Thumb_2_ArmorClash.png")
    t2.save(out2, "PNG")

    # THUMBNAIL 3: RTS Command + 3rd Person Direct Control [TAB]
    t3 = make_thumbnail_base(s1, (18, 26, 40))
    d3 = ImageDraw.Draw(t3)
    draw_tank_silhouette(d3, 960, 700, 2.6, (78, 96, 66), True, (250, 204, 21))
    # Crosshair reticle overlay
    d3.ellipse([860, 440, 1060, 640], outline=(250, 204, 21), width=5)
    d3.line([(820, 540), (1100, 540)], fill=(250, 204, 21), width=4)
    d3.line([(960, 400), (960, 680)], fill=(250, 204, 21), width=4)

    d3.rounded_rectangle([80, 60, 1840, 250], radius=22, fill=(12, 18, 28), outline=(250, 204, 21), width=4)
    d3.text((960, 126), "HYBRID RTS + DIRECT CONTROL", fill=(255, 255, 255), font=f_hero, anchor="mm")
    d3.text((960, 204), "COMMAND FULL ARMIES FROM ABOVE OR PRESS [TAB] TO PILOT ANY TANK OR SOLDIER", fill=(253, 224, 71), font=f_sub, anchor="mm")

    d3.rounded_rectangle([240, 880, 1680, 995], radius=18, fill=(16, 24, 34), outline=(74, 222, 128), width=3)
    d3.text((960, 938), "🎯 MANUAL TURRET AIMING • CO-OP & SOLO PLAYER-BOT AI • COMMANDER RANK PROGRESSION", fill=(134, 239, 172), font=f_pill, anchor="mm")
    out3 = os.path.join(ASSETS_DIR, "WarOfMen_Thumb_3_DirectControl.png")
    t3.save(out3, "PNG")

    print(f"Generated 3 HD Thumbnails:\n  - {out1}\n  - {out2}\n  - {out3}")
    return [out1, out2, out3]


def generate_trailer_mp4(thumb_paths: list) -> str:
    """
    Renders a 15-second 1920x1080 @ 30fps MP4 Trailer (450 frames) with animated tracer fire,
    smooth pans across our gameplay captures & thumbnails, dynamic HUD callouts, and audio track.
    """
    out_mp4 = os.path.join(ASSETS_DIR, "WarOfMen_Trailer_1080p.mp4")
    audio_candidates = [
        os.path.join(WEB_ROOT, "public", "assets", "sound", "music", "usa.mp3"),
        os.path.join(WEB_ROOT, "public", "assets", "sound", "battle_ambient.wav"),
    ]
    audio_path = next((p for p in audio_candidates if os.path.exists(p)), None)

    slides = [Image.open(p).convert("RGB") for p in thumb_paths]
    f_banner = load_font(44, True)

    fps = 30
    duration_sec = 15
    total_frames = fps * duration_sec

    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", "1920x1080",
        "-pix_fmt", "rgb24",
        "-r", str(fps),
        "-i", "-",
    ]
    if audio_path:
        cmd.extend(["-i", audio_path, "-shortest"])
    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "21",
    ])
    if audio_path:
        cmd.extend(["-c:a", "aac", "-b:a", "192k"])
    cmd.append(out_mp4)

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    captions = [
        "WAR OF MEN — FULL MEN OF WAR RTS PORT ON ROBLOX",
        "REAL GEM2 ARMOR PENETRATION & 70° RICOCHET BALLISTICS",
        "PRESS [TAB] FOR 3RD-PERSON DIRECT CONTROL OF ANY UNIT!",
    ]

    for frame_idx in range(total_frames):
        sec = frame_idx / float(fps)
        seg = min(2, int(sec // 5.0))
        local_t = (sec - seg * 5.0) / 5.0

        base = slides[seg].copy()
        draw = ImageDraw.Draw(base)

        # Animated ballistic tracers flying across the battlefield
        for b_i in range(4):
            prog = (local_t * 2.4 + b_i * 0.25) % 1.0
            sx = int(420 + prog * 1080)
            sy = int(520 + math.sin(prog * 6.28 + b_i) * 45)
            draw.line([(sx - 75, sy - 6), (sx, sy)], fill=(255, 230, 115), width=6)
            draw.ellipse([sx - 8, sy - 8, sx + 8, sy + 8], fill=(255, 250, 200))

        # Animated progress bar & callout at bottom
        draw.rectangle([0, 1064, int(1920 * (frame_idx / total_frames)), 1080], fill=(74, 222, 128))
        draw.rounded_rectangle([310, 780, 1610, 852], radius=14, fill=(10, 16, 24), outline=(74, 222, 128), width=3)
        draw.text((960, 816), captions[seg], fill=(255, 255, 255), font=f_banner, anchor="mm")

        proc.stdin.write(base.tobytes())

    proc.stdin.close()
    stderr_out = proc.stderr.read().decode("utf-8", errors="ignore")
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg trailer generation failed: {stderr_out}")

    print(f"Generated 1080p MP4 Trailer: {out_mp4} ({os.path.getsize(out_mp4)} bytes)")
    return out_mp4


if __name__ == "__main__":
    generate_icon_512()
    thumbs = generate_thumbnails()
    generate_trailer_mp4(thumbs)
