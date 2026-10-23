--!nocheck
--[[
	GameServer.server.luau
	Orquestador Principal de Servidor para "War of Men" (Roblox Engine).
	Conecta todos los eventos tácticos (RTS + Direct Control), desactiva el
	personaje por defecto de Roblox para que no interfiera con la cámara/controles RTS,
	y ejecuta el bucle de simulación y sincronización a 20 Hz.
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

local function broadcastSnapshotNow()
	NetProtocol.fireAllClients(NetProtocol.EVENTS.SyncBattleState, WorldSimService.buildStateSnapshot())
end

-- 1. Orden de Movimiento en Formación / Parada Táctica / Retirada
NetProtocol.onServerEvent(NetProtocol.EVENTS.IssueMoveOrder, function(_player, payload)
	if type(payload) ~= "table" or type(payload.unitIds) ~= "table" then
		return
	end
	local ids = payload.unitIds

	-- Parada táctica inmediata (Hold Position / Stop [S])
	if payload.holdPosition == true then
		for _, rawId in ipairs(ids) do
			local u = WorldSimService.units[tonumber(rawId) or -1]
			if u and u.hp > 0 and u.team == 0 then
				u.targetPos = nil
				u.hasExplicitOrder = true
				u.hasExplicitTarget = false
			end
		end
		broadcastSnapshotNow()
		return
	end

	if typeof(payload.targetPos) ~= "Vector3" then
		return
	end
	local dest: Vector3 = payload.targetPos
	local count = #ids
	local cols = math.max(1, math.ceil(math.sqrt(count)))
	local spacing = 5.5

	for idx, rawId in ipairs(ids) do
		local u = WorldSimService.units[tonumber(rawId) or -1]
		if u and u.hp > 0 and u.team == 0 then
			local r = math.floor((idx - 1) / cols)
			local c = (idx - 1) % cols
			local offset = Vector3.new((c - (cols - 1) * 0.5) * spacing, 0, (r - (math.ceil(count / cols) - 1) * 0.5) * spacing)
			u.targetPos = Vector3.new(
				math.clamp(dest.X + offset.X, -152, 152),
				0,
				math.clamp(dest.Z + offset.Z, -104, 104)
			)
			u.hasExplicitOrder = true
			if not payload.attackMove then
				u.hasExplicitTarget = false
				u.targetUnitId = nil
			end
		end
	end
	broadcastSnapshotNow()
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
			u.hasExplicitTarget = true
			u.hasExplicitOrder = true
			local wep = WarOfMenCatalog.WEAPONS[u.weaponId]
			if wep and (target.pos - u.pos).Magnitude > wep.range * 0.92 then
				u.targetPos = target.pos
			else
				u.targetPos = nil
			end
		end
	end
	broadcastSnapshotNow()
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
			WorldSimService.syncUnitModelImmediate(u, false)
		end
	end
	broadcastSnapshotNow()
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
				u.hasExplicitTarget = false
			end
		end
	end
	broadcastSnapshotNow()
end)

-- 5. Despliegue de Refuerzos por Puntos de Mando (MP)
NetProtocol.onServerEvent(NetProtocol.EVENTS.CallReinforcementOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local reinfId = tostring(payload.reinfId or "")
	if reinfId ~= "" then
		WorldSimService.spawnReinforcement(0, reinfId)
		broadcastSnapshotNow()
	end
end)

-- 6. Selección de Escaramuza / Mapa (15 Misiones)
NetProtocol.onServerEvent(NetProtocol.EVENTS.SelectMissionOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local missionId = tostring(payload.missionId or "usa_normandy")
	WorldSimService.loadMission(missionId)
	broadcastSnapshotNow()
end)

-- 7. Alternar Modo Player-Bot (OFF / DEFEND / ATTACK)
NetProtocol.onServerEvent(NetProtocol.EVENTS.ToggleBotModeOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local mode = tostring(payload.mode or "OFF")
	if mode == "OFF" or mode == "DEFEND" or mode == "ATTACK" then
		WorldSimService.playerBotMode = mode
		broadcastSnapshotNow()
	end
end)

-- 8. Reiniciar Escaramuza Actual
NetProtocol.onServerEvent(NetProtocol.EVENTS.ResetSkirmishOrder, function()
	WorldSimService.loadMission(WorldSimService.currentMissionId)
	broadcastSnapshotNow()
end)

-- 9. Control Directo en 3ra Persona: Movimiento Fluido y Apuntado de Torreta
NetProtocol.onServerEvent(NetProtocol.EVENTS.DirectControlMoveOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local unitId = tonumber(payload.unitId) or -1
	local u = WorldSimService.units[unitId]
	if not u or u.hp <= 0 or u.team ~= 0 then
		return
	end
	u.directControlUntil = os.clock() + 0.85
	u.hasExplicitOrder = true
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

	local isMoving = false
	if typeof(payload.moveVec) == "Vector3" and payload.moveVec.Magnitude > 0.05 then
		isMoving = true
		local mv = Vector3.new(payload.moveVec.X, 0, payload.moveVec.Z).Unit
		local dtStep = math.clamp(tonumber(payload.dt) or 0.05, 0.016, 0.12)
		local postureMult = if u.posture == "prone" then 0.5 elseif u.posture == "crouch" then 0.8 else 1.05
		local nextPos = u.pos + mv * (u.speed * postureMult * dtStep)
		u.pos = Vector3.new(math.clamp(nextPos.X, -154, 154), 0, math.clamp(nextPos.Z, -106, 106))
		if u.kind == "vehicle" then
			u.yaw = math.atan2(mv.X, mv.Z)
		end
	end

	WorldSimService.syncUnitModelImmediate(u, isMoving)
end)

-- 10. Control Directo en 3ra Persona: Disparo Manual con Cono Balístico
NetProtocol.onServerEvent(NetProtocol.EVENTS.DirectControlFireOrder, function(_player, payload)
	if type(payload) ~= "table" then
		return
	end
	local unitId = tonumber(payload.unitId) or -1
	local u = WorldSimService.units[unitId]
	if not u or u.hp <= 0 or u.team ~= 0 then
		return
	end

	local useSecondary = payload.secondary == true and u.secondaryWeaponId ~= nil
	local chosenWeaponId = if useSecondary then (u.secondaryWeaponId :: string) else u.weaponId
	local weapon = WarOfMenCatalog.WEAPONS[chosenWeaponId]
	if not weapon then
		return
	end

	if useSecondary then
		if u.secondaryCooldown > 0 then
			return
		end
		u.secondaryCooldown = weapon.cooldown * 0.75
	else
		if u.cooldownTimer > 0 then
			return
		end
		u.cooldownTimer = weapon.cooldown * 0.80
	end

	u.directControlUntil = os.clock() + 0.9
	u.hasExplicitOrder = true

	local aimPoint: Vector3 = if typeof(payload.aimPoint) == "Vector3"
		then payload.aimPoint
		else (u.pos + Vector3.new(math.sin(u.turretYaw) * weapon.range, 0, math.cos(u.turretYaw) * weapon.range))

	local aimVec = Vector3.new(aimPoint.X - u.pos.X, 0, aimPoint.Z - u.pos.Z)
	local aimDir = if aimVec.Magnitude > 0.1 then aimVec.Unit else Vector3.new(math.sin(u.turretYaw), 0, math.cos(u.turretYaw))
	u.turretYaw = math.atan2(aimDir.X, aimDir.Z)
	if u.kind == "infantry" then
		u.yaw = u.turretYaw
	end

	-- Buscar blanco enemigo cercano al punto de mira O dentro del cono/línea de tiro
	local bestEnemy = nil
	local bestScore = 999999
	local maxRange = weapon.range * 1.18

	for _, other in pairs(WorldSimService.units) do
		if other.team ~= u.team and other.hp > 0 then
			local toEnemy = Vector3.new(other.pos.X - u.pos.X, 0, other.pos.Z - u.pos.Z)
			local distFromShooter = toEnemy.Magnitude
			local distToCursor = (other.pos - aimPoint).Magnitude
			if distToCursor <= 16 and distFromShooter <= maxRange then
				if distToCursor < bestScore then
					bestScore = distToCursor
					bestEnemy = other
				end
			elseif distFromShooter <= maxRange and distFromShooter > 0.5 then
				local proj = toEnemy:Dot(aimDir)
				if proj > 0 then
					local perpDist = (toEnemy - aimDir * proj).Magnitude
					local hitRadius = if other.kind == "vehicle" then 8.5 else 5.0
					if perpDist <= hitRadius then
						local score = perpDist * 3 + math.abs(distFromShooter - aimVec.Magnitude) * 0.25
						if score < bestScore then
							bestScore = score
							bestEnemy = other
						end
					end
				end
			end
		end
	end

	if bestEnemy then
		WorldSimService.fireWeaponAt(u, bestEnemy, chosenWeaponId)
	else
		local clampedTarget = if aimVec.Magnitude > weapon.range
			then (u.pos + aimDir * weapon.range)
			else aimPoint
		NetProtocol.fireAllClients(NetProtocol.EVENTS.CombatShotBroadcast, {
			shooterId = u.id,
			targetId = -1,
			weaponId = chosenWeaponId,
			fromPos = u.pos + Vector3.new(0, if u.kind == "vehicle" then 3.6 else 2.6, 0),
			toPos = clampedTarget + Vector3.new(0, 1.5, 0),
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

-- Neutralizar el avatar por defecto de Roblox (invisible y anclado bajo tierra con WalkSpeed = 0)
-- para que StarterGui/StarterPlayerScripts carguen siempre al 100%, pero el avatar no interfiera en la batalla
local function neutralizeDefaultCharacter(char: Model)
	task.defer(function()
		for _, inst in ipairs(char:GetDescendants()) do
			if inst:IsA("BasePart") then
				inst.Transparency = 1
				inst.CanCollide = false
				inst.CanQuery = false
				inst.Anchored = true
			elseif inst:IsA("Decal") or inst:IsA("Accessory") then
				pcall(function()
					inst:Destroy()
				end)
			elseif inst:IsA("Humanoid") then
				inst.WalkSpeed = 0
				inst.JumpPower = 0
				inst.JumpHeight = 0
			end
		end
		if char.PrimaryPart then
			char:PivotTo(CFrame.new(0, -180, 0))
		end
	end)
end

-- Sincronización de perfiles al entrar jugadores
local function setupPlayer(player: Player)
	player.CharacterAdded:Connect(neutralizeDefaultCharacter)
	if player.Character then
		neutralizeDefaultCharacter(player.Character)
	end
	task.defer(function()
		local prof = ProfileStoreService.getProfile(player.UserId)
		NetProtocol.fireClient(NetProtocol.EVENTS.SyncPlayerProfile, player, prof)
		NetProtocol.fireClient(NetProtocol.EVENTS.SyncBattleState, player, WorldSimService.buildStateSnapshot())
	end)
end

Players.PlayerAdded:Connect(setupPlayer)
for _, p in ipairs(Players:GetPlayers()) do
	setupPlayer(p)
end

Players.PlayerRemoving:Connect(function(player)
	ProfileStoreService.saveProfile(player.UserId)
end)

-- Bucle Principal de Simulación y Sincronización a 20 Hz
local simAccum = 0

RunService.Heartbeat:Connect(function(dt)
	local clampedDt = math.min(dt, 0.1)
	simAccum += clampedDt

	if simAccum >= 0.05 then
		local stepDt = simAccum
		simAccum = 0
		WorldSimService.stepSimulation(stepDt)
		TacticalAIService.stepAI(stepDt)
		local snap = WorldSimService.buildStateSnapshot()
		NetProtocol.fireAllClients(NetProtocol.EVENTS.SyncBattleState, snap)
	end
end)

print("[War of Men Server] Initialized 20Hz Tactical RTS + Direct Control Simulation.")
