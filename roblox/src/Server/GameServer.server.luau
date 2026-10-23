--!nocheck
--[[
	GameServer.server.luau
	Orquestador Principal de Servidor para "War of Men" (Roblox Engine).
	Conecta todos los eventos tácticos (RTS + Direct Control), gestiona
	perfiles de comandante y ejecuta el bucle de simulación a 20 Hz.
]]

if _G.WarOfMenServerStarted then
	return
end
_G.WarOfMenServerStarted = true

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))
local NetProtocol = require(Shared:WaitForChild("NetProtocol"))

local WorldSimService = require(ServerScriptService:WaitForChild("WorldSimService"))
local TacticalAIService = require(ServerScriptService:WaitForChild("TacticalAIService"))
local ProfileStoreService = require(ServerScriptService:WaitForChild("ProfileStoreService"))

NetProtocol.ensureRemotesFolder()
NetProtocol.ensureStudioBusFolder()

-- Cargar la misión inicial (Omaha Beachhead — Sector Charlie)
WorldSimService.loadMission("usa_normandy")

-- 1. Orden de Movimiento en Formación (Clic derecho sobre terreno)
NetProtocol.onServerEvent(NetProtocol.EVENTS.IssueMoveOrder, function(_player, payload)
	if type(payload) ~= "table" or type(payload.unitIds) ~= "table" or typeof(payload.targetPos) ~= "Vector3" then
		return
	end
	local ids = payload.unitIds
	local dest: Vector3 = payload.targetPos
	local count = #ids
	local cols = math.max(1, math.ceil(math.sqrt(count)))
	local spacing = 5.5

	for idx, rawId in ipairs(ids) do
		local u = WorldSimService.units[tonumber(rawId) or -1]
		if u and u.hp > 0 and u.team == 0 then
			local r = math.floor((idx - 1) / cols)
			local c = (idx - 1) % cols
			local offset = Vector3.new((c - (cols - 1) * 0.5) * spacing, 0, r * spacing)
			u.targetPos = Vector3.new(
				math.clamp(dest.X + offset.X, -152, 152),
				0,
				math.clamp(dest.Z + offset.Z, -104, 104)
			)
			u.targetUnitId = nil
		end
	end
end)

-- 2. Orden de Ataque Concentrado (Clic derecho sobre enemigo)
NetProtocol.onServerEvent(NetProtocol.EVENTS.IssueAttackOrder, function(_player, payload)
	if type(payload) ~= "table" or type(payload.unitIds) ~= "table" then
		return
	end
	local targetId = tonumber(payload.targetUnitId) or -1
	local target = WorldSimService.units[targetId]
	if not target or target.hp <= 0 then
		return
	end

	for _, rawId in ipairs(payload.unitIds) do
		local u = WorldSimService.units[tonumber(rawId) or -1]
		if u and u.hp > 0 and u.team == 0 then
			u.targetUnitId = targetId
			local wep = WarOfMenCatalog.WEAPONS[u.weaponId]
			if wep and (target.pos - u.pos).Magnitude > wep.range * 0.92 then
				u.targetPos = target.pos
			else
				u.targetPos = nil
			end
		end
	end
end)

-- 3. Orden de Cambio de Postura (stand / crouch / prone)
NetProtocol.onServerEvent(NetProtocol.EVENTS.SetPostureOrder, function(_player, payload)
	if type(payload) ~= "table" or type(payload.unitIds) ~= "table" then
		return
	end
	local posture = tostring(payload.posture or "stand")
	if posture ~= "stand" and posture ~= "crouch" and posture ~= "prone" then
		return
	end
	for _, rawId in ipairs(payload.unitIds) do
		local u = WorldSimService.units[tonumber(rawId) or -1]
		if u and u.hp > 0 and u.team == 0 and u.kind == "infantry" then
			u.posture = posture
		end
	end
end)

-- 4. Orden de Modo de Fuego (free / hold / return)
NetProtocol.onServerEvent(NetProtocol.EVENTS.SetFireModeOrder, function(_player, payload)
	if type(payload) ~= "table" or type(payload.unitIds) ~= "table" then
		return
	end
	local mode = tostring(payload.fireMode or "free")
	if mode ~= "free" and mode ~= "hold" and mode ~= "return" then
		return
	end
	for _, rawId in ipairs(payload.unitIds) do
		local u = WorldSimService.units[tonumber(rawId) or -1]
		if u and u.hp > 0 and u.team == 0 then
			u.fireMode = mode
			if mode == "hold" then
				u.targetUnitId = nil
			end
		end
	end
end)

-- 5. Despliegue de Refuerzos por Puntos de Mando (MP)
NetProtocol.onServerEvent(NetProtocol.EVENTS.CallReinforcementOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local reinfId = tostring(payload.reinfId or "")
	if reinfId ~= "" then
		WorldSimService.spawnReinforcement(0, reinfId)
	end
end)

-- 6. Selección de Escaramuza / Mapa (15 Misiones)
NetProtocol.onServerEvent(NetProtocol.EVENTS.SelectMissionOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local missionId = tostring(payload.missionId or "usa_normandy")
	WorldSimService.loadMission(missionId)
end)

-- 7. Alternar Modo Player-Bot (OFF / DEFEND / ATTACK)
NetProtocol.onServerEvent(NetProtocol.EVENTS.ToggleBotModeOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local mode = tostring(payload.mode or "OFF")
	if mode == "OFF" or mode == "DEFEND" or mode == "ATTACK" then
		WorldSimService.playerBotMode = mode
	end
end)

-- 8. Reiniciar Escaramuza Actual
NetProtocol.onServerEvent(NetProtocol.EVENTS.ResetSkirmishOrder, function()
	WorldSimService.loadMission(WorldSimService.currentMissionId)
end)

-- 9. Control Directo en 3ra Persona: Movimiento y Apuntado de Torreta
NetProtocol.onServerEvent(NetProtocol.EVENTS.DirectControlMoveOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local unitId = tonumber(payload.unitId) or -1
	local u = WorldSimService.units[unitId]
	if not u or u.hp <= 0 or u.team ~= 0 then
		return
	end
	u.directControlUntil = os.clock() + 0.65
	u.targetPos = nil

	if typeof(payload.aimPoint) == "Vector3" then
		local aimDir = payload.aimPoint - u.pos
		if aimDir.Magnitude > 0.2 then
			u.turretYaw = math.atan2(aimDir.X, aimDir.Z)
			if u.kind == "infantry" then
				u.yaw = u.turretYaw
			end
		end
	end

	if typeof(payload.moveVec) == "Vector3" and payload.moveVec.Magnitude > 0.05 then
		local mv = Vector3.new(payload.moveVec.X, 0, payload.moveVec.Z).Unit
		local nextPos = u.pos + mv * (u.speed * 0.12)
		u.pos = Vector3.new(math.clamp(nextPos.X, -154, 154), 0, math.clamp(nextPos.Z, -106, 106))
		if u.kind == "vehicle" then
			u.yaw = math.atan2(mv.X, mv.Z)
		end
	end
end)

-- 10. Control Directo en 3ra Persona: Disparo Manual hacia Retícula
NetProtocol.onServerEvent(NetProtocol.EVENTS.DirectControlFireOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local unitId = tonumber(payload.unitId) or -1
	local u = WorldSimService.units[unitId]
	if not u or u.hp <= 0 or u.team ~= 0 then
		return
	end
	if u.cooldownTimer > 0 then
		return
	end
	local weapon = WarOfMenCatalog.WEAPONS[u.weaponId]
	if not weapon then
		return
	end
	u.directControlUntil = os.clock() + 0.8
	u.cooldownTimer = weapon.cooldown * 0.85

	local aimPoint: Vector3 = if typeof(payload.aimPoint) == "Vector3"
		then payload.aimPoint
		else (u.pos + Vector3.new(math.sin(u.turretYaw) * 60, 0, math.cos(u.turretYaw) * 60))

	local bestEnemy = nil
	local bestDist = 26
	for _, other in pairs(WorldSimService.units) do
		if other.team ~= u.team and other.hp > 0 then
			local d = (other.pos - aimPoint).Magnitude
			if d < bestDist then
				bestDist = d
				bestEnemy = other
			end
		end
	end

	if bestEnemy then
		WorldSimService.fireWeaponAt(u, bestEnemy, u.weaponId)
	else
		NetProtocol.fireAllClients(NetProtocol.EVENTS.CombatShotBroadcast, {
			shooterId = u.id,
			targetId = -1,
			weaponId = u.weaponId,
			fromPos = u.pos + Vector3.new(0, if u.kind == "vehicle" then 3.6 else 2.6, 0),
			toPos = aimPoint + Vector3.new(0, 1.5, 0),
			outcome = "MISS",
			armorFace = "BODY",
			impactAngleDeg = 0,
			penetrationMm = weapon.penetration.d50,
			effectiveArmorMm = 0,
			damageDealt = 0,
			targetDestroyed = false,
			heRadius = weapon.heRadius,
		})
	end
end)

-- Sincronización de perfiles al entrar jugadores
Players.PlayerAdded:Connect(function(player)
	task.defer(function()
		local prof = ProfileStoreService.getProfile(player.UserId)
		NetProtocol.fireClient(NetProtocol.EVENTS.SyncPlayerProfile, player, prof)
		NetProtocol.fireClient(NetProtocol.EVENTS.SyncBattleState, player, WorldSimService.buildStateSnapshot())
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	ProfileStoreService.saveProfile(player.UserId)
end)

-- Bucle Principal de Simulación a 20 Hz + Broadcast a Clientes
local simAccum = 0
local syncAccum = 0

RunService.Heartbeat:Connect(function(dt)
	local clampedDt = math.min(dt, 0.1)
	simAccum += clampedDt
	syncAccum += clampedDt

	if simAccum >= 0.05 then
		local stepDt = simAccum
		simAccum = 0
		WorldSimService.stepSimulation(stepDt)
		TacticalAIService.stepAI(stepDt)
	end

	if syncAccum >= 0.15 then
		syncAccum = 0
		local snap = WorldSimService.buildStateSnapshot()
		NetProtocol.fireAllClients(NetProtocol.EVENTS.SyncBattleState, snap)
	end
end)

print("[War of Men Server] Initialized 20Hz Tactical RTS + Direct Control Simulation.")
