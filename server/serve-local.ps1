param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "serve-local.py"
$pythonLauncher = Get-Command "py" -ErrorAction SilentlyContinue
$pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue

if ($null -ne $pythonLauncher) {
    if ($NoBrowser) { & $pythonLauncher.Source -3 $scriptPath --no-browser }
    else { & $pythonLauncher.Source -3 $scriptPath }
    exit $LASTEXITCODE
}

if ($null -ne $pythonCommand) {
    if ($NoBrowser) { & $pythonCommand.Source $scriptPath --no-browser }
    else { & $pythonCommand.Source $scriptPath }
    exit $LASTEXITCODE
}

Write-Host "Pyme360 necesita Python 3.11 o superior para guardar los datos en SQLite." -ForegroundColor Yellow
Write-Host "Instálalo desde https://www.python.org/downloads/ y vuelve a abrir el lanzador."
exit 1
