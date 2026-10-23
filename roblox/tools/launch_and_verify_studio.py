#!/usr/bin/env python3
"""
Launches Roblox Studio directly into Cloud Place 133837357200651 (Universe 10772595182 - "War of Men"),
uses Win32 AttachThreadInput + SwitchToThisWindow to bypass Windows Foreground Lock,
verifies GetForegroundWindow() == hwnd, waits for WarOfMenStudioLive.rbxmx to inject all scripts,
remotes, and 3D battlefield, triggers Alt+P to publish the experience to Roblox Cloud,
and activates the Universe as Public.
"""
import os
import sys
import time
import glob
import json
import ctypes
import subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLISH_INFO_PATH = os.path.join(ROOT_DIR, "publish_info.json")

STUDIO_VERSIONS = sorted(
    glob.glob(r"C:\Users\jegom\AppData\Local\Roblox\Versions\version-*\RobloxStudioBeta.exe"),
    key=os.path.getmtime,
    reverse=True,
)
STUDIO_EXE = STUDIO_VERSIONS[0] if STUDIO_VERSIONS else r"C:\Users\jegom\AppData\Local\Roblox\Versions\version-7aaa6838d36c4448\RobloxStudioBeta.exe"

UNIVERSE_ID = "10772595182"
PLACE_ID = "133837357200651"
if os.path.exists(PUBLISH_INFO_PATH):
    try:
        with open(PUBLISH_INFO_PATH, "r", encoding="utf-8") as f:
            pinfo = json.load(f)
            UNIVERSE_ID = str(pinfo.get("universeId") or UNIVERSE_ID)
            PLACE_ID = str(pinfo.get("placeId") or PLACE_ID)
    except Exception:
        pass

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32


def find_studio_hwnd():
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_cb(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value
                if any(k in title for k in ["Roblox Studio", "War of Men", "Guerra de hombres", "dominusbabl"]):
                    found.append((hwnd, title))
        return True

    user32.EnumWindows(enum_cb, 0)
    return found


def force_foreground(hwnd):
    fg_hwnd = user32.GetForegroundWindow()
    fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None)
    target_tid = user32.GetWindowThreadProcessId(hwnd, None)
    cur_tid = kernel32.GetCurrentThreadId()

    if fg_tid != cur_tid:
        user32.AttachThreadInput(fg_tid, cur_tid, True)
    if target_tid != cur_tid:
        user32.AttachThreadInput(target_tid, cur_tid, True)

    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.BringWindowToTop(hwnd)
    user32.SwitchToThisWindow(hwnd, True)
    res = user32.SetForegroundWindow(hwnd)
    user32.SetFocus(hwnd)

    if target_tid != cur_tid:
        user32.AttachThreadInput(target_tid, cur_tid, False)
    if fg_tid != cur_tid:
        user32.AttachThreadInput(fg_tid, cur_tid, False)

    now_fg = user32.GetForegroundWindow()
    print(f"  [force_foreground] target={hwnd} SetForegroundWindow={res} actual_fg={now_fg}")
    return now_fg == hwnd


def send_alt_p(hwnd):
    force_foreground(hwnd)
    time.sleep(0.6)
    VK_MENU = 0x12
    VK_P = 0x50
    KEYEVENTF_KEYUP = 0x0002
    scan_alt = user32.MapVirtualKeyW(VK_MENU, 0)
    scan_p = user32.MapVirtualKeyW(VK_P, 0)

    user32.keybd_event(VK_MENU, scan_alt, 0, 0)
    time.sleep(0.1)
    user32.keybd_event(VK_P, scan_p, 0, 0)
    time.sleep(0.1)
    user32.keybd_event(VK_P, scan_p, KEYEVENTF_KEYUP, 0)
    time.sleep(0.1)
    user32.keybd_event(VK_MENU, scan_alt, KEYEVENTF_KEYUP, 0)


def main():
    subprocess.run(["taskkill", "/F", "/IM", "RobloxStudioBeta.exe"], capture_output=True)
    time.sleep(1.5)

    print(f"Launching Roblox Studio ({STUDIO_EXE}) into Cloud Place {PLACE_ID} (Universe {UNIVERSE_ID})...")
    subprocess.Popen([
        STUDIO_EXE,
        "-task", "EditPlace",
        "-universeId", UNIVERSE_ID,
        "-placeId", PLACE_ID,
    ])

    hwnd = None
    for i in range(45):
        time.sleep(1.0)
        wins = find_studio_hwnd()
        if wins:
            hwnd, title = wins[0]
            print(f"[{i+1}s] Found Studio Window: HWND={hwnd} Title='{title}'")
            force_foreground(hwnd)
            if "-" in title and "Place1" not in title:
                break

    print("Keeping Studio active in foreground for 14s while D3D11 SwapChain & WarOfMenStudioLive finish loading...")
    for _ in range(4):
        wins = find_studio_hwnd()
        if wins:
            force_foreground(wins[0][0])
        time.sleep(3.5)

    wins = find_studio_hwnd()
    if wins:
        hwnd, title = wins[0]
        print(f"Triggering Alt+P (Publish to Roblox) on HWND={hwnd} ('{title}')...")
        send_alt_p(hwnd)

    print("Waiting 8s for StudioPublishPlace to complete...")
    time.sleep(8.0)

    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import publish_to_roblox as pub
        client = pub.RobloxStudioClient(pub.get_studio_cookie())
        st, bd = client.request("POST", f"https://develop.roblox.com/v1/universes/{UNIVERSE_ID}/activate", data=b"{}")
        print(f"[Activate Universe {UNIVERSE_ID}] HTTP {st}: {bd}")
    except Exception as e:
        print(f"Activate warning: {e}")

    log_dir = os.path.expandvars(r"%LOCALAPPDATA%\Roblox\logs")
    logs = sorted(glob.glob(os.path.join(log_dir, "*Studio*.log")), key=os.path.getmtime, reverse=True)
    if logs:
        latest_log = logs[0]
        print(f"Inspecting latest Studio log: {latest_log}")
        with open(latest_log, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        relevant = [
            l.strip() for l in lines
            if any(k in l for k in ["War of Men", "WarOfMen", "Publish", "publish", "StudioKeyEvents", PLACE_ID, UNIVERSE_ID])
        ]
        print("--- RELEVANT STUDIO LOG LINES ---")
        for rl in relevant[-45:]:
            print(rl[:180])


if __name__ == "__main__":
    main()
