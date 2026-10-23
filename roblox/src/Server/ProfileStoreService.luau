--!strict
--[[
	ProfileStoreService.luau
	Persistencia de Comandante en DataStoreService ("WarOfMen_CommanderProfile_v1")
	con fallback en memoria para sesiones en Roblox Studio sin API de terceros.
]]

local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local NetProtocol = require(Shared:WaitForChild("NetProtocol"))

local ProfileStoreService = {}

export type CommanderProfile = {
	userId: number,
	rankLevel: number,
	rankTitle: string,
	xp: number,
	victories: number,
	infantryEliminated: number,
	armorDestroyed: number,
	flagsCaptured: number,
}

local RANKS = {
	{ level = 1, xp = 0, title = "2nd Lieutenant" },
	{ level = 2, xp = 300, title = "1st Lieutenant" },
	{ level = 3, xp = 800, title = "Captain" },
	{ level = 4, xp = 1600, title = "Major" },
	{ level = 5, xp = 2800, title = "Lieutenant Colonel" },
	{ level = 6, xp = 4500, title = "Colonel" },
	{ level = 7, xp = 7000, title = "Brigadier General" },
	{ level = 8, xp = 11000, title = "Major General" },
	{ level = 9, xp = 17000, title = "Field Marshal" },
}

local profiles: { [number]: CommanderProfile } = {}
local store: GlobalDataStore? = nil

pcall(function()
	store = DataStoreService:GetDataStore("WarOfMen_CommanderProfile_v1")
end)

local function computeRank(xp: number): (number, string)
	local lvl = 1
	local title = "2nd Lieutenant"
	for _, r in ipairs(RANKS) do
		if xp >= r.xp then
			lvl = r.level
			title = r.title
		end
	end
	return lvl, title
end

function ProfileStoreService.getProfile(userId: number): CommanderProfile
	if profiles[userId] then
		return profiles[userId]
	end
	local defaultProfile: CommanderProfile = {
		userId = userId,
		rankLevel = 1,
		rankTitle = "2nd Lieutenant",
		xp = 0,
		victories = 0,
		infantryEliminated = 0,
		armorDestroyed = 0,
		flagsCaptured = 0,
	}
	if store and userId > 0 then
		local ok, saved = pcall(function()
			return store:GetAsync("cmd_" .. tostring(userId))
		end)
		if ok and type(saved) == "table" then
			defaultProfile.xp = tonumber(saved.xp) or 0
			defaultProfile.victories = tonumber(saved.victories) or 0
			defaultProfile.infantryEliminated = tonumber(saved.infantryEliminated) or 0
			defaultProfile.armorDestroyed = tonumber(saved.armorDestroyed) or 0
			defaultProfile.flagsCaptured = tonumber(saved.flagsCaptured) or 0
			local lvl, title = computeRank(defaultProfile.xp)
			defaultProfile.rankLevel = lvl
			defaultProfile.rankTitle = title
		end
	end
	profiles[userId] = defaultProfile
	return defaultProfile
end

function ProfileStoreService.addStats(
	player: Player?,
	xpDelta: number,
	killsDelta: number,
	armorDelta: number,
	flagsDelta: number,
	victoryDelta: number
)
	local uid = if player then player.UserId else 0
	local p = ProfileStoreService.getProfile(uid)
	p.xp += xpDelta
	p.infantryEliminated += killsDelta
	p.armorDestroyed += armorDelta
	p.flagsCaptured += flagsDelta
	p.victories += victoryDelta
	local lvl, title = computeRank(p.xp)
	p.rankLevel = lvl
	p.rankTitle = title

	NetProtocol.fireClient(NetProtocol.EVENTS.SyncPlayerProfile, player, p)
end

function ProfileStoreService.saveProfile(userId: number)
	local p = profiles[userId]
	if not p or not store or userId <= 0 then
		return
	end
	pcall(function()
		store:SetAsync("cmd_" .. tostring(userId), p)
	end)
end

return ProfileStoreService
