# Builds the files of a release from the payload folders (see installer/offline and installer/win7), with the checksums:
#   powershell -File scripts\release\build-release.ps1 -Version 2.2.0 -Out <folder> -Repo <owner/name>
# The payloads are made first by installer/offline/build-payload.mjs (the Windows 10/11 setups) and
# installer/win7/build-win7-payload.mjs (the Windows 7 setup).
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Cache = (Join-Path $PSScriptRoot "..\..\node_modules\.cache")
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$tag = "v$Version"
$base = "https://github.com/$Repo/releases/download/$tag/"
New-Item -ItemType Directory -Force $Out | Out-Null
$build = Join-Path $root "installer\gui\build-gui-installer.mjs"
$work = Join-Path $env:TEMP "release-$Version"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work | Out-Null

# the Windows 10 and 11 setups: the whole classroom, and the students' tools alone
node $build --version $Version --payload "$Cache\gui-payload" --out "$work\classroom"
node $build --version $Version --payload "$Cache\gui-payload-student" --edition student --out "$work\student"
Copy-Item "$work\classroom\ClassroomSetup.exe", "$work\student\ClassTools-Setup.exe" $Out -Force

# the small setup that downloads: its list names this release for the files that are the project's own
node (Join-Path $root "installer\online\make-online-manifest.mjs") --payload "$Cache\gui-payload" --release-base $base --out "$work\online.json"
node $build --version $Version --online "$work\online.json" --out "$work\online"
Copy-Item "$work\online\ClassroomSetup-Online.exe" $Out -Force
foreach ($own in "app.zip", "excalidraw-bridge-*.vsix", "indra-wheels-*.zip", "indra-models-*.zip") {
  Get-ChildItem "$Cache\gui-payload" -Filter $own | Copy-Item -Destination $Out -Force
}

# the Windows 7 setup: a small program with its files in a folder beside it, as one zip
node $build --version $Version --win7 --folder --payload "$Cache\win7-payload" --out "$work\win7"
& "$env:SystemRoot\System32\tar.exe" -a -c -f "$Out\ClassroomSetup-Win7.zip" -C "$work\win7" "ClassroomSetup-Win7.exe" "payload"

# the sums, the file the publisher reads
$lines = Get-ChildItem $Out -File | Where-Object { $_.Name -notlike "SHA256SUMS*" } | Sort-Object Name | ForEach-Object {
  "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()) *$($_.Name)"
}
Set-Content (Join-Path $Out "SHA256SUMS-$tag.txt") $lines -Encoding ascii
$lines
