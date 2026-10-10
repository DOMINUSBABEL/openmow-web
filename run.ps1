# OpenMoW-Web launcher: builds the web client (if needed) and starts the localhost server.
# Usage:  .\run.ps1            -> build + serve on http://127.0.0.1:8080
#         .\run.ps1 -NoBuild   -> serve only
param([switch]$NoBuild, [int]$Port = 8080)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $NoBuild) {
  Push-Location "$root\web"
  if (-not (Test-Path node_modules)) { npm install }
  npm run build
  Pop-Location
}
Write-Host "Abriendo http://127.0.0.1:$Port  (Ctrl+C para detener)"
python "$root\tools\server\main.py" --port $Port
