--!strict
--[[
	TacticalAIService.luau
	Inteligencia Artificial Táctica para "War of Men":
	  1. Adquisición de blancos por prioridad balística para todas las unidades (Team 0 y Team 1)
	  2. Comandante IA del Eje/Oponente (Team 1): despliegue de oleadas y captura de banderas
	  3. Player-Bot Asistente (Team 0): modos OFF, DEFEND y ATTACK
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))
local WorldSimService = require(ServerScriptService:WaitForChild("WorldSimService"))

local TacticalAIService = {}

local aiTimer = 0
local commanderTimer = 0

local function acquireBestTarget(u: WorldSimService.UnitEntity)
	if u.fireMode == "hold" then
		return
	end
	local weapon = WarOfMenCatalog.WEAPONS[u.weaponId]
	if not weapon then
		return
	end

	-- Si ya tiene un objetivo válido dentro de rango, mantenerlo
	if u.targetUnitId then
		local existing = WorldSimService.units[u.targetUnitId]
		if existing and existing.hp > 0 and (existing.pos - u.pos).Magnitude <= weapon.range * 1.05 then
			return
		end
	end

	local bestTargetId: number? = nil
	local bestScore = -999999

	for _, other in pairs(WorldSimService.units) do
		if other.team ~= u.team and other.hp > 0 then
			local dist = (other.pos - u.pos).Magnitude
			if dist <= weapon.range * 1.12 then
				local score = 200 - dist
				if other.kind == "vehicle" then
					if weapon.category == "cannon" or weapon.category == "at_rocket" then
						score += 140
					else
						-- Armas ligeras evitan disparar a tanques si hay infantería
						score -= 220
					end
				else
					if weapon.category == "mg" or weapon.category == "small_arms" then
						score += 65
					end
				end
				if score > bestScore then
					bestScore = score
					bestTargetId = other.id
				end
			end
		end
	end

	if bestTargetId and bestScore > -100 then
		u.targetUnitId = bestTargetId
	end
end

local function issueCommanderOrdersForTeam(team: number, aggressive: boolean)
	local flags = WorldSimService.flags
	if #flags == 0 then
		return
	end

	-- Seleccionar bandera objetivo
	local targetFlag = flags[2] or flags[1]
	for _, fl in ipairs(flags) do
		if aggressive then
			if fl.owner ~= team then
				targetFlag = fl
				break
			end
		else
			-- Modo defensivo: proteger banderas propias o la central
			if fl.owner == team or fl.id == "flag_center" then
				targetFlag = fl
				break
			end
		end
	end

	for _, u in pairs(WorldSimService.units) do
		if u.team == team and u.hp > 0 and os.clock() > u.directControlUntil then
			if not u.targetPos and not u.targetUnitId then
				local distToFlag = (u.pos - targetFlag.pos).Magnitude
				if distToFlag > 22 then
					local spread = Vector3.new((math.random() - 0.5) * 22, 0, (math.random() - 0.5) * 22)
					u.targetPos = targetFlag.pos + spread
				end
			end
		end
	end
end

local function tryCallAIReinforcement(team: number, faction: WarOfMenCatalog.FactionId, minMpReserve: number)
	local mp = WorldSimService.teamMp[team] or 0
	if mp < minMpReserve then
		return
	end

	local countTeam = 0
	for _, u in pairs(WorldSimService.units) do
		if u.team == team and u.hp > 0 then
			countTeam += 1
		end
	end
	if countTeam >= 22 then
		return
	end

	local reinfList = WarOfMenCatalog.getReinforcementsForFaction(faction)
	if #reinfList == 0 then
		return
	end

	-- Si tiene suficiente MP para un tanque y hay pocos vehículos, priorizar blindado
	local choice = reinfList[math.random(1, #reinfList)]
	if mp >= 260 and #reinfList >= 4 and math.random() < 0.55 then
		choice = reinfList[4]
	elseif mp >= 170 and #reinfList >= 3 and math.random() < 0.5 then
		choice = reinfList[3]
	end

	WorldSimService.spawnReinforcement(team, choice.id)
end

function TacticalAIService.stepAI(dt: number)
	if WorldSimService.matchOver then
		return
	end

	aiTimer += dt
	commanderTimer += dt

	if aiTimer >= 0.30 then
		aiTimer = 0
		for _, u in pairs(WorldSimService.units) do
			if u.hp > 0 then
				acquireBestTarget(u)
			end
		end
	end

	if commanderTimer >= 2.5 then
		commanderTimer = 0
		local mission = WorldSimService.missionDef

		-- IA Comandante Enemigo (Team 1)
		tryCallAIReinforcement(1, mission.enemyFaction, 115)
		issueCommanderOrdersForTeam(1, true)

		-- IA Asistente del Jugador (Team 0 si Player-Bot está activo)
		if WorldSimService.playerBotMode ~= "OFF" then
			tryCallAIReinforcement(0, mission.playerFaction, 160)
			issueCommanderOrdersForTeam(0, WorldSimService.playerBotMode == "ATTACK")
		end
	end
end

return TacticalAIService
