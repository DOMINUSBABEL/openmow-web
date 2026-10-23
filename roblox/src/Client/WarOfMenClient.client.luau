--!nocheck
--[[
	WarOfMenClient.client.luau
	Cliente Táctico Jugable para "War of Men" (Roblox Port de OpenMoW-Web / Men of War: Assault Squad 2).
	Características:
	  - Superficie Táctica Interactiva (TacticalViewportCanvas) compatible 100% con Studio Edit Mode, Play Mode (F5) y Roblox Player.
	  - Cámara Híbrida con prioridad RenderStep:
	      1) Vista Comandante RTS (WASD, Zoom con Rueda, Rotación Q/E, bordes de pantalla).
	      2) Modo Direct Control 3ra Persona [TAB] SIN bucle de retroalimentación de cámara, con predicción local a 60 FPS,
	         láser/retícula 3D en tiempo real, disparo primario (Clic Izq / Espacio) y coaxial/secundario (Clic Der / F).
	  - Selección Múltiple y Táctica:
	      - Clic Izquierdo sobre modelo 3D o etiqueta, Caja de Arrastre (Marquee 2D -> 3D), y botones de escuadra ([1] Inf, [2] Armor, [G] All).
	      - Modos de Orden con Clic Derecho o Botones de Acción (Move [M], Attack-Move [A], Stop/Hold [K], Retreat [R]).
	      - Anillos luminosos 3D de selección y líneas de orden en el suelo.
]]

if _G.WarOfMenClientStarted then
	return
end
_G.WarOfMenClientStarted = true

local ContextActionService = game:GetService("ContextActionService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

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

-- Desactivar controles por defecto del PlayerModule si existen para que no bloqueen WASD / Clic Derecho
pcall(function()
	ContextActionService:UnbindAction("moveForwardAction")
	ContextActionService:UnbindAction("moveBackwardAction")
	ContextActionService:UnbindAction("moveLeftAction")
	ContextActionService:UnbindAction("moveRightAction")
	ContextActionService:UnbindAction("jumpAction")
end)

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
-- 2. ESTADO DEL CLIENTE (RTS + TÁCTICO + DIRECT CONTROL)
-- ============================================================================
local state = {
	missionId = "usa_normandy",
	missionTitle = "USA 1: Omaha Beachhead — Sector Charlie",
	playerFaction = "USA",
	enemyFaction = "GER",
	elapsedTime = 0,
	teamMp = { [0] = 420, [1] = 420 },
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

	-- Modo de orden táctica para clic izquierdo ("AUTO" = seleccionar con clic izq / ordenar con clic der;
	-- "MOVE" = clic izq o der mueve; "ATTACK" = clic izq o der ataca)
	commandMode = "AUTO", -- "AUTO" | "MOVE" | "ATTACK"

	-- Cámara RTS Orbital
	camFocus = Vector3.new(-48, 0, 0),
	camYaw = 0,
	camPitch = math.rad(50),
	camDist = 96,

	-- Cámara Direct Control (independiente del cursor para evitar bucle de giro)
	dcCamYaw = math.pi / 2, -- Apuntando al Este (+X, hacia el frente enemigo)
	dcCamPitch = math.rad(22),
	dcCamDist = 28,
	dcPredictedPos = nil :: Vector3?,
	dcPredictedHullYaw = math.pi / 2,
	dcAimPoint = Vector3.new(0, 0, 0),
	dcFirePrimaryHeld = false,
	dcFireSecondaryHeld = false,
	dcFireAccum = 0,

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
if fxFolder then
	fxFolder:ClearAllChildren()
else
	fxFolder = Instance.new("Folder")
	fxFolder.Name = "WarOfMenClientFX"
	fxFolder.Parent = Workspace
end

local selectionRingsFolder = Instance.new("Folder")
selectionRingsFolder.Name = "SelectionRings"
selectionRingsFolder.Parent = fxFolder

-- Retícula 3D en el suelo para Direct Control
local dcGroundReticle = Instance.new("Part")
dcGroundReticle.Name = "DirectControlAimRing"
dcGroundReticle.Shape = Enum.PartType.Cylinder
dcGroundReticle.Size = Vector3.new(0.25, 4.2, 4.2)
dcGroundReticle.Color = Color3.fromRGB(250, 204, 21)
dcGroundReticle.Material = Enum.Material.Neon
dcGroundReticle.Transparency = 1
dcGroundReticle.Anchored = true
dcGroundReticle.CanCollide = false
dcGroundReticle.CanQuery = false
dcGroundReticle.Parent = fxFolder

local dcLaserBeam = Instance.new("Part")
dcLaserBeam.Name = "DirectControlLaser"
dcLaserBeam.Size = Vector3.new(0.12, 0.12, 1)
dcLaserBeam.Color = Color3.fromRGB(250, 204, 21)
dcLaserBeam.Material = Enum.Material.Neon
dcLaserBeam.Transparency = 1
dcLaserBeam.Anchored = true
dcLaserBeam.CanCollide = false
dcLaserBeam.CanQuery = false
dcLaserBeam.Parent = fxFolder

-- ============================================================================
-- 3. CONSTRUCCIÓN DE INTERFAZ TÁCTICA (HUD GLASSMORPHISM + VIEWPORT CANVAS)
-- ============================================================================
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "WarOfMenTacticalGui"
screenGui.ResetOnSpawn = false
screenGui.IgnoreGuiInset = true
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Global
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

-- SUPERFICIE INTERACTIVA DE PANTALLA COMPLETA (Captura clics en Studio Edit Mode, F5 Play Mode y Player)
local viewportCanvas = Instance.new("TextButton")
viewportCanvas.Name = "TacticalViewportCanvas"
viewportCanvas.Size = UDim2.new(1, 0, 1, 0)
viewportCanvas.Position = UDim2.new(0, 0, 0, 0)
viewportCanvas.BackgroundTransparency = 1
viewportCanvas.Text = ""
viewportCanvas.AutoButtonColor = false
viewportCanvas.Active = true
viewportCanvas.ZIndex = 1
viewportCanvas.Parent = screenGui

-- Caja de Selección Múltiple (Marquee Box)
local marqueeBox = Instance.new("Frame")
marqueeBox.Name = "MarqueeSelectionBox"
marqueeBox.BackgroundColor3 = Color3.fromRGB(74, 222, 128)
marqueeBox.BackgroundTransparency = 0.80
marqueeBox.BorderSizePixel = 0
marqueeBox.Visible = false
marqueeBox.ZIndex = 3
marqueeBox.Parent = screenGui
addStroke(marqueeBox, Color3.fromRGB(74, 222, 128), 1.5, 0.1)

-- Retícula de Puntería 2D en Pantalla para Modo Direct Control
local reticleCursor = Instance.new("Frame")
reticleCursor.Name = "DirectControlCrosshair"
reticleCursor.Size = UDim2.new(0, 28, 0, 28)
reticleCursor.AnchorPoint = Vector2.new(0.5, 0.5)
reticleCursor.BackgroundTransparency = 1
reticleCursor.Visible = false
reticleCursor.ZIndex = 4
reticleCursor.Parent = screenGui
addCorner(reticleCursor, 14)
addStroke(reticleCursor, Color3.fromRGB(250, 204, 21), 2, 0.1)

local reticleDot = Instance.new("Frame")
reticleDot.Size = UDim2.new(0, 4, 0, 4)
reticleDot.AnchorPoint = Vector2.new(0.5, 0.5)
reticleDot.Position = UDim2.new(0.5, 0, 0.5, 0)
reticleDot.BackgroundColor3 = Color3.fromRGB(248, 113, 113)
reticleDot.BorderSizePixel = 0
reticleDot.ZIndex = 4
reticleDot.Parent = reticleCursor
addCorner(reticleDot, 2)

-- Banner de Estado de Direct Control
local reticleFrame = Instance.new("Frame")
reticleFrame.Name = "DirectControlBanner"
reticleFrame.Size = UDim2.new(0, 410, 0, 54)
reticleFrame.Position = UDim2.new(0.5, -205, 0, 68)
reticleFrame.BackgroundColor3 = Color3.fromRGB(15, 23, 34)
reticleFrame.BackgroundTransparency = 0.16
reticleFrame.Visible = false
reticleFrame.ZIndex = 12
reticleFrame.Parent = screenGui
addCorner(reticleFrame, 8)
addStroke(reticleFrame, Color3.fromRGB(250, 204, 21), 1.5, 0.15)

local reticleLabel = Instance.new("TextLabel")
reticleLabel.Size = UDim2.new(1, -16, 1, 0)
reticleLabel.Position = UDim2.new(0, 8, 0, 0)
reticleLabel.BackgroundTransparency = 1
reticleLabel.Font = Enum.Font.GothamBold
reticleLabel.TextSize = 12
reticleLabel.TextColor3 = Color3.fromRGB(250, 204, 21)
reticleLabel.RichText = true
reticleLabel.Text = "🎯 <b>DIRECT CONTROL ACTIVE</b> • <b>WASD</b> Move • <b>Q/E</b> Rotate Camera\n<b>Left-Click / Space</b> Fire Main Gun • <b>Right-Click / F</b> Coaxial MG • <b>[TAB]</b> Return RTS"
reticleLabel.ZIndex = 13
reticleLabel.Parent = reticleFrame

-- 3.1. BARRA SUPERIOR TÁCTICA (TOP BAR)
local topBar = Instance.new("Frame")
topBar.Name = "TopCommandBar"
topBar.Size = UDim2.new(1, -24, 0, 52)
topBar.Position = UDim2.new(0, 12, 0, 10)
topBar.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
topBar.BackgroundTransparency = 0.12
topBar.Active = true
topBar.ZIndex = 10
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
brandLabel.ZIndex = 11
brandLabel.Parent = topBar

-- Indicador de Puntos de Mando (MP)
local mpPill = Instance.new("Frame")
mpPill.Size = UDim2.new(0, 155, 0, 36)
mpPill.Position = UDim2.new(0, 222, 0.5, -18)
mpPill.BackgroundColor3 = Color3.fromRGB(20, 36, 28)
mpPill.ZIndex = 11
mpPill.Parent = topBar
addCorner(mpPill, 8)
addStroke(mpPill, Color3.fromRGB(74, 222, 128), 1, 0.35)

local mpText = Instance.new("TextLabel")
mpText.Size = UDim2.new(1, 0, 1, 0)
mpText.BackgroundTransparency = 1
mpText.Font = Enum.Font.GothamBold
mpText.TextSize = 14
mpText.TextColor3 = Color3.fromRGB(134, 239, 172)
mpText.Text = "⚡ MP: 420 (+16/s)"
mpText.ZIndex = 12
mpText.Parent = mpPill

-- Marcador Central de Banderas y Puntos de Victoria (VP)
local scorePill = Instance.new("Frame")
scorePill.Size = UDim2.new(0, 275, 0, 36)
scorePill.Position = UDim2.new(0, 386, 0.5, -18)
scorePill.BackgroundColor3 = Color3.fromRGB(22, 28, 38)
scorePill.ZIndex = 11
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
scoreText.ZIndex = 12
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
missionBtn.ZIndex = 12
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
botBtn.ZIndex = 12
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
directBtn.ZIndex = 12
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
resetBtn.ZIndex = 12
resetBtn.Parent = topBar
addCorner(resetBtn, 8)

-- 3.2. BANNER CENTRAL DE EVENTOS TÁCTICOS
local bannerFrame = Instance.new("Frame")
bannerFrame.Size = UDim2.new(0, 420, 0, 56)
bannerFrame.Position = UDim2.new(0.5, -210, 0, 128)
bannerFrame.BackgroundColor3 = Color3.fromRGB(15, 23, 34)
bannerFrame.BackgroundTransparency = 0.15
bannerFrame.Visible = false
bannerFrame.ZIndex = 14
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
bannerTitle.ZIndex = 15
bannerTitle.Parent = bannerFrame

local bannerSub = Instance.new("TextLabel")
bannerSub.Size = UDim2.new(1, -16, 0, 20)
bannerSub.Position = UDim2.new(0, 8, 0, 30)
bannerSub.BackgroundTransparency = 1
bannerSub.Font = Enum.Font.GothamMedium
bannerSub.TextSize = 12
bannerSub.TextColor3 = Color3.fromRGB(226, 232, 240)
bannerSub.Text = "Allied forces hold the sector!"
bannerSub.ZIndex = 15
bannerSub.Parent = bannerFrame

local bannerHideToken = 0
local function showBanner(title: string, subtitle: string, team: number?)
	bannerHideToken += 1
	local myToken = bannerHideToken
	bannerTitle.Text = title
	bannerSub.Text = subtitle
	bannerTitle.TextColor3 = if team == 1 then Color3.fromRGB(248, 113, 113) else Color3.fromRGB(134, 239, 172)
	bannerFrame.Visible = true
	task.delay(3.5, function()
		if bannerHideToken == myToken then
			bannerFrame.Visible = false
		end
	end)
end

-- 3.3. PANEL IZQUIERDO: INSPECTOR DE UNIDAD, ÓRDENES TÁCTICAS Y SELECCIÓN RÁPIDA
local inspectorFrame = Instance.new("Frame")
inspectorFrame.Name = "UnitInspectorPanel"
inspectorFrame.Size = UDim2.new(0, 304, 0, 294)
inspectorFrame.Position = UDim2.new(0, 12, 1, -436)
inspectorFrame.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
inspectorFrame.BackgroundTransparency = 0.12
inspectorFrame.Active = true
inspectorFrame.ZIndex = 10
inspectorFrame.Parent = screenGui
addCorner(inspectorFrame, 10)
addStroke(inspectorFrame, Color3.fromRGB(71, 85, 105), 1, 0.3)

local inspHeader = Instance.new("TextLabel")
inspHeader.Size = UDim2.new(1, -20, 0, 22)
inspHeader.Position = UDim2.new(0, 10, 0, 6)
inspHeader.BackgroundTransparency = 1
inspHeader.Font = Enum.Font.GothamBlack
inspHeader.TextSize = 13
inspHeader.TextXAlignment = Enum.TextXAlignment.Left
inspHeader.TextColor3 = Color3.fromRGB(134, 239, 172)
inspHeader.Text = "UNIT INSPECTOR & ORDERS"
inspHeader.ZIndex = 11
inspHeader.Parent = inspectorFrame

local inspDetails = Instance.new("TextLabel")
inspDetails.Size = UDim2.new(1, -20, 0, 56)
inspDetails.Position = UDim2.new(0, 10, 0, 28)
inspDetails.BackgroundTransparency = 1
inspDetails.Font = Enum.Font.GothamMedium
inspDetails.TextSize = 11
inspDetails.TextXAlignment = Enum.TextXAlignment.Left
inspDetails.TextYAlignment = Enum.TextYAlignment.Top
inspDetails.TextColor3 = Color3.fromRGB(226, 232, 240)
inspDetails.RichText = true
inspDetails.Text = "Select troops with Left-Click or drag box.\nRight-Click ground to Move, or use Order buttons below."
inspDetails.ZIndex = 11
inspDetails.Parent = inspectorFrame

-- Fila 1: Selección Rápida de Escuadras ([1] INFANTRY, [2] ARMOR, [3] NEXT UNIT, [G] ALL)
local quickSelectDefs = {
	{ id = "INF", label = "🪖 INF [1]", x = 10, w = 68 },
	{ id = "ARMOR", label = "🛡️ TANK [2]", x = 82, w = 68 },
	{ id = "NEXT", label = "🔄 NEXT [3]", x = 154, w = 68 },
	{ id = "ALL", label = "✪ ALL [G]", x = 226, w = 68 },
}
local quickSelectButtons: { [string]: TextButton } = {}
for _, qDef in ipairs(quickSelectDefs) do
	local btn = Instance.new("TextButton")
	btn.Size = UDim2.new(0, qDef.w, 0, 28)
	btn.Position = UDim2.new(0, qDef.x, 0, 88)
	btn.BackgroundColor3 = Color3.fromRGB(28, 48, 78)
	btn.Font = Enum.Font.GothamBold
	btn.TextSize = 10
	btn.TextColor3 = Color3.fromRGB(191, 219, 254)
	btn.Text = qDef.label
	btn.ZIndex = 12
	btn.Parent = inspectorFrame
	addCorner(btn, 6)
	addStroke(btn, Color3.fromRGB(96, 165, 250), 1, 0.45)
	quickSelectButtons[qDef.id] = btn
end

-- Fila 2: Órdenes Tácticas Directas (MOVE [M], ATTACK [A], STOP [K], RETREAT [R])
local orderButtonsDefs = {
	{ id = "MOVE", label = "🥾 MOVE [M]", x = 10, w = 68, bg = Color3.fromRGB(22, 62, 42) },
	{ id = "ATTACK", label = "⚔ ATK [A]", x = 82, w = 68, bg = Color3.fromRGB(76, 30, 30) },
	{ id = "STOP", label = "🛑 HOLD [K]", x = 154, w = 68, bg = Color3.fromRGB(58, 48, 22) },
	{ id = "RETREAT", label = "↩ BACK [R]", x = 226, w = 68, bg = Color3.fromRGB(48, 38, 68) },
}
local orderModeButtons: { [string]: TextButton } = {}
for _, oDef in ipairs(orderButtonsDefs) do
	local btn = Instance.new("TextButton")
	btn.Size = UDim2.new(0, oDef.w, 0, 30)
	btn.Position = UDim2.new(0, oDef.x, 0, 122)
	btn.BackgroundColor3 = oDef.bg
	btn.Font = Enum.Font.GothamBold
	btn.TextSize = 10
	btn.TextColor3 = Color3.fromRGB(248, 250, 252)
	btn.Text = oDef.label
	btn.ZIndex = 12
	btn.Parent = inspectorFrame
	addCorner(btn, 6)
	addStroke(btn, Color3.fromRGB(148, 163, 184), 1, 0.4)
	orderModeButtons[oDef.id] = btn
end

-- Fila 3: Posturas Tácticas (STAND [Z], CROUCH [X], PRONE [C])
local postureDefs = {
	{ id = "stand", label = "🧍 STAND [Z]", x = 10 },
	{ id = "crouch", label = "🧎 CROUCH [X]", x = 104 },
	{ id = "prone", label = "🛌 PRONE [C]", x = 198 },
}
local postureButtons: { [string]: TextButton } = {}
for _, pDef in ipairs(postureDefs) do
	local btn = Instance.new("TextButton")
	btn.Size = UDim2.new(0, 90, 0, 30)
	btn.Position = UDim2.new(0, pDef.x, 0, 158)
	btn.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
	btn.Font = Enum.Font.GothamBold
	btn.TextSize = 10
	btn.TextColor3 = Color3.fromRGB(241, 245, 249)
	btn.Text = pDef.label
	btn.ZIndex = 12
	btn.Parent = inspectorFrame
	addCorner(btn, 6)
	addStroke(btn, Color3.fromRGB(100, 116, 139), 1, 0.4)
	postureButtons[pDef.id] = btn
end

-- Fila 4: Modo de Fuego (FREE FIRE [F], HOLD FIRE [H], FOCUS CAMERA [V])
local fireFreeBtn = Instance.new("TextButton")
fireFreeBtn.Size = UDim2.new(0, 90, 0, 30)
fireFreeBtn.Position = UDim2.new(0, 10, 0, 194)
fireFreeBtn.BackgroundColor3 = Color3.fromRGB(22, 68, 42)
fireFreeBtn.Font = Enum.Font.GothamBold
fireFreeBtn.TextSize = 10
fireFreeBtn.TextColor3 = Color3.fromRGB(134, 239, 172)
fireFreeBtn.Text = "🔥 FREE [F]"
fireFreeBtn.ZIndex = 12
fireFreeBtn.Parent = inspectorFrame
addCorner(fireFreeBtn, 6)

local fireHoldBtn = Instance.new("TextButton")
fireHoldBtn.Size = UDim2.new(0, 90, 0, 30)
fireHoldBtn.Position = UDim2.new(0, 104, 0, 194)
fireHoldBtn.BackgroundColor3 = Color3.fromRGB(68, 32, 32)
fireHoldBtn.Font = Enum.Font.GothamBold
fireHoldBtn.TextSize = 10
fireHoldBtn.TextColor3 = Color3.fromRGB(252, 165, 165)
fireHoldBtn.Text = "✋ HOLD [H]"
fireHoldBtn.ZIndex = 12
fireHoldBtn.Parent = inspectorFrame
addCorner(fireHoldBtn, 6)

local focusUnitBtn = Instance.new("TextButton")
focusUnitBtn.Size = UDim2.new(0, 90, 0, 30)
focusUnitBtn.Position = UDim2.new(0, 198, 0, 194)
focusUnitBtn.BackgroundColor3 = Color3.fromRGB(58, 48, 20)
focusUnitBtn.Font = Enum.Font.GothamBold
focusUnitBtn.TextSize = 10
focusUnitBtn.TextColor3 = Color3.fromRGB(253, 224, 71)
focusUnitBtn.Text = "🎥 FOCUS [V]"
focusUnitBtn.ZIndex = 12
focusUnitBtn.Parent = inspectorFrame
addCorner(focusUnitBtn, 6)

local commandStatusLabel = Instance.new("TextLabel")
commandStatusLabel.Size = UDim2.new(1, -20, 0, 20)
commandStatusLabel.Position = UDim2.new(0, 10, 0, 230)
commandStatusLabel.BackgroundTransparency = 1
commandStatusLabel.Font = Enum.Font.GothamBold
commandStatusLabel.TextSize = 11
commandStatusLabel.TextXAlignment = Enum.TextXAlignment.Left
commandStatusLabel.TextColor3 = Color3.fromRGB(134, 239, 172)
commandStatusLabel.Text = "🎯 MODE: STANDARD RTS (L-Click Select • R-Click Order)"
commandStatusLabel.ZIndex = 11
commandStatusLabel.Parent = inspectorFrame

local commanderRankLabel = Instance.new("TextLabel")
commanderRankLabel.Size = UDim2.new(1, -20, 0, 20)
commanderRankLabel.Position = UDim2.new(0, 10, 0, 252)
commanderRankLabel.BackgroundTransparency = 1
commanderRankLabel.Font = Enum.Font.GothamBold
commanderRankLabel.TextSize = 11
commanderRankLabel.TextXAlignment = Enum.TextXAlignment.Left
commanderRankLabel.TextColor3 = Color3.fromRGB(250, 204, 21)
commanderRankLabel.Text = "🎖 2nd Lieutenant • Kills: 0 • Armor Destroyed: 0"
commanderRankLabel.ZIndex = 11
commanderRankLabel.Parent = inspectorFrame

-- 3.4. PANEL INFERIOR DE DESPLIEGUE DE REFUERZOS (20 ESCUADRAS / BLINDADOS)
local reinfDock = Instance.new("Frame")
reinfDock.Name = "ReinforcementDock"
reinfDock.Size = UDim2.new(1, -556, 0, 126)
reinfDock.Position = UDim2.new(0, 12, 1, -134)
reinfDock.BackgroundColor3 = Color3.fromRGB(14, 20, 28)
reinfDock.BackgroundTransparency = 0.12
reinfDock.Active = true
reinfDock.ZIndex = 10
reinfDock.Parent = screenGui
addCorner(reinfDock, 10)
addStroke(reinfDock, Color3.fromRGB(71, 85, 105), 1, 0.3)

local factionTabsFrame = Instance.new("Frame")
factionTabsFrame.Size = UDim2.new(1, -16, 0, 26)
factionTabsFrame.Position = UDim2.new(0, 8, 0, 6)
factionTabsFrame.BackgroundTransparency = 1
factionTabsFrame.ZIndex = 11
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
	tb.ZIndex = 12
	tb.Parent = factionTabsFrame
	addCorner(tb, 6)
	tabButtons[tDef.id] = tb
end

local cardsContainer = Instance.new("Frame")
cardsContainer.Size = UDim2.new(1, -16, 0, 84)
cardsContainer.Position = UDim2.new(0, 8, 0, 36)
cardsContainer.BackgroundTransparency = 1
cardsContainer.ZIndex = 11
cardsContainer.Parent = reinfDock

-- 3.5. MINIMAPA RADAR TÁCTICO INTERACTIVO (ESQUINA INFERIOR DERECHA)
local minimapFrame = Instance.new("Frame")
minimapFrame.Name = "TacticalMinimap"
minimapFrame.Size = UDim2.new(0, 248, 0, 174)
minimapFrame.Position = UDim2.new(1, -260, 1, -182)
minimapFrame.BackgroundColor3 = Color3.fromRGB(16, 26, 22)
minimapFrame.BackgroundTransparency = 0.08
minimapFrame.ClipsDescendants = true
minimapFrame.Active = true
minimapFrame.ZIndex = 10
minimapFrame.Parent = screenGui
addCorner(minimapFrame, 10)
addStroke(minimapFrame, Color3.fromRGB(74, 222, 128), 1.5, 0.35)

local mmRiver = Instance.new("Frame")
mmRiver.Size = UDim2.new(0.08, 0, 1, 0)
mmRiver.Position = UDim2.new(0.46, 0, 0, 0)
mmRiver.BackgroundColor3 = Color3.fromRGB(38, 88, 124)
mmRiver.BorderSizePixel = 0
mmRiver.ZIndex = 11
mmRiver.Parent = minimapFrame

local mmRoad = Instance.new("Frame")
mmRoad.Size = UDim2.new(1, 0, 0.09, 0)
mmRoad.Position = UDim2.new(0, 0, 0.455, 0)
mmRoad.BackgroundColor3 = Color3.fromRGB(110, 104, 88)
mmRoad.BorderSizePixel = 0
mmRoad.ZIndex = 11
mmRoad.Parent = minimapFrame

local mmHeader = Instance.new("TextLabel")
mmHeader.Size = UDim2.new(1, -10, 0, 16)
mmHeader.Position = UDim2.new(0, 6, 0, 2)
mmHeader.BackgroundTransparency = 1
mmHeader.Font = Enum.Font.GothamBold
mmHeader.TextSize = 10
mmHeader.TextXAlignment = Enum.TextXAlignment.Left
mmHeader.TextColor3 = Color3.fromRGB(134, 239, 172)
mmHeader.Text = "RADAR • L-CLICK CAM • R-CLICK MOVE"
mmHeader.ZIndex = 14
mmHeader.Parent = minimapFrame

local mmDotsFolder = Instance.new("Folder")
mmDotsFolder.Name = "RadarDots"
mmDotsFolder.Parent = minimapFrame

local mmCamBox = Instance.new("Frame")
mmCamBox.Size = UDim2.new(0, 44, 0, 32)
mmCamBox.BackgroundTransparency = 1
mmCamBox.ZIndex = 15
mmCamBox.Parent = minimapFrame
addStroke(mmCamBox, Color3.fromRGB(250, 204, 21), 1.2, 0.15)

local mmClickBtn = Instance.new("TextButton")
mmClickBtn.Size = UDim2.new(1, 0, 1, 0)
mmClickBtn.BackgroundTransparency = 1
mmClickBtn.Text = ""
mmClickBtn.ZIndex = 16
mmClickBtn.Parent = minimapFrame

-- 3.6. MODAL SELECTOR DE LAS 15 ESCARAMUZAS TÁCTICAS
local missionModal = Instance.new("Frame")
missionModal.Name = "MissionSelectorModal"
missionModal.Size = UDim2.new(0, 740, 0, 430)
missionModal.Position = UDim2.new(0.5, -370, 0.5, -215)
missionModal.BackgroundColor3 = Color3.fromRGB(12, 18, 26)
missionModal.BackgroundTransparency = 0.04
missionModal.Visible = false
missionModal.Active = true
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
-- 4. FUNCIONES AUXILIARES DE POSICIÓN 3D Y ACTUALIZACIÓN DEL HUD
-- ============================================================================
local function getLiveUnitWorldPosition(u: any): Vector3
	local bf = Workspace:FindFirstChild("WarOfMenBattlefield")
	if bf then
		local unitsFolder = bf:FindFirstChild("Units")
		if unitsFolder then
			local mdl = unitsFolder:FindFirstChild("Unit_" .. tostring(u.id))
			if mdl and mdl:IsA("Model") and mdl.PrimaryPart then
				return Vector3.new(mdl.PrimaryPart.Position.X, 0, mdl.PrimaryPart.Position.Z)
			end
		end
	end
	return u.pos
end

local function getSelectedIdsArray(): { number }
	local arr = {}
	for uid, isSel in pairs(state.selectedUnitIds) do
		if isSel and state.unitsById[uid] and state.unitsById[uid].hp > 0 then
			table.insert(arr, uid)
		end
	end
	table.sort(arr)
	return arr
end

local function updateCommandModeVisuals()
	if state.commandMode == "MOVE" then
		commandStatusLabel.Text = "🥾 MOVE ORDER ACTIVE: Click ground (Left or Right) to move squad!"
		commandStatusLabel.TextColor3 = Color3.fromRGB(74, 222, 128)
		orderModeButtons.MOVE.BackgroundColor3 = Color3.fromRGB(34, 124, 72)
		orderModeButtons.ATTACK.BackgroundColor3 = Color3.fromRGB(76, 30, 30)
	elseif state.commandMode == "ATTACK" then
		commandStatusLabel.Text = "⚔ ATTACK ORDER ACTIVE: Click enemy or ground to engage!"
		commandStatusLabel.TextColor3 = Color3.fromRGB(248, 113, 113)
		orderModeButtons.MOVE.BackgroundColor3 = Color3.fromRGB(22, 62, 42)
		orderModeButtons.ATTACK.BackgroundColor3 = Color3.fromRGB(145, 42, 42)
	else
		commandStatusLabel.Text = "🎯 RTS MODE: Left-Click Select • Right-Click Move/Attack"
		commandStatusLabel.TextColor3 = Color3.fromRGB(148, 163, 184)
		orderModeButtons.MOVE.BackgroundColor3 = Color3.fromRGB(22, 62, 42)
		orderModeButtons.ATTACK.BackgroundColor3 = Color3.fromRGB(76, 30, 30)
	end
end

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
			if cdRem > 0 then string.format("(⏳ %ds)", cdRem) else "• DEPLOY"
		)
		card.ZIndex = 12
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

	local income = math.floor(11 + alliedFlags * 5.0)
	mpText.Text = string.format("⚡ MP: %d (+%d/s)", mp0, income)
	scoreText.Text = string.format("ALLIES %d VP  |  ⚑ %d - %d  |  AXIS %d VP", vp0, alliedFlags, axisFlags, vp1)
	missionBtn.Text = "🗺 " .. state.missionTitle .. " ▾"
	botBtn.Text = "🤖 BOT: " .. state.playerBotMode
	directBtn.Text = if state.directControlUnitId then "🎯 EXIT [TAB]" else "🎯 3RD [TAB]"
	directBtn.BackgroundColor3 = if state.directControlUnitId
		then Color3.fromRGB(145, 42, 42)
		else Color3.fromRGB(68, 52, 18)

	rebuildReinforcementCards()
	updateCommandModeVisuals()

	-- Actualizar Inspector de Unidad
	local selList = {}
	for uid, isSel in pairs(state.selectedUnitIds) do
		if isSel and state.unitsById[uid] and state.unitsById[uid].hp > 0 then
			table.insert(selList, state.unitsById[uid])
		else
			state.selectedUnitIds[uid] = nil
		end
	end

	if #selList == 0 then
		inspHeader.Text = "NO UNIT SELECTED (CLICK OR [1]/[2]/[G])"
		inspDetails.Text = "<b>Select:</b> Left-Click unit, drag box, or press <b>[1] Inf</b> / <b>[2] Tank</b> / <b>[G] All</b>.\n<b>Order:</b> Right-Click ground/enemy, or click <b>MOVE [M]</b> / <b>ATK [A]</b>.\n<b>Direct Control:</b> Press <b>[TAB]</b> to drive/shoot in 3rd Person!"
	else
		local lead = selList[1]
		local wep = WarOfMenCatalog.WEAPONS[lead.weaponId]
		local tpl = WarOfMenCatalog.UNIT_TEMPLATES[lead.templateId]
		local wepInfo = if wep then string.format("%s (Pen %dmm, Rng %dm)", wep.name, wep.penetration.d50, wep.range) else lead.weaponId
		local armorInfo = if tpl and tpl.armor
			then string.format("Armor F/S/R: %d/%d/%dmm", tpl.armor.front, tpl.armor.side, tpl.armor.rear)
			else string.format("Posture: %s %s", string.upper(lead.posture), if lead.inCover then "🛡️ [COVER]" else "")

		inspHeader.Text = if #selList == 1
			then string.format("★ %s (HP %d/%d)", lead.name, lead.hp, lead.maxHp)
			else string.format("SQUAD SELECTED (%d UNITS) • Lead: %s", #selList, lead.name)

		inspDetails.Text = string.format(
			"<b>Weapon:</b> %s\n<b>Status:</b> %s • Fire: <b>%s</b> • Kills: <b>%d</b> (Vet ★%d)",
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
		fDot.ZIndex = 13
		fDot.Parent = mmDotsFolder
		addCorner(fDot, 5)
	end

	for _, u in ipairs(state.units) do
		if u.hp > 0 then
			local livePos = getLiveUnitWorldPosition(u)
			local ux = math.clamp((livePos.X + 160) / 320, 0.03, 0.97)
			local uz = math.clamp((livePos.Z + 110) / 220, 0.05, 0.95)
			local dot = Instance.new("Frame")
			local sz = if u.kind == "vehicle" then 7 else 5
			dot.Size = UDim2.new(0, sz, 0, sz)
			dot.Position = UDim2.new(ux, -sz / 2, uz, -sz / 2)
			dot.BackgroundColor3 = if state.directControlUnitId == u.id
				then Color3.fromRGB(255, 255, 255)
				elseif state.selectedUnitIds[u.id] then Color3.fromRGB(250, 204, 21)
				elseif u.team == 0 then Color3.fromRGB(74, 222, 128)
				else Color3.fromRGB(248, 113, 113)
			dot.BorderSizePixel = 0
			dot.ZIndex = 14
			dot.Parent = mmDotsFolder
		end
	end

	local cx = math.clamp((state.camFocus.X + 160) / 320, 0.08, 0.92)
	local cz = math.clamp((state.camFocus.Z + 110) / 220, 0.1, 0.9)
	mmCamBox.Position = UDim2.new(cx, -22, cz, -16)
end

-- ============================================================================
-- 5. ACCIONES TÁCTICAS Y CONEXIONES DE BOTONES DEL HUD
-- ============================================================================
local function spawnOrderMarker(pos: Vector3, color: Color3)
	local ring = Instance.new("Part")
	ring.Shape = Enum.PartType.Cylinder
	ring.Size = Vector3.new(0.25, 7.0, 7.0)
	ring.CFrame = CFrame.new(pos + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.rad(90))
	ring.Color = color
	ring.Material = Enum.Material.Neon
	ring.Transparency = 0.2
	ring.Anchored = true
	ring.CanCollide = false
	ring.CanQuery = false
	ring.Parent = fxFolder
	TweenService:Create(ring, TweenInfo.new(0.65), { Size = Vector3.new(0.25, 1.2, 1.2), Transparency = 1 }):Play()
	Debris:AddItem(ring, 0.7)
end

local function selectGroupByFilter(filterKind: string)
	playSound("order")
	if filterKind == "NEXT" then
		local allied = {}
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				table.insert(allied, u)
			end
		end
		if #allied == 0 then
			return
		end
		local currIds = getSelectedIdsArray()
		local nextUnit = allied[1]
		if #currIds > 0 then
			for idx, u in ipairs(allied) do
				if u.id == currIds[1] then
					nextUnit = allied[(idx % #allied) + 1]
					break
				end
			end
		end
		state.selectedUnitIds = { [nextUnit.id] = true }
		state.camFocus = getLiveUnitWorldPosition(nextUnit)
		updateInspectorAndHud()
		return
	end

	local newSel = {}
	local sumPos = Vector3.zero
	local count = 0
	for _, u in ipairs(state.units) do
		if u.team == 0 and u.hp > 0 then
			if
				filterKind == "ALL"
				or (filterKind == "INF" and u.kind == "infantry")
				or (filterKind == "ARMOR" and u.kind == "vehicle")
			then
				newSel[u.id] = true
				sumPos += getLiveUnitWorldPosition(u)
				count += 1
			end
		end
	end
	if count > 0 then
		state.selectedUnitIds = newSel
		if filterKind ~= "ALL" then
			state.camFocus = sumPos / count
		end
		updateInspectorAndHud()
	end
end

for qId, btn in pairs(quickSelectButtons) do
	btn.MouseButton1Click:Connect(function()
		selectGroupByFilter(qId)
	end)
end

local function issueHoldPositionOrder()
	local ids = getSelectedIdsArray()
	if #ids == 0 then
		return
	end
	playSound("order")
	state.commandMode = "AUTO"
	NetProtocol.fireServer(NetProtocol.EVENTS.IssueMoveOrder, {
		unitIds = ids,
		holdPosition = true,
	})
	for _, uid in ipairs(ids) do
		local u = state.unitsById[uid]
		if u then
			spawnOrderMarker(getLiveUnitWorldPosition(u), Color3.fromRGB(250, 204, 21))
		end
	end
	updateInspectorAndHud()
end

local function issueRetreatOrder()
	local ids = getSelectedIdsArray()
	if #ids == 0 then
		return
	end
	playSound("radio")
	state.commandMode = "AUTO"
	local retreatTarget = Vector3.new(-52, 0, 0)
	spawnOrderMarker(retreatTarget, Color3.fromRGB(167, 139, 250))
	NetProtocol.fireServer(NetProtocol.EVENTS.IssueMoveOrder, {
		unitIds = ids,
		targetPos = retreatTarget,
	})
	updateInspectorAndHud()
end

orderModeButtons.MOVE.MouseButton1Click:Connect(function()
	playSound("order")
	state.commandMode = if state.commandMode == "MOVE" then "AUTO" else "MOVE"
	updateCommandModeVisuals()
end)

orderModeButtons.ATTACK.MouseButton1Click:Connect(function()
	playSound("order")
	state.commandMode = if state.commandMode == "ATTACK" then "AUTO" else "ATTACK"
	updateCommandModeVisuals()
end)

orderModeButtons.STOP.MouseButton1Click:Connect(issueHoldPositionOrder)
orderModeButtons.RETREAT.MouseButton1Click:Connect(issueRetreatOrder)

focusUnitBtn.MouseButton1Click:Connect(function()
	local ids = getSelectedIdsArray()
	if #ids > 0 then
		local u = state.unitsById[ids[1]]
		if u then
			playSound("order")
			state.camFocus = getLiveUnitWorldPosition(u)
			updateInspectorAndHud()
		end
	end
end)

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
	state.directControlUnitId = nil
	state.dcPredictedPos = nil
	reticleFrame.Visible = false
	reticleCursor.Visible = false
	NetProtocol.fireServer(NetProtocol.EVENTS.ResetSkirmishOrder, {})
end)

local function toggleDirectControlMode()
	playSound("order")
	if state.directControlUnitId then
		state.directControlUnitId = nil
		state.dcPredictedPos = nil
		state.dcFirePrimaryHeld = false
		state.dcFireSecondaryHeld = false
		reticleFrame.Visible = false
		reticleCursor.Visible = false
		dcGroundReticle.Transparency = 1
		dcLaserBeam.Transparency = 1
		updateInspectorAndHud()
		return
	end

	local ids = getSelectedIdsArray()
	local targetUnit = nil
	if #ids > 0 then
		-- Priorizar tanque si hay uno en la selección
		for _, uid in ipairs(ids) do
			local u = state.unitsById[uid]
			if u and u.kind == "vehicle" and u.hp > 0 then
				targetUnit = u
				break
			end
		end
		if not targetUnit then
			targetUnit = state.unitsById[ids[1]]
		end
	else
		-- Seleccionar automáticamente el tanque o soldado aliado vivo más cercano al centro
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				if not targetUnit or (u.kind == "vehicle" and targetUnit.kind ~= "vehicle") then
					targetUnit = u
				end
			end
		end
	end

	if targetUnit then
		state.directControlUnitId = targetUnit.id
		state.selectedUnitIds = { [targetUnit.id] = true }
		local livePos = getLiveUnitWorldPosition(targetUnit)
		state.dcPredictedPos = livePos
		state.dcCamYaw = math.pi / 2 -- Mirar hacia el Este (+X, frente enemigo)
		state.dcPredictedHullYaw = targetUnit.hullYaw or (math.pi / 2)
		state.dcAimPoint = livePos + Vector3.new(35, 0, 0)
		reticleFrame.Visible = true
		reticleCursor.Visible = true
		showBanner(
			"🎯 DIRECT CONTROL: " .. string.upper(targetUnit.name),
			"WASD Move • Q/E Orbit Cam • L-Click/Space Fire Main • R-Click/F Fire MG • [TAB] Exit",
			0
		)
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

-- Minimapa: Clic Izquierdo mueve cámara, Clic Derecho ordena mover tropas seleccionadas al punto del radar
local function getMinimapWorldPos(): Vector3
	local mousePos = UserInputService:GetMouseLocation()
	local absPos = minimapFrame.AbsolutePosition
	local absSize = minimapFrame.AbsoluteSize
	local rx = math.clamp((mousePos.X - absPos.X) / math.max(1, absSize.X), 0, 1)
	local rz = math.clamp((mousePos.Y - absPos.Y - 12) / math.max(1, absSize.Y), 0, 1)
	return Vector3.new((rx - 0.5) * 320, 0, (rz - 0.5) * 220)
end

mmClickBtn.MouseButton1Click:Connect(function()
	state.camFocus = getMinimapWorldPos()
	updateInspectorAndHud()
end)

mmClickBtn.MouseButton2Click:Connect(function()
	local ids = getSelectedIdsArray()
	if #ids > 0 then
		local targetPt = getMinimapWorldPos()
		playSound("order")
		spawnOrderMarker(targetPt, Color3.fromRGB(74, 222, 128))
		NetProtocol.fireServer(NetProtocol.EVENTS.IssueMoveOrder, {
			unitIds = ids,
			targetPos = targetPt,
		})
	end
end)

-- ============================================================================
-- 6. RAYCAST Y SELECCIÓN TÁCTICA 3D + ÓRDENES EN EL CAMPO DE BATALLA
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
		if t > 0 and t < 1200 then
			local hit = ray.Origin + ray.Direction * t
			return Vector3.new(math.clamp(hit.X, -155, 155), 0, math.clamp(hit.Z, -108, 108))
		end
	end
	return state.camFocus
end

local function pickUnitNearCursor(teamFilter: number?): any
	local cam = Workspace.CurrentCamera
	if not cam then
		return nil
	end
	local mPos = UserInputService:GetMouseLocation()
	local groundPt = getMouseGroundPosition()

	local bestUnit = nil
	local bestScore = 999999

	for _, u in ipairs(state.units) do
		if u.hp > 0 and (teamFilter == nil or u.team == teamFilter) then
			local livePos = getLiveUnitWorldPosition(u)
			local dGround = (livePos - groundPt).Magnitude
			local vp, onScreen = cam:WorldToViewportPoint(livePos + Vector3.new(0, 2.2, 0))
			local dScreen = if onScreen
				then (Vector2.new(vp.X, vp.Y) - mPos).Magnitude
				else 9999

			local maxGround = if u.kind == "vehicle" then 14 else 11
			local maxScreen = if u.kind == "vehicle" then 52 else 42

			if dGround <= maxGround or dScreen <= maxScreen then
				local score = math.min(dGround * 3.0, dScreen)
				if score < bestScore then
					bestScore = score
					bestUnit = u
				end
			end
		end
	end
	return bestUnit
end

local function executeTacticalOrderAtCursor(forceAttackMode: boolean?)
	local ids = getSelectedIdsArray()
	if #ids == 0 then
		-- Si no hay unidades seleccionadas, seleccionar todas las aliadas automáticamente
		for _, u in ipairs(state.units) do
			if u.team == 0 and u.hp > 0 then
				state.selectedUnitIds[u.id] = true
			end
		end
		ids = getSelectedIdsArray()
		if #ids == 0 then
			return
		end
	end

	local groundPt = getMouseGroundPosition()
	local clickedEnemy = pickUnitNearCursor(1)

	playSound("order")
	if clickedEnemy then
		local enemyPos = getLiveUnitWorldPosition(clickedEnemy)
		spawnOrderMarker(enemyPos, Color3.fromRGB(248, 113, 113))
		NetProtocol.fireServer(NetProtocol.EVENTS.IssueAttackOrder, {
			unitIds = ids,
			targetUnitId = clickedEnemy.id,
		})
	else
		local markerColor = if forceAttackMode
			then Color3.fromRGB(251, 146, 60)
			else Color3.fromRGB(74, 222, 128)
		spawnOrderMarker(groundPt, markerColor)
		NetProtocol.fireServer(NetProtocol.EVENTS.IssueMoveOrder, {
			unitIds = ids,
			targetPos = groundPt,
		})
	end

	state.commandMode = "AUTO"
	updateInspectorAndHud()
end

local function fireDirectControlWeapon(weaponSlot: string)
	if not state.directControlUnitId then
		return
	end
	local aimPt = getMouseGroundPosition()
	state.dcAimPoint = aimPt
	NetProtocol.fireServer(NetProtocol.EVENTS.DirectControlFireOrder, {
		unitId = state.directControlUnitId,
		aimPoint = aimPt,
		weaponSlot = weaponSlot,
	})
end

-- Eventos sobre el TacticalViewportCanvas (Funciona en Edit Mode, Play Mode F5 y Roblox Player)
viewportCanvas.MouseButton1Down:Connect(function(x, y)
	if state.missionModalOpen then
		return
	end
	if state.directControlUnitId then
		state.dcFirePrimaryHeld = true
		fireDirectControlWeapon("primary")
		return
	end

	-- Si el jugador activó el botón MOVE [M] o ATK [A], el Clic Izquierdo ejecuta la orden directamente
	if state.commandMode == "MOVE" then
		executeTacticalOrderAtCursor(false)
		return
	elseif state.commandMode == "ATTACK" then
		executeTacticalOrderAtCursor(true)
		return
	end

	state.isDraggingBox = true
	state.dragStartPos = UserInputService:GetMouseLocation()
	state.dragCurrPos = state.dragStartPos
	marqueeBox.Position = UDim2.new(0, state.dragStartPos.X, 0, state.dragStartPos.Y)
	marqueeBox.Size = UDim2.new(0, 0, 0, 0)
	marqueeBox.Visible = true
end)

local function finishSelectionBox()
	if not state.isDraggingBox then
		return
	end
	state.isDraggingBox = false
	marqueeBox.Visible = false

	local cam = Workspace.CurrentCamera
	if not cam then
		return
	end
	state.dragCurrPos = UserInputService:GetMouseLocation()
	local dragDist = (state.dragCurrPos - state.dragStartPos).Magnitude
	local shiftHeld = UserInputService:IsKeyDown(Enum.KeyCode.LeftShift)
		or UserInputService:IsKeyDown(Enum.KeyCode.RightShift)
	local newSel = if shiftHeld then table.clone(state.selectedUnitIds) else {}

	if dragDist < 12 then
		-- Clic individual: comprobar si hizo clic en una unidad aliada
		local clickedAlly = pickUnitNearCursor(0)
		if clickedAlly then
			newSel[clickedAlly.id] = true
			playSound("order")
			state.selectedUnitIds = newSel
			updateInspectorAndHud()
		else
			-- Si hizo clic en un enemigo teniendo unidades seleccionadas, atacarlo directamente
			local clickedEnemy = pickUnitNearCursor(1)
			local currIds = getSelectedIdsArray()
			if clickedEnemy and #currIds > 0 then
				playSound("order")
				spawnOrderMarker(getLiveUnitWorldPosition(clickedEnemy), Color3.fromRGB(248, 113, 113))
				NetProtocol.fireServer(NetProtocol.EVENTS.IssueAttackOrder, {
					unitIds = currIds,
					targetUnitId = clickedEnemy.id,
				})
			end
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
				local livePos = getLiveUnitWorldPosition(u)
				local vp, onScreen = cam:WorldToViewportPoint(livePos + Vector3.new(0, 2.2, 0))
				if onScreen and vp.X >= minX and vp.X <= maxX and vp.Y >= minY and vp.Y <= maxY then
					newSel[u.id] = true
					count += 1
				end
			end
		end
		if count > 0 then
			playSound("order")
			state.selectedUnitIds = newSel
			updateInspectorAndHud()
		end
	end
end

viewportCanvas.MouseButton1Up:Connect(function()
	state.dcFirePrimaryHeld = false
	finishSelectionBox()
end)

viewportCanvas.MouseButton2Down:Connect(function()
	if state.missionModalOpen then
		return
	end
	if state.directControlUnitId then
		state.dcFireSecondaryHeld = true
		fireDirectControlWeapon("secondary")
		return
	end
	executeTacticalOrderAtCursor(false)
end)

viewportCanvas.MouseButton2Up:Connect(function()
	state.dcFireSecondaryHeld = false
end)

-- Teclado y Respaldo de Ratón (Sin bloquear por gameProcessed salvo TextBox activo)
UserInputService.InputBegan:Connect(function(input, _gameProcessed)
	if UserInputService:GetFocusedTextBox() then
		return
	end

	if input.KeyCode == Enum.KeyCode.Tab then
		toggleDirectControlMode()
		return
	elseif input.KeyCode == Enum.KeyCode.One then
		selectGroupByFilter("INF")
	elseif input.KeyCode == Enum.KeyCode.Two then
		selectGroupByFilter("ARMOR")
	elseif input.KeyCode == Enum.KeyCode.Three then
		selectGroupByFilter("NEXT")
	elseif input.KeyCode == Enum.KeyCode.G then
		selectGroupByFilter("ALL")
	elseif input.KeyCode == Enum.KeyCode.M then
		playSound("order")
		state.commandMode = if state.commandMode == "MOVE" then "AUTO" else "MOVE"
		updateCommandModeVisuals()
	elseif input.KeyCode == Enum.KeyCode.K then
		issueHoldPositionOrder()
	elseif input.KeyCode == Enum.KeyCode.R then
		issueRetreatOrder()
	elseif input.KeyCode == Enum.KeyCode.V then
		local ids = getSelectedIdsArray()
		if #ids > 0 and state.unitsById[ids[1]] then
			state.camFocus = getLiveUnitWorldPosition(state.unitsById[ids[1]])
		end
	elseif input.KeyCode == Enum.KeyCode.Z then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			playSound("order")
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "stand" })
		end
	elseif input.KeyCode == Enum.KeyCode.X then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			playSound("order")
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "crouch" })
		end
	elseif input.KeyCode == Enum.KeyCode.C then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			playSound("order")
			NetProtocol.fireServer(NetProtocol.EVENTS.SetPostureOrder, { unitIds = ids, posture = "prone" })
		end
	elseif input.KeyCode == Enum.KeyCode.F then
		if state.directControlUnitId then
			state.dcFireSecondaryHeld = true
			fireDirectControlWeapon("secondary")
		else
			local ids = getSelectedIdsArray()
			if #ids > 0 then
				playSound("order")
				NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "free" })
			end
		end
	elseif input.KeyCode == Enum.KeyCode.H then
		local ids = getSelectedIdsArray()
		if #ids > 0 then
			playSound("order")
			NetProtocol.fireServer(NetProtocol.EVENTS.SetFireModeOrder, { unitIds = ids, fireMode = "hold" })
		end
	elseif input.KeyCode == Enum.KeyCode.Space and state.directControlUnitId then
		state.dcFirePrimaryHeld = true
		fireDirectControlWeapon("primary")
	end
end)

UserInputService.InputChanged:Connect(function(input, _gameProcessed)
	if input.UserInputType == Enum.UserInputType.MouseMovement then
		if state.isDraggingBox then
			state.dragCurrPos = UserInputService:GetMouseLocation()
			local minX = math.min(state.dragStartPos.X, state.dragCurrPos.X)
			local minY = math.min(state.dragStartPos.Y, state.dragCurrPos.Y)
			local w = math.abs(state.dragCurrPos.X - state.dragStartPos.X)
			local h = math.abs(state.dragCurrPos.Y - state.dragStartPos.Y)
			marqueeBox.Position = UDim2.new(0, minX, 0, minY)
			marqueeBox.Size = UDim2.new(0, w, 0, h)
		end
	elseif input.UserInputType == Enum.UserInputType.MouseWheel then
		if state.directControlUnitId then
			state.dcCamDist = math.clamp(state.dcCamDist - input.Position.Z * 3, 16, 48)
		else
			state.camDist = math.clamp(state.camDist - input.Position.Z * 12, 34, 185)
		end
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		state.dcFirePrimaryHeld = false
		finishSelectionBox()
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		state.dcFireSecondaryHeld = false
	elseif input.KeyCode == Enum.KeyCode.Space then
		state.dcFirePrimaryHeld = false
	elseif input.KeyCode == Enum.KeyCode.F then
		state.dcFireSecondaryHeld = false
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
	anchor.CanQuery = false
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
	tracer.CanQuery = false
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
		blast.CanQuery = false
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
	if type(data.spawnedUnitIds) == "table" and data.team == 0 then
		-- Seleccionar las tropas recién desplegadas por el jugador
		state.selectedUnitIds = {}
		for _, id in ipairs(data.spawnedUnitIds) do
			state.selectedUnitIds[id] = true
		end
		updateInspectorAndHud()
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

	if state.directControlUnitId then
		local dcUnit = byId[state.directControlUnitId]
		if not dcUnit or dcUnit.hp <= 0 then
			state.directControlUnitId = nil
			state.dcPredictedPos = nil
			reticleFrame.Visible = false
			reticleCursor.Visible = false
			dcGroundReticle.Transparency = 1
			dcLaserBeam.Transparency = 1
		elseif state.dcPredictedPos then
			-- Reconciliar suavemente la posición predicha con la del servidor
			local err = (dcUnit.pos - state.dcPredictedPos).Magnitude
			if err > 8 then
				state.dcPredictedPos = dcUnit.pos
			else
				state.dcPredictedPos = state.dcPredictedPos:Lerp(dcUnit.pos, 0.35)
			end
		end
	end

	-- Seleccionar unidades iniciales aliadas automáticamente si ninguna está seleccionada
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
-- 8. ANILLOS 3D DE SELECCIÓN Y BUCLE DE CÁMARA HÍBRIDA (PRIORIDAD CAMERA+10)
-- ============================================================================
local ringPool: { [number]: Part } = {}

local function updateSelectionRings3D()
	local activeIds = {}
	for uid, isSel in pairs(state.selectedUnitIds) do
		local u = state.unitsById[uid]
		if isSel and u and u.hp > 0 then
			activeIds[uid] = true
			local ring = ringPool[uid]
			if not ring or not ring.Parent then
				ring = Instance.new("Part")
				ring.Name = "SelRing_" .. tostring(uid)
				ring.Shape = Enum.PartType.Cylinder
				ring.Material = Enum.Material.Neon
				ring.Anchored = true
				ring.CanCollide = false
				ring.CanQuery = false
				ring.Parent = selectionRingsFolder
				ringPool[uid] = ring
			end
			local livePos = getLiveUnitWorldPosition(u)
			local diam = if u.kind == "vehicle" then 13.5 else 5.2
			ring.Size = Vector3.new(0.22, diam, diam)
			ring.Color = if state.directControlUnitId == uid
				then Color3.fromRGB(250, 204, 21)
				else Color3.fromRGB(74, 222, 128)
			ring.Transparency = 0.25
			ring.CFrame = CFrame.new(livePos.X, 0.22, livePos.Z) * CFrame.Angles(0, 0, math.rad(90))
		end
	end

	for uid, ring in pairs(ringPool) do
		if not activeIds[uid] then
			ring:Destroy()
			ringPool[uid] = nil
		end
	end
end

local dcSyncAccum = 0

local function stepCameraAndDirectControl(dt: number)
	local cam = Workspace.CurrentCamera
	if not cam then
		return
	end

	if not isStudioEdit then
		cam.CameraType = Enum.CameraType.Scriptable
	end

	updateSelectionRings3D()

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
			if state.directControlUnitId then
				state.dcCamYaw += dt * 1.65
			else
				state.camYaw += dt * 1.45
			end
		end
		if UserInputService:IsKeyDown(Enum.KeyCode.E) then
			if state.directControlUnitId then
				state.dcCamYaw -= dt * 1.65
			else
				state.camYaw -= dt * 1.45
			end
		end
	end

	local dcUnit = if state.directControlUnitId then state.unitsById[state.directControlUnitId] else nil
	if dcUnit and dcUnit.hp > 0 then
		-- ====================================================================
		-- MODO DIRECT CONTROL (3RA PERSONA SIN BUCLE DE RETROALIMENTACIÓN)
		-- ====================================================================
		local uPos: Vector3 = state.dcPredictedPos or getLiveUnitWorldPosition(dcUnit)

		-- 1. Fijar la cámara en órbita estable según state.dcCamYaw (NO según el cursor)
		local camFwdXZ = Vector3.new(math.sin(state.dcCamYaw), 0, math.cos(state.dcCamYaw))
		local camRightXZ = Vector3.new(-math.cos(state.dcCamYaw), 0, math.sin(state.dcCamYaw))

		-- 2. Predicción local a 60 FPS del movimiento WASD relativo a la cámara
		local worldMove = camFwdXZ * moveForward + camRightXZ * moveRight
		if worldMove.Magnitude > 0.05 then
			local dir = worldMove.Unit
			local tpl = WarOfMenCatalog.UNIT_TEMPLATES[dcUnit.templateId]
			local speed = if tpl then tpl.speed else 13
			uPos = Vector3.new(
				math.clamp(uPos.X + dir.X * speed * dt, -152, 152),
				0,
				math.clamp(uPos.Z + dir.Z * speed * dt, -104, 104)
			)
			state.dcPredictedHullYaw = math.atan2(dir.X, dir.Z)
		end
		state.dcPredictedPos = uPos
		state.camFocus = uPos

		local camOffset = -camFwdXZ * state.dcCamDist + Vector3.new(0, state.dcCamDist * 0.56, 0)
		local camTarget = uPos + camFwdXZ * 18 + Vector3.new(0, 2.8, 0)
		cam.CFrame = CFrame.lookAt(uPos + camOffset, camTarget)

		-- 3. Calcular punto de mira (aimPt) con la cámara ya estable
		local mPos = UserInputService:GetMouseLocation()
		reticleCursor.Position = UDim2.new(0, mPos.X, 0, mPos.Y)
		local aimPt = getMouseGroundPosition()
		state.dcAimPoint = aimPt

		local aimDelta = aimPt - uPos
		local aimYaw = if aimDelta.Magnitude > 0.5
			then math.atan2(aimDelta.X, aimDelta.Z)
			else state.dcPredictedHullYaw

		-- Actualizar retícula 3D y línea láser en el campo de batalla
		dcGroundReticle.Transparency = 0.2
		dcGroundReticle.CFrame = CFrame.new(aimPt.X, 0.25, aimPt.Z) * CFrame.Angles(0, 0, math.rad(90))

		local muzzlePos = uPos + Vector3.new(0, if dcUnit.kind == "vehicle" then 3.2 else 2.5, 0)
		local targetBeamPos = Vector3.new(aimPt.X, 1.2, aimPt.Z)
		local beamDist = (targetBeamPos - muzzlePos).Magnitude
		dcLaserBeam.Transparency = 0.45
		dcLaserBeam.Size = Vector3.new(0.12, 0.12, math.max(1, beamDist))
		dcLaserBeam.CFrame = CFrame.lookAt(muzzlePos, targetBeamPos) * CFrame.new(0, 0, -beamDist * 0.5)

		-- Actualizar visualmente el modelo 3D local de inmediato para respuesta instantánea a 60 FPS
		local bf = Workspace:FindFirstChild("WarOfMenBattlefield")
		if bf and bf:FindFirstChild("Units") then
			local mdl = bf.Units:FindFirstChild("Unit_" .. tostring(dcUnit.id))
			if mdl and mdl:IsA("Model") and mdl.PrimaryPart then
				local bodyYaw = if dcUnit.kind == "vehicle" then state.dcPredictedHullYaw else aimYaw
				local rootCf = CFrame.new(uPos.X, 0, uPos.Z) * CFrame.Angles(0, bodyYaw, 0)
				mdl:PivotTo(rootCf)
				local turret = mdl:FindFirstChild("Turret")
				if turret and turret:IsA("BasePart") then
					local tRot = CFrame.new(uPos.X, 3.35, uPos.Z) * CFrame.Angles(0, aimYaw, 0)
					turret.CFrame = tRot
					local barrel = mdl:FindFirstChild("MainGunBarrel")
					if barrel and barrel:IsA("BasePart") then
						barrel.CFrame = tRot * CFrame.new(0, 0.1, 4.8)
					end
				end
			end
		end

		-- 4. Enviar movimiento y puntería al servidor a 20 Hz
		dcSyncAccum += dt
		if dcSyncAccum >= 0.05 then
			local stepDt = dcSyncAccum
			dcSyncAccum = 0
			NetProtocol.fireServer(NetProtocol.EVENTS.DirectControlMoveOrder, {
				unitId = dcUnit.id,
				moveVec = worldMove,
				aimPoint = aimPt,
				dt = stepDt,
			})
		end

		-- 5. Disparo continuo si mantiene presionado LMB/Space o RMB/F
		if state.dcFirePrimaryHeld or state.dcFireSecondaryHeld then
			state.dcFireAccum += dt
			if state.dcFireAccum >= 0.12 then
				state.dcFireAccum = 0
				if state.dcFirePrimaryHeld then
					fireDirectControlWeapon("primary")
				elseif state.dcFireSecondaryHeld then
					fireDirectControlWeapon("secondary")
				end
			end
		end
	else
		-- ====================================================================
		-- MODO COMANDANTE RTS ORBITAL
		-- ====================================================================
		dcGroundReticle.Transparency = 1
		dcLaserBeam.Transparency = 1
		reticleCursor.Visible = false

		local panSpeed = 72 * (state.camDist / 95)
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
end

pcall(function()
	RunService:UnbindFromRenderStep("WarOfMenTacticalCamera")
end)
RunService:BindToRenderStep("WarOfMenTacticalCamera", Enum.RenderPriority.Camera.Value + 10, stepCameraAndDirectControl)

updateInspectorAndHud()
print("[War of Men Client] Balanced Tactical RTS + 60FPS Direct Control HUD ready.")
