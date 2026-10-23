--!strict
--[[
	WorldSimService.luau
	Motor de Simulación Táctica Determinista (20 Hz) en Servidor para "War of Men".
	Construye el escenario 3D en Workspace.WarOfMenBattlefield, instancia modelos 3D
	articulados de infantería y tanques con torreta móvil, gestiona movimiento, posturas,
	cobertura tras sacos terreros, captura de banderas, puntos de mando (MP) y combate.
]]

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local ServerScriptService = game:GetService("ServerScriptService")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))
local NetProtocol = require(Shared:WaitForChild("NetProtocol"))
local BallisticsCombatService = require(ServerScriptService:WaitForChild("BallisticsCombatService"))
local ProfileStoreService = require(ServerScriptService:WaitForChild("ProfileStoreService"))

local WorldSimService = {}

export type UnitEntity = {
	id: number,
	templateId: string,
	name: string,
	team: number, -- 0 = Allied/Player, 1 = Axis/Enemy
	faction: WarOfMenCatalog.FactionId,
	kind: "infantry" | "vehicle",
	role: string,
	hp: number,
	maxHp: number,
	speed: number,
	pos: Vector3,
	targetPos: Vector3?,
	yaw: number,
	turretYaw: number,
	posture: "stand" | "crouch" | "prone",
	fireMode: "free" | "hold" | "return",
	inCover: boolean,
	weaponId: string,
	secondaryWeaponId: string?,
	cooldownTimer: number,
	secondaryCooldown: number,
	targetUnitId: number?,
	armor: WarOfMenCatalog.ArmorProfile?,
	veterancy: number,
	kills: number,
	model: Model?,
	walkCycle: number,
	directControlUntil: number,
}

export type FlagState = {
	id: string,
	name: string,
	pos: Vector3,
	owner: number, -- -1 neutral, 0 team0, 1 team1
	captureProgress: number, -- -100 (team1) to +100 (team0)
	model: Model?,
}

-- Estado Maestro de la Partida
WorldSimService.currentMissionId = "usa_normandy"
WorldSimService.missionDef = WarOfMenCatalog.getMissionById("usa_normandy")
WorldSimService.tickCount = 0
WorldSimService.elapsedTime = 0
WorldSimService.nextUnitId = 1
WorldSimService.units = {} :: { [number]: UnitEntity }
WorldSimService.flags = {} :: { FlagState }
WorldSimService.coverPositions = {} :: { Vector3 }
WorldSimService.teamMp = { [0] = 380, [1] = 380 }
WorldSimService.teamVp = { [0] = 500, [1] = 500 }
WorldSimService.reinfCooldowns = { [0] = {} :: { [string]: number }, [1] = {} :: { [string]: number } }
WorldSimService.playerBotMode = "OFF" :: "OFF" | "DEFEND" | "ATTACK"
WorldSimService.matchOver = false
WorldSimService.winnerTeam = -1

local rootFolder: Folder? = nil
local mapFolder: Folder? = nil
local unitsFolder: Folder? = nil
local flagsFolder: Folder? = nil
local wrecksFolder: Folder? = nil

local function makePart(parent: Instance, name: string, size: Vector3, cf: CFrame, color: Color3, material: Enum.Material, canCollide: boolean?): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material
	p.Anchored = true
	p.CanCollide = if canCollide ~= nil then canCollide else true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

function WorldSimService.ensureContainers()
	local bf = Workspace:FindFirstChild("WarOfMenBattlefield")
	if not bf then
		bf = Instance.new("Folder")
		bf.Name = "WarOfMenBattlefield"
		bf.Parent = Workspace
	end
	rootFolder = bf :: Folder

	local function ensureSub(name: string): Folder
		local f = (bf :: Folder):FindFirstChild(name)
		if not f then
			f = Instance.new("Folder")
			f.Name = name
			f.Parent = bf
		end
		return f :: Folder
	end

	mapFolder = ensureSub("MapGeometry")
	unitsFolder = ensureSub("Units")
	flagsFolder = ensureSub("Flags")
	wrecksFolder = ensureSub("Wrecks")
end

function WorldSimService.buildBattlefieldGeometry(mission: WarOfMenCatalog.MissionDef)
	WorldSimService.ensureContainers()
	if not mapFolder or not flagsFolder then
		return
	end
	mapFolder:ClearAllChildren()
	flagsFolder:ClearAllChildren()
	table.clear(WorldSimService.coverPositions)
	table.clear(WorldSimService.flags)

	-- Iluminación atmosférica según el teatro de operaciones
	pcall(function()
		Lighting.Ambient = mission.ambientColor
		Lighting.OutdoorAmbient = mission.ambientColor
		Lighting.Brightness = 2.4
		Lighting.ClockTime = if mission.id == "eng_pegasus" then 5.8 else 14.5
	end)

	local groundMat = Enum.Material.Grass
	if mission.biome == "winter" or mission.biome == "winter_urban" then
		groundMat = Enum.Material.Snow
	elseif mission.biome == "desert" then
		groundMat = Enum.Material.Sand
	elseif mission.biome == "urban" then
		groundMat = Enum.Material.Cobblestone
	elseif mission.biome == "volcanic" then
		groundMat = Enum.Material.Basalt
	end

	-- Suelo Táctico Principal (320 x 220 studs)
	makePart(mapFolder, "TacticalGround", Vector3.new(340, 4, 240), CFrame.new(0, -2, 0), mission.groundColor, groundMat, true)

	-- Canal / Río Táctico Norte-Sur con Vados y Puente Central
	makePart(mapFolder, "RiverChannel", Vector3.new(26, 1.5, 236), CFrame.new(0, -0.6, 0), mission.waterColor, Enum.Material.Water, false)
	-- Puente Central de Piedra/Acero
	makePart(mapFolder, "CentralBridgeDeck", Vector3.new(34, 1.4, 26), CFrame.new(0, 0.3, 0), mission.roadColor, Enum.Material.Concrete, true)
	makePart(mapFolder, "BridgeParapetNorth", Vector3.new(34, 2.6, 1.8), CFrame.new(0, 1.6, -12.5), Color3.fromRGB(95, 98, 102), Enum.Material.Concrete, true)
	makePart(mapFolder, "BridgeParapetSouth", Vector3.new(34, 2.6, 1.8), CFrame.new(0, 1.6, 12.5), Color3.fromRGB(95, 98, 102), Enum.Material.Concrete, true)

	-- Vados laterales Norte y Sur para flanqueos
	makePart(mapFolder, "NorthFordCrossing", Vector3.new(30, 0.9, 20), CFrame.new(0, -0.1, -68), mission.roadColor, Enum.Material.Slate, true)
	makePart(mapFolder, "SouthFordCrossing", Vector3.new(30, 0.9, 20), CFrame.new(0, -0.1, 68), mission.roadColor, Enum.Material.Slate, true)

	-- Carretera Este-Oeste
	makePart(mapFolder, "MainRoadWest", Vector3.new(145, 0.3, 18), CFrame.new(-88, 0.1, 0), mission.roadColor, Enum.Material.Cobblestone, true)
	makePart(mapFolder, "MainRoadEast", Vector3.new(145, 0.3, 18), CFrame.new(88, 0.1, 0), mission.roadColor, Enum.Material.Cobblestone, true)

	-- Búnkeres de Hormigón y Trincheras en ambos frentes
	local bunkerLocations = {
		{ pos = Vector3.new(-76, 0, -34), yaw = 0 },
		{ pos = Vector3.new(-76, 0, 34), yaw = 0 },
		{ pos = Vector3.new(76, 0, -34), yaw = math.pi },
		{ pos = Vector3.new(76, 0, 34), yaw = math.pi },
	}
	for idx, b in ipairs(bunkerLocations) do
		local bModel = Instance.new("Model")
		bModel.Name = "ConcreteBunker_" .. tostring(idx)
		bModel.Parent = mapFolder
		local baseCf = CFrame.new(b.pos) * CFrame.Angles(0, b.yaw, 0)
		makePart(bModel, "BunkerFloor", Vector3.new(16, 0.6, 14), baseCf * CFrame.new(0, 0.3, 0), Color3.fromRGB(108, 110, 114), Enum.Material.Concrete, true)
		makePart(bModel, "BunkerWallFrontLow", Vector3.new(2.2, 2.4, 14), baseCf * CFrame.new(7, 1.2, 0), Color3.fromRGB(96, 98, 102), Enum.Material.Concrete, true)
		makePart(bModel, "BunkerWallNorth", Vector3.new(16, 5.5, 2.0), baseCf * CFrame.new(0, 2.75, -6), Color3.fromRGB(92, 94, 98), Enum.Material.Concrete, true)
		makePart(bModel, "BunkerWallSouth", Vector3.new(16, 5.5, 2.0), baseCf * CFrame.new(0, 2.75, 6), Color3.fromRGB(92, 94, 98), Enum.Material.Concrete, true)
		makePart(bModel, "BunkerRoof", Vector3.new(17, 1.2, 15), baseCf * CFrame.new(0, 6.0, 0), Color3.fromRGB(82, 85, 88), Enum.Material.Concrete, true)
		table.insert(WorldSimService.coverPositions, b.pos)
	end

	-- Líneas de Sacos Terreros (Cobertura Táctica Real)
	local sandbagPositions = {
		Vector3.new(-46, 0, -24),
		Vector3.new(-46, 0, 24),
		Vector3.new(-24, 0, -48),
		Vector3.new(-24, 0, 48),
		Vector3.new(46, 0, -24),
		Vector3.new(46, 0, 24),
		Vector3.new(24, 0, -48),
		Vector3.new(24, 0, 48),
		Vector3.new(-92, 0, -16),
		Vector3.new(92, 0, 16),
	}
	for idx, sPos in ipairs(sandbagPositions) do
		makePart(
			mapFolder,
			"SandbagWall_" .. tostring(idx),
			Vector3.new(3.2, 2.3, 11.5),
			CFrame.new(sPos + Vector3.new(0, 1.15, 0)),
			Color3.fromRGB(174, 154, 112),
			Enum.Material.Sand,
			true
		)
		table.insert(WorldSimService.coverPositions, sPos)
	end

	-- Erizos Checos Antitanque y Árboles del Bioma
	local treePositions = {
		Vector3.new(-62, 0, -68), Vector3.new(-35, 0, -78), Vector3.new(35, 0, -78), Vector3.new(62, 0, -68),
		Vector3.new(-62, 0, 68), Vector3.new(-35, 0, 78), Vector3.new(35, 0, 78), Vector3.new(62, 0, 68),
		Vector3.new(-118, 0, -45), Vector3.new(-118, 0, 45), Vector3.new(118, 0, -45), Vector3.new(118, 0, 45),
	}
	local foliageColor = if mission.biome == "winter" or mission.biome == "winter_urban"
		then Color3.fromRGB(220, 230, 240)
		elseif mission.biome == "autumn" then Color3.fromRGB(168, 102, 44)
		elseif mission.biome == "desert" then Color3.fromRGB(128, 142, 74)
		else Color3.fromRGB(54, 92, 46)

	for idx, tPos in ipairs(treePositions) do
		local treeModel = Instance.new("Model")
		treeModel.Name = "BattleTree_" .. tostring(idx)
		treeModel.Parent = mapFolder
		makePart(treeModel, "Trunk", Vector3.new(1.8, 7, 1.8), CFrame.new(tPos + Vector3.new(0, 3.5, 0)), Color3.fromRGB(92, 68, 46), Enum.Material.Wood, true)
		makePart(treeModel, "Canopy", Vector3.new(7.5, 7.5, 7.5), CFrame.new(tPos + Vector3.new(0, 8.8, 0)), foliageColor, Enum.Material.Grass, false)
	end

	-- Instanciar las 3 Banderas Estratégicas de Captura
	for _, fDef in ipairs(mission.flags) do
		local fModel = Instance.new("Model")
		fModel.Name = fDef.id
		fModel.Parent = flagsFolder

		local ring = makePart(
			fModel,
			"CaptureZoneRing",
			Vector3.new(0.4, 24, 24),
			CFrame.new(fDef.pos + Vector3.new(0, 0.2, 0)) * CFrame.Angles(0, 0, math.rad(90)),
			Color3.fromRGB(230, 200, 90),
			Enum.Material.Neon,
			false
		)
		ring.Shape = Enum.PartType.Cylinder
		ring.Transparency = 0.65

		local pole = makePart(
			fModel,
			"FlagPole",
			Vector3.new(0.6, 15, 0.6),
			CFrame.new(fDef.pos + Vector3.new(0, 7.5, 0)),
			Color3.fromRGB(210, 214, 220),
			Enum.Material.Metal,
			false
		)
		fModel.PrimaryPart = pole

		local bannerColor = if fDef.initialOwner == 0
			then Color3.fromRGB(52, 168, 83)
			elseif fDef.initialOwner == 1 then Color3.fromRGB(220, 62, 54)
			else Color3.fromRGB(240, 210, 90)

		makePart(
			fModel,
			"FlagCloth",
			Vector3.new(0.3, 3.2, 5.2),
			CFrame.new(fDef.pos + Vector3.new(0, 13.2, 2.7)),
			bannerColor,
			Enum.Material.Fabric,
			false
		)

		local bb = Instance.new("BillboardGui")
		bb.Name = "FlagHud"
		bb.Size = UDim2.new(0, 170, 0, 42)
		bb.StudsOffset = Vector3.new(0, 16.5, 0)
		bb.AlwaysOnTop = true
		bb.Parent = pole

		local lbl = Instance.new("TextLabel")
		lbl.Name = "Title"
		lbl.Size = UDim2.new(1, 0, 1, 0)
		lbl.BackgroundColor3 = Color3.fromRGB(15, 22, 30)
		lbl.BackgroundTransparency = 0.25
		lbl.TextColor3 = Color3.fromRGB(248, 250, 252)
		lbl.Font = Enum.Font.GothamBold
		lbl.TextSize = 13
		lbl.Text = "⚑ " .. fDef.name
		lbl.Parent = bb

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 6)
		corner.Parent = lbl

		local initProg = if fDef.initialOwner == 0 then 100 elseif fDef.initialOwner == 1 then -100 else 0
		table.insert(WorldSimService.flags, {
			id = fDef.id,
			name = fDef.name,
			pos = fDef.pos,
			owner = fDef.initialOwner,
			captureProgress = initProg,
			model = fModel,
		})
	end
end

-- ============================================================================
-- GENERADOR DE MODELOS 3D ARTICULADOS (INFANTERÍA Y TANQUES)
-- ============================================================================
local function buildUnitModel(unit: UnitEntity): Model
	WorldSimService.ensureContainers()
	local facDef = WarOfMenCatalog.FACTIONS[unit.faction] or WarOfMenCatalog.FACTIONS.USA
	local m = Instance.new("Model")
	m.Name = string.format("Unit_%d_%s", unit.id, unit.templateId)
	m:SetAttribute("UnitId", unit.id)
	m:SetAttribute("Team", unit.team)
	m:SetAttribute("Faction", unit.faction)
	m:SetAttribute("Kind", unit.kind)
	m:SetAttribute("Role", unit.role)
	m:SetAttribute("UnitName", unit.name)
	m:SetAttribute("Hp", unit.hp)
	m:SetAttribute("MaxHp", unit.maxHp)
	m:SetAttribute("Posture", unit.posture)
	m:SetAttribute("FireMode", unit.fireMode)

	local teamColor = if unit.team == 0 then Color3.fromRGB(74, 222, 128) else Color3.fromRGB(248, 113, 113)
	local baseCf = CFrame.new(unit.pos) * CFrame.Angles(0, unit.yaw, 0)

	if unit.kind == "infantry" then
		local root = makePart(m, "HumanoidRootPart", Vector3.new(2.0, 2.2, 1.2), baseCf * CFrame.new(0, 2.6, 0), facDef.uniformColor, Enum.Material.Fabric, false)
		m.PrimaryPart = root

		makePart(m, "Head", Vector3.new(1.15, 1.15, 1.15), baseCf * CFrame.new(0, 4.3, 0), Color3.fromRGB(232, 196, 162), Enum.Material.SmoothPlastic, false)
		makePart(m, "Helmet", Vector3.new(1.32, 0.65, 1.35), baseCf * CFrame.new(0, 4.68, 0), facDef.helmetColor, Enum.Material.Metal, false)
		makePart(m, "LeftLeg", Vector3.new(0.85, 2.0, 0.85), baseCf * CFrame.new(-0.5, 1.0, 0), facDef.uniformColor, Enum.Material.Fabric, false)
		makePart(m, "RightLeg", Vector3.new(0.85, 2.0, 0.85), baseCf * CFrame.new(0.5, 1.0, 0), facDef.uniformColor, Enum.Material.Fabric, false)
		makePart(m, "LeftArm", Vector3.new(0.75, 1.9, 0.75), baseCf * CFrame.new(-1.3, 2.7, 0.35), facDef.uniformColor, Enum.Material.Fabric, false)
		makePart(m, "RightArm", Vector3.new(0.75, 1.9, 0.75), baseCf * CFrame.new(1.3, 2.7, 0.35), facDef.uniformColor, Enum.Material.Fabric, false)

		local gunLen = if unit.role == "at" then 4.2 elseif unit.role == "mg" then 3.5 else 2.9
		local weaponPart = makePart(m, "WeaponPart", Vector3.new(0.35, 0.42, gunLen), baseCf * CFrame.new(0.85, 2.75, 1.4), Color3.fromRGB(48, 52, 56), Enum.Material.Metal, false)
		local muzzle = Instance.new("Attachment")
		muzzle.Name = "Muzzle"
		muzzle.Position = Vector3.new(0, 0, gunLen * 0.5)
		muzzle.Parent = weaponPart

		-- Base táctica de facción bajo los pies
		local ring = makePart(
			m,
			"TeamBaseRing",
			Vector3.new(0.18, 3.6, 3.6),
			CFrame.new(unit.pos + Vector3.new(0, 0.1, 0)) * CFrame.Angles(0, 0, math.rad(90)),
			teamColor,
			Enum.Material.Neon,
			false
		)
		ring.Shape = Enum.PartType.Cylinder
		ring.Transparency = 0.45
	else
		-- Vehículo Blindado / Tanque con Torreta y Cañón Articulados
		local hullSize = Vector3.new(8.6, 3.2, 14.5)
		local hull = makePart(m, "Hull", hullSize, baseCf * CFrame.new(0, 2.2, 0), facDef.tankColor, Enum.Material.Metal, true)
		m.PrimaryPart = hull

		makePart(m, "LeftTrack", Vector3.new(1.6, 2.4, hullSize.Z + 0.6), baseCf * CFrame.new(-hullSize.X * 0.52, 1.2, 0), Color3.fromRGB(36, 38, 40), Enum.Material.Slate, false)
		makePart(m, "RightTrack", Vector3.new(1.6, 2.4, hullSize.Z + 0.6), baseCf * CFrame.new(hullSize.X * 0.52, 1.2, 0), Color3.fromRGB(36, 38, 40), Enum.Material.Slate, false)

		local turretCf = CFrame.new(unit.pos + Vector3.new(0, 4.5, 0)) * CFrame.Angles(0, unit.turretYaw, 0)
		makePart(m, "Turret", Vector3.new(5.4, 2.2, 6.4), turretCf, facDef.tankColor, Enum.Material.Metal, false)
		local barrel = makePart(m, "GunBarrel", Vector3.new(0.75, 0.75, 9.2), turretCf * CFrame.new(0, 0.15, 6.2), Color3.fromRGB(58, 64, 68), Enum.Material.Metal, false)
		local muzzle = Instance.new("Attachment")
		muzzle.Name = "Muzzle"
		muzzle.Position = Vector3.new(0, 0, 4.6)
		muzzle.Parent = barrel

		local ring = makePart(
			m,
			"TeamBaseRing",
			Vector3.new(0.22, 14.5, 14.5),
			CFrame.new(unit.pos + Vector3.new(0, 0.12, 0)) * CFrame.Angles(0, 0, math.rad(90)),
			teamColor,
			Enum.Material.Neon,
			false
		)
		ring.Shape = Enum.PartType.Cylinder
		ring.Transparency = 0.52
	end

	-- Etiqueta flotante de Salud y Clase (BillboardGui)
	if m.PrimaryPart then
		local bb = Instance.new("BillboardGui")
		bb.Name = "UnitStatusGui"
		bb.Size = UDim2.new(0, 110, 0, 28)
		bb.StudsOffset = Vector3.new(0, if unit.kind == "vehicle" then 6.2 else 4.2, 0)
		bb.MaxDistance = 240
		bb.AlwaysOnTop = true
		bb.Parent = m.PrimaryPart

		local bg = Instance.new("Frame")
		bg.Name = "BarBg"
		bg.Size = UDim2.new(1, 0, 0, 7)
		bg.Position = UDim2.new(0, 0, 1, -8)
		bg.BackgroundColor3 = Color3.fromRGB(20, 24, 30)
		bg.BorderSizePixel = 0
		bg.Parent = bb

		local fill = Instance.new("Frame")
		fill.Name = "BarFill"
		fill.Size = UDim2.new(1, 0, 1, 0)
		fill.BackgroundColor3 = teamColor
		fill.BorderSizePixel = 0
		fill.Parent = bg

		local title = Instance.new("TextLabel")
		title.Name = "UnitTitle"
		title.Size = UDim2.new(1, 0, 0, 16)
		title.Position = UDim2.new(0, 0, 0, 0)
		title.BackgroundTransparency = 1
		title.TextColor3 = Color3.fromRGB(245, 248, 252)
		title.TextStrokeTransparency = 0.25
		title.Font = Enum.Font.GothamBold
		title.TextSize = 11
		title.Text = unit.name
		title.Parent = bb
	end

	if unitsFolder then
		m.Parent = unitsFolder
	end
	return m
end

local function updateUnitModelTransform(unit: UnitEntity, dt: number, isMoving: boolean)
	local m = unit.model
	if not m or not m.PrimaryPart then
		return
	end

	m:SetAttribute("Hp", unit.hp)
	m:SetAttribute("Posture", unit.posture)
	m:SetAttribute("FireMode", unit.fireMode)
	m:SetAttribute("InCover", unit.inCover)

	local baseCf = CFrame.new(unit.pos) * CFrame.Angles(0, unit.yaw, 0)

	if unit.kind == "infantry" then
		if isMoving then
			unit.walkCycle = (unit.walkCycle + dt * 9.5) % (math.pi * 2)
		else
			unit.walkCycle = 0
		end
		local swing = math.sin(unit.walkCycle) * 0.45

		local yOffset = 2.6
		local pitch = 0
		if unit.posture == "crouch" then
			yOffset = 1.85
			pitch = math.rad(-15)
		elseif unit.posture == "prone" then
			yOffset = 0.85
			pitch = math.rad(-78)
		end

		local root = m:FindFirstChild("HumanoidRootPart") :: BasePart?
		if root then
			root.CFrame = baseCf * CFrame.new(0, yOffset, 0) * CFrame.Angles(pitch, 0, 0)
		end
		local head = m:FindFirstChild("Head") :: BasePart?
		if head then
			head.CFrame = baseCf * CFrame.new(0, yOffset + 1.65, 0)
		end
		local helmet = m:FindFirstChild("Helmet") :: BasePart?
		if helmet then
			helmet.CFrame = baseCf * CFrame.new(0, yOffset + 2.02, 0)
		end
		local lLeg = m:FindFirstChild("LeftLeg") :: BasePart?
		if lLeg then
			lLeg.CFrame = baseCf * CFrame.new(-0.5, math.max(0.5, yOffset - 1.5), swing * 0.45) * CFrame.Angles(swing, 0, 0)
		end
		local rLeg = m:FindFirstChild("RightLeg") :: BasePart?
		if rLeg then
			rLeg.CFrame = baseCf * CFrame.new(0.5, math.max(0.5, yOffset - 1.5), -swing * 0.45) * CFrame.Angles(-swing, 0, 0)
		end
		local lArm = m:FindFirstChild("LeftArm") :: BasePart?
		if lArm then
			lArm.CFrame = baseCf * CFrame.new(-1.25, yOffset + 0.1, 0.45) * CFrame.Angles(math.rad(65), 0, 0)
		end
		local rArm = m:FindFirstChild("RightArm") :: BasePart?
		if rArm then
			rArm.CFrame = baseCf * CFrame.new(1.25, yOffset + 0.1, 0.45) * CFrame.Angles(math.rad(65), 0, 0)
		end
		local wPart = m:FindFirstChild("WeaponPart") :: BasePart?
		if wPart then
			wPart.CFrame = baseCf * CFrame.new(0.85, yOffset + 0.15, 1.45)
		end
	else
		-- Vehículo Blindado
		local hull = m:FindFirstChild("Hull") :: BasePart?
		if hull then
			hull.CFrame = baseCf * CFrame.new(0, 2.2, 0)
		end
		local lTrack = m:FindFirstChild("LeftTrack") :: BasePart?
		if lTrack then
			lTrack.CFrame = baseCf * CFrame.new(-4.5, 1.2, 0)
		end
		local rTrack = m:FindFirstChild("RightTrack") :: BasePart?
		if rTrack then
			rTrack.CFrame = baseCf * CFrame.new(4.5, 1.2, 0)
		end
		local turretCf = CFrame.new(unit.pos + Vector3.new(0, 4.5, 0)) * CFrame.Angles(0, unit.turretYaw, 0)
		local turret = m:FindFirstChild("Turret") :: BasePart?
		if turret then
			turret.CFrame = turretCf
		end
		local barrel = m:FindFirstChild("GunBarrel") :: BasePart?
		if barrel then
			barrel.CFrame = turretCf * CFrame.new(0, 0.15, 6.2)
		end
	end

	local ring = m:FindFirstChild("TeamBaseRing") :: BasePart?
	if ring then
		ring.CFrame = CFrame.new(unit.pos + Vector3.new(0, 0.12, 0)) * CFrame.Angles(0, 0, math.rad(90))
	end

	local bb = m.PrimaryPart:FindFirstChild("UnitStatusGui") :: BillboardGui?
	if bb then
		local barBg = bb:FindFirstChild("BarBg")
		local barFill = if barBg then barBg:FindFirstChild("BarFill") :: Frame? else nil
		if barFill then
			local ratio = math.clamp(unit.hp / math.max(1, unit.maxHp), 0, 1)
			barFill.Size = UDim2.new(ratio, 0, 1, 0)
		end
	end
end

function WorldSimService.spawnUnit(templateId: string, team: number, faction: WarOfMenCatalog.FactionId, pos: Vector3, yaw: number): UnitEntity?
	local tpl = WarOfMenCatalog.UNIT_TEMPLATES[templateId]
	if not tpl then
		return nil
	end

	local id = WorldSimService.nextUnitId
	WorldSimService.nextUnitId += 1

	local u: UnitEntity = {
		id = id,
		templateId = templateId,
		name = tpl.name,
		team = team,
		faction = faction,
		kind = tpl.kind,
		role = tpl.role,
		hp = tpl.maxHp,
		maxHp = tpl.maxHp,
		speed = tpl.speed,
		pos = Vector3.new(pos.X, 0, pos.Z),
		targetPos = nil,
		yaw = yaw,
		turretYaw = yaw,
		posture = "stand",
		fireMode = "free",
		inCover = false,
		weaponId = tpl.weaponId,
		secondaryWeaponId = tpl.secondaryWeaponId,
		cooldownTimer = math.random() * 0.5,
		secondaryCooldown = 0.5,
		targetUnitId = nil,
		armor = tpl.armor,
		veterancy = 0,
		kills = 0,
		model = nil,
		walkCycle = 0,
		directControlUntil = 0,
	}

	u.model = buildUnitModel(u)
	WorldSimService.units[id] = u
	return u
end

function WorldSimService.spawnReinforcement(team: number, reinfId: string): boolean
	local mission = WorldSimService.missionDef
	local faction = if team == 0 then mission.playerFaction else mission.enemyFaction

	local foundDef: WarOfMenCatalog.ReinforcementDef? = nil
	for _, r in ipairs(WarOfMenCatalog.REINFORCEMENTS) do
		if r.id == reinfId then
			foundDef = r
			break
		end
	end
	if not foundDef then
		return false
	end

	local cdMap = WorldSimService.reinfCooldowns[team]
	if (cdMap[reinfId] or 0) > 0 then
		return false
	end
	if (WorldSimService.teamMp[team] or 0) < foundDef.costMp then
		return false
	end

	WorldSimService.teamMp[team] -= foundDef.costMp
	cdMap[reinfId] = foundDef.cooldown

	local baseX = if team == 0 then -132 else 132
	local yaw = if team == 0 then math.rad(90) else math.rad(-90)
	local zCenter = (math.random() - 0.5) * 44

	local spawnedIds = {}
	for idx, tplId in ipairs(foundDef.units) do
		local row = math.floor((idx - 1) / 3)
		local col = (idx - 1) % 3
		local spawnPos = Vector3.new(baseX + (if team == 0 then -row * 7 else row * 7), 0, zCenter + (col - 1) * 6.5)
		local u = WorldSimService.spawnUnit(tplId, team, faction, spawnPos, yaw)
		if u then
			-- Avanzar hacia la línea del frente al desplegarse
			local advanceX = if team == 0 then -82 else 82
			u.targetPos = Vector3.new(advanceX + (math.random() - 0.5) * 14, 0, spawnPos.Z)
			table.insert(spawnedIds, u.id)
		end
	end

	NetProtocol.fireAllClients(NetProtocol.EVENTS.BattleBannerBroadcast, {
		team = team,
		title = string.format("%s REINFORCEMENTS DEPLOYED", faction),
		subtitle = foundDef.name,
		spawnedUnitIds = spawnedIds,
	})
	return true
end

function WorldSimService.loadMission(missionId: string)
	WorldSimService.ensureContainers()
	local mission = WarOfMenCatalog.getMissionById(missionId)
	WorldSimService.currentMissionId = mission.id
	WorldSimService.missionDef = mission
	WorldSimService.tickCount = 0
	WorldSimService.elapsedTime = 0
	WorldSimService.matchOver = false
	WorldSimService.winnerTeam = -1
	WorldSimService.teamMp[0] = mission.startMp
	WorldSimService.teamMp[1] = mission.startMp
	WorldSimService.teamVp[0] = 500
	WorldSimService.teamVp[1] = 500
	WorldSimService.reinfCooldowns[0] = {}
	WorldSimService.reinfCooldowns[1] = {}

	for _, u in pairs(WorldSimService.units) do
		if u.model then
			u.model:Destroy()
		end
	end
	table.clear(WorldSimService.units)
	if unitsFolder then
		unitsFolder:ClearAllChildren()
	end
	if wrecksFolder then
		wrecksFolder:ClearAllChildren()
	end

	WorldSimService.buildBattlefieldGeometry(mission)

	-- Despliegue Inicial de Fuerzas Aliadas (Team 0) y del Eje/Oponente (Team 1)
	local pReinf = WarOfMenCatalog.getReinforcementsForFaction(mission.playerFaction)
	local eReinf = WarOfMenCatalog.getReinforcementsForFaction(mission.enemyFaction)

	if #pReinf >= 1 then
		for i, tplId in ipairs(pReinf[1].units) do
			WorldSimService.spawnUnit(tplId, 0, mission.playerFaction, Vector3.new(-78 - (i % 2) * 5, 0, -22 + i * 5), math.rad(90))
		end
	end
	if #pReinf >= 2 then
		for i, tplId in ipairs(pReinf[2].units) do
			WorldSimService.spawnUnit(tplId, 0, mission.playerFaction, Vector3.new(-74 - (i % 2) * 5, 0, 12 + i * 5), math.rad(90))
		end
	end
	if #pReinf >= 4 then
		WorldSimService.spawnUnit(pReinf[4].units[1], 0, mission.playerFaction, Vector3.new(-92, 0, 0), math.rad(90))
	end

	if #eReinf >= 1 then
		for i, tplId in ipairs(eReinf[1].units) do
			WorldSimService.spawnUnit(tplId, 1, mission.enemyFaction, Vector3.new(78 + (i % 2) * 5, 0, -22 + i * 5), math.rad(-90))
		end
	end
	if #eReinf >= 2 then
		for i, tplId in ipairs(eReinf[2].units) do
			WorldSimService.spawnUnit(tplId, 1, mission.enemyFaction, Vector3.new(74 + (i % 2) * 5, 0, 12 + i * 5), math.rad(-90))
		end
	end
	if #eReinf >= 3 then
		WorldSimService.spawnUnit(eReinf[3].units[1], 1, mission.enemyFaction, Vector3.new(92, 0, 0), math.rad(-90))
	end

	NetProtocol.fireAllClients(NetProtocol.EVENTS.BattleBannerBroadcast, {
		team = 0,
		title = mission.title,
		subtitle = mission.theater .. " — Capture the tactical sectors!",
	})
end

local function spawnVehicleWreck(unit: UnitEntity)
	if not wrecksFolder then
		return
	end
	local w = makePart(
		wrecksFolder,
		"Wreck_" .. unit.name,
		Vector3.new(8.2, 3.0, 13.8),
		CFrame.new(unit.pos + Vector3.new(0, 1.5, 0)) * CFrame.Angles(0, unit.yaw, math.rad(4)),
		Color3.fromRGB(32, 30, 28),
		Enum.Material.CorrodedMetal,
		false
	)
	local fire = Instance.new("Fire")
	fire.Size = 9
	fire.Heat = 12
	fire.Parent = w

	local smoke = Instance.new("Smoke")
	smoke.Color = Color3.fromRGB(45, 45, 45)
	smoke.Opacity = 0.65
	smoke.Size = 8
	smoke.Parent = w

	Debris:AddItem(w, 18)
end

function WorldSimService.handleUnitElimination(victim: UnitEntity, killer: UnitEntity?)
	if victim.kind == "vehicle" then
		spawnVehicleWreck(victim)
	end
	if victim.model then
		victim.model:Destroy()
		victim.model = nil
	end
	WorldSimService.units[victim.id] = nil

	if killer then
		killer.kills += 1
		killer.veterancy = math.min(3, math.floor(killer.kills / 2))
		if killer.team == 0 then
			ProfileStoreService.addStats(
				nil,
				if victim.kind == "vehicle" then 65 else 20,
				if victim.kind == "infantry" then 1 else 0,
				if victim.kind == "vehicle" then 1 else 0,
				0,
				0
			)
		end
	end
end

function WorldSimService.fireWeaponAt(shooter: UnitEntity, target: UnitEntity, weaponId: string)
	local weapon = WarOfMenCatalog.WEAPONS[weaponId]
	if not weapon then
		return
	end

	-- Orientar torreta o soldado hacia el objetivo
	local dir = target.pos - shooter.pos
	if dir.Magnitude > 0.1 then
		local desiredYaw = math.atan2(dir.X, dir.Z)
		shooter.turretYaw = desiredYaw
		if shooter.kind == "infantry" then
			shooter.yaw = desiredYaw
		end
	end

	local shotResult, splashHits = BallisticsCombatService.resolveShot(shooter, target, weapon, WorldSimService.units)
	if shotResult.damageDealt > 0 then
		target.hp = math.max(0, target.hp - shotResult.damageDealt)
		if target.hp <= 0 then
			shotResult.targetDestroyed = true
			WorldSimService.handleUnitElimination(target, shooter)
		end
	end

	for _, sh in ipairs(splashHits) do
		local u = sh.unit
		if u and u.hp > 0 then
			u.hp = math.max(0, u.hp - sh.splashDamage)
			if u.hp <= 0 then
				WorldSimService.handleUnitElimination(u, shooter)
			end
		end
	end

	NetProtocol.fireAllClients(NetProtocol.EVENTS.CombatShotBroadcast, shotResult)
end

function WorldSimService.stepSimulation(dt: number)
	if WorldSimService.matchOver then
		return
	end

	WorldSimService.tickCount += 1
	WorldSimService.elapsedTime += dt

	-- 1. Reducir enfriamientos de refuerzos y sumar Manpower (MP)
	for team = 0, 1 do
		local cdMap = WorldSimService.reinfCooldowns[team]
		for rId, rem in pairs(cdMap) do
			if rem > 0 then
				cdMap[rId] = math.max(0, rem - dt)
			end
		end
	end

	local ownedFlags = { [0] = 0, [1] = 0 }
	for _, fl in ipairs(WorldSimService.flags) do
		if fl.owner == 0 or fl.owner == 1 then
			ownedFlags[fl.owner] += 1
		end
	end

	for team = 0, 1 do
		local incomePerSec = 10 + ownedFlags[team] * 5.5
		WorldSimService.teamMp[team] = math.min(999, WorldSimService.teamMp[team] + incomePerSec * dt)
	end

	-- Drenaje de Puntos de Victoria (VP) si un bando domina más banderas
	if ownedFlags[0] > ownedFlags[1] then
		WorldSimService.teamVp[1] = math.max(0, WorldSimService.teamVp[1] - (ownedFlags[0] - ownedFlags[1]) * 3.2 * dt)
	elseif ownedFlags[1] > ownedFlags[0] then
		WorldSimService.teamVp[0] = math.max(0, WorldSimService.teamVp[0] - (ownedFlags[1] - ownedFlags[0]) * 3.2 * dt)
	end

	if WorldSimService.teamVp[1] <= 0 or WorldSimService.teamVp[0] <= 0 then
		WorldSimService.matchOver = true
		WorldSimService.winnerTeam = if WorldSimService.teamVp[0] > WorldSimService.teamVp[1] then 0 else 1
		NetProtocol.fireAllClients(NetProtocol.EVENTS.BattleBannerBroadcast, {
			team = WorldSimService.winnerTeam,
			title = if WorldSimService.winnerTeam == 0 then "ALLIED TACTICAL VICTORY!" else "AXIS TACTICAL VICTORY!",
			subtitle = "Sector supremacy achieved — Starting new operation in 8s...",
		})
		task.delay(8, function()
			if WorldSimService.matchOver then
				WorldSimService.loadMission(WorldSimService.currentMissionId)
			end
		end)
		return
	end

	-- 2. Actualizar Unidades (Movimiento, Cobertura, Postura y Disparo)
	for _, u in pairs(WorldSimService.units) do
		if u.hp > 0 then
			-- Evaluar cobertura cercana para infantería
			if u.kind == "infantry" then
				local nearCover = false
				for _, cPos in ipairs(WorldSimService.coverPositions) do
					if (u.pos - cPos).Magnitude <= 10.5 then
						nearCover = true
						break
					end
				end
				u.inCover = nearCover
			end

			local isMoving = false
			if u.targetPos and os.clock() > u.directControlUntil then
				local delta = Vector3.new(u.targetPos.X - u.pos.X, 0, u.targetPos.Z - u.pos.Z)
				local dist = delta.Magnitude
				if dist > 1.4 then
					isMoving = true
					local dir = delta.Unit
					local postureSpeedMult = if u.posture == "prone"
						then 0.45
						elseif u.posture == "crouch" then 0.75
						else 1.0
					local step = math.min(dist, u.speed * postureSpeedMult * dt)
					local nextPos = u.pos + dir * step
					-- Evitar caer al agua fuera del puente central o los vados norte/sur
					if math.abs(nextPos.X) < 13 and math.abs(nextPos.Z) > 13 and math.abs(math.abs(nextPos.Z) - 68) > 11 then
						-- Redirigir hacia el puente o vado más cercano
						local targetFordZ = if math.abs(nextPos.Z) < 38 then 0 elseif nextPos.Z > 0 then 68 else -68
						local redirectDir = Vector3.new(0, 0, targetFordZ - u.pos.Z)
						if redirectDir.Magnitude > 0.1 then
							nextPos = u.pos + redirectDir.Unit * step
						end
					end
					u.pos = Vector3.new(math.clamp(nextPos.X, -155, 155), 0, math.clamp(nextPos.Z, -108, 108))
					u.yaw = math.atan2(dir.X, dir.Z)
					if not u.targetUnitId then
						u.turretYaw = u.yaw
					end
				else
					u.targetPos = nil
					-- Si llega a cobertura, agacharse automáticamente
					if u.kind == "infantry" and u.inCover and u.posture == "stand" then
						u.posture = "crouch"
					end
				end
			end

			-- Combate y Enfriamiento de Armas
			u.cooldownTimer = math.max(0, u.cooldownTimer - dt)
			u.secondaryCooldown = math.max(0, u.secondaryCooldown - dt)

			if u.fireMode ~= "hold" and os.clock() > u.directControlUntil then
				local weapon = WarOfMenCatalog.WEAPONS[u.weaponId]
				if weapon then
					local target = if u.targetUnitId then WorldSimService.units[u.targetUnitId] else nil
					if not target or target.hp <= 0 or (target.pos - u.pos).Magnitude > weapon.range * 1.1 then
						u.targetUnitId = nil
						target = nil
					end

					if target then
						local d = (target.pos - u.pos).Magnitude
						if d <= weapon.range then
							local aimDir = target.pos - u.pos
							if aimDir.Magnitude > 0.1 then
								u.turretYaw = math.atan2(aimDir.X, aimDir.Z)
								if u.kind == "infantry" and not isMoving then
									u.yaw = u.turretYaw
								end
							end
							if u.cooldownTimer <= 0 then
								u.cooldownTimer = weapon.cooldown
								WorldSimService.fireWeaponAt(u, target, u.weaponId)
							end
						elseif not u.targetPos then
							-- Acercarse hasta entrar en rango de tiro
							u.targetPos = target.pos
						end
					end

					-- Ametralladora coaxial secundaria de tanques
					if u.secondaryWeaponId and u.secondaryCooldown <= 0 and target and target.hp > 0 then
						local secWep = WarOfMenCatalog.WEAPONS[u.secondaryWeaponId]
						if secWep and (target.pos - u.pos).Magnitude <= secWep.range then
							u.secondaryCooldown = secWep.cooldown
							WorldSimService.fireWeaponAt(u, target, u.secondaryWeaponId)
						end
					end
				end
			end

			updateUnitModelTransform(u, dt, isMoving)
		end
	end

	-- 3. Captura de Banderas Estratégicas
	for _, fl in ipairs(WorldSimService.flags) do
		local count0 = 0
		local count1 = 0
		for _, u in pairs(WorldSimService.units) do
			if u.hp > 0 and (u.pos - fl.pos).Magnitude <= 18 then
				if u.team == 0 then
					count0 += if u.kind == "vehicle" then 2 else 1
				else
					count1 += if u.kind == "vehicle" then 2 else 1
				end
			end
		end

		local prevOwner = fl.owner
		if count0 > count1 then
			fl.captureProgress = math.min(100, fl.captureProgress + (count0 - count1) * 14 * dt)
		elseif count1 > count0 then
			fl.captureProgress = math.max(-100, fl.captureProgress - (count1 - count0) * 14 * dt)
		end

		if fl.captureProgress >= 65 then
			fl.owner = 0
		elseif fl.captureProgress <= -65 then
			fl.owner = 1
		elseif math.abs(fl.captureProgress) < 20 then
			fl.owner = -1
		end

		if fl.owner ~= prevOwner and (fl.owner == 0 or fl.owner == 1) then
			if fl.owner == 0 then
				ProfileStoreService.addStats(nil, 45, 0, 0, 1, 0)
			end
			NetProtocol.fireAllClients(NetProtocol.EVENTS.BattleBannerBroadcast, {
				team = fl.owner,
				title = string.format("SECTOR CAPTURED: %s", string.upper(fl.name)),
				subtitle = if fl.owner == 0 then "Allied forces hold the sector!" else "Enemy forces seized the sector!",
			})
		end

		if fl.model then
			local bColor = if fl.owner == 0
				then Color3.fromRGB(52, 198, 98)
				elseif fl.owner == 1 then Color3.fromRGB(235, 68, 60)
				else Color3.fromRGB(240, 210, 90)
			local cloth = fl.model:FindFirstChild("FlagCloth") :: BasePart?
			if cloth then
				cloth.Color = bColor
			end
			local ring = fl.model:FindFirstChild("CaptureZoneRing") :: BasePart?
			if ring then
				ring.Color = bColor
			end
			local pole = fl.model:FindFirstChild("FlagPole")
			local gui = if pole then pole:FindFirstChild("FlagHud") else nil
			local lbl = if gui then gui:FindFirstChild("Title") :: TextLabel? else nil
			if lbl then
				lbl.Text = string.format("⚑ %s (%d%%)", fl.name, math.abs(math.floor(fl.captureProgress)))
			end
		end
	end
end

function WorldSimService.buildStateSnapshot()
	local unitList = {}
	for _, u in pairs(WorldSimService.units) do
		table.insert(unitList, {
			id = u.id,
			templateId = u.templateId,
			name = u.name,
			team = u.team,
			faction = u.faction,
			kind = u.kind,
			role = u.role,
			hp = u.hp,
			maxHp = u.maxHp,
			pos = u.pos,
			targetPos = u.targetPos,
			yaw = u.yaw,
			turretYaw = u.turretYaw,
			posture = u.posture,
			fireMode = u.fireMode,
			inCover = u.inCover,
			weaponId = u.weaponId,
			kills = u.kills,
			veterancy = u.veterancy,
		})
	end

	local flagList = {}
	for _, f in ipairs(WorldSimService.flags) do
		table.insert(flagList, {
			id = f.id,
			name = f.name,
			pos = f.pos,
			owner = f.owner,
			captureProgress = math.floor(f.captureProgress),
		})
	end

	return {
		missionId = WorldSimService.currentMissionId,
		missionTitle = WorldSimService.missionDef.title,
		playerFaction = WorldSimService.missionDef.playerFaction,
		enemyFaction = WorldSimService.missionDef.enemyFaction,
		elapsedTime = math.floor(WorldSimService.elapsedTime),
		teamMp = { [0] = math.floor(WorldSimService.teamMp[0]), [1] = math.floor(WorldSimService.teamMp[1]) },
		teamVp = { [0] = math.floor(WorldSimService.teamVp[0]), [1] = math.floor(WorldSimService.teamVp[1]) },
		reinfCooldowns = WorldSimService.reinfCooldowns[0],
		playerBotMode = WorldSimService.playerBotMode,
		flags = flagList,
		units = unitList,
	}
end

return WorldSimService
