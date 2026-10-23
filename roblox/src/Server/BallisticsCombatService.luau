--!strict
--[[
	BallisticsCombatService.luau
	Motor balístico GEM2 en servidor para "War of Men":
	  - Curvas de penetración por distancia (10m, 50m, 100m, 200m)
	  - Blindaje direccional (Front / Side / Rear / Top)
	  - Cálculo de ángulo de incidencia y rebote automático a >= 70° (RICOCHET)
	  - Modificadores de postura (stand / crouch / prone) y cobertura táctica
	  - Daño en área HE (High Explosive) de artillería, tanques y cohetes AT
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local WarOfMenCatalog = require(Shared:WaitForChild("WarOfMenCatalog"))

local BallisticsCombatService = {}

export type ShotResult = {
	shooterId: number,
	targetId: number,
	weaponId: string,
	fromPos: Vector3,
	toPos: Vector3,
	outcome: "HIT" | "MISS" | "PENETRATED" | "PARTIAL" | "BOUNCED" | "RICOCHET",
	armorFace: "FRONT" | "SIDE" | "REAR" | "BODY",
	impactAngleDeg: number,
	penetrationMm: number,
	effectiveArmorMm: number,
	damageDealt: number,
	targetDestroyed: boolean,
	heRadius: number,
}

function BallisticsCombatService.resolveShot(
	shooter: any,
	target: any,
	weapon: WarOfMenCatalog.WeaponDef,
	allUnits: { [number]: any }
): (ShotResult, { { unit: any, splashDamage: number } })
	local fromPos: Vector3 = shooter.pos + Vector3.new(0, if shooter.kind == "vehicle" then 3.6 else 2.6, 0)
	local targetHeight = if target.kind == "vehicle"
		then 2.8
		elseif target.posture == "prone" then 0.9
		elseif target.posture == "crouch" then 1.8
		else 2.7
	local toPos: Vector3 = target.pos + Vector3.new(0, targetHeight, 0)
	local delta = toPos - fromPos
	local distStuds = math.max(1, delta.Magnitude)

	local splashHits: { { unit: any, splashDamage: number } } = {}

	if target.kind == "vehicle" and target.armor then
		-- Arma ligera sin penetración suficiente contra blindados
		local penMm = WarOfMenCatalog.getPenetrationAtDistance(weapon, distStuds) * (0.92 + math.random() * 0.16)
		local incVec = Vector3.new(fromPos.X - toPos.X, 0, fromPos.Z - toPos.Z)
		if incVec.Magnitude < 0.01 then
			incVec = Vector3.new(0, 0, 1)
		else
			incVec = incVec.Unit
		end

		local yaw = target.yaw or 0
		local fwd = Vector3.new(math.sin(yaw), 0, math.cos(yaw))
		local right = Vector3.new(math.cos(yaw), 0, -math.sin(yaw))

		local dotFwd = fwd:Dot(incVec)
		local armorFace: "FRONT" | "SIDE" | "REAR" = "SIDE"
		local baseArmor = target.armor.side
		local normalVec = right

		if dotFwd > 0.52 then
			armorFace = "FRONT"
			baseArmor = target.armor.front
			normalVec = fwd
		elseif dotFwd < -0.52 then
			armorFace = "REAR"
			baseArmor = target.armor.rear
			normalVec = -fwd
		else
			armorFace = "SIDE"
			baseArmor = target.armor.side
			normalVec = if right:Dot(incVec) >= 0 then right else -right
		end

		local cosTheta = math.clamp(math.abs(normalVec:Dot(incVec)), 0.08, 1.0)
		local angleDeg = math.floor(math.deg(math.acos(cosTheta)) + 0.5)
		local effectiveArmor = math.floor((baseArmor / cosTheta) + 0.5)

		local outcome: "PENETRATED" | "PARTIAL" | "BOUNCED" | "RICOCHET" = "BOUNCED"
		local damage = 0

		if weapon.category == "small_arms" or weapon.category == "mg" then
			outcome = "BOUNCED"
			damage = 0
		elseif angleDeg >= 70 then
			outcome = "RICOCHET"
			damage = 0
		elseif penMm >= effectiveArmor then
			outcome = "PENETRATED"
			damage = math.floor(weapon.damage * (0.92 + math.random() * 0.22))
		elseif penMm >= effectiveArmor * 0.78 then
			outcome = "PARTIAL"
			damage = math.floor(weapon.damage * 0.30)
		else
			outcome = "BOUNCED"
			damage = 0
		end

		local result: ShotResult = {
			shooterId = shooter.id,
			targetId = target.id,
			weaponId = weapon.id,
			fromPos = fromPos,
			toPos = toPos,
			outcome = outcome,
			armorFace = armorFace,
			impactAngleDeg = angleDeg,
			penetrationMm = math.floor(penMm + 0.5),
			effectiveArmorMm = effectiveArmor,
			damageDealt = damage,
			targetDestroyed = false,
			heRadius = weapon.heRadius,
		}
		return result, splashHits
	else
		-- Disparo contra Infantería
		local postureMult = 1.0
		local hitProb = 0.76
		if target.posture == "crouch" then
			postureMult = 0.76
			hitProb = 0.56
		elseif target.posture == "prone" then
			postureMult = 0.52
			hitProb = 0.38
		end

		if target.inCover then
			hitProb *= 0.68
			postureMult *= 0.75
		end

		-- Penalización por distancia
		local distRatio = math.clamp(distStuds / math.max(40, weapon.range), 0, 1.15)
		hitProb = math.clamp(hitProb * (1.12 - distRatio * 0.48), 0.16, 0.92)

		local outcome: "HIT" | "MISS" = "MISS"
		local damage = 0

		if math.random() <= hitProb or weapon.heRadius > 0 then
			outcome = "HIT"
			local rawDmg = if weapon.heDamage > 0 then weapon.heDamage else weapon.damage
			damage = math.max(6, math.floor(rawDmg * postureMult * (0.88 + math.random() * 0.24)))
		else
			-- Desvío visual del trazador en caso de fallo
			toPos = toPos + Vector3.new((math.random() - 0.5) * 4.5, (math.random() - 0.3) * 2.2, (math.random() - 0.5) * 4.5)
		end

		-- Daño HE en área (cañones y cohetes AT contra escuadras)
		if weapon.heRadius > 0 then
			for _, other in pairs(allUnits) do
				if other.id ~= target.id and other.hp > 0 and other.team ~= shooter.team and other.kind == "infantry" then
					local d = (other.pos - target.pos).Magnitude
					if d <= weapon.heRadius then
						local falloff = 1 - (d / (weapon.heRadius + 1))
						local sDmg = math.max(8, math.floor(weapon.heDamage * falloff * 0.75))
						table.insert(splashHits, { unit = other, splashDamage = sDmg })
					end
				end
			end
		end

		local result: ShotResult = {
			shooterId = shooter.id,
			targetId = target.id,
			weaponId = weapon.id,
			fromPos = fromPos,
			toPos = toPos,
			outcome = outcome,
			armorFace = "BODY",
			impactAngleDeg = 0,
			penetrationMm = weapon.penetration.d50,
			effectiveArmorMm = 0,
			damageDealt = damage,
			targetDestroyed = false,
			heRadius = weapon.heRadius,
		}
		return result, splashHits
	end
end

return BallisticsCombatService
