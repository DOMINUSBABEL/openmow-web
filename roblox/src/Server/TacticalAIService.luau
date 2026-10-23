--!strict
--[[
	TacticalAIService.luau
	Inteligencia Artificial Táctica Balanceada para "War of Men":
	  1. Adquisición de blancos por prioridad balística respetando siempre las órdenes explícitas del jugador
	  2. Comandante IA del Eje/Oponente (Team 1): avance táctico por sectores y oleadas balanceadas
	  3. Player-Bot Asistente (Team 0): modos OFF, DEFEND y ATTACK (solo para unidades sin orden manual activa)
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))
local WorldSimService = require(ServerScriptService:WaitForChild("WorldSimService"))

local TacticalAIService = {}

local aiTimer = 0
local commanderTimer = 0
local reinfTimer = 0

local function acquireBestTarget(u: WorldSimService.UnitEntity)
	if u.fireMode == "hold" then
		return
	end
	local weapon = WarOfMenCatalog.WEAPONS[u.weaponId]
	if not weapon then
		return
	end

	-- Si el jugador le asignó un blanco explícito y sigue vivo, respetarlo al 100%
	if u.hasExplicitTarget and u.targetUnitId then
		local explicitTarget = WorldSimService.units[u.targetUnitId]
		if explicitTarget and explicitTarget.hp > 0 then
			return
		end
		u.hasExplicitTarget = false
	end

	-- Si ya tiene un objetivo automático válido dentro de rango, mantenerlo
	if u.targetUnitId then
		local existing = WorldSimService.units[u.targetUnitId]
		if existing and existing.hp > 0 and (existing.pos - u.pos).Magnitude <= weapon.range then
			return
		end
	end

	local bestTargetId: number? = nil
	local bestScore = -999999

	for _, other in pairs(WorldSimService.units) do
		if other.team ~= u.team and other.hp > 0 then
			local dist = (other.pos - u.pos).Magnitude
			if dist <= weapon.range then
				local score = 200 - dist
				if other.kind == "vehicle" then
					if weapon.category == "cannon" or weapon.category == "at_rocket" then
						score += 140
					else
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

	local targetFlag = flags[2] or flags[1]
	for _, fl in ipairs(flags) do
		if aggressive then
			if fl.id == "flag_center" and fl.owner ~= team then
				targetFlag = fl
				break
			elseif fl.owner ~= team then
				targetFlag = fl
				break
			end
		else
			if fl.owner == team or fl.id == "flag_center" then
				targetFlag = fl
				break
			end
		end
	end

	local movedCount = 0
	local maxAdvanceBatch = if team == 1 then 6 else 12

	for _, u in pairs(WorldSimService.units) do
		if u.team == team and u.hp > 0 and os.clock() > u.directControlUntil then
			-- Nunca sobreescribir unidades controladas u ordenadas explícitamente por el jugador
			if team == 0 and u.hasExplicitOrder then
				continue
			end
			if not u.targetPos and not u.targetUnitId then
				local distToFlag = (u.pos - targetFlag.pos).Magnitude
				if distToFlag > 20 then
					local spread = Vector3.new((math.random() - 0.5) * 24, 0, (math.random() - 0.5) * 24)
					u.targetPos = targetFlag.pos + spread
					movedCount += 1
					if movedCount >= maxAdvanceBatch then
						break
					end
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
	local countVehicles = 0
	for _, u in pairs(WorldSimService.units) do
		if u.team == team and u.hp > 0 then
			countTeam += 1
			if u.kind == "vehicle" then
				countVehicles += 1
			end
		end
	end
	if countTeam >= 13 then
		return
	end

	local reinfList = WarOfMenCatalog.getReinforcementsForFaction(faction)
	if #reinfList == 0 then
		return
	end

	-- Evitar spamear tanques si ya hay 2 vehículos en el campo
	local choice = reinfList[1]
	if countVehicles < 2 and mp >= 270 and #reinfList >= 3 and math.random() < 0.45 then
		choice = reinfList[3]
	elseif #reinfList >= 2 and math.random() < 0.5 then
		choice = reinfList[2]
	end

	WorldSimService.spawnReinforcement(team, choice.id)
end

function TacticalAIService.stepAI(dt: number)
	if WorldSimService.matchOver then
		return
	end

	aiTimer += dt
	commanderTimer += dt
	reinfTimer += dt

	if aiTimer >= 0.25 then
		aiTimer = 0
		for _, u in pairs(WorldSimService.units) do
			if u.hp > 0 then
				acquireBestTarget(u)
			end
		end
	end

	if commanderTimer >= 4.0 then
		commanderTimer = 0
		issueCommanderOrdersForTeam(1, true)
		if WorldSimService.playerBotMode ~= "OFF" then
			issueCommanderOrdersForTeam(0, WorldSimService.playerBotMode == "ATTACK")
		end
	end

	if reinfTimer >= 11.5 then
		reinfTimer = 0
		local mission = WorldSimService.missionDef
		tryCallAIReinforcement(1, mission.enemyFaction, 185)
		if WorldSimService.playerBotMode ~= "OFF" then
			tryCallAIReinforcement(0, mission.playerFaction, 185)
		end
	end
end

return TacticalAIService
