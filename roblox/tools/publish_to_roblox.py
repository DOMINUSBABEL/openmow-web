#!/usr/bin/env python3
"""
War of Men — Automated Roblox Studio & Cloud Publisher
Uses the authenticated local Roblox Studio session cookie (Windows DPAPI) to:
1. Verify authenticated Studio user (dominusbabl / 5711570733)
2. Create or locate the Universe & Root Place for "War of Men"
3. Configure Universe settings (Name, Description, Studio API Access for DataStoreService, Public/Active status)
4. Configure Root Place settings (Name, Description, MaxPlayerCount=12)
5. Upload the compiled WarOfMen_Roblox.rbxlx directly to the Root Place in Roblox Cloud
6. Upload the Official 512x512 Game Icon and the 3 Promotional 1920x1080 HD Thumbnails
"""
import os
import re
import sys
import json
import uuid
import base64
import ctypes
import ctypes.wintypes
import subprocess
import urllib.request
import urllib.error

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RBXLX_PATH = os.path.join(ROOT_DIR, "WarOfMen_Roblox.rbxlx")
ASSETS_DIR = os.path.join(ROOT_DIR, "assets")
COOKIE_DAT = os.path.expandvars(r"%LOCALAPPDATA%\Roblox\LocalStorage\RobloxCookies.dat")


def get_studio_cookie() -> str:
    with open(COOKIE_DAT, "r", encoding="utf-8") as f:
        d = json.load(f)
    raw = base64.b64decode(d["CookiesData"])

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    blob_in = DATA_BLOB(len(raw), ctypes.create_string_buffer(raw, len(raw)))
    blob_out = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        raise RuntimeError("DPAPI CryptUnprotectData failed")

    dec = ctypes.string_at(blob_out.pbData, blob_out.cbData).decode("utf-8", errors="ignore")
    m = re.search(r"\.ROBLOSECURITY\t([^\t\r\n;]+)", dec)
    if m:
        return m.group(1).strip()
    m2 = re.search(r"_\|WARNING:-DO-NOT-SHARE-THIS[^\s;\"]+", dec)
    if m2:
        return m2.group(0).strip()
    raise RuntimeError("Could not find .ROBLOSECURITY in RobloxCookies.dat")


class RobloxStudioClient:
    def __init__(self, cookie: str):
        self.cookie = cookie
        self.csrf_token = ""

    def request(
        self,
        method: str,
        url: str,
        data: bytes = None,
        content_type: str = "application/json",
        extra_headers: dict = None,
    ):
        for attempt in range(2):
            headers = {
                "Cookie": f".ROBLOSECURITY={self.cookie}",
                "User-Agent": "RobloxStudio/WinInet RobloxApp/0.744.0.7441077 (GlobalDist; RobloxDirectDownload)",
                "Accept": "application/json",
            }
            if content_type:
                headers["Content-Type"] = content_type
            if self.csrf_token:
                headers["X-CSRF-TOKEN"] = self.csrf_token
            if extra_headers:
                headers.update(extra_headers)

            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    body = resp.read().decode("utf-8", errors="ignore")
                    return resp.status, body
            except urllib.error.HTTPError as e:
                if e.code == 403 and "x-csrf-token" in {k.lower() for k in e.headers.keys()} and attempt == 0:
                    for k, v in e.headers.items():
                        if k.lower() == "x-csrf-token":
                            self.csrf_token = v
                            break
                    continue
                err_body = e.read().decode("utf-8", errors="ignore")
                return e.code, err_body

    def upload_multipart_file(self, url: str, field_name: str, file_path: str, mime_type: str = "image/png", extra_fields: dict = None):
        boundary = f"----RobloxBoundary{uuid.uuid4().hex}"
        body_parts = []
        if extra_fields:
            for k, v in extra_fields.items():
                body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
                body_parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))

        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            file_bytes = f.read()

        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8")
        )
        body_parts.append(file_bytes)
        body_parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))

        payload = b"".join(body_parts)
        return self.request(
            "POST",
            url,
            data=payload,
            content_type=f"multipart/form-data; boundary={boundary}",
        )

    def patch_place_user_auth(self, place_id: int, file_path: str, published: bool = True):
        boundary = f"----RobloxPlaceBoundary{uuid.uuid4().hex}"
        req_json = json.dumps({
            "assetId": str(place_id),
            "assetType": "Place",
            "published": published,
        })
        with open(file_path, "rb") as f:
            file_bytes = f.read()

        body_parts = [
            f"--{boundary}\r\n".encode("utf-8"),
            b'Content-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n',
            req_json.encode("utf-8"),
            f"\r\n--{boundary}\r\n".encode("utf-8"),
            b'Content-Disposition: form-data; name="fileContent"; filename="WarOfMen_Roblox.rbxlx"\r\nContent-Type: application/octet-stream\r\n\r\n',
            file_bytes,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
        payload = b"".join(body_parts)
        return self.request(
            "PATCH",
            f"https://apis.roblox.com/assets/user-auth/v1/assets/{place_id}",
            data=payload,
            content_type=f"multipart/form-data; boundary={boundary}",
        )


def main():
    cookie = get_studio_cookie()
    client = RobloxStudioClient(cookie)

    status, body = client.request("GET", "https://users.roblox.com/v1/users/authenticated")
    print(f"[Auth] HTTP {status}: {body}")
    user_info = json.loads(body)
    user_id = user_info["id"]
    user_name = user_info["name"]

    # Check existing universes for "War of Men"
    status, body = client.request("GET", "https://develop.roblox.com/v1/user/universes?limit=50&sortOrder=Desc")
    print(f"[Universes] HTTP {status}")
    universes_data = json.loads(body).get("data", [])
    target_uni = None
    for u in universes_data:
        uname = u.get("name") or ""
        print(f"  - Universe {u.get('id')}: {uname} (RootPlace: {u.get('rootPlaceId')})")
        if "war of men" in uname.lower():
            target_uni = u
            break

    if target_uni:
        universe_id = target_uni["id"]
        place_id = target_uni["rootPlaceId"]
        print(f"[Reuse] Found existing War of Men universe: UniverseId={universe_id}, PlaceId={place_id}")
    else:
        print("[Create] Creating new Universe for 'War of Men' via apis.roblox.com/universes/v1/universes/create ...")
        payload = json.dumps({"templatePlaceId": 95206881}).encode("utf-8")
        status, body = client.request("POST", "https://apis.roblox.com/universes/v1/universes/create", data=payload)
        print(f"[Create] HTTP {status}: {body}")
        if status not in (200, 201):
            raise RuntimeError(f"Failed to create universe: {status} {body}")
        created = json.loads(body)
        universe_id = created.get("universeId") or created.get("id")
        place_id = created.get("rootPlaceId") or created.get("placeId")
        print(f"[Created] UniverseId={universe_id}, PlaceId={place_id}")

    game_name = "War of Men [WWII Tactical RTS & Direct Control]"
    game_desc = (
        "⚔️ WAR OF MEN — TACTICAL COMBINED ARMS RTS & DIRECT CONTROL ⚔️\n\n"
        "Command squads of infantry, anti-tank teams, and heavy armor across 15 historical WWII battlefields!\n"
        "🌍 5 Playable Factions: USA, Germany (Wehrmacht), British Commonwealth, Red Army (USSR), and Imperial Japan.\n"
        "💥 Real GEM2 Armor Ballistics: Directional armor thickness (Front/Side/Rear), distance penetration curves, and >=70° shell ricochets.\n"
        "🎯 Hybrid Command + 3rd Person Direct Control [TAB]: Command your army from above, or press [TAB] at any moment to take direct 3rd-person control of any tank or soldier!\n"
        "🤖 Play Solo vs Tactical AI Commander, Co-op with Player-Bot Assistant (DEFEND / ATTACK), or Multiplayer."
    )

    config_payload = json.dumps({
        "name": game_name,
        "description": game_desc,
        "studioAccessToApisAllowed": True,
        "allowPrivateServers": True,
        "privateServerPrice": 0,
    }).encode("utf-8")
    status, body = client.request(
        "PATCH",
        f"https://develop.roblox.com/v2/universes/{universe_id}/configuration",
        data=config_payload,
    )
    print(f"[Configure Universe {universe_id}] HTTP {status}: {body}")

    place_payload = json.dumps({
        "name": game_name,
        "description": game_desc,
        "maxPlayerCount": 12,
        "customSocialSlotsCount": 4,
    }).encode("utf-8")
    status, body = client.request(
        "PATCH",
        f"https://develop.roblox.com/v2/places/{place_id}",
        data=place_payload,
    )
    print(f"[Configure Place {place_id}] HTTP {status}: {body}")

    # Activate Universe (Make Public)
    status, body = client.request(
        "POST",
        f"https://develop.roblox.com/v1/universes/{universe_id}/activate",
        data=b"{}",
    )
    print(f"[Activate Universe {universe_id}] HTTP {status}: {body}")

    # Save publish_info.json first and rebuild .rbxlx + Studio Plugin so PUBLISHED_PLACE_ID is embedded
    info_path = os.path.join(ROOT_DIR, "publish_info.json")
    info = {
        "userId": user_id,
        "userName": user_name,
        "universeId": universe_id,
        "placeId": place_id,
        "gameName": game_name,
        "gameUrl": f"https://www.roblox.com/games/{place_id}/War-of-Men",
        "createDashboardUrl": f"https://create.roblox.com/dashboard/creations/experiences/{universe_id}/overview",
        "mediaUploaded": {},
    }
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)

    subprocess.run([sys.executable, os.path.join(ROOT_DIR, "tools", "build_rbxlx.py")], check=True)

    # Upload compiled .rbxlx directly to the Root Place in Roblox Cloud via user-auth v1 API
    status, body = client.patch_place_user_auth(place_id, RBXLX_PATH, published=True)
    print(f"[Upload Place RBXLX (user-auth v1) -> {place_id}] HTTP {status}: {body}")
    info["placeUploadHttpStatus"] = status
    info["placeUploadResponse"] = body

    # Upload Official 512x512 Game Icon
    icon_path = os.path.join(ASSETS_DIR, "WarOfMen_Icon_512x512.png")
    if os.path.exists(icon_path):
        # Try publish.roblox.com/v1/games/{universeId}/icon and develop/places icon endpoints
        st_icon, bd_icon = client.upload_multipart_file(
            f"https://publish.roblox.com/v1/games/{universe_id}/icon",
            "request.files",
            icon_path,
            "image/png",
        )
        print(f"[Upload Icon 512x512 (publish API)] HTTP {st_icon}: {bd_icon}")
        info["mediaUploaded"]["icon_512"] = {"status": st_icon, "response": bd_icon}

    # Upload 3 Promotional 1920x1080 HD Thumbnails
    thumb_files = [
        "WarOfMen_Thumb_1_Normandy.png",
        "WarOfMen_Thumb_2_ArmorClash.png",
        "WarOfMen_Thumb_3_DirectControl.png",
    ]
    info["mediaUploaded"]["thumbnails"] = []
    for tf in thumb_files:
        tpath = os.path.join(ASSETS_DIR, tf)
        if os.path.exists(tpath):
            st_th, bd_th = client.upload_multipart_file(
                f"https://publish.roblox.com/v1/games/{universe_id}/thumbnail/image",
                "request.files",
                tpath,
                "image/png",
            )
            print(f"[Upload Thumbnail {tf}] HTTP {st_th}: {bd_th}")
            info["mediaUploaded"]["thumbnails"].append({"file": tf, "status": st_th, "response": bd_th})

    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)
    print(f"[Done] Saved publish_info.json -> {info['gameUrl']}")


if __name__ == "__main__":
    main()
