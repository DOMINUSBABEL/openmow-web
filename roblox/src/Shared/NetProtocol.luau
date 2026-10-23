--!nocheck
--[[
	NetProtocol.luau
	Protocolo de comunicación Cliente <-> Servidor para "War of Men" (Roblox Engine).
	Soporta tanto servidores en vivo / Play Mode (RemoteEvent) como ejecución
	interactiva en vivo dentro del visor de Roblox Studio Edit Mode (BindableEvent StudioBus).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local NetProtocol = {}

NetProtocol.FOLDER_NAME = "WarOfMenRemotes"
NetProtocol.BUS_FOLDER_NAME = "WarOfMenStudioBus"

NetProtocol.EVENTS = {
	-- Órdenes del Jugador (Client -> Server)
	IssueMoveOrder = "IssueMoveOrder",
	IssueAttackOrder = "IssueAttackOrder",
	SetPostureOrder = "SetPostureOrder",
	SetFireModeOrder = "SetFireModeOrder",
	CallReinforcementOrder = "CallReinforcementOrder",
	SelectMissionOrder = "SelectMissionOrder",
	ToggleBotModeOrder = "ToggleBotModeOrder",
	DirectControlFireOrder = "DirectControlFireOrder",
	DirectControlMoveOrder = "DirectControlMoveOrder",
	ResetSkirmishOrder = "ResetSkirmishOrder",

	-- Difusión del Servidor (Server -> Client)
	SyncBattleState = "SyncBattleState",
	CombatShotBroadcast = "CombatShotBroadcast",
	BattleBannerBroadcast = "BattleBannerBroadcast",
	SyncPlayerProfile = "SyncPlayerProfile",
}

function NetProtocol.isStudioEdit(): boolean
	local ok, res = pcall(function()
		return RunService:IsStudio() and not RunService:IsRunning()
	end)
	return ok and res == true
end

function NetProtocol.ensureRemotesFolder(): Folder
	local folder = ReplicatedStorage:FindFirstChild(NetProtocol.FOLDER_NAME)
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = NetProtocol.FOLDER_NAME
		folder.Parent = ReplicatedStorage
	end
	for _, evName in pairs(NetProtocol.EVENTS) do
		if not folder:FindFirstChild(evName) then
			local re = Instance.new("RemoteEvent")
			re.Name = evName
			re.Parent = folder
		end
	end
	return folder
end

function NetProtocol.ensureStudioBusFolder(): Folder
	local folder = ReplicatedStorage:FindFirstChild(NetProtocol.BUS_FOLDER_NAME)
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = NetProtocol.BUS_FOLDER_NAME
		folder.Parent = ReplicatedStorage
	end
	for _, evName in pairs(NetProtocol.EVENTS) do
		if not folder:FindFirstChild(evName) then
			local be = Instance.new("BindableEvent")
			be.Name = evName
			be.Parent = folder
		end
	end
	return folder
end

function NetProtocol.getEvent(eventName: string): RemoteEvent
	local folder = NetProtocol.ensureRemotesFolder()
	local ev = folder:FindFirstChild(eventName)
	if not ev then
		ev = Instance.new("RemoteEvent")
		ev.Name = eventName
		ev.Parent = folder
	end
	return ev
end

function NetProtocol.getBusEvent(eventName: string): BindableEvent
	local folder = NetProtocol.ensureStudioBusFolder()
	local be = folder:FindFirstChild(eventName)
	if not be then
		be = Instance.new("BindableEvent")
		be.Name = eventName
		be.Parent = folder
	end
	return be
end

-- Helper universal para enviar desde el Cliente al Servidor
function NetProtocol.fireServer(eventName: string, payload: any)
	if NetProtocol.isStudioEdit() then
		NetProtocol.getBusEvent(eventName):Fire(nil, payload)
	else
		NetProtocol.getEvent(eventName):FireServer(payload)
	end
end

-- Helper universal para escuchar en el Servidor eventos del Cliente
function NetProtocol.onServerEvent(eventName: string, callback: (Player?, any) -> ())
	if NetProtocol.isStudioEdit() then
		NetProtocol.getBusEvent(eventName).Event:Connect(callback)
	else
		NetProtocol.getEvent(eventName).OnServerEvent:Connect(callback)
	end
end

-- Helper universal para enviar desde el Servidor a todos los Clientes
function NetProtocol.fireAllClients(eventName: string, payload: any)
	if NetProtocol.isStudioEdit() then
		NetProtocol.getBusEvent(eventName):Fire(payload)
	else
		NetProtocol.getEvent(eventName):FireAllClients(payload)
	end
end

-- Helper universal para enviar desde el Servidor a un Cliente específico
function NetProtocol.fireClient(eventName: string, player: Player?, payload: any)
	if NetProtocol.isStudioEdit() then
		NetProtocol.getBusEvent(eventName):Fire(payload)
	elseif player then
		NetProtocol.getEvent(eventName):FireClient(player, payload)
	end
end

-- Helper universal para escuchar en el Cliente eventos del Servidor
function NetProtocol.onClientEvent(eventName: string, callback: (any) -> ())
	if NetProtocol.isStudioEdit() then
		NetProtocol.getBusEvent(eventName).Event:Connect(callback)
	else
		NetProtocol.getEvent(eventName).OnClientEvent:Connect(callback)
	end
end

return NetProtocol
