param(
    [string]$Mission,
    [string]$OutName,
    [int]$Budget = 40000
)

$encoded = [System.Uri]::EscapeDataString($Mission)
$url = "http://127.0.0.1:8080/map.html?m=$encoded"
$outPath = Join-Path (Get-Location) $OutName
Write-Host "Capturing $url -> $outPath (budget: $Budget ms)..."
& .\tools\shot.ps1 -Url $url -Out $outPath -Budget $Budget
