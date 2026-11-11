<#
.SYNOPSIS
  Sets up the editor for the whiteboard: finds or installs VS Code or
  VSCodium, makes the "excalidraw" profile, and puts the bridge and the
  teacher's language extensions in it (D-364 to D-367).

.DESCRIPTION
  This is the engine. The page's link (Open-SetupLink.ps1) and the downloaded
  installer (ExcalidrawSetup.cmd) both run it, and a teacher can run it by hand.

  What it does, in this order:

    1. it finds the editor - VS Code, VSCodium, or the one that was asked for;
    2. it installs the editor when there is none: winget, then scoop, then the
       editor's own installer downloaded directly and checked against the
       checksum its publisher gives. Nothing needs the administrator;
    3. it makes the profile when there is none, and uses it when there is;
    4. it puts the bridge in the profile (from a .vsix), and the language
       extensions the teacher ticked - an extension that is there is updated;
    5. it opens the editor on the profile.

  There is no driver step: the whiteboard does not use a virtual display
  (D-329), and nothing here asks Windows for the administrator (D-518).

  -Mode Plan says all of that and changes nothing. -Mode Run does it. The
  answers are lines of plain text, or - with -Json - one JSON object per line.

  It never installs the editor without -Yes: -Mode Run without it
  stops after the plan and says so. The helper that is opened by the page shows
  the plan and asks first; this script is what it runs after the teacher says
  yes.

  PowerShell 5.1 compatible: no null-coalescing operator, no ternary operator.
  ASCII only: a file without a byte-order mark is read as the machine's own
  code page.

.PARAMETER Mode
  Plan | Run | Profile | ParseLink | Detect | SelfTest

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File EditorSetup.ps1 -Mode Plan

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File EditorSetup.ps1 -Mode Run -Editor codium -Yes
#>

[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Run', 'Profile', 'ParseLink', 'Detect', 'SelfTest')]
  [string]$Mode = 'Plan',
  [ValidateSet('auto', 'code', 'codium')]
  [string]$Editor = 'auto',
  [string]$ProfileName = 'excalidraw',
  # the language groups of the checklist: python, cpp, java, js
  [string]$Groups = 'python,cpp,java,js',
  [string]$VsixPath = '',
  [string]$VsixUrl = '',
  [string]$Folder = '',
  [string]$Link = '',
  # the editor's own folders, for a throwaway run (a test, the sandbox)
  [string]$UserDataDir = '',
  [string]$ExtensionsDir = '',
  # the rungs of the install that may be used: winget,scoop,direct
  [string]$Ladder = 'winget,scoop,direct',
  [switch]$Yes,
  [switch]$Json,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------------------
# what is known
# ---------------------------------------------------------------------------

# The two editors. Both are Inno Setup programs, so the same silent switches
# install either, for the user alone.
$Editors = @{
  code   = @{
    Key        = 'code'
    Name       = 'Visual Studio Code'
    Cli        = 'code'
    Winget     = 'Microsoft.VisualStudioCode'
    Scoop      = 'vscode'
    DataFolder = 'Code'
    Candidates = @(
      '%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd',
      '%ProgramFiles%\Microsoft VS Code\bin\code.cmd',
      '%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd'
    )
    ProcessName = 'Code'
  }
  codium = @{
    Key        = 'codium'
    Name       = 'VSCodium'
    Cli        = 'codium'
    Winget     = 'VSCodium.VSCodium'
    Scoop      = 'vscodium'
    DataFolder = 'VSCodium'
    Candidates = @(
      '%LOCALAPPDATA%\Programs\VSCodium\bin\codium.cmd',
      '%ProgramFiles%\VSCodium\bin\codium.cmd',
      '%ProgramFiles(x86)%\VSCodium\bin\codium.cmd'
    )
    ProcessName = 'VSCodium'
  }
}

# The checklist. Microsoft's C and C++ extension is not on the open store that
# VSCodium uses, so there the same group is clangd and LLDB. JavaScript and
# TypeScript are built into both editors, and so is their debugger.
$Groups_ = [ordered]@{
  python = @{ Label = 'Python';                   code = @('ms-python.python', 'ms-python.debugpy'); codium = @('ms-python.python', 'ms-python.debugpy') }
  cpp    = @{ Label = 'C and C++';                code = @('ms-vscode.cpptools');                    codium = @('llvm-vs-code-extensions.vscode-clangd', 'vadimcn.vscode-lldb') }
  java   = @{ Label = 'Java';                     code = @('redhat.java', 'vscjava.vscode-java-debug', 'vscjava.vscode-java-test', 'vscjava.vscode-maven'); codium = @('redhat.java', 'vscjava.vscode-java-debug', 'vscjava.vscode-java-test', 'vscjava.vscode-maven') }
  js     = @{ Label = 'JavaScript and TypeScript'; code = @();                                       codium = @() }
}

$BridgeId = 'excalidraw-teacher-help.excalidraw-bridge'

# ---------------------------------------------------------------------------
# saying things
# ---------------------------------------------------------------------------

function Say {
  param([string]$Step, [string]$Status, [string]$Text, $Data = $null)

  if ($Json) {
    $line = [ordered]@{ step = $Step; status = $Status; text = $Text }

    if ($null -ne $Data) {
      $line['data'] = $Data
    }

    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $line -Depth 8 -Compress))
  }
  else {
    # to the console, and not to the pipeline: a function's pipeline output is
    # its RETURN VALUE, and the run's exit code is one
    [Console]::Out.WriteLine(('[{0}] {1}: {2}' -f $Status, $Step, $Text))

    if ($null -ne $Data -and $Step -eq 'plan') {
      [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Data -Depth 8))
    }
  }

  [Console]::Out.Flush()
}

function Expand([string]$Path) {
  return [Environment]::ExpandEnvironmentVariables($Path)
}

# ---------------------------------------------------------------------------
# the link (D-364)
# ---------------------------------------------------------------------------

# A link comes from a web page, and any page may make one: it is read against
# a closed list, and what is not on the list is refused - not ignored.
# excalidraw-setup://install?editor=codium&profile=excalidraw&groups=python,java
#   &vsix=http://127.0.0.1:3061/setup/excalidraw-bridge.vsix
function Resolve-Link {
  param([string]$Text)

  $result = [ordered]@{ ok = $false; reason = ''; options = [ordered]@{} }

  # The browser hands over what it made of the link, and Chrome puts a slash after the name: install/? as well as install?
  # Both are the same link. What is wrong is said with what came, so that a person can see it.
  $Text = $Text.Trim().Trim('"')

  if ($Text -notmatch '^excalidraw-setup:(//)?install/?\?(?<query>.*)$') {
    $shown = $(if ($Text.Length -gt 80) { $Text.Substring(0, 80) + '...' } else { $Text })
    $result.reason = 'this is not a setup link (it begins: ' + $shown + ')'
    return $result
  }

  $options = [ordered]@{
    editor  = 'auto'
    profile = 'excalidraw'
    groups  = 'python,cpp,java,js'
    vsix    = ''
    folder  = ''
  }

  $allowed = @('editor', 'profile', 'groups', 'vsix', 'folder')

  foreach ($pair in ($Matches['query'] -split '&')) {
    if ($pair -eq '') { continue }

    $parts = $pair -split '=', 2
    $key = [Uri]::UnescapeDataString($parts[0])
    $value = ''

    if ($parts.Count -gt 1) {
      $value = [Uri]::UnescapeDataString($parts[1].Replace('+', ' '))
    }

    if ($allowed -notcontains $key) {
      $result.reason = "the link asks for '$key', which a setup link may not"
      return $result
    }

    switch ($key) {
      'editor' {
        if (@('auto', 'code', 'codium') -notcontains $value) {
          $result.reason = "'$value' is not an editor this setup knows"
          return $result
        }
        $options.editor = $value
      }
      'profile' {
        # a name that is only letters, digits, a space, - and _
        if ($value -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$') {
          $result.reason = 'the profile name has characters it may not have'
          return $result
        }
        $options.profile = $value
      }
      'groups' {
        foreach ($g in ($value -split ',')) {
          if ($g -ne '' -and $Groups_.Keys -notcontains $g) {
            $result.reason = "'$g' is not a language group of this setup"
            return $result
          }
        }
        $options.groups = $value
      }
      'vsix' {
        # the extension is downloaded from this page's own address, over http
        # on this machine, or over https - and from nowhere else
        if ($value -ne '' -and $value -notmatch '^(https://[A-Za-z0-9.-]+(:\d+)?/|http://(127\.0\.0\.1|localhost)(:\d+)?/)[^\s"''`]*\.vsix$') {
          $result.reason = 'the extension address is not one this setup will download from'
          return $result
        }
        $options.vsix = $value
      }
      'folder' {
        if ($value -match '[<>"|?*]' -or $value -match '\.\.') {
          $result.reason = 'the folder has characters it may not have'
          return $result
        }
        $options.folder = $value
      }
    }
  }

  $result.ok = $true
  $result.options = $options
  return $result
}

# ---------------------------------------------------------------------------
# finding the editor
# ---------------------------------------------------------------------------

function Find-Cli {
  param([hashtable]$Def)

  $cmd = Get-Command $Def.Cli -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandType -eq 'Application' -or $_.CommandType -eq 'ExternalScript' } |
    Select-Object -First 1

  if ($cmd) {
    return $cmd.Source
  }

  foreach ($candidate in $Def.Candidates) {
    $path = Expand $candidate

    if (Test-Path -LiteralPath $path) {
      return $path
    }
  }

  return $null
}

function Get-EditorVersion {
  param([string]$Cli)

  try {
    $out = & $Cli --version 2>$null

    if ($out) {
      return @($out)[0]
    }
  }
  catch { }

  return ''
}

function Get-DataRoot {
  param([hashtable]$Def)

  if ($UserDataDir -ne '') {
    return $UserDataDir
  }

  return (Join-Path $env:APPDATA $Def.DataFolder)
}

function Get-Editors {
  $found = @()

  foreach ($key in @('code', 'codium')) {
    $def = $Editors[$key]
    $cli = Find-Cli $def
    $version = ''

    if ($cli) {
      $version = Get-EditorVersion $cli
    }

    $found += [ordered]@{
      key       = $key
      name      = $def.Name
      installed = [bool]$cli
      cli       = $cli
      version   = $version
    }
  }

  return $found
}

# The editor this run uses: the one that was asked for; else the one that is
# there (VS Code first); else VS Code, which is installed.
function Select-Editor {
  param($Found)

  if ($Editor -ne 'auto') {
    return $Editor
  }

  foreach ($e in $Found) {
    if ($e.installed) {
      return $e.key
    }
  }

  return 'code'
}

# ---------------------------------------------------------------------------
# the profile (D-366)
# ---------------------------------------------------------------------------

function Get-StoragePath {
  param([hashtable]$Def)

  return (Join-Path (Join-Path (Join-Path (Get-DataRoot $Def) 'User') 'globalStorage') 'storage.json')
}

function Read-Storage {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    try {
      $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
      $parsed = ConvertFrom-Json -InputObject $raw

      if ($null -ne $parsed) {
        return $parsed
      }
    }
    catch { }
  }

  return $null
}

function Test-ProfileExists {
  param([hashtable]$Def)

  $storage = Read-Storage (Get-StoragePath $Def)

  if ($null -eq $storage -or $null -eq $storage.userDataProfiles) {
    return $false
  }

  foreach ($p in @($storage.userDataProfiles)) {
    if ($p.name -eq $ProfileName) {
      return $true
    }
  }

  return $false
}

# The command line cannot make a profile - it says "Profile not found" - but
# the editor reads its profiles from storage.json, so the profile is added
# there, and what else is in the file stays as it was.
function New-Profile {
  param([hashtable]$Def)

  if (Test-ProfileExists $Def) {
    return 'exists'
  }

  $path = Get-StoragePath $Def
  $storage = Read-Storage $path
  $folder = Split-Path -Parent $path

  if (-not (Test-Path -LiteralPath $folder)) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
  }

  if ($null -eq $storage) {
    $storage = [pscustomobject]@{}
  }

  $list = @()

  if ($null -ne $storage.userDataProfiles) {
    $list = @($storage.userDataProfiles)
  }

  # the location is the profile's folder under User\profiles
  $location = ($ProfileName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')

  if ($location -eq '') {
    $location = 'excalidraw'
  }

  $list += [pscustomobject]@{ name = $ProfileName; location = $location }

  if ($null -ne $storage.PSObject.Properties['userDataProfiles']) {
    $storage.userDataProfiles = $list
  }
  else {
    Add-Member -InputObject $storage -MemberType NoteProperty -Name 'userDataProfiles' -Value $list
  }

  # a copy first: the editor's own file is only replaced by a whole one
  if (Test-Path -LiteralPath $path) {
    Copy-Item -LiteralPath $path -Destination ($path + '.before-excalidraw') -Force
  }

  $text = ConvertTo-Json -InputObject $storage -Depth 20
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))

  return 'created'
}

function Get-CliBase {
  $args_ = @()

  if ($UserDataDir -ne '') {
    $args_ += @('--user-data-dir', $UserDataDir)
  }

  if ($ExtensionsDir -ne '') {
    $args_ += @('--extensions-dir', $ExtensionsDir)
  }

  $args_ += @('--profile', $ProfileName)
  return $args_
}

function Get-ProfileExtensions {
  param([string]$Cli)

  $base = Get-CliBase
  $out = & $Cli @base --list-extensions --show-versions 2>$null
  $map = @{}

  foreach ($line in @($out)) {
    if ($line -match '^(?<id>[^@\s]+)@(?<v>\S+)$') {
      $map[$Matches['id'].ToLowerInvariant()] = $Matches['v']
    }
  }

  return $map
}

# The bridge in an editor's DEFAULT profile (not the excalidraw profile): the version, or $null. An old bridge
# there is what the board meets when the teacher opens the editor the usual way, and a bridge from before the
# pairing cannot answer the board (D-518).
function Get-DefaultProfileBridge {
  param([string]$Cli)

  $base = @()

  if ($UserDataDir -ne '') { $base += @('--user-data-dir', $UserDataDir) }
  if ($ExtensionsDir -ne '') { $base += @('--extensions-dir', $ExtensionsDir) }

  # the plan changes nothing: the editor makes a folder it is pointed at, so a folder that is not there is not asked
  if (($UserDataDir -ne '' -and -not (Test-Path -LiteralPath $UserDataDir)) -or ($ExtensionsDir -ne '' -and -not (Test-Path -LiteralPath $ExtensionsDir))) {
    return $null
  }

  try {
    $out = & $Cli @base --list-extensions --show-versions 2>$null

    foreach ($line in @($out)) {
      if ($line -match '^(?<id>[^@\s]+)@(?<v>\S+)$' -and $Matches['id'].ToLowerInvariant() -eq $BridgeId.ToLowerInvariant()) {
        return $Matches['v']
      }
    }
  }
  catch { }

  return $null
}

# the version inside a .vsix, or $null
function Get-VsixVersion {
  param([string]$Path)

  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)

    try {
      $entry = $zip.GetEntry('extension/package.json')
      $reader = New-Object System.IO.StreamReader($entry.Open())

      # a pattern and not ConvertFrom-Json: Windows PowerShell refuses a manifest that has two keys differing only in case
      try {
        if ($reader.ReadToEnd() -match '"version"\s*:\s*"(?<v>[0-9][^"]*)"') { return $Matches['v'] }

        return $null
      }
      finally { $reader.Dispose() }
    }
    finally { $zip.Dispose() }
  }
  catch { return $null }
}

# is version $a older than version $b? Unreadable versions count as older.
function Test-OlderVersion {
  param([string]$A, [string]$B)

  try { return ([version]$A) -lt ([version]$B) }
  catch { return $true }
}

# ---------------------------------------------------------------------------
# the plan
# ---------------------------------------------------------------------------

function Get-WantedExtensions {
  param([string]$Key)

  $wanted = @()

  foreach ($g in ($Groups -split ',')) {
    $g = $g.Trim()

    if ($g -eq '' -or -not $Groups_.Contains($g)) { continue }

    foreach ($id in $Groups_[$g][$Key]) {
      $wanted += [ordered]@{ group = $g; id = $id }
    }
  }

  return $wanted
}

function Get-Plan {
  $found = Get-Editors
  $key = Select-Editor $found
  $def = $Editors[$key]
  $entry = $found | Where-Object { $_.key -eq $key } | Select-Object -First 1

  $plan = [ordered]@{
    editor     = [ordered]@{
      key         = $key
      name        = $def.Name
      installed   = $entry.installed
      cli         = $entry.cli
      version     = $entry.version
      willInstall = (-not $entry.installed)
      ladder      = @($Ladder -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    }
    others     = @($found | Where-Object { $_.key -ne $key })
    profile    = [ordered]@{
      name   = $ProfileName
      exists = (Test-ProfileExists $def)
    }
    bridge     = [ordered]@{
      id     = $BridgeId
      source = $(if ($VsixPath -ne '') { $VsixPath } elseif ($VsixUrl -ne '') { $VsixUrl } else { '' })
    }
    extensions = @()
    folder     = $Folder
    # the editors that have the bridge in their usual profile: updated when it is older than the one that comes
    staleBridges = @()
  }

  foreach ($candidate in @($found | Where-Object { $_.installed -and $_.cli })) {
    $have = Get-DefaultProfileBridge $candidate.cli

    if ($have) {
      $plan.staleBridges += [ordered]@{ key = $candidate.key; name = $candidate.name; cli = $candidate.cli; have = $have }
    }
  }

  $installed = @{}

  if ($entry.installed -and $plan.profile.exists) {
    $installed = Get-ProfileExtensions $entry.cli
  }

  foreach ($w in (Get-WantedExtensions $key)) {
    $have = $installed[$w.id.ToLowerInvariant()]

    $plan.extensions += [ordered]@{
      group = $w.group
      id    = $w.id
      state = $(if ($have) { 'installed' } else { 'missing' })
      have  = $have
      does  = $(if ($have) { 'update' } else { 'install' })
    }
  }

  return $plan
}

# ---------------------------------------------------------------------------
# installing the editor (D-365)
# ---------------------------------------------------------------------------

function Get-Tool {
  param([string]$Name)

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-FileSha256 {
  param([string]$Path)

  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Downloads with curl.exe when the machine has it (Windows 10 and later), and
# with PowerShell's own client when it does not.
function Save-Url {
  param([string]$Url, [string]$To)

  if (Get-Tool 'curl.exe') {
    & curl.exe -L --fail --silent --show-error --retry 3 -o $To $Url | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $To)) { return $true }
  }

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $To
    return (Test-Path -LiteralPath $To)
  }
  catch {
    return $false
  }
}

function Install-ViaWinget {
  param([hashtable]$Def)

  if (-not (Get-Tool 'winget')) { return $false }

  # the program's own words go to the screen, and not into the return value
  & winget install --id $Def.Winget -e --silent --scope user --accept-package-agreements --accept-source-agreements | Out-Host
  return ($LASTEXITCODE -eq 0)
}

function Install-ViaScoop {
  param([hashtable]$Def)

  if (-not (Get-Tool 'scoop')) { return $false }

  & scoop bucket add extras 2>$null | Out-Null
  & scoop install $Def.Scoop | Out-Host
  return ($LASTEXITCODE -eq 0)
}

# The publisher's own installer, for this user alone, checked against the
# checksum the publisher gives before it is run.
function Install-Direct {
  param([hashtable]$Def)

  $temp = Join-Path $env:TEMP ('excalidraw-setup-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null

  $installer = Join-Path $temp ($Def.Key + '-setup.exe')
  $expected = ''

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    if ($Def.Key -eq 'code') {
      # the update service names the file and its checksum
      $info = Invoke-RestMethod -UseBasicParsing -Uri 'https://update.code.visualstudio.com/api/update/win32-x64-user/stable/latest'
      $url = $info.url
      $expected = [string]$info.sha256hash
    }
    else {
      $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/VSCodium/vscodium/releases/latest' -Headers @{ 'User-Agent' = 'excalidraw-setup' }
      $asset = $release.assets | Where-Object { $_.name -match '^VSCodiumUserSetup-x64-.*\.exe$' } | Select-Object -First 1

      if (-not $asset) { return $false }

      $url = $asset.browser_download_url
      $sum = $release.assets | Where-Object { $_.name -eq ($asset.name + '.sha256') } | Select-Object -First 1

      if ($sum) {
        $sumFile = Join-Path $temp 'installer.sha256'

        if (Save-Url $sum.browser_download_url $sumFile) {
          $expected = ((Get-Content -LiteralPath $sumFile -Raw).Trim() -split '\s+')[0]
        }
      }
    }
  }
  catch {
    Say 'editor' 'warn' ('could not read the download address: ' + $_.Exception.Message)
    return $false
  }

  if ($expected -eq '') {
    Say 'editor' 'warn' 'the publisher gave no checksum, so the installer is not run'
    return $false
  }

  Say 'editor' 'doing' ('downloading ' + $Def.Name + ' from ' + $url)

  if (-not (Save-Url $url $installer)) { return $false }

  $actual = Get-FileSha256 $installer

  if ($actual -ne $expected.ToLowerInvariant()) {
    Say 'editor' 'fail' 'the downloaded installer does not match its checksum, so it is not run'
    return $false
  }

  Say 'editor' 'doing' 'checksum matches; installing for this user'
  $p = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/MERGETASKS=!runcode') -Wait -PassThru

  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue

  return ($p.ExitCode -eq 0)
}

function Install-Editor {
  param([hashtable]$Def)

  foreach ($rung in ($Ladder -split ',')) {
    $rung = $rung.Trim()

    if ($rung -eq '') { continue }

    Say 'editor' 'doing' ('trying ' + $rung + ' to install ' + $Def.Name)

    $ok = $false

    switch ($rung) {
      'winget' { $ok = Install-ViaWinget $Def }
      'scoop' { $ok = Install-ViaScoop $Def }
      'direct' { $ok = Install-Direct $Def }
    }

    $cli = Find-Cli $Def

    if ($ok -and $cli) {
      Say 'editor' 'done' ($Def.Name + ' is installed (' + $rung + ')') ([ordered]@{ cli = $cli; rung = $rung })
      return $cli
    }

    Say 'editor' 'warn' ($rung + ' did not install ' + $Def.Name + '; trying the next way')
  }

  return $null
}

# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------

function Invoke-Cli {
  param([string]$Cli, [string[]]$More)

  $base = Get-CliBase
  $out = & $Cli @base @More 2>&1

  return [ordered]@{ code = $LASTEXITCODE; text = (($out | ForEach-Object { "$_" } | Where-Object { $_ -notmatch 'DEP0169|trace-deprecation' }) -join "`n") }
}

function Install-ExtensionInProfile {
  param([string]$Cli, [string]$What, [string]$Label)

  $r = Invoke-Cli $Cli @('--install-extension', $What, '--force')
  $last = (($r.text -split "`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)

  if ($r.code -eq 0 -and $r.text -notmatch 'Failed Installing') {
    Say 'extension' 'done' ($Label + ': ' + $last)
    return $true
  }

  Say 'extension' 'warn' ($Label + ' was not installed: ' + $last)
  return $false
}

function Resolve-Bridge {
  # a path that is there, or an address that is downloaded
  if ($VsixPath -ne '' -and (Test-Path -LiteralPath $VsixPath)) {
    return $VsixPath
  }

  if ($VsixUrl -ne '') {
    $to = Join-Path $env:TEMP 'excalidraw-bridge.vsix'

    if (Save-Url $VsixUrl $to) {
      return $to
    }
  }

  return $null
}

function Invoke-Run {
  $plan = Get-Plan
  $def = $Editors[$plan.editor.key]
  Say 'plan' 'info' 'the plan' $plan

  if (-not $Yes) {
    Say 'run' 'stop' 'nothing was changed: -Yes says the plan is accepted'
    return 2
  }

  # 1. the editor
  $cli = $plan.editor.cli

  if (-not $cli) {
    $cli = Install-Editor $def

    if (-not $cli) {
      Say 'editor' 'fail' ($def.Name + ' could not be installed by any of: ' + $Ladder)
      return 1
    }
  }
  else {
    Say 'editor' 'done' ($def.Name + ' ' + $plan.editor.version + ' is already installed') ([ordered]@{ cli = $cli })
  }

  # 2. the profile
  $made = New-Profile $def
  Say 'profile' 'done' ('profile ' + $ProfileName + ' ' + $made)

  # 3. the bridge
  $vsix = Resolve-Bridge

  $bridgeIn = $false
  $bridgeVersion = $null
  $updated = @()

  if ($vsix) {
    $bridgeIn = Install-ExtensionInProfile $cli $vsix 'the bridge'
    $bridgeVersion = Get-VsixVersion $vsix

    # the bridge in the editors' usual profile: an old one cannot answer the board, so it is updated too
    foreach ($stale in @($plan.staleBridges)) {
      if ($bridgeVersion -and -not (Test-OlderVersion $stale.have $bridgeVersion)) {
        continue
      }

      $base = @()

      if ($UserDataDir -ne '') { $base += @('--user-data-dir', $UserDataDir) }
      if ($ExtensionsDir -ne '') { $base += @('--extensions-dir', $ExtensionsDir) }

      $text = (& $stale.cli @base --install-extension $vsix --force 2>&1 | ForEach-Object { "$_" }) -join "`n"

      if ($LASTEXITCODE -eq 0 -and $text -notmatch 'Failed Installing') {
        Say 'bridge' 'done' ($stale.name + ' had the old bridge ' + $stale.have + ' in its usual profile; it is now ' + $bridgeVersion)
        $updated += $stale.name
      }
      else {
        Say 'bridge' 'warn' ($stale.name + ' still has the old bridge ' + $stale.have + ': it could not be updated')
      }
    }
  }
  else {
    Say 'bridge' 'warn' 'no extension file was given or found, so the bridge was not installed'
  }

  # 4. the language extensions - installed, or updated when they are there
  $failedNames = @()

  foreach ($e in $plan.extensions) {
    if (-not (Install-ExtensionInProfile $cli $e.id $e.id)) { $failedNames += $e.id }
  }

  # 5. the editor, opened on the profile
  $opened = $false

  if (-not $NoOpen) {
    $open = @(Get-CliBase)

    if ($Folder -ne '') { $open += $Folder }

    Start-Process -FilePath $cli -ArgumentList $open -WindowStyle Hidden | Out-Null
    $opened = $true
    Say 'open' 'done' ('opened ' + $def.Name + ' on the ' + $ProfileName + ' profile')
  }

  Say 'run' 'done' ('finished; ' + $failedNames.Count + ' extension(s) could not be installed') ([ordered]@{
      editor        = $def.Name
      profile       = $ProfileName
      opened        = $opened
      bridge        = $bridgeIn
      bridgeVersion = $bridgeVersion
      updated       = @($updated)
      failed        = @($failedNames)
    })
  return 0
}

# ---------------------------------------------------------------------------
# the modes
# ---------------------------------------------------------------------------

switch ($Mode) {
  'SelfTest' {
    Write-Output 'OK'
    exit 0
  }
  'Detect' {
    Write-Output (ConvertTo-Json -InputObject @(Get-Editors) -Depth 4 -Compress)
    exit 0
  }
  'ParseLink' {
    Write-Output (ConvertTo-Json -InputObject (Resolve-Link $Link) -Depth 6 -Compress)
    exit 0
  }
  'Plan' {
    Say 'plan' 'info' 'the plan (nothing is changed)' (Get-Plan)
    exit 0
  }
  'Profile' {
    $found = Get-Editors
    $def = $Editors[(Select-Editor $found)]
    Say 'profile' 'done' ('profile ' + $ProfileName + ' ' + (New-Profile $def))
    exit 0
  }
  'Run' {
    exit (Invoke-Run)
  }
}
