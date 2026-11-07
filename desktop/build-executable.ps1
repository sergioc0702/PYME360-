[CmdletBinding()]
param(
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontendRoot = Join-Path $projectRoot 'typescript-model'
$serverRoot = Join-Path $projectRoot 'server'
$buildRoot = Join-Path $projectRoot '.build\desktop'
$environmentRoot = Join-Path $buildRoot 'python-env'
$pythonInEnvironment = Join-Path $environmentRoot 'Scripts\python.exe'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$applicationVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim()
$releaseDirectory = Join-Path $projectRoot 'outputs\releases'
$executablePath = Join-Path $releaseDirectory 'Pyme360.exe'

if (-not $pythonCommand) {
    throw 'Instala Python 3.11 o superior para construir la aplicación de escritorio.'
}
$pythonVersionCode = & $pythonCommand.Source -c 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'
if ($LASTEXITCODE -ne 0 -or [int]$pythonVersionCode -lt 311) {
    throw "El constructor necesita Python 3.11 o superior. Detectado: $pythonVersionCode"
}

New-Item -ItemType Directory -Path $buildRoot, $releaseDirectory -Force | Out-Null

if (-not $SkipFrontendBuild) {
    Push-Location $frontendRoot
    try {
        Write-Host 'Compilando React y TypeScript…'
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'La compilación React/TypeScript falló.' }
    }
    finally {
        Pop-Location
    }
}

$frontendBuild = Join-Path $frontendRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $frontendBuild 'index.html') -PathType Leaf)) {
    throw 'No existe typescript-model/dist/index.html. Compila el frontend antes de empaquetar.'
}

if (-not (Test-Path -LiteralPath $pythonInEnvironment -PathType Leaf)) {
    & $pythonCommand.Source -m venv $environmentRoot
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno aislado de construcción.' }
}
Write-Host 'Instalando herramientas de empaquetado en el entorno aislado…'
& $pythonInEnvironment -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar PyInstaller y pywebview.' }

$iconPath = Join-Path $frontendRoot 'public\pyme360-mark-light.png'
$iconOutput = Join-Path $buildRoot 'Pyme360.ico'
& $pythonInEnvironment -c "from PIL import Image; Image.open(r'$iconPath').convert('RGBA').save(r'$iconOutput', format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $iconOutput -PathType Leaf)) {
    throw 'No se pudo convertir el logotipo a un icono de Windows.'
}

$pyinstaller = Join-Path $environmentRoot 'Scripts\pyinstaller.exe'
$desktopEntry = Join-Path $PSScriptRoot 'launcher.py'
$workPath = Join-Path $buildRoot 'onefile-work'
$specPath = Join-Path $buildRoot 'onefile-spec'
$packageArguments = @(
    '--noconfirm',
    '--clean',
    '--windowed',
    '--onefile',
    '--name', 'Pyme360',
    '--distpath', $releaseDirectory,
    '--workpath', $workPath,
    '--specpath', $specPath,
    '--paths', $serverRoot,
    '--collect-all', 'webview',
    '--collect-all', 'clr_loader',
    '--hidden-import', 'pythonnet',
    '--add-data', "$($frontendRoot)\dist;typescript-model/dist",
    '--add-data', "$($serverRoot)\serve-local.py;server",
    '--add-data', "$($serverRoot)\electronic_invoicing.py;server",
    '--add-data', "$($serverRoot)\environment_benchmarks.py;server",
    '--add-data', "$($serverRoot)\sync_local.py;server",
    '--add-data', "$($serverRoot)\benchmark-data\official_snapshots.template.csv;server/benchmark-data",
    '--icon', $iconOutput,
    $desktopEntry
)

Write-Host "Empaquetando Pyme360 $applicationVersion como ejecutable portable…"
& $pyinstaller @packageArguments
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller no pudo crear Pyme360.exe.' }
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw 'PyInstaller terminó sin crear el ejecutable esperado.'
}

$hash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash
Write-Host "Ejecutable listo: $executablePath"
Write-Host "SHA-256: $hash"
