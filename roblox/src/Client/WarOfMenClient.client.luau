--!nocheck
--[[
	WarOfMenClient.client.luau
	Cliente Táctico Jugable para "War of Men" (Roblox Port de OpenMoW-Web / Men of War: Assault Squad 2).
	Características:
	  - Cámara Híbrida: Vista Aérea Comandante RTS (WASD, Zoom, Q/E) + Modo Direct Control 3ra Persona [TAB]
	  - Selección Individual y Caja de Arrastre (Marquee Selection 2D -> 3D)
	  - Órdenes Tácticas con Clic Derecho (Movimiento en Formación y Fuego Concentrado)
	  - HUD Glassmorphism: Barra Superior, Selector de 15 Escaramuzas, Panel de 20 Refuerzos,
	    Inspector de Unidad (Posturas Stand/Crouch/Prone, Modo de Fuego, Blindaje) y Minimapa Radar
	  - Trazadores Balísticos, Destellos de Cañón, Explosiones HE y Textos Flotantes (PENETRATED / RICOCHET)
]]

if _G.WarOfMenClientStarted then
	return
end
_G.WarOfMenClientStarted = true

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")
local Debris = game:GetService("Debris")

local localPlayer = Players.LocalPlayer
local isStudioEdit = false
pcall(function()
	isStudioEdit = RunService:IsStudio() and not RunService:IsRunning()
end)

local parentGui = if localPlayer and not isStudioEdit
	then localPlayer:WaitForChild("PlayerGui")
	else game:GetService("CoreGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))
local NetProtocol = require(Shared:WaitForChild("NetProtocol"))

-- ============================================================================
-- 1. EFECTOS DE SONIDO DE COMBATE Y RADIO (ROBLOX SOUND ENGINE)
-- ============================================================================
local function playSound(kind: string, volume: number?, pitch: number?)
	pcall(function()
		local snd = Instance.new("Sound")
		snd.Volume = volume or 0.35
		snd.PlaybackSpeed = pitch or (0.95 + math.random() * 0.12)
		if kind == "rifle" then
			snd.SoundId = "rbxassetid://138081500"
		elseif kind == "mg" then
			snd.SoundId = "rbxassetid://138081500"
			snd.PlaybackSpeed = 1.35
		elseif kind == "cannon" then
			snd.SoundId = "rbxassetid://138090596"
			snd.Volume = 0.55
			snd.PlaybackSpeed = 0.82
		elseif kind == "ricochet" then
			snd.SoundId = "rbxassetid://12222084"
			snd.PlaybackSpeed = 1.45
		elseif kind == "order" then
			snd.SoundId = "rbxassetid://6895079853"
			snd.PlaybackSpeed = 1.15
		elseif kind == "radio" then
			snd.SoundId = "rbxassetid://12222253"
			snd.Volume = 0.45
		else
			snd.SoundId = "rbxassetid://6895079853"
		end
		snd.Parent = SoundService
		snd:Play()
		Debris:AddItem(snd, 2.0)
	end)
end

-- ============================================================================
-- 2. ESTADO DEL CLIENTE (RTS + DIRECT CONTROL)
-- ============================================================================
local state = {
	missionId = "usa_normandy",
	missionTitle = "USA 1: Omaha Beachhead — Sector Charlie",
	playerFaction = "USA",
	enemyFaction = "GER",
	elapsedTime = 0,
	teamMp = { [0] = 380, [1] = 380 },
	teamVp = { [0] = 500, [1] = 500 },
	reinfCooldowns = {},
	playerBotMode = "OFF",
	flags = {},
	units = {},
	unitsById = {},

	selectedUnitIds = {} :: { [number]: boolean },
	directControlUnitId = nil :: number?,
	activeReinfTab = "ACTIVE", -- "ACTIVE" | "USA" | "GER" | "ENG" | "RUS" | "JAP"
	missionModalOpen = false,

	-- Cámara RTS Orbital
	camFocus = Vector3.new(-35, 0, 0),
	camYaw = 0,
	camPitch = math.rad(52),
	camDist = 98,

	-- Selección por Caja (Marquee)
	isDraggingBox = false,
	dragStartPos = Vector2.zero,
	dragCurrPos = Vector2.zero,

	-- Perfil de Comandante
	commanderProfile = {
		rankLevel = 1,
		rankTitle = "2nd Lieutenant",
		xp = 0,
		victories = 0,
		infantryEliminated = 0,
		armorDestroyed = 0,
		flagsCaptured = 0,
	},
}

-- Limpiar GUI previa si se recarga
local oldGui = parentGui:FindFirstChild("WarOfMenTacticalGui")
if oldGui then
	oldGui:Destroy()
end

local fxFolder = Workspace:FindFirstChild("WarOfMenClientFX")
if not fxFolder then
	fxFolder = Instance.new("Folder")
	fxFolder.Name = "WarOfMenClientFX"
	fxFolder.Parent = Workspace
end

-- ============================================================================
-- 3. CONSTRUCCIÓN DE INTERFAZ TÁCTICA (HUD GLASSMORPHISM)
-- ============================================================================
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "WarOfMenTacticalGui"
screenGui.ResetOnSpawn = false
screenGui.IgnoreGuiInset = true
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screenGui.Parent = parentGui

local function addCorner(inst: GuiObject, radius: number)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = inst
end

local function addStroke(inst: GuiObject, color: Color3, thickness: number, trans: number?)
	local s = Instance.new("UIStroke")
	s.Color = color
	s.Thickness = thickness
	s.Transparency = trans or 0.35
	s.Parent = inst
end

-- Caja de Selección Múltiple (Marquee Box)
local marqueeBox = Instance.new("Frame")
marqueeBox.Name = "MarqueeSelectionBox"
marqueeBox.BackgroundColor3 = Color3.fromRGB(74, 222, 128)
marqueeBox.BackgroundTransparency = 0.82
marqueeBox.BorderSizePixel = 0
marqueeBox.Visible = false
marqueeBox.Parent = screenGui
addStroke(marqueeBox, Color3.fromRGB(74, 222, 128), 1.5, 0.1)

-- Retícula de Puntería para Modo Direct Control
local reticleFrame = Instance.new("Frame")
reticleFrame.Name = "DirectControlReticle"
reticleFrame.Size = UDim2.new(0, 180, 0, 48)
reticleFrame.Position = UDim2.new(0.5, -90, 0.14, 0)
reticleFrame.BackgroundColor3 = Color3.fromRGB(15, 23, 34)
reticleFrame.BackgroundTransparency = 0.25
reticleFrame.Visible = false
reticleFrame.Parent = screenGui
addCorner(reticleFrame, 8)
addStroke(reticleFrame, Color3.fromRGB(250, 204, 21), 1.5, 0.15)

local reticleLabel = Instance.new("TextLabel")
reticleLabel.Size = UDim2.new(1, -12, 1, 0)
reticleLabel.Position = UDim2.new(0, 6, 0, 0)
reticleLabel.BackgroundTransparency = 1
reticleLabel.Font = Enum.Font.GothamBold
reticleLabel.TextSize = 12
reticleLabel.TextColor3 = Color3.fromRGB(250, 204, 21)
reticleLabel.Text = "🎯 DIRECT CONTROL ACTIVE\nWASD Move • Click/Space Fire • [TAB] Exit"
reticleLabel.Parent = reticleFrame

-- 3.1. BARRA SUPERIOR TÁCTICA (TOP BAR)
local topBar = Instance.new("Frame")
topBar.Name = "TopCommandBar"
topBar.Size = UDim2.new(1, -24, 0, 52)
topBar.Position = UDim2.new(0, 12, 0, 10)
topBar.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
topBar.BackgroundTransparency = 0.14
topBar.Parent = screenGui
addCorner(topBar, 10)
addStroke(topBar, Color3.fromRGB(71, 85, 105), 1, 0.3)

local brandLabel = Instance.new("TextLabel")
brandLabel.Size = UDim2.new(0, 205, 1, 0)
brandLabel.Position = UDim2.new(0, 14, 0, 0)
brandLabel.BackgroundTransparency = 1
brandLabel.Font = Enum.Font.GothamBlack
brandLabel.TextSize = 15
brandLabel.TextXAlignment = Enum.TextXAlignment.Left
brandLabel.TextColor3 = Color3.fromRGB(248, 250, 252)
brandLabel.Text = "⚔ WAR OF MEN\n<font size='10' color='#94a3b8'>ASSAULT SQUAD RTS • GEM2</font>"
brandLabel.RichText = true
brandLabel.Parent = topBar

-- Indicador de Puntos de Mando (MP)
local mpPill = Instance.new("Frame")
mpPill.Size = UDim2.new(0, 155, 0, 36)
mpPill.Position = UDim2.new(0, 222, 0.5, -18)
mpPill.BackgroundColor3 = Color3.fromRGB(20, 36, 28)
mpPill.Parent = topBar
addCorner(mpPill, 8)
addStroke(mpPill, Color3.fromRGB(74, 222, 128), 1, 0.35)

local mpText = Instance.new("TextLabel")
mpText.Size = UDim2.new(1, 0, 1, 0)
mpText.BackgroundTransparency = 1
mpText.Font = Enum.Font.GothamBold
mpText.TextSize = 14
mpText.TextColor3 = Color3.fromRGB(134, 239, 172)
mpText.Text = "⚡ MP: 380 (+16/s)"
mpText.Parent = mpPill

-- Marcador Central de Banderas y Puntos de Victoria (VP)
local scorePill = Instance.new("Frame")
scorePill.Size = UDim2.new(0, 275, 0, 36)
scorePill.Position = UDim2.new(0, 386, 0.5, -18)
scorePill.BackgroundColor3 = Color3.fromRGB(22, 28, 38)
scorePill.Parent = topBar
addCorner(scorePill, 8)
addStroke(scorePill, Color3.fromRGB(100, 116, 139), 1, 0.4)

local scoreText = Instance.new("TextLabel")
scoreText.Size = UDim2.new(1, 0, 1, 0)
scoreText.BackgroundTransparency = 1
scoreText.Font = Enum.Font.GothamBold
scoreText.TextSize = 13
scoreText.TextColor3 = Color3.fromRGB(241, 245, 249)
scoreText.Text = "ALLIES 500 VP  |  ⚑ 1 - 1  |  AXIS 500 VP"
scoreText.Parent = scorePill

-- Botón Selector de Misión (15 Escaramuzas)
local missionBtn = Instance.new("TextButton")
missionBtn.Size = UDim2.new(0, 250, 0, 36)
missionBtn.Position = UDim2.new(1, -555, 0.5, -18)
missionBtn.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
missionBtn.Font = Enum.Font.GothamBold
missionBtn.TextSize = 12
missionBtn.TextColor3 = Color3.fromRGB(226, 232, 240)
missionBtn.Text = "🗺 MAP: USA 1 — Omaha Beachhead ▾"
missionBtn.Parent = topBar
addCorner(missionBtn, 8)
addStroke(missionBtn, Color3.fromRGB(96, 165, 250), 1, 0.35)

-- Botón Player-Bot (OFF / DEFEND / ATTACK)
local botBtn = Instance.new("TextButton")
botBtn.Size = UDim2.new(0, 118, 0, 36)
botBtn.Position = UDim2.new(1, -296, 0.5, -18)
botBtn.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
botBtn.Font = Enum.Font.GothamBold
botBtn.TextSize = 12
botBtn.TextColor3 = Color3.fromRGB(248, 250, 252)
botBtn.Text = "🤖 BOT: OFF"
botBtn.Parent = topBar
addCorner(botBtn, 8)
addStroke(botBtn, Color3.fromRGB(148, 163, 184), 1, 0.4)

-- Botón Direct Control [TAB]
local directBtn = Instance.new("TextButton")
directBtn.Size = UDim2.new(0, 108, 0, 36)
directBtn.Position = UDim2.new(1, -170, 0.5, -18)
directBtn.BackgroundColor3 = Color3.fromRGB(68, 52, 18)
directBtn.Font = Enum.Font.GothamBold
directBtn.TextSize = 12
directBtn.TextColor3 = Color3.fromRGB(253, 224, 71)
directBtn.Text = "🎯 3RD [TAB]"
directBtn.Parent = topBar
addCorner(directBtn, 8)
addStroke(directBtn, Color3.fromRGB(250, 204, 21), 1, 0.3)

-- Botón Reiniciar Partida
local resetBtn = Instance.new("TextButton")
resetBtn.Size = UDim2.new(0, 48, 0, 36)
resetBtn.Position = UDim2.new(1, -56, 0.5, -18)
resetBtn.BackgroundColor3 = Color3.fromRGB(69, 26, 26)
resetBtn.Font = Enum.Font.GothamBold
resetBtn.TextSize = 14
resetBtn.TextColor3 = Color3.fromRGB(252, 165, 165)
resetBtn.Text = "↻"
resetBtn.Parent = topBar
addCorner(resetBtn, 8)

-- 3.2. BANNER CENTRAL DE EVENTOS TÁCTICOS (CAPTURA / REFUERZOS / VICTORIA)
local bannerFrame = Instance.new("Frame")
bannerFrame.Size = UDim2.new(0, 420, 0, 56)
bannerFrame.Position = UDim2.new(0.5, -210, 0, 70)
bannerFrame.BackgroundColor3 = Color3.fromRGB(15, 23, 34)
bannerFrame.BackgroundTransparency = 0.15
bannerFrame.Visible = false
bannerFrame.Parent = screenGui
addCorner(bannerFrame, 10)
addStroke(bannerFrame, Color3.fromRGB(134, 239, 172), 1.5, 0.2)

local bannerTitle = Instance.new("TextLabel")
bannerTitle.Size = UDim2.new(1, -16, 0, 26)
bannerTitle.Position = UDim2.new(0, 8, 0, 4)
bannerTitle.BackgroundTransparency = 1
bannerTitle.Font = Enum.Font.GothamBlack
bannerTitle.TextSize = 15
bannerTitle.TextColor3 = Color3.fromRGB(134, 239, 172)
bannerTitle.Text = "SECTOR CAPTURED"
bannerTitle.Parent = bannerFrame

local bannerSub = Instance.new("TextLabel")
bannerSub.Size = UDim2.new(1, -16, 0, 20)
bannerSub.Position = UDim2.new(0, 8, 0, 30)
bannerSub.BackgroundTransparency = 1
bannerSub.Font = Enum.Font.GothamMedium
bannerSub.TextSize = 12
bannerSub.TextColor3 = Color3.fromRGB(226, 232, 240)
bannerSub.Text = "Allied forces hold the sector!"
bannerSub.Parent = bannerFrame

local bannerHideToken = 0
local function showBanner(title: string, subtitle: string, team: number?)
	bannerHideToken += 1
	local myToken = bannerHideToken
	bannerTitle.Text = title
	bannerSub.Text = subtitle
	bannerTitle.TextColor3 = if team == 1 then Color3.fromRGB(248, 113, 113) else Color3.fromRGB(134, 239, 172)
	bannerFrame.Visible = true
	task.delay(3.8, function()
		if bannerHideToken == myToken then
			bannerFrame.Visible = false
		end
	end)
end

-- 3.3. PANEL IZQUIERDO: INSPECTOR DE UNIDAD Y ÓRDENES DE POSTURA / FUEGO
local inspectorFrame = Instance.new("Frame")
inspectorFrame.Name = "UnitInspectorPanel"
inspectorFrame.Size = UDim2.new(0, 276, 0, 224)
inspectorFrame.Position = UDim2.new(0, 12, 1, -368)
inspectorFrame.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
inspectorFrame.BackgroundTransparency = 0.14
inspectorFrame.Parent = screenGui
addCorner(inspectorFrame, 10)
addStroke(inspectorFrame, Color3.fromRGB(71, 85, 105), 1, 0.3)

local inspHeader = Instance.new("TextLabel")
inspHeader.Size = UDim2.new(1, -20, 0, 24)
inspHeader.Position = UDim2.new(0, 10, 0, 8)
inspHeader.BackgroundTransparency = 1
inspHeader.Font = Enum.Font.GothamBlack
inspHeader.TextSize = 13
inspHeader.TextXAlignment = Enum.TextXAlignment.Left
inspHeader.TextColor3 = Color3.fromRGB(134, 239, 172)
inspHeader.Text = "UNIT INSPECTOR (CLICK OR DRAG)"
inspHeader.Parent = inspectorFrame

local inspDetails = Instance.new("TextLabel")
inspDetails.Size = UDim2.new(1, -20, 0, 68)
inspDetails.Position = UDim2.new(0, 10, 0, 34)
inspDetails.BackgroundTransparency = 1
inspDetails.Font = Enum.Font.GothamMedium
inspDetails.TextSize = 12
inspDetails.TextXAlignment = Enum.TextXAlignment.Left
inspDetails.TextYAlignment = Enum.TextYAlignment.Top
inspDetails.TextColor3 = Color3.fromRGB(226, 232, 240)
inspDetails.RichText = true
inspDetails.Text = "Select allied troops with Left-Click or drag a box.\nRight-Click ground to move in formation.\nRight-Click an enemy to focus fire."
inspDetails.Parent = inspectorFrame

-- Botones de Postura: STAND [Z], CROUCH [X], PRONE [C]
local postureDefs = {
	{ id = "stand", label = "🧍 STAND [Z]", x = 10 },
	{ id = "crouch", label = "🧎 CROUCH [X]", x = 98 },
	{ id = "prone", label = "🛌 PRONE [C]", x = 186 },
}
local postureButtons: { [string]: TextButton } = {}
for _, pDef in ipairs(postureDefs) do
	local btn = Instance.new("TextButton")
	btn.Size = UDim2.new(0, 80, 0, 32)
	btn.Position = UDim2.new(0, pDef.x, 0, 110)
	btn.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
	btn.Font = Enum.Font.GothamBold
	btn.TextSize = 11
	btn.TextColor3 = Color3.fromRGB(241, 245, 249)
	btn.Text = pDef.label
	btn.Parent = inspectorFrame
	addCorner(btn, 6)
	addStroke(btn, Color3.fromRGB(100, 116, 139), 1, 0.4)
	postureButtons[pDef.id] = btn
end

-- Botones de Modo de Fuego: FREE FIRE [F], HOLD FIRE [H], SELECT ALL [A]
local fireFreeBtn = Instance.new("TextButton")
fireFreeBtn.Size = UDim2.new(0, 80, 0, 32)
fireFreeBtn.Position = UDim2.new(0, 10, 0, 148)
fireFreeBtn.BackgroundColor3 = Color3.fromRGB(22, 68, 42)
fireFreeBtn.Font = Enum.Font.GothamBold
fireFreeBtn.TextSize = 11
fireFreeBtn.TextColor3 = Color3.fromRGB(134, 239, 172)
fireFreeBtn.Text = "🔥 FREE [F]"
fireFreeBtn.Parent = inspectorFrame
addCorner(fireFreeBtn, 6)

local fireHoldBtn = Instance.new("TextButton")
fireHoldBtn.Size = UDim2.new(0, 80, 0, 32)
fireHoldBtn.Position = UDim2.new(0, 98, 0, 148)
fireHoldBtn.BackgroundColor3 = Color3.fromRGB(68, 32, 32)
fireHoldBtn.Font = Enum.Font.GothamBold
fireHoldBtn.TextSize = 11
fireHoldBtn.TextColor3 = Color3.fromRGB(252, 165, 165)
fireHoldBtn.Text = "✋ HOLD [H]"
fireHoldBtn.Parent = inspectorFrame
addCorner(fireHoldBtn, 6)

local selectAllBtn = Instance.new("TextButton")
selectAllBtn.Size = UDim2.new(0, 80, 0, 32)
selectAllBtn.Position = UDim2.new(0, 186, 0, 148)
selectAllBtn.BackgroundColor3 = Color3.fromRGB(30, 58, 95)
selectAllBtn.Font = Enum.Font.GothamBold
selectAllBtn.TextSize = 11
selectAllBtn.TextColor3 = Color3.fromRGB(147, 197, 253)
selectAllBtn.Text = "✪ ALL [G]"
selectAllBtn.Parent = inspectorFrame
addCorner(selectAllBtn, 6)

local commanderRankLabel = Instance.new("TextLabel")
commanderRankLabel.Size = UDim2.new(1, -20, 0, 26)
commanderRankLabel.Position = UDim2.new(0, 10, 0, 188)
commanderRankLabel.BackgroundTransparency = 1
commanderRankLabel.Font = Enum.Font.GothamBold
commanderRankLabel.TextSize = 11
commanderRankLabel.TextXAlignment = Enum.TextXAlignment.Left
commanderRankLabel.TextColor3 = Color3.fromRGB(250, 204, 21)
commanderRankLabel.Text = "🎖 2nd Lieutenant • Kills: 0 • Armor Destroyed: 0"
commanderRankLabel.Parent = inspectorFrame

-- 3.4. PANEL INFERIOR DE DESPLIEGUE DE REFUERZOS (20 ESCUADRAS / BLINDADOS)
local reinfDock = Instance.new("Frame")
reinfDock.Name = "ReinforcementDock"
reinfDock.Size = UDim2.new(1, -556, 0, 126)
reinfDock.Position = UDim2.new(0, 12, 1, -134)
reinfDock.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
reinfDock.BackgroundTransparency = 0.12
reinfDock.Parent = screenGui
addCorner(reinfDock, 10)
addStroke(reinfDock, Color3.fromRGB(71, 85, 105), 1, 0.3)

local factionTabsFrame = Instance.new("Frame")
factionTabsFrame.Size = UDim2.new(1, -16, 0, 26)
factionTabsFrame.Position = UDim2.new(0, 8, 0, 6)
factionTabsFrame.BackgroundTransparency = 1
factionTabsFrame.Parent = reinfDock

local tabDefs = {
	{ id = "ACTIVE", label = "⚔ MISSION FACTION" },
	{ id = "USA", label = "🇺🇸 USA" },
	{ id = "GER", label = "🇩🇪 GER" },
	{ id = "ENG", label = "🇬🇧 ENG" },
	{ id = "RUS", label = "🚩 RUS" },
	{ id = "JAP", label = "🇯🇵 JAP" },
}
local tabButtons: { [string]: TextButton } = {}
for idx, tDef in ipairs(tabDefs) do
	local tb = Instance.new("TextButton")
	tb.Size = UDim2.new(0, if idx == 1 then 138 else 72, 1, 0)
	tb.Position = UDim2.new(0, if idx == 1 then 0 else (144 + (idx - 2) * 76), 0, 0)
	tb.BackgroundColor3 = if idx == 1 then Color3.fromRGB(34, 84, 56) else Color3.fromRGB(26, 34, 46)
	tb.Font = Enum.Font.GothamBold
	tb.TextSize = 11
	tb.TextColor3 = Color3.fromRGB(241, 245, 249)
	tb.Text = tDef.label
	tb.Parent = factionTabsFrame
	addCorner(tb, 6)
	tabButtons[tDef.id] = tb
end

local cardsContainer = Instance.new("Frame")
cardsContainer.Size = UDim2.new(1, -16, 0, 84)
cardsContainer.Position = UDim2.new(0, 8, 0, 36)
cardsContainer.BackgroundTransparency = 1
cardsContainer.Parent = reinfDock

-- 3.5. MINIMAPA RADAR TÁCTICO INTERACTIVO (ESQUINA INFERIOR DERECHA)
local minimapFrame = Instance.new("Frame")
minimapFrame.Name = "TacticalMinimap"
minimapFrame.Size = UDim2.new(0, 248, 0, 174)
minimapFrame.Position = UDim2.new(1, -260, 1, -182)
minimapFrame.BackgroundColor3 = Color3.fromRGB(16, 26, 22)
minimapFrame.BackgroundTransparency = 0.08
minimapFrame.ClipsDescendants = true
minimapFrame.Parent = screenGui
addCorner(minimapFrame, 10)
addStroke(minimapFrame, Color3.fromRGB(74, 222, 128), 1.5, 0.35)

-- Río y Puente en el Minimapa
local mmRiver = Instance.new("Frame")
mmRiver.Size = UDim2.new(0.08, 0, 1, 0)
mmRiver.Position = UDim2.new(0.46, 0, 0, 0)
mmRiver.BackgroundColor3 = Color3.fromRGB(38, 88, 124)
mmRiver.BorderSizePixel = 0
mmRiver.Parent = minimapFrame

local mmRoad = Instance.new("Frame")
mmRoad.Size = UDim2.new(1, 0, 0.09, 0)
mmRoad.Position = UDim2.new(0, 0, 0.455, 0)
mmRoad.BackgroundColor3 = Color3.fromRGB(110, 104, 88)
mmRoad.BorderSizePixel = 0
mmRoad.Parent = minimapFrame

local mmHeader = Instance.new("TextLabel")
mmHeader.Size = UDim2.new(1, -10, 0, 16)
mmHeader.Position = UDim2.new(0, 6, 0, 2)
mmHeader.BackgroundTransparency = 1
mmHeader.Font = Enum.Font.GothamBold
mmHeader.TextSize = 10
mmHeader.TextXAlignment = Enum.TextXAlignment.Left
mmHeader.TextColor3 = Color3.fromRGB(134, 239, 172)
mmHeader.Text = "RADAR • CLICK TO MOVE CAMERA"
mmHeader.ZIndex = 5
mmHeader.Parent = minimapFrame

local mmDotsFolder = Instance.new("Folder")
mmDotsFolder.Name = "RadarDots"
mmDotsFolder.Parent = minimapFrame

local mmCamBox = Instance.new("Frame")
mmCamBox.Size = UDim2.new(0, 44, 0, 32)
mmCamBox.BackgroundTransparency = 1
mmCamBox.ZIndex = 6
mmCamBox.Parent = minimapFrame
addStroke(mmCamBox, Color3.fromRGB(250, 204, 21), 1.2, 0.15)

local mmClickBtn = Instance.new("TextButton")
mmClickBtn.Size = UDim2.new(1, 0, 1, 0)
mmClickBtn.BackgroundTransparency = 1
mmClickBtn.Text = ""
mmClickBtn.ZIndex = 10
mmClickBtn.Parent = minimapFrame

-- 3.6. MODAL SELECTOR DE LAS 15 ESCARAMUZAS TÁCTICAS
local missionModal = Instance.new("Frame")
missionModal.Name = "MissionSelectorModal"
missionModal.Size = UDim2.new(0, 740, 0, 430)
missionModal.Position = UDim2.new(0.5, -370, 0.5, -215)
missionModal.BackgroundColor3 = Color3.fromRGB(12, 18, 26)
missionModal.BackgroundTransparency = 0.04
missionModal.Visible = false
missionModal.ZIndex = 20
missionModal.Parent = screenGui
addCorner(missionModal, 12)
addStroke(missionModal, Color3.fromRGB(96, 165, 250), 1.5, 0.2)

local modalTitle = Instance.new("TextLabel")
modalTitle.Size = UDim2.new(1, -24, 0, 34)
modalTitle.Position = UDim2.new(0, 14, 0, 8)
modalTitle.BackgroundTransparency = 1
modalTitle.Font = Enum.Font.GothamBlack
modalTitle.TextSize = 16
modalTitle.TextXAlignment = Enum.TextXAlignment.Left
modalTitle.TextColor3 = Color3.fromRGB(248, 250, 252)
modalTitle.Text = "🗺 SELECT OPERATION (15 HISTORICAL SKIRMISHES • 5 FACTIONS)"
modalTitle.ZIndex = 21
modalTitle.Parent = missionModal

local closeModalBtn = Instance.new("TextButton")
closeModalBtn.Size = UDim2.new(0, 32, 0, 32)
closeModalBtn.Position = UDim2.new(1, -42, 0, 8)
closeModalBtn.BackgroundColor3 = Color3.fromRGB(68, 28, 28)
closeModalBtn.Font = Enum.Font.GothamBold
closeModalBtn.TextSize = 14
closeModalBtn.TextColor3 = Color3.fromRGB(252, 165, 165)
closeModalBtn.Text = "✕"
closeModalBtn.ZIndex = 22
closeModalBtn.Parent = missionModal
addCorner(closeModalBtn, 6)

local missionGrid = Instance.new("Frame")
missionGrid.Size = UDim2.new(1, -24, 1, -56)
missionGrid.Position = UDim2.new(0, 12, 0, 46)
missionGrid.BackgroundTransparency = 1
missionGrid.ZIndex = 21
missionGrid.Parent = missionModal

for idx, mDef in ipairs(WarOfMenCatalog.MISSIONS) do
	local row = math.floor((idx - 1) / 3)
	local col = (idx - 1) % 3
	local card = Instance.new("TextButton")
	card.Size = UDim2.new(0.32, 0, 0, 68)
	card.Position = UDim2.new(col * 0.34, 0, 0, row * 74)
	card.BackgroundColor3 = Color3.fromRGB(22, 32, 46)
	card.Font = Enum.Font.GothamBold
	card.TextSize = 12
	card.TextColor3 = Color3.fromRGB(241, 245, 249)
	card.TextXAlignment = Enum.TextXAlignment.Left
	card.RichText = true
	local pFac = WarOfMenCatalog.FACTIONS[mDef.playerFaction]
	local eFac = WarOfMenCatalog.FACTIONS[mDef.enemyFaction]
	card.Text = string.format(
		"  %s <b>%s</b>\n  <font size='10' color='#94a3b8'>%s (%s vs %s)</font>",
		pFac.flagEmoji,
		mDef.title,
		mDef.theater,
		mDef.playerFaction,
		mDef.enemyFaction
	)
	card.ZIndex = 22
	card.Parent = missionGrid
	addCorner(card, 8)
	addStroke(card, pFac.accentColor, 1, 0.45)

	card.MouseButton1Click:Connect(function()
		playSound("order")
		missionModal.Visible = false
		state.missionModalOpen = false
		NetProtocol.fireServer(NetProtocol.EVENTS.SelectMissionOrder, { missionId = mDef.id })
	end)
end

-- ============================================================================
-- 4. RENDERIZADO DE TARJETAS DE REFUERZOS Y MINIMAPA
-- ============================================================================
local function rebuildReinforcementCards()
	cardsContainer:ClearAllChildren()
	local targetFaction: any = if state.activeReinfTab == "ACTIVE"
		then state.playerFaction
		else state.activeReinfTab
	local list = WarOfMenCatalog.getReinforcementsForFaction(targetFaction)
	local facDef = WarOfMenCatalog.FACTIONS[targetFaction] or WarOfMenCatalog.FACTIONS.USA

	for idx, rDef in ipairs(list) do
		local card = Instance.new("TextButton")
		card.Name = rDef.id
		card.Size = UDim2.new(0.24, -4, 1, 0)
		card.Position = UDim2.new((idx - 1) * 0.25, 0, 0, 0)
		card.BackgroundColor3 = Color3.fromRGB(24, 34, 46)
		card.Font = Enum.Font.GothamBold
		card.TextSize = 12
		card.TextColor3 = Color3.fromRGB(248, 250, 252)
		card.RichText = true
		local cdRem = math.ceil(tonumber(state.reinfCooldowns[rDef.id]) or 0)
		local canAfford = (state.teamMp[0] or 0) >= rDef.costMp and cdRem <= 0
		card.BackgroundColor3 = if canAfford then Color3.fromRGB(24, 42, 34) else Color3.fromRGB(30, 32, 38)
		card.Text = string.format(
			"%s <b>[%s] %s</b>\n<font size='11' color='%s'>⚡ %d MP %s</font>",
			facDef.flagEmoji,
			rDef.badge,
			rDef.name,
			if canAfford then "#86efac" else "#fca5a5",
			rDef.costMp,
			if cdRem > 0 then string.format("(⏳ %ds)", cdRem) else "• READY"
		)
		card.Parent = cardsContainer
		addCorner(card, 8)
		addStroke(card, if canAfford then Color3.fromRGB(74, 222, 128) else Color3.fromRGB(100, 116, 139), 1, 0.35)

		card.MouseButton1Click:Connect(function()
			playSound("radio")
			NetProtocol.fireServer(NetProtocol.EVENTS.CallReinforcementOrder, { reinfId = rDef.id })
		end)
	end
end

for tabId, btn in pairs(tabButtons) do
	btn.MouseButton1Click:Connect(function()
		playSound("order")
		state.activeReinfTab = tabId
		for id, b in pairs(tabButtons) do
			b.BackgroundColor3 = if id == tabId then Color3.fromRGB(34, 84, 56) else Color3.fromRGB(26, 34, 46)
		end
		rebuildReinforcementCards()
	end)
end

local function updateInspectorAndHud()
	local mp0 = state.teamMp[0] or 0
	local vp0 = state.teamVp[0] or 500
	local vp1 = state.teamVp[1] or 500

	local alliedFlags = 0
	local axisFlags = 0
	for _, fl in ipairs(state.flags) do
		if fl.owner == 0 then
			alliedFlags += 1
		elseif fl.owner == 1 then
			axisFlags += 1
		end
	end

	local income = math.floor(10 + alliedFlags * 5.5)
	mpText.Text = string.format("⚡ MP: %d (+%d/s)", mp0, income)
	scoreText.Text = string.format("ALLIES %d VP  |  ⚑ %d - %d  |  AXIS %d VP", vp0, alliedFlags, axisFlags, vp1)
	missionBtn.Text = "🗺 " .. state.missionTitle .. " ▾"
	botBtn.Text = "🤖 BOT: " .. state.playerBotMode

	rebuildReinforcementCards()

	-- Actualizar Inspector de Unidad
	local selList = {}
	for uid, isSel in pairs(state.selectedUnitIds) do
		if isSel and state.unitsById[uid] then
			table.insert(selList, state.unitsById[uid])
		else
			state.selectedUnitIds[uid] = nil
		end
	end

	if #selList == 0 then
		inspHeader.Text = "NO UNIT SELECTED (LEFT-CLICK / DRAG)"
		inspDetails.Text = "<b>RTS Controls:</b> WASD Camera • Scroll Zoom • Q/E Rotate\n<b>Combat Orders:</b> Right-Click ground to move in formation, or Right-Click enemy to focus fire.\n<b>Direct Control:</b> Press <b>[TAB]</b> to pilot any unit in 3rd Person!"
	else
		local lead = selList[1]
		local wep = WarOfMenCatalog.WEAPONS[lead.weaponId]
		local tpl = WarOfMenCatalog.UNIT_TEMPLATES[lead.templateId]
		local wepInfo = if wep then string.format("%s (Pen: %dmm @ 50m)", wep.name, wep.penetration.d50) else lead.weaponId
		local armorInfo = if tpl and tpl.armor
			then string.format("Armor F/S/R: %d / %d / %d mm", tpl.armor.front, tpl.armor.side, tpl.armor.rear)
			else string.format("Posture: %s %s", string.upper(lead.posture), if lead.inCover then "🛡️ [IN COVER]" else "")

		inspHeader.Text = if #selList == 1
			then string.format("★ %s (HP %d/%d)", lead.name, lead.hp, lead.maxHp)
			else string.format("SQUAD SELECTED (%d UNITS) • Lead: %s", #selList, lead.name)

		inspDetails.Text = string.format(
			"<b>Weapon:</b> %s\n<b>Protection:</b> %s\n<b>Fire Mode:</b> %s  •  <b>Kills:</b> %d (Vet ★%d)",
			wepInfo,
			armorInfo,
			string.upper(lead.fireMode),
			lead.kills or 0,
			lead.veterancy or 0
		)
	end

	-- Actualizar Minimapa Radar
	mmDotsFolder:ClearAllChildren()
	for _, fl in ipairs(state.flags) do
		local fx = math.clamp((fl.pos.X + 160) / 320, 0.04, 0.96)
		local fz = math.clamp((fl.pos.Z + 110) / 220, 0.06, 0.94)
		local fDot = Instance.new("Frame")
		fDot.Size = UDim2.new(0, 10, 0, 10)
		fDot.Position = UDim2.new(fx, -5, fz, -5)
		fDot.BackgroundColor3 = if fl.owner == 0
			then Color3.fromRGB(52, 211, 153)
			elseif fl.owner == 1 then Color3.fromRGB(248, 113, 113)
			else Color3.fromRGB(250, 204, 21)
		fDot.ZIndex = 4
		fDot.Parent = mmDotsFolder
		addCorner(fDot, 5)
	end

	for _, u in ipairs(state.units) do
		local ux = math.clamp((u.pos.X + 160) / 320, 0.03, 0.97)
		local uz = math.clamp((u.pos.Z + 110) / 220, 0.05, 0.95)
		local dot = Instance.new("Frame")
		local sz = if u.kind == "vehicle" then 7 else 4
		dot.Size = UDim2.new(0, sz, 0, sz)
		dot.Position = UDim2.new(ux, -sz / 2, uz, -sz / 2)
		dot.BackgroundColor3 = if state.selectedUnitIds[u.id]
			then Color3.fromRGB(250, 204, 21)
			elseif u.team == 0 then Color3.fromRGB(74, 222, 128)
			else Color3.fromRGB(248, 113, 113)
		dot.BorderSizePixel = 0
		dot.ZIndex = 5
		dot.Parent = mmDotsFolder
	end

	local cx = math.clamp((state.camFocus.X + 160) / 320, 0.08, 0.92)
	local cz = math.clamp((state.camFocus.Z + 110) / 220, 0.1, 0.9)
	mmCamBox.Position = UDim2.new(cx, -22, cz, -16)
end

-- ============================================================================
-- 5. CONEXIONES DE BOTONES DEL HUD Y MINIMAPA
-- ============================================================================
missionBtn.MouseButton1Click:Connect(function()
	playSound("order")
	state.missionModalOpen = not state.missionModalOpen
	missionModal.Visible = state.missionModalOpen
end)

closeModalBtn.MouseButton1Click:Connect(function()
	state.missionModalOpen = false
	missionModal.Visible = false
end)

botBtn.MouseButton1Click:Connect(function()
	playSound("order")
	local nextMode = if state.playerBotMode == "OFF"
		then "DEFEND"
		elseif state.playerBotMode == "DEFEND" then "ATTACK"
		else "OFF"
	state.playerBotMode = nextMode
	NetProtocol.fireServer(NetProtocol.EVENTS.ToggleBotModeOrder, { mode = nextMode })
	updateInspectorAndHud()
end)

resetBtn.MouseButton1Click:Connect(function()
	playSound("order")
	NetProtocol.fireServer(NetProtocol.EVENTS.ResetSkirmishOrder, {})
end)

local function getSelectedIdsArray(): { number }
	local arr = {}
	for uid, isSel in pairs(state.selectedUnitIds) do
		if isSel and state.unitsById[uid] then
			table.insert(arr, uid)
		end
	end
	return arr
end

local function toggleDirectControlMode()
	playSound("order")
	if state.directControlUnitId then
		state.directControlUnitId = nil
		reticleFrame.Visible = false
		return
	end
	local ids = getSelectedIdsArray()
	if #ids > 0 then
		state.directControlUnitId = ids[1]
	else
		-- Seleccionar automáticamente el tanque o soldado aliado más cercano
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				state.directControlUnitId = u.id
				state.selectedUnitIds = { [u.id] = true }
				break
			end
		end
	end
	if state.directControlUnitId then
		reticleFrame.Visible = true
		updateInspectorAndHud()
	end
end

directBtn.MouseButton1Click:Connect(toggleDirectControlMode)

for pId, btn in pairs(postureButtons) do
	btn.MouseButton1Click:Connect(function()
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			playSound("order")
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = pId })
		end
	end)
end

fireFreeBtn.MouseButton1Click:Connect(function()
	local ids = getSelectedIdsArray()
	if #ids > 0 then
		playSound("order")
		NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "free" })
	end
end)

fireHoldBtn.MouseButton1Click:Connect(function()
	local ids = getSelectedIdsArray()
	if #ids > 0 then
		playSound("order")
		NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "hold" })
	end
end)

selectAllBtn.MouseButton1Click:Connect(function()
	playSound("order")
	state.selectedUnitIds = {}
	for _, u in ipairs(state.units) do
		if u.team == 0 and u.hp > 0 then
			state.selectedUnitIds[u.id] = true
		end
	end
	updateInspectorAndHud()
end)

mmClickBtn.MouseButton1Click:Connect(function()
	local mousePos = UserInputService:GetMouseLocation()
	local absPos = minimapFrame.AbsolutePosition
	local absSize = minimapFrame.AbsoluteSize
	local rx = math.clamp((mousePos.X - absPos.X) / math.max(1, absSize.X), 0, 1)
	local rz = math.clamp((mousePos.Y - absPos.Y - 18) / math.max(1, absSize.Y), 0, 1)
	state.camFocus = Vector3.new((rx - 0.5) * 320, 0, (rz - 0.5) * 220)
	updateInspectorAndHud()
end)

-- ============================================================================
-- 6. RAYCAST Y SELECCIÓN TÁCTICA 3D + CAJA DE ARRASTRE (MARQUEE)
-- ============================================================================
local function getMouseGroundPosition(): Vector3
	local cam = Workspace.CurrentCamera
	if not cam then
		return state.camFocus
	end
	local mPos = UserInputService:GetMouseLocation()
	local ray = cam:ViewportPointToRay(mPos.X, mPos.Y)
	if math.abs(ray.Direction.Y) > 0.001 then
		local t = -ray.Origin.Y / ray.Direction.Y
		if t > 0 and t < 900 then
			local hit = ray.Origin + ray.Direction * t
			return Vector3.new(math.clamp(hit.X, -155, 155), 0, math.clamp(hit.Z, -108, 108))
		end
	end
	return state.camFocus
end

local function spawnOrderMarker(pos: Vector3, color: Color3)
	local ring = Instance.new("Part")
	ring.Shape = Enum.PartType.Cylinder
	ring.Size = Vector3.new(0.25, 6.5, 6.5)
	ring.CFrame = CFrame.new(pos + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.rad(90))
	ring.Color = color
	ring.Material = Enum.Material.Neon
	ring.Transparency = 0.25
	ring.Anchored = true
	ring.CanCollide = false
	ring.Parent = fxFolder
	TweenService:Create(ring, TweenInfo.new(0.65), { Size = Vector3.new(0.25, 1.2, 1.2), Transparency = 1 }):Play()
	Debris:AddItem(ring, 0.7)
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if input.KeyCode == Enum.KeyCode.Tab then
		toggleDirectControlMode()
		return
	end
	if gameProcessed then
		return
	end

	if input.KeyCode == Enum.KeyCode.Z then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "stand" })
		end
	elseif input.KeyCode == Enum.KeyCode.X then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "crouch" })
		end
	elseif input.KeyCode == Enum.KeyCode.C then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "prone" })
		end
	elseif input.KeyCode == Enum.KeyCode.F then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "free" })
		end
	elseif input.KeyCode == Enum.KeyCode.H then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "hold" })
		end
	elseif input.KeyCode == Enum.KeyCode.G then
		state.selectedUnitIds = {}
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				state.selectedUnitIds[u.id] = true
			end
		end
		updateInspectorAndHud()
	elseif input.KeyCode == Enum.KeyCode.Space and state.directControlUnitId then
		local aimPt = getMouseGroundPosition()
		NetProtocol.fireServer(NetProtocol.EVENTS.DirectControlFireOrder, {
			unitId = state.directControlUnitId,
			aimPoint = aimPt,
		})
	end

	-- Clic Izquierdo: Disparar en Direct Control o Iniciar Caja de Selección RTS
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		if state.directControlUnitId then
			local aimPt = getMouseGroundPosition()
			NetProtocol.fireServer(NetProtocol.EVENTS.DirectControlFireOrder, {
				unitId = state.directControlUnitId,
				aimPoint = aimPt,
			})
		else
			state.isDraggingBox = true
			state.dragStartPos = UserInputService:GetMouseLocation()
			state.dragCurrPos = state.dragStartPos
			marqueeBox.Position = UDim2.new(0, state.dragStartPos.X, 0, state.dragStartPos.Y)
			marqueeBox.Size = UDim2.new(0, 0, 0, 0)
			marqueeBox.Visible = true
		end
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		-- Clic Derecho: Orden de Ataque o Movimiento en Formación
		local ids = getSelectedIdsArray()
		if #ids == 0 then
			return
		end
		local groundPt = getMouseGroundPosition()
		local clickedEnemy = nil
		local bestDist = 10.5
		for _, u in ipairs(state.units) do
			if u.team == 1 and u.hp > 0 then
				local d = (u.pos - groundPt).Magnitude
				if d < bestDist then
					bestDist = d
					clickedEnemy = u
				end
			end
		end

		playSound("order")
		if clickedEnemy then
			spawnOrderMarker(clickedEnemy.pos, Color3.fromRGB(248, 113, 113))
			NetProtocol.fireServer(NetProtocol.EVENTS.IssueAttackOrder, {
				unitIds = ids,
				targetUnitId = clickedEnemy.id,
			})
		else
			spawnOrderMarker(groundPt, Color3.fromRGB(74, 222, 128))
			NetProtocol.fireServer(NetProtocol.EVENTS.IssueMoveOrder, {
				unitIds = ids,
				targetPos = groundPt,
			})
		end
	end
end)

UserInputService.InputChanged:Connect(function(input, gameProcessed)
	if input.UserInputType == Enum.UserInputType.MouseMovement and state.isDraggingBox then
		state.dragCurrPos = UserInputService:GetMouseLocation()
		local minX = math.min(state.dragStartPos.X, state.dragCurrPos.X)
		local minY = math.min(state.dragStartPos.Y, state.dragCurrPos.Y)
		local w = math.abs(state.dragCurrPos.X - state.dragStartPos.X)
		local h = math.abs(state.dragCurrPos.Y - state.dragStartPos.Y)
		marqueeBox.Position = UDim2.new(0, minX, 0, minY)
		marqueeBox.Size = UDim2.new(0, w, 0, h)
	elseif input.UserInputType == Enum.UserInputType.MouseWheel and not gameProcessed then
		state.camDist = math.clamp(state.camDist - input.Position.Z * 12, 34, 185)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 and state.isDraggingBox then
		state.isDraggingBox = false
		marqueeBox.Visible = false

		local cam = Workspace.CurrentCamera
		if not cam then
			return
		end
		local dragDist = (state.dragCurrPos - state.dragStartPos).Magnitude
		local newSel = {}

		if dragDist < 10 then
			-- Selección individual cercana al clic
			local clickPt = getMouseGroundPosition()
			local bestUnit = nil
			local bestD = 11
			for _, u in ipairs(state.units) do
				if u.team == 0 and u.hp > 0 then
					local d = (u.pos - clickPt).Magnitude
					if d < bestD then
						bestD = d
						bestUnit = u
					end
				end
			end
			if bestUnit then
				newSel[bestUnit.id] = true
				playSound("order")
			end
		else
			-- Selección por Caja (Marquee 2D)
			local minX = math.min(state.dragStartPos.X, state.dragCurrPos.X)
			local maxX = math.max(state.dragStartPos.X, state.dragCurrPos.X)
			local minY = math.min(state.dragStartPos.Y, state.dragCurrPos.Y)
			local maxY = math.max(state.dragStartPos.Y, state.dragCurrPos.Y)

			local count = 0
			for _, u in ipairs(state.units) do
				if u.team == 0 and u.hp > 0 then
					local vp, onScreen = cam:WorldToViewportPoint(u.pos + Vector3.new(0, 2.5, 0))
					if onScreen and vp.X >= minX and vp.X <= maxX and vp.Y >= minY and vp.Y <= maxY then
						newSel[u.id] = true
						count += 1
					end
				end
			end
			if count > 0 then
				playSound("order")
			end
		end

		if next(newSel) ~= nil then
			state.selectedUnitIds = newSel
			updateInspectorAndHud()
		end
	end
end)

-- ============================================================================
-- 7. RECEPCIÓN DE TRAZADORES BALÍSTICOS Y ESTADO DEL SERVIDOR
-- ============================================================================
local function spawnFloatingCombatText(pos: Vector3, text: string, color: Color3)
	local anchor = Instance.new("Part")
	anchor.Size = Vector3.new(0.2, 0.2, 0.2)
	anchor.Position = pos + Vector3.new(0, 3.5, 0)
	anchor.Transparency = 1
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.Parent = fxFolder

	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.new(0, 160, 0, 32)
	bb.AlwaysOnTop = true
	bb.Parent = anchor

	local lbl = Instance.new("TextLabel")
	lbl.Size = UDim2.new(1, 0, 1, 0)
	lbl.BackgroundTransparency = 1
	lbl.Font = Enum.Font.GothamBlack
	lbl.TextSize = 13
	lbl.TextColor3 = color
	lbl.TextStrokeTransparency = 0.15
	lbl.Text = text
	lbl.Parent = bb

	TweenService:Create(anchor, TweenInfo.new(1.15), { Position = pos + Vector3.new(0, 9.5, 0) }):Play()
	Debris:AddItem(anchor, 1.2)
end

NetProtocol.onClientEvent(NetProtocol.EVENTS.CombatShotBroadcast, function(shot)
	if type(shot) ~= "table" or typeof(shot.fromPos) ~= "Vector3" or typeof(shot.toPos) ~= "Vector3" then
		return
	end
	local wep = WarOfMenCatalog.WEAPONS[shot.weaponId]
	local color = if wep then wep.tracerColor else Color3.fromRGB(255, 220, 110)
	local thickness = if wep then wep.tracerThickness else 0.2

	if wep then
		if wep.category == "cannon" or wep.category == "at_rocket" then
			playSound("cannon", 0.5)
		elseif wep.category == "mg" then
			playSound("mg", 0.25)
		else
			playSound("rifle", 0.22)
		end
	end

	-- Trazador Luminoso
	local delta = shot.toPos - shot.fromPos
	local dist = math.max(0.5, delta.Magnitude)
	local tracer = Instance.new("Part")
	tracer.Size = Vector3.new(thickness, thickness, math.min(dist, 16))
	tracer.CFrame = CFrame.lookAt(shot.fromPos, shot.toPos) * CFrame.new(0, 0, -math.min(dist * 0.35, 8))
	tracer.Color = color
	tracer.Material = Enum.Material.Neon
	tracer.Anchored = true
	tracer.CanCollide = false
	tracer.Parent = fxFolder

	TweenService:Create(tracer, TweenInfo.new(0.14), {
		CFrame = CFrame.lookAt(shot.fromPos, shot.toPos) * CFrame.new(0, 0, -dist * 0.85),
		Transparency = 0.85,
	}):Play()
	Debris:AddItem(tracer, 0.16)

	-- Efecto de Impacto / Penetración / Rebote
	if shot.outcome == "RICOCHET" then
		playSound("ricochet", 0.42)
		spawnFloatingCombatText(
			shot.toPos,
			string.format("RICOCHET! (%d° on %s)", shot.impactAngleDeg or 72, shot.armorFace or "FRONT"),
			Color3.fromRGB(250, 204, 21)
		)
	elseif shot.outcome == "BOUNCED" then
		playSound("ricochet", 0.35)
		spawnFloatingCombatText(
			shot.toPos,
			string.format("ARMOR BOUNCED (%dmm < %dmm)", shot.penetrationMm or 0, shot.effectiveArmorMm or 0),
			Color3.fromRGB(148, 163, 184)
		)
	elseif shot.outcome == "PENETRATED" then
		spawnFloatingCombatText(
			shot.toPos,
			string.format("💥 PENETRATED %s! -%d HP", shot.armorFace or "HULL", shot.damageDealt or 0),
			Color3.fromRGB(248, 113, 113)
		)
	elseif shot.outcome == "PARTIAL" then
		spawnFloatingCombatText(
			shot.toPos,
			string.format("SPALLING HIT -%d HP", shot.damageDealt or 0),
			Color3.fromRGB(251, 146, 60)
		)
	end

	if (shot.heRadius and shot.heRadius > 0) or shot.targetDestroyed then
		local blast = Instance.new("Part")
		blast.Shape = Enum.PartType.Ball
		blast.Size = Vector3.new(3, 3, 3)
		blast.Position = shot.toPos
		blast.Color = Color3.fromRGB(255, 145, 45)
		blast.Material = Enum.Material.Neon
		blast.Transparency = 0.2
		blast.Anchored = true
		blast.CanCollide = false
		blast.Parent = fxFolder
		local maxR = if shot.targetDestroyed then 16 else math.max(7, shot.heRadius or 8)
		TweenService:Create(blast, TweenInfo.new(0.32), { Size = Vector3.new(maxR, maxR, maxR), Transparency = 1 }):Play()
		Debris:AddItem(blast, 0.35)
	end
end)

NetProtocol.onClientEvent(NetProtocol.EVENTS.BattleBannerBroadcast, function(data)
	if type(data) ~= "table" then
		return
	end
	showBanner(tostring(data.title or "BATTLE UPDATE"), tostring(data.subtitle or ""), tonumber(data.team))
	if type(data.spawnedUnitIds) == "table" and data.team == 0 and next(state.selectedUnitIds) == nil then
		for _, id in ipairs(data.spawnedUnitIds) do
			state.selectedUnitIds[id] = true
		end
	end
end)

NetProtocol.onClientEvent(NetProtocol.EVENTS.SyncPlayerProfile, function(prof)
	if type(prof) ~= "table" then
		return
	end
	state.commanderProfile = prof
	commanderRankLabel.Text = string.format(
		"🎖 %s (Lv.%d) • Victories: %d • Kills: %d • Armor: %d",
		tostring(prof.rankTitle or "Commander"),
		tonumber(prof.rankLevel) or 1,
		tonumber(prof.victories) or 0,
		tonumber(prof.infantryEliminated) or 0,
		tonumber(prof.armorDestroyed) or 0
	)
end)

NetProtocol.onClientEvent(NetProtocol.EVENTS.SyncBattleState, function(snap)
	if type(snap) ~= "table" then
		return
	end
	state.missionId = snap.missionId or state.missionId
	state.missionTitle = snap.missionTitle or state.missionTitle
	state.playerFaction = snap.playerFaction or state.playerFaction
	state.enemyFaction = snap.enemyFaction or state.enemyFaction
	state.elapsedTime = snap.elapsedTime or 0
	state.teamMp = snap.teamMp or state.teamMp
	state.teamVp = snap.teamVp or state.teamVp
	state.reinfCooldowns = snap.reinfCooldowns or {}
	state.playerBotMode = snap.playerBotMode or "OFF"
	state.flags = snap.flags or {}
	state.units = snap.units or {}

	local byId = {}
	for _, u in ipairs(state.units) do
		byId[u.id] = u
	end
	state.unitsById = byId

	if state.directControlUnitId and not byId[state.directControlUnitId] then
		state.directControlUnitId = nil
		reticleFrame.Visible = false
	end

	-- Seleccionar unidades iniciales aliadas automáticamente al arranque
	if next(state.selectedUnitIds) == nil and #state.units > 0 then
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				state.selectedUnitIds[u.id] = true
			end
		end
	end

	updateInspectorAndHud()
end)

-- ============================================================================
-- 8. BUCLE DE CÁMARA HÍBRIDA (COMANDANTE RTS + 3RA PERSONA DIRECT CONTROL)
-- ============================================================================
local dcSyncAccum = 0

RunService.RenderStepped:Connect(function(dt)
	local cam = Workspace.CurrentCamera
	if not cam then
		return
	end

	-- Si estamos en Play Mode (no Edit Mode), fijar cámara como Scriptable
	if not isStudioEdit then
		cam.CameraType = Enum.CameraType.Scriptable
	end

	local moveForward = 0
	local moveRight = 0
	if not UserInputService:GetFocusedTextBox() then
		if UserInputService:IsKeyDown(Enum.KeyCode.W) or UserInputService:IsKeyDown(Enum.KeyCode.Up) then
			moveForward += 1
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.S) or UserInputService:IsKeyDown(Enum.KeyCode.Down) then
			moveForward -= 1
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.D) or UserInputService:IsKeyDown(Enum.KeyCode.Right) then
			moveRight += 1
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.A) or UserInputService:IsKeyDown(Enum.KeyCode.Left) then
			moveRight -= 1
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.Q) then
			state.camYaw += dt * 1.4
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.E) then
			state.camYaw -= dt * 1.4
		end
	end

	local dcUnit = if state.directControlUnitId then state.unitsById[state.directControlUnitId] else nil
	if dcUnit and dcUnit.hp > 0 then
		-- MODO DIRECT CONTROL (3RA PERSONA ESTILO MEN OF WAR)
		local uPos: Vector3 = dcUnit.pos
		local aimPt = getMouseGroundPosition()
		local lookDir = (aimPt - uPos)
		local yaw = if lookDir.Magnitude > 0.5 then math.atan2(lookDir.X, lookDir.Z) else (dcUnit.turretYaw or 0)

		local camOffset = Vector3.new(-math.sin(yaw) * 26, 15, -math.cos(yaw) * 26)
		local camTarget = uPos + Vector3.new(math.sin(yaw) * 18, 3.2, math.cos(yaw) * 18)
		cam.CFrame = CFrame.lookAt(uPos + camOffset, camTarget)
		state.camFocus = uPos

		dcSyncAccum += dt
		if dcSyncAccum >= 0.08 then
			dcSyncAccum = 0
			local fwdVec = Vector3.new(math.sin(yaw), 0, math.cos(yaw))
			local rightVec = Vector3.new(math.cos(yaw), 0, -math.sin(yaw))
			local worldMove = fwdVec * moveForward + rightVec * moveRight
			NetProtocol.fireServer(NetProtocol.EVENTS.DirectControlMoveOrder, {
				unitId = dcUnit.id,
				moveVec = worldMove,
				aimPoint = aimPt,
			})
		end
	else
		-- MODO COMANDANTE RTS ORBITAL
		local panSpeed = 68 * (state.camDist / 95)
		local fwd = Vector3.new(-math.sin(state.camYaw), 0, -math.cos(state.camYaw))
		local right = Vector3.new(math.cos(state.camYaw), 0, -math.sin(state.camYaw))
		if moveForward ~= 0 or moveRight ~= 0 then
			state.camFocus = state.camFocus + (fwd * moveForward + right * moveRight) * panSpeed * dt
			state.camFocus = Vector3.new(
				math.clamp(state.camFocus.X, -155, 155),
				0,
				math.clamp(state.camFocus.Z, -108, 108)
			)
		end

		if not isStudioEdit or moveForward ~= 0 or moveRight ~= 0 then
			local horiz = math.cos(state.camPitch) * state.camDist
			local vert = math.sin(state.camPitch) * state.camDist
			local camPos = state.camFocus + Vector3.new(math.sin(state.camYaw) * horiz, vert, math.cos(state.camYaw) * horiz)
			cam.CFrame = CFrame.lookAt(camPos, state.camFocus)
		end
	end
end)

updateInspectorAndHud()
print("[War of Men Client] Tactical RTS + Direct Control HUD ready.")
