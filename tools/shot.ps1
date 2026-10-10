param([string]$Url, [string]$Out, [int]$Budget = 20000)
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$Out = [System.IO.Path]::GetFullPath($Out)
Remove-Item -Force $Out -ErrorAction SilentlyContinue
$prof = Join-Path $env:TEMP ("omw-chrome-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $prof -Force | Out-Null
try {
  & $chrome --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader `
    --user-data-dir=$prof --no-first-run --hide-scrollbars --disk-cache-size=1 `
    --virtual-time-budget=$Budget --window-size=1280,800 --screenshot=$Out $Url 2>&1 | Out-Null
} finally {
  Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
}
if (Test-Path $Out) { "saved $Out" } else { "FAILED" }
