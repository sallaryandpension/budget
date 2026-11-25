# Raises the app version everywhere it appears, so a release never mixes old and new files:
#   js/main.js (APP_VERSION), index.html (?v= on every css/js link), sw.js (CACHE name and file list),
#   version.json (what open apps check to offer "יש גרסה חדשה").
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File bump-version.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$enc = New-Object Text.UTF8Encoding $false
$mainPath = Join-Path $root 'js\main.js'
$main = [IO.File]::ReadAllText($mainPath)
$m = [regex]::Match($main, 'const APP_VERSION = (\d+);')
if (-not $m.Success) { throw 'APP_VERSION not found in js/main.js' }
$old = [int]$m.Groups[1].Value; $new = $old + 1

[IO.File]::WriteAllText($mainPath, $main.Replace("const APP_VERSION = $old;", "const APP_VERSION = $new;"), $enc)

$idxPath = Join-Path $root 'index.html'
$idx = [regex]::Replace([IO.File]::ReadAllText($idxPath), '((?:href="css|src="js)/[a-z]+\.(?:css|js))\?v=\d+"', "`$1?v=$new`"")
[IO.File]::WriteAllText($idxPath, $idx, $enc)

$swPath = Join-Path $root 'sw.js'
$sw = [IO.File]::ReadAllText($swPath)
$sw = [regex]::Replace($sw, "const CACHE = 'budget-v\d+';", "const CACHE = 'budget-v$new';")
$sw = [regex]::Replace($sw, "(\./(?:css|js)/[a-z]+\.(?:css|js))\?v=\d+'", "`$1?v=$new'")
[IO.File]::WriteAllText($swPath, $sw, $enc)

[IO.File]::WriteAllText((Join-Path $root 'version.json'), "{ `"version`": $new }`n", $enc)

# Check that every place now carries the new number
$checks = @{
  'index.html' = ([regex]::Matches($idx, "\?v=$new`"").Count)
  'sw.js'      = ([regex]::Matches($sw, "\?v=$new'").Count)
}
"Version $old -> $new  (index.html links: $($checks['index.html']), sw.js files: $($checks['sw.js']))"
