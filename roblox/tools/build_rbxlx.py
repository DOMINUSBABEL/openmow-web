#!/usr/bin/env python3
"""
War of Men (Roblox Port of OpenMoW-Web / Men of War: Assault Squad 2)
Compiles:
  1. WarOfMen_Roblox.rbxlx (Full 3D Battlefield + Server/Client/Shared Luau architecture)
  2. WarOfMenStudioLive.rbxmx (Roblox Studio Live Cloud Sync & Interactive Viewport Plugin)
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "WarOfMen_Roblox.rbxlx")
PUBLISH_INFO_PATH = os.path.join(ROOT, "publish_info.json")


def read_src(rel_path: str) -> str:
    full = os.path.join(ROOT, rel_path)
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


def cdata_safe(code: str) -> str:
    return "<![CDATA[" + code.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def part_xml(ref: str, name: str, size: tuple, pos: tuple, color_rgb: tuple, material: int = 256, transparency: float = 0.0, shape: int = 1, can_collide: bool = True) -> str:
    r, g, b = [c / 255.0 for c in color_rgb]
    sx, sy, sz = size
    px, py, pz = pos
    cc_str = "true" if can_collide else "false"
    return f"""\t\t\t\t<Item class="Part" referent="{ref}">
\t\t\t\t\t<Properties>
\t\t\t\t\t\t<string name="Name">{name}</string>
\t\t\t\t\t\t<bool name="Anchored">true</bool>
\t\t\t\t\t\t<bool name="CanCollide">{cc_str}</bool>
\t\t\t\t\t\t<float name="Transparency">{transparency}</float>
\t\t\t\t\t\t<Vector3 name="size">
\t\t\t\t\t\t\t<X>{sx}</X>
\t\t\t\t\t\t\t<Y>{sy}</Y>
\t\t\t\t\t\t\t<Z>{sz}</Z>
\t\t\t\t\t\t</Vector3>
\t\t\t\t\t\t<CoordinateFrame name="CFrame">
\t\t\t\t\t\t\t<X>{px}</X>
\t\t\t\t\t\t\t<Y>{py}</Y>
\t\t\t\t\t\t\t<Z>{pz}</Z>
\t\t\t\t\t\t\t<R00>1</R00><R01>0</R01><R02>0</R02>
\t\t\t\t\t\t\t<R10>0</R10><R11>1</R11><R12>0</R12>
\t\t\t\t\t\t\t<R20>0</R20><R21>0</R21><R22>1</R22>
\t\t\t\t\t\t</CoordinateFrame>
\t\t\t\t\t\t<Color3 name="Color">
\t\t\t\t\t\t\t<R>{r:.4f}</R>
\t\t\t\t\t\t\t<G>{g:.4f}</G>
\t\t\t\t\t\t\t<B>{b:.4f}</B>
\t\t\t\t\t\t</Color3>
\t\t\t\t\t</Properties>
\t\t\t\t</Item>"""


def main():
    catalog_code = read_src("src/Shared/WarOfMenCatalog.luau")
    net_protocol_code = read_src("src/Shared/NetProtocol.luau")
    profile_store_code = read_src("src/Server/ProfileStoreService.luau")
    ballistics_code = read_src("src/Server/BallisticsCombatService.luau")
    world_sim_code = read_src("src/Server/WorldSimService.luau")
    tactical_ai_code = read_src("src/Server/TacticalAIService.luau")
    game_server_code = read_src("src/Server/GameServer.server.luau")
    client_code = read_src("src/Client/WarOfMenClient.client.luau")

    published_universe_id = 0
    published_place_id = 0
    if os.path.exists(PUBLISH_INFO_PATH):
        try:
            with open(PUBLISH_INFO_PATH, "r", encoding="utf-8") as pf:
                pinfo = json.load(pf)
                published_universe_id = int(pinfo.get("universeId") or 0)
                published_place_id = int(pinfo.get("placeId") or 0)
        except Exception:
            pass

    # Pre-built 3D battlefield geometry in Workspace so the place has rich 3D visual elements immediately
    bf_parts = [
        part_xml("RBX_WOM_GROUND", "TacticalGround", (340, 4, 240), (0, -2, 0), (82, 108, 64), 1280),
        part_xml("RBX_WOM_RIVER", "RiverChannel", (26, 1.5, 236), (0, -0.6, 0), (42, 96, 128), 272, 0.15, 1, False),
        part_xml("RBX_WOM_BRIDGE", "CentralBridgeDeck", (34, 1.4, 26), (0, 0.3, 0), (122, 112, 92), 816),
        part_xml("RBX_WOM_PARAPET_N", "BridgeParapetNorth", (34, 2.6, 1.8), (0, 1.6, -12.5), (95, 98, 102), 816),
        part_xml("RBX_WOM_PARAPET_S", "BridgeParapetSouth", (34, 2.6, 1.8), (0, 1.6, 12.5), (95, 98, 102), 816),
        part_xml("RBX_WOM_FORD_N", "NorthFordCrossing", (30, 0.9, 20), (0, -0.1, -68), (122, 112, 92), 800),
        part_xml("RBX_WOM_FORD_S", "SouthFordCrossing", (30, 0.9, 20), (0, -0.1, 68), (122, 112, 92), 800),
        part_xml("RBX_WOM_ROAD_W", "MainRoadWest", (145, 0.3, 18), (-88, 0.1, 0), (122, 112, 92), 864),
        part_xml("RBX_WOM_ROAD_E", "MainRoadEast", (145, 0.3, 18), (88, 0.1, 0), (122, 112, 92), 864),
        part_xml("RBX_WOM_BUNKER_W1", "BunkerWestNorth", (16, 5.5, 14), (-76, 2.75, -34), (96, 98, 102), 816),
        part_xml("RBX_WOM_BUNKER_W2", "BunkerWestSouth", (16, 5.5, 14), (-76, 2.75, 34), (96, 98, 102), 816),
        part_xml("RBX_WOM_BUNKER_E1", "BunkerEastNorth", (16, 5.5, 14), (76, 2.75, -34), (96, 98, 102), 816),
        part_xml("RBX_WOM_BUNKER_E2", "BunkerEastSouth", (16, 5.5, 14), (76, 2.75, 34), (96, 98, 102), 816),
        part_xml("RBX_WOM_SANDBAG_1", "SandbagWall_W1", (3.2, 2.3, 11.5), (-46, 1.15, -24), (174, 154, 112), 1296),
        part_xml("RBX_WOM_SANDBAG_2", "SandbagWall_W2", (3.2, 2.3, 11.5), (-46, 1.15, 24), (174, 154, 112), 1296),
        part_xml("RBX_WOM_SANDBAG_3", "SandbagWall_E1", (3.2, 2.3, 11.5), (46, 1.15, -24), (174, 154, 112), 1296),
        part_xml("RBX_WOM_SANDBAG_4", "SandbagWall_E2", (3.2, 2.3, 11.5), (46, 1.15, 24), (174, 154, 112), 1296),
    ]
    bf_xml = "\n".join(bf_parts)

    remote_events = [
        "IssueMoveOrder", "IssueAttackOrder", "SetPostureOrder", "SetFireModeOrder",
        "CallReinforcementOrder", "SelectMissionOrder", "ToggleBotModeOrder",
        "DirectControlFireOrder", "DirectControlMoveOrder", "ResetSkirmishOrder",
        "SyncBattleState", "CombatShotBroadcast", "BattleBannerBroadcast", "SyncPlayerProfile",
    ]
    remotes_xml = "\n".join([
        f"""\t\t\t<Item class="RemoteEvent" referent="RBX_REM_{i}">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">{rname}</string>
\t\t\t\t</Properties>
\t\t\t</Item>"""
        for i, rname in enumerate(remote_events)
    ])

    rbxlx = f"""<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
\t<External>null</External>
\t<External>nil</External>
\t<Item class="Workspace" referent="RBX_WORKSPACE">
\t\t<Properties>
\t\t\t<string name="Name">Workspace</string>
\t\t\t<float name="Gravity">196.2</float>
\t\t</Properties>
\t\t<Item class="Camera" referent="RBX_CAMERA">
\t\t\t<Properties>
\t\t\t\t<string name="Name">Camera</string>
\t\t\t\t<CoordinateFrame name="CFrame">
\t\t\t\t\t<X>-35</X><Y>78</Y><Z>62</Z>
\t\t\t\t\t<R00>1</R00><R01>0</R01><R02>0</R02>
\t\t\t\t\t<R10>0</R10><R11>0.6156</R11><R12>0.7880</R12>
\t\t\t\t\t<R20>0</R20><R21>-0.7880</R21><R22>0.6156</R22>
\t\t\t\t</CoordinateFrame>
\t\t\t\t<float name="FieldOfView">65</float>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="SpawnLocation" referent="RBX_SPAWN">
\t\t\t<Properties>
\t\t\t\t<string name="Name">CommanderSpawn</string>
\t\t\t\t<bool name="Anchored">true</bool>
\t\t\t\t<bool name="CanCollide">false</bool>
\t\t\t\t<float name="Transparency">1</float>
\t\t\t\t<Vector3 name="size"><X>6</X><Y>1</Y><Z>6</Z></Vector3>
\t\t\t\t<CoordinateFrame name="CFrame">
\t\t\t\t\t<X>-95</X><Y>3</Y><Z>0</Z>
\t\t\t\t\t<R00>1</R00><R01>0</R01><R02>0</R02>
\t\t\t\t\t<R10>0</R10><R11>1</R11><R12>0</R12>
\t\t\t\t\t<R20>0</R20><R21>0</R21><R22>1</R22>
\t\t\t\t</CoordinateFrame>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="Folder" referent="RBX_WOM_BF">
\t\t\t<Properties>
\t\t\t\t<string name="Name">WarOfMenBattlefield</string>
\t\t\t</Properties>
\t\t\t<Item class="Folder" referent="RBX_WOM_MAP_GEO">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">MapGeometry</string>
\t\t\t\t</Properties>
{bf_xml}
\t\t\t</Item>
\t\t\t<Item class="Folder" referent="RBX_WOM_UNITS">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">Units</string>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t\t<Item class="Folder" referent="RBX_WOM_FLAGS">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">Flags</string>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t\t<Item class="Folder" referent="RBX_WOM_WRECKS">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">Wrecks</string>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t</Item>
\t</Item>
\t<Item class="ReplicatedStorage" referent="RBX_REP_STORAGE">
\t\t<Properties>
\t\t\t<string name="Name">ReplicatedStorage</string>
\t\t</Properties>
\t\t<Item class="Folder" referent="RBX_REMOTES_FOLDER">
\t\t\t<Properties>
\t\t\t\t<string name="Name">WarOfMenRemotes</string>
\t\t\t</Properties>
{remotes_xml}
\t\t</Item>
\t\t<Item class="Folder" referent="RBX_SHARED">
\t\t\t<Properties>
\t\t\t\t<string name="Name">Shared</string>
\t\t\t</Properties>
\t\t\t<Item class="ModuleScript" referent="RBX_MOD_CATALOG">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">WarOfMenCatalog</string>
\t\t\t\t\t<ProtectedString name="Source">{cdata_safe(catalog_code)}</ProtectedString>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t\t<Item class="ModuleScript" referent="RBX_MOD_NET">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">NetProtocol</string>
\t\t\t\t\t<ProtectedString name="Source">{cdata_safe(net_protocol_code)}</ProtectedString>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t</Item>
\t</Item>
\t<Item class="ServerScriptService" referent="RBX_SSS">
\t\t<Properties>
\t\t\t<string name="Name">ServerScriptService</string>
\t\t</Properties>
\t\t<Item class="ModuleScript" referent="RBX_SRV_PROFILE">
\t\t\t<Properties>
\t\t\t\t<string name="Name">ProfileStoreService</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(profile_store_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="ModuleScript" referent="RBX_SRV_BALLISTICS">
\t\t\t<Properties>
\t\t\t\t<string name="Name">BallisticsCombatService</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(ballistics_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="ModuleScript" referent="RBX_SRV_WORLDSIM">
\t\t\t<Properties>
\t\t\t\t<string name="Name">WorldSimService</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(world_sim_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="ModuleScript" referent="RBX_SRV_AI">
\t\t\t<Properties>
\t\t\t\t<string name="Name">TacticalAIService</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(tactical_ai_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="Script" referent="RBX_SRV_MAIN">
\t\t\t<Properties>
\t\t\t\t<string name="Name">GameServer</string>
\t\t\t\t<token name="RunContext">0</token>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(game_server_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t</Item>
\t<Item class="StarterGui" referent="RBX_STARTER_GUI">
\t\t<Properties>
\t\t\t<string name="Name">StarterGui</string>
\t\t</Properties>
\t\t<Item class="LocalScript" referent="RBX_CLIENT_STARTERGUI">
\t\t\t<Properties>
\t\t\t\t<string name="Name">WarOfMenClientStarter</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(client_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t</Item>
\t<Item class="StarterPlayer" referent="RBX_STARTER_PLAYER">
\t\t<Properties>
\t\t\t<string name="Name">StarterPlayer</string>
\t\t</Properties>
\t\t<Item class="StarterPlayerScripts" referent="RBX_SPS">
\t\t\t<Properties>
\t\t\t\t<string name="Name">StarterPlayerScripts</string>
\t\t\t</Properties>
\t\t\t<Item class="LocalScript" referent="RBX_CLIENT_MAIN">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">WarOfMenClient</string>
\t\t\t\t\t<ProtectedString name="Source">{cdata_safe(client_code)}</ProtectedString>
\t\t\t\t</Properties>
\t\t\t</Item>
\t\t</Item>
\t</Item>
</roblox>
"""

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(rbxlx)
    print(f"Successfully generated {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")

    # Build Roblox Studio Live Plugin (.rbxmx)
    plugin_dir = os.path.expandvars(r"%LOCALAPPDATA%\Roblox\Plugins")
    os.makedirs(plugin_dir, exist_ok=True)
    plugin_path = os.path.join(plugin_dir, "WarOfMenStudioLive.rbxmx")

    plugin_entry_code = f"""--!nocheck
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterGui = game:GetService("StarterGui")
local StarterPlayer = game:GetService("StarterPlayer")
local CoreGui = game:GetService("CoreGui")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local okEdit, isEdit = pcall(function()
\treturn RunService:IsEdit()
end)
if not okEdit or not isEdit then
\treturn
end

local PUBLISHED_UNIVERSE_ID = {published_universe_id}
local PUBLISHED_PLACE_ID = {published_place_id}

local toolbar = plugin:CreateToolbar("War of Men RTS (OpenMoW)")
local toggleBtn = toolbar:CreateButton(
\t"⚔ Jugar / HUD",
\t"Mostrar u ocultar la interfaz táctica de War of Men en el visor de Roblox Studio",
\t"rbxassetid://6031075938"
)
local publishBtn = toolbar:CreateButton(
\t"☁️ Sincronizar & Publicar",
\t"Sincronizar scripts y campo de batalla de War of Men en este lugar",
\t"rbxassetid://6031302931"
)

local function syncDataModelScriptsAndBattlefield()
\tlocal syncFolder = script:FindFirstChild("SyncSources")
\tif not syncFolder then return end

\tlocal function getSource(name)
\t\tlocal sv = syncFolder:FindFirstChild(name)
\t\treturn if sv then sv.Value else nil
\tend

\tlocal function upsertScript(parent, className, name, src)
\t\tif not src then return end
\t\tlocal inst = parent:FindFirstChild(name)
\t\tif not inst or inst.ClassName ~= className then
\t\t\tif inst then inst:Destroy() end
\t\t\tinst = Instance.new(className)
\t\t\tinst.Name = name
\t\t\tinst.Parent = parent
\t\tend
\t\tpcall(function()
\t\t\tinst.Source = src
\t\tend)
\tend

\tlocal sharedFolder = ReplicatedStorage:FindFirstChild("Shared")
\tif not sharedFolder then
\t\tsharedFolder = Instance.new("Folder")
\t\tsharedFolder.Name = "Shared"
\t\tsharedFolder.Parent = ReplicatedStorage
\tend
\tupsertScript(sharedFolder, "ModuleScript", "WarOfMenCatalog", getSource("WarOfMenCatalog"))
\tupsertScript(sharedFolder, "ModuleScript", "NetProtocol", getSource("NetProtocol"))

\tlocal remotesFolder = ReplicatedStorage:FindFirstChild("WarOfMenRemotes")
\tif not remotesFolder then
\t\tremotesFolder = Instance.new("Folder")
\t\tremotesFolder.Name = "WarOfMenRemotes"
\t\tremotesFolder.Parent = ReplicatedStorage
\tend
\tfor _, rName in ipairs({{
\t\t"IssueMoveOrder", "IssueAttackOrder", "SetPostureOrder", "SetFireModeOrder",
\t\t"CallReinforcementOrder", "SelectMissionOrder", "ToggleBotModeOrder",
\t\t"DirectControlFireOrder", "DirectControlMoveOrder", "ResetSkirmishOrder",
\t\t"SyncBattleState", "CombatShotBroadcast", "BattleBannerBroadcast", "SyncPlayerProfile"
\t}}) do
\t\tif not remotesFolder:FindFirstChild(rName) then
\t\t\tlocal re = Instance.new("RemoteEvent")
\t\t\tre.Name = rName
\t\t\tre.Parent = remotesFolder
\t\tend
\tend

\tupsertScript(ServerScriptService, "ModuleScript", "ProfileStoreService", getSource("ProfileStoreService"))
\tupsertScript(ServerScriptService, "ModuleScript", "BallisticsCombatService", getSource("BallisticsCombatService"))
\tupsertScript(ServerScriptService, "ModuleScript", "WorldSimService", getSource("WorldSimService"))
\tupsertScript(ServerScriptService, "ModuleScript", "TacticalAIService", getSource("TacticalAIService"))
\tupsertScript(ServerScriptService, "Script", "GameServer", getSource("GameServer"))

\tupsertScript(StarterGui, "LocalScript", "WarOfMenClientStarter", getSource("WarOfMenClient"))
\tlocal sps = StarterPlayer:FindFirstChildOfClass("StarterPlayerScripts")
\tif sps then
\t\tupsertScript(sps, "LocalScript", "WarOfMenClient", getSource("WarOfMenClient"))
\tend

\tlocal bp = Workspace:FindFirstChild("Baseplate")
\tif bp then
\t\tbp:Destroy()
\tend

\tpcall(function()
\t\tChangeHistoryService:SetWaypoint("War of Men Cloud Sync")
\tend)
\tprint("[War of Men Studio Live Plugin] Synchronized all scripts & Remotes into PlaceId:", game.PlaceId)
end

local booted = false
local function tryBootWarOfMenInEditMode()
\tif booted then return end
\tif not Workspace:FindFirstChild("WarOfMenBattlefield") and game.PlaceId ~= PUBLISHED_PLACE_ID then return end
\tbooted = true
\tsyncDataModelScriptsAndBattlefield()
\tprint("[War of Men Studio Live Plugin] Mounting War of Men RTS directly in Roblox Studio Viewport...")
\ttask.spawn(function()
\t\trequire(script:WaitForChild("ClientRunner"))
\tend)
\ttask.delay(0.15, function()
\t\trequire(script:WaitForChild("ServerRunner"))
\tend)
\ttask.delay(1.0, function()
\t\tpcall(function()
\t\t\tChangeHistoryService:SetWaypoint("War of Men Ready To Publish")
\t\tend)
\tend)
end

toggleBtn.Click:Connect(function()
\ttryBootWarOfMenInEditMode()
\tlocal gui = CoreGui:FindFirstChild("WarOfMenTacticalGui")
\tif gui then
\t\tgui.Enabled = not gui.Enabled
\tend
end)

publishBtn.Click:Connect(function()
\tsyncDataModelScriptsAndBattlefield()
\tprint("[War of Men Studio Live Plugin] Ready to publish with Alt+P or File -> Publish to Roblox.")
end)

task.defer(function()
\tfor _ = 1, 25 do
\t\tif Workspace:FindFirstChild("WarOfMenBattlefield") or (PUBLISHED_PLACE_ID > 0 and game.PlaceId == PUBLISHED_PLACE_ID) then
\t\t\ttryBootWarOfMenInEditMode()
\t\t\tbreak
\t\tend
\t\ttask.wait(0.5)
\tend
end)
"""

    client_module_code = "return (function()\n" + client_code + "\nreturn true\nend)()"
    server_module_code = "return (function()\n" + game_server_code + "\nreturn true\nend)()"

    sync_sources_map = {
        "WarOfMenCatalog": catalog_code,
        "NetProtocol": net_protocol_code,
        "ProfileStoreService": profile_store_code,
        "BallisticsCombatService": ballistics_code,
        "WorldSimService": world_sim_code,
        "TacticalAIService": tactical_ai_code,
        "GameServer": game_server_code,
        "WarOfMenClient": client_code,
    }

    sync_items_xml = []
    for sname, scode in sync_sources_map.items():
        sync_items_xml.append(f"""\t\t\t<Item class="StringValue" referent="RBX_SYNC_{sname.upper()}">
\t\t\t\t<Properties>
\t\t\t\t\t<string name="Name">{sname}</string>
\t\t\t\t\t<string name="Value">{cdata_safe(scode)}</string>
\t\t\t\t</Properties>
\t\t\t</Item>""")
    sync_items_str = "\n".join(sync_items_xml)

    plugin_xml = f"""<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
\t<External>null</External>
\t<External>nil</External>
\t<Item class="Script" referent="RBX_WOM_PLUGIN_MAIN">
\t\t<Properties>
\t\t\t<string name="Name">WarOfMenStudioLivePlugin</string>
\t\t\t<token name="RunContext">0</token>
\t\t\t<ProtectedString name="Source">{cdata_safe(plugin_entry_code)}</ProtectedString>
\t\t</Properties>
\t\t<Item class="Folder" referent="RBX_WOM_SYNC_FOLDER">
\t\t\t<Properties>
\t\t\t\t<string name="Name">SyncSources</string>
\t\t\t</Properties>
{sync_items_str}
\t\t</Item>
\t\t<Item class="ModuleScript" referent="RBX_WOM_PLUGIN_CLIENT">
\t\t\t<Properties>
\t\t\t\t<string name="Name">ClientRunner</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(client_module_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t\t<Item class="ModuleScript" referent="RBX_WOM_PLUGIN_SERVER">
\t\t\t<Properties>
\t\t\t\t<string name="Name">ServerRunner</string>
\t\t\t\t<ProtectedString name="Source">{cdata_safe(server_module_code)}</ProtectedString>
\t\t\t</Properties>
\t\t</Item>
\t</Item>
</roblox>
"""

    with open(plugin_path, "w", encoding="utf-8") as f:
        f.write(plugin_xml)
    print(f"Successfully installed Roblox Studio Live Plugin: {plugin_path} ({os.path.getsize(plugin_path)} bytes)")


if __name__ == "__main__":
    main()
