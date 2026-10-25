<#
.SYNOPSIS
  The setup: check what this machine is missing, and install it (D-152, AC-186).

.DESCRIPTION
  This is the script a teacher or a student runs. It does three things, in
  this order:

    1. it REPORTS what it finds - every thing it checks, in plain words;
    2. it ASKS before it installs anything on the machine;
    3. it INSTALLS what is missing, and ends with a summary.

  It never installs software silently: without a switch it asks, with -Yes it
  accepts the answers, and with -DryRun it reports and installs nothing at all.

  It needs no dependency of its own: PowerShell and what is already on the
  machine. Checking never uses the network - only installing does.

  It is safe to run twice: everything it checks is idempotent, and a second
  run says "already there" rather than doing it again.

.PARAMETER Yes
  Accept the defaults and do not ask. Everything that is missing is installed.

.PARAMETER DryRun
  Report only. Nothing is installed, not even a question is asked.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\setup.ps1 -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\setup.ps1

.NOTES
  PowerShell 5.1 compatible: no null-coalescing operator, no ternary
  operator, no -Parallel. The rules this script implements live in
  installer/lib/check.mjs, and the test pins the two together.
#>

[CmdletBinding()]
param(
    [switch]$Yes,
    [switch]$DryRun
)

# $ErrorActionPreference = 'Stop' would turn a native command that writes to
# its standard error into a terminating error, so it is set per call instead.
$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ExtensionRelative = 'packages/vscode-bridge/excalidraw-bridge-0.1.0.vsix'
$ExtensionId = 'excalidraw-teacher-help.excalidraw-bridge'
$NodeMinimum = 20

# ---------------------------------------------------------------------------
# finding the facts
# ---------------------------------------------------------------------------

function Get-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue

    if ($null -eq $command) {
        return $null
    }

    return $command.Source
}

function Invoke-ToolOutput {
    <#
      Runs a command and returns what it printed (standard output and
      standard error together), or $null when the command is not there or
      failed. Nothing here touches the network.
    #>
    param(
        [string]$Name,
        [string[]]$Arguments = @()
    )

    if ($null -eq (Get-CommandPath $Name)) {
        return $null
    }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0

    try {
        $output = & $Name @Arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0) {
        return $null
    }

    $text = $output.Trim()

    if ($text -eq '') {
        return $null
    }

    return $text
}

function Get-ToolVersion {
    <#
      The version a tool reports, or $null when it is not there or its
      version cannot be read. The pattern has one capture group: the version.
    #>
    param(
        [string]$Name,
        [string]$Pattern,
        [string[]]$Arguments = @('--version')
    )

    $output = Invoke-ToolOutput -Name $Name -Arguments $Arguments

    if ($null -eq $output) {
        return $null
    }

    if ($output -match $Pattern) {
        return $Matches[1]
    }

    return $null
}

function Get-Editor {
    <#
      What the setup found for an editor: its CLI, its standard install path,
      and whether the extension is already installed in it.
    #>
    param(
        [string]$Cli,
        [string[]]$StandardPaths
    )

    $cliPath = Get-CommandPath $Cli
    $standard = $null

    foreach ($candidate in $StandardPaths) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $standard = $candidate
            break
        }
    }

    $installed = $false

    if ($cliPath) {
        $list = Invoke-ToolOutput -Name $Cli -Arguments @('--list-extensions')

        if ($list -and ($list -match [regex]::Escape($ExtensionId))) {
            $installed = $true
        }
    }

    return [pscustomobject]@{
        Cli = $cliPath
        Path = $(if ($cliPath) { $cliPath } else { $standard })
        Installed = $installed
    }
}

function Get-SetupFacts {
    <#
      Everything the setup knows about this machine. Nothing here uses the
      network.
    #>
    $programFilesX86 = ${env:ProgramFiles(x86)}

    $facts = @{}

    $facts.NodeVersion = Get-ToolVersion -Name 'node' -Pattern '^v?(\d+\.\d+\.\d+)'
    $facts.YarnVersion = Get-ToolVersion -Name 'yarn' -Pattern '^(\d+\.\d+\.\d+)'
    $facts.CorepackVersion = Get-ToolVersion -Name 'corepack' -Pattern '^(\d+\.\d+\.\d+)'

    $facts.Vscode = Get-Editor -Cli 'code' -StandardPaths @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft VS Code\Code.exe'),
        $(if ($programFilesX86) { Join-Path $programFilesX86 'Microsoft VS Code\Code.exe' } else { $null })
    )

    $facts.Vscodium = Get-Editor -Cli 'codium' -StandardPaths @(
        (Join-Path $env:LOCALAPPDATA 'Programs\VSCodium\VSCodium.exe'),
        (Join-Path $env:ProgramFiles 'VSCodium\VSCodium.exe')
    )

    $facts.ExtensionBuilt = Test-Path -LiteralPath (Join-Path $RepoRoot 'packages\vscode-bridge\excalidraw-bridge-0.1.0.vsix')
    $facts.DependenciesInstalled = Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules')
    $facts.Winget = $null -ne (Get-CommandPath 'winget')
    # Windows can always download and run the official installer itself, so the
    # setup does not NEED a package manager to install anything.
    $facts.DirectInstall = $true

    $pythonVersion = Get-ToolVersion -Name 'python' -Pattern 'Python (\d+\.\d+\.\d+)'
    $javaVersion = Get-ToolVersion -Name 'java' -Pattern 'version "([^"]+)"' -Arguments @('-version')

    $facts.Runtimes = @{
        node = $null -ne $facts.NodeVersion
        python = $null -ne $pythonVersion
        java = $null -ne $javaVersion
    }

    return $facts
}

# ---------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------

function Get-SetupPlan {
    <#
      The checks and the things to install. This is the same rules as
      installer/lib/check.mjs, in PowerShell: the setup has to run on a
      machine with no Node at all, and Node is one of the things it installs.
    #>
    param($Facts)

    $checks = @()
    $actions = @()

    # --- Node.js: on the PATH, and 20 or newer ----------------------------
    if ($null -eq $Facts.NodeVersion) {
        $checks += [pscustomobject]@{ Id = 'node'; Label = 'Node.js'; Present = $false; Text = 'Node.js is not on the PATH' }
    } elseif ([int]($Facts.NodeVersion -replace '^v', '' -split '\.')[0] -lt $NodeMinimum) {
        $checks += [pscustomobject]@{ Id = 'node'; Label = 'Node.js'; Present = $false; Text = "Node.js $($Facts.NodeVersion) is older than $NodeMinimum, which the toolchain wants" }
    } else {
        $checks += [pscustomobject]@{ Id = 'node'; Label = 'Node.js'; Present = $true; Text = "$($Facts.NodeVersion) ($NodeMinimum or newer)" }
    }

    $nodeIsThere = $checks[0].Present

    # --- Yarn: on the PATH, or Corepack can provide it --------------------
    if ($Facts.YarnVersion) {
        $checks += [pscustomobject]@{ Id = 'yarn'; Label = 'Yarn'; Present = $true; Text = $Facts.YarnVersion }
    } elseif ($Facts.CorepackVersion) {
        $checks += [pscustomobject]@{ Id = 'yarn'; Label = 'Yarn'; Present = $true; Text = "not on the PATH yet - Corepack $($Facts.CorepackVersion) can provide it" }
    } else {
        $checks += [pscustomobject]@{ Id = 'yarn'; Label = 'Yarn'; Present = $false; Text = 'Yarn is not on the PATH and Corepack is not available to provide it' }
    }

    # --- VS Code and VSCodium ---------------------------------------------
    foreach ($editor in @(
        [pscustomobject]@{ Id = 'vscode'; Label = 'VS Code'; Cli = 'code'; Fact = $Facts.Vscode },
        [pscustomobject]@{ Id = 'vscodium'; Label = 'VSCodium'; Cli = 'codium'; Fact = $Facts.Vscodium }
    )) {
        if ($editor.Fact.Path) {
            $checks += [pscustomobject]@{ Id = $editor.Id; Label = $editor.Label; Present = $true; Text = $editor.Fact.Path }
        } else {
            $checks += [pscustomobject]@{ Id = $editor.Id; Label = $editor.Label; Present = $false; Text = "$($editor.Label) was not found (no $($editor.Cli) command and no standard install path)" }
        }
    }

    # --- the extension ------------------------------------------------------
    if ($Facts.ExtensionBuilt) {
        $checks += [pscustomobject]@{ Id = 'extension'; Label = 'The extension'; Present = $true; Text = "$ExtensionRelative is built" }
    } else {
        $checks += [pscustomobject]@{ Id = 'extension'; Label = 'The extension'; Present = $false; Text = 'the extension has not been built yet' }
    }

    # --- the app's dependencies ---------------------------------------------
    if ($Facts.DependenciesInstalled) {
        $checks += [pscustomobject]@{ Id = 'dependencies'; Label = "The app's dependencies"; Present = $true; Text = 'node_modules is there' }
    } else {
        $checks += [pscustomobject]@{ Id = 'dependencies'; Label = "The app's dependencies"; Present = $false; Text = "the app's dependencies are not installed (no node_modules)" }
    }

    # --- the language runtimes the panel's Run can execute -------------------
    $runtimeText = @()
    $missingRuntimes = @()

    foreach ($runtime in @('node', 'python', 'java')) {
        if ($Facts.Runtimes[$runtime]) {
            $runtimeText += "$runtime ok"
        } else {
            $runtimeText += "$runtime missing"
            $missingRuntimes += $runtime
        }
    }

    if ($missingRuntimes.Count -eq 0) {
        $checks += [pscustomobject]@{ Id = 'runtimes'; Label = 'Runtimes for Run'; Present = $true; Text = ($runtimeText -join ', ') }
    } else {
        $checks += [pscustomobject]@{ Id = 'runtimes'; Label = 'Runtimes for Run'; Present = $false; Text = ($runtimeText -join ', ') }
    }

    # --- what the setup would install ----------------------------------------
    if (-not $nodeIsThere) {
        $canInstall = $Facts.Winget -or $Facts.DirectInstall

        $actions += [pscustomobject]@{
            Id = 'node.install'
            Label = 'Install Node.js'
            Detail = $(if ($Facts.Winget) { 'through winget' } elseif ($canInstall) { 'from nodejs.org' } else { 'no package manager is available, so this one is yours to do' })
            Automatic = $canInstall
            Instruction = $(if ($canInstall) { $null } else { "Install Node.js $NodeMinimum or newer from https://nodejs.org and run this script again." })
        }
    }

    if (-not $Facts.YarnVersion -and $Facts.CorepackVersion) {
        $actions += [pscustomobject]@{
            Id = 'yarn.corepack'
            Label = 'Enable Yarn through Corepack'
            Detail = "Corepack $($Facts.CorepackVersion) is on the PATH"
            Automatic = $true
            Instruction = $null
        }
    }

    if (-not $Facts.ExtensionBuilt) {
        $actions += [pscustomobject]@{
            Id = 'extension.build'
            Label = 'Build the extension'
            Detail = $ExtensionRelative
            Automatic = $nodeIsThere
            Instruction = $(if ($nodeIsThere) { $null } else { 'Node.js is needed to build the extension - install Node.js first, then run this script again.' })
        }
    }

    foreach ($editor in @(
        [pscustomobject]@{ Id = 'extension.install.vscode'; Label = 'VS Code'; Cli = 'code'; Fact = $Facts.Vscode },
        [pscustomobject]@{ Id = 'extension.install.vscodium'; Label = 'VSCodium'; Cli = 'codium'; Fact = $Facts.Vscodium }
    )) {
        if ($editor.Fact.Path -and -not $editor.Fact.Installed) {
            $actions += [pscustomobject]@{
                Id = $editor.Id
                Label = "Install the extension into $($editor.Label)"
                Detail = 'the editor does not have it yet'
                Automatic = $true
                Instruction = $null
            }
        }
    }

    # The editor ITSELF, when it is not on the machine at all. A teacher with
    # neither VS Code nor VSCodium cannot use the bridge, so the setup offers
    # to install one - through the package manager, or from the official
    # installer when there is no package manager.
    foreach ($editor in @(
        [pscustomobject]@{ Id = 'editor.install.vscode'; Label = 'VS Code'; Fact = $Facts.Vscode; From = 'code.visualstudio.com' },
        [pscustomobject]@{ Id = 'editor.install.vscodium'; Label = 'VSCodium'; Fact = $Facts.Vscodium; From = 'vscodium.com' }
    )) {
        if ($editor.Fact.Path -or $editor.Fact.Cli) {
            continue
        }

        $canInstall = $Facts.Winget -or $Facts.DirectInstall

        $actions += [pscustomobject]@{
            Id = $editor.Id
            Label = "Install $($editor.Label)"
            Detail = $(if ($Facts.Winget) { 'through winget' } elseif ($canInstall) { "from $($editor.From)" } else { 'no package manager is available, so this one is yours to do' })
            Automatic = $canInstall
            Instruction = $(if ($canInstall) { $null } else { "Install $($editor.Label) from https://$($editor.From) and run this script again." })
        }
    }

    if (-not $Facts.DependenciesInstalled) {
        $canInstall = [bool]($Facts.YarnVersion -or $Facts.CorepackVersion)

        $actions += [pscustomobject]@{
            Id = 'dependencies.install'
            Label = "Install the app's dependencies"
            Detail = 'with yarn, in the repository root'
            Automatic = $canInstall
            Instruction = $(if ($canInstall) { $null } else { 'Yarn is needed to install the app''s dependencies - install Yarn first, then run this script again.' })
        }
    }

    foreach ($runtime in @(
        [pscustomobject]@{ Id = 'runtime.python'; Label = 'Python'; Present = $Facts.Runtimes.python },
        [pscustomobject]@{ Id = 'runtime.java'; Label = 'Java'; Present = $Facts.Runtimes.java }
    )) {
        if (-not $runtime.Present) {
            $actions += [pscustomobject]@{
                Id = $runtime.Id
                Label = "Install $($runtime.Label)"
                Detail = $(if ($Facts.Winget) { 'through winget' } else { 'winget is not on the PATH, so this one is yours to do' })
                Automatic = $Facts.Winget
                Instruction = $(if ($Facts.Winget) { $null } else { "Install $($runtime.Label) from https://excalidraw.com and run this script again." })
            }
        }
    }

    return [pscustomobject]@{ Checks = $checks; Actions = $actions }
}

function Show-Report {
    <#
      Prints the report. The last line is the summary: the report ENDS with
      something the reader can act on.
    #>
    param($Plan)

    $width = 0

    foreach ($check in $Plan.Checks) {
        if ($check.Label.Length -gt $width) {
            $width = $check.Label.Length
        }
    }

    Write-Host ''
    Write-Host 'Excalidraw setup - what this machine already has'
    Write-Host ''

    foreach ($check in $Plan.Checks) {
        $state = 'missing'

        if ($check.Present) {
            $state = 'ok'
        }

        Write-Host ("  [{0,-7}] {1}  {2}" -f $state, $check.Label.PadRight($width), $check.Text)
    }

    Write-Host ''

    if ($Plan.Actions.Count -eq 0) {
        Write-Host 'What the setup would install: nothing - everything is already there.'
    } else {
        Write-Host "What the setup would install ($($Plan.Actions.Count)):"

        $index = 0

        foreach ($action in $Plan.Actions) {
            $index = $index + 1
            Write-Host "  $index. $($action.Label) - $($action.Detail)"

            if (-not $action.Automatic -and $action.Instruction) {
                Write-Host "     $($action.Instruction)"
            }
        }
    }
}

function Get-SummaryText {
    param($Plan)

    $missing = @($Plan.Checks | Where-Object { -not $_.Present })
    $present = $Plan.Checks.Count - $missing.Count

    if ($missing.Count -eq 0) {
        return "Summary: all $($Plan.Checks.Count) checks are already in place. Nothing to install."
    }

    $noun = 'things'

    if ($Plan.Actions.Count -eq 1) {
        $noun = 'thing'
    }

    return "Summary: $present of $($Plan.Checks.Count) checks are already in place, $($missing.Count) $(if ($missing.Count -eq 1) { 'is' } else { 'are' }) missing. $($Plan.Actions.Count) $noun would be installed."
}

function Test-Yes {
    param([string]$Answer)

    if ($null -eq $Answer) {
        return $true
    }

    $text = $Answer.Trim().ToLower()

    if ($text -eq '') {
        return $true
    }

    return ($text -eq 'y' -or $text -eq 'yes')
}

# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'Excalidraw setup'
Write-Host 'Checking what this machine has. Nothing is installed until you say so.'

$Facts = Get-SetupFacts
$Plan = Get-SetupPlan -Facts $Facts

Show-Report -Plan $Plan
Write-Host ''

# --- the dry run stops here -------------------------------------------------
# Everything below this line installs software. The guard above it is what
# makes -DryRun install nothing at all.
if ($DryRun) {
    Write-Host 'Dry run: nothing was installed.'
    Write-Host (Get-SummaryText -Plan $Plan)
    Write-Host ''
    exit 0
}

# --- nothing to do ------------------------------------------------------------
if ($Plan.Actions.Count -eq 0) {
    Write-Host 'Everything is already there. Nothing to install.'
    Write-Host (Get-SummaryText -Plan $Plan)
    Write-Host ''
    exit 0
}

# --- ask ----------------------------------------------------------------------
if (-not $Yes) {
    Write-Host "Install $($Plan.Actions.Count) thing(s) now? [Y/n] "
    $Answer = Read-Host

    if (-not (Test-Yes $Answer)) {
        Write-Host 'Nothing was installed.'
        Write-Host (Get-SummaryText -Plan $Plan)
        Write-Host ''
        exit 0
    }
}

# ---------------------------------------------------------------------------
# the installing
# ---------------------------------------------------------------------------

# The paths the installing needs. They live here, below the dry-run guard, so
# that nothing above the guard can install anything.
$ExtensionFile = Join-Path $RepoRoot 'packages\vscode-bridge\excalidraw-bridge-0.1.0.vsix'
$BuildScript = Join-Path $RepoRoot 'packages\vscode-bridge\scripts\build-vsix.mjs'
$BuildScript = Join-Path $RepoRoot 'packages\vscode-bridge\scripts\build-vsix.mjs'

function Write-Step {
    param([string]$Message)

    Write-Host ''
    Write-Host "-> $Message"
}

function Install-Node {
    if ($Facts.Winget) {
        & winget install --id OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
        return
    }

    Install-NodeDirect
}

# ---------------------------------------------------------------------------
# installing without a package manager
#
# winget ships with every ordinary Windows 10 and 11, but it is NOT in a bare
# image - a Windows Sandbox, a fresh server, a locked-down classroom machine.
# There the setup downloads the OFFICIAL installer and runs it, so the promise
# holds everywhere: it checks, and it installs.
# ---------------------------------------------------------------------------

function Get-MachineArchitecture {
    # 'x64' or 'arm64' - the official installers are published for both.
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        return 'arm64'
    }

    return 'x64'
}

function Update-PathFromMachine {
    # An installer adds itself to the machine's PATH, but this session was
    # started before that, so the PATH is read again from the registry.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')

    if ($machine) { $env:Path = "$machine;$env:Path" }
    if ($user) { $env:Path = "$user;$env:Path" }
}

function Get-DownloadPath {
    $dir = Join-Path $env:TEMP 'excalidraw-setup-downloads'

    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    return $dir
}

function Install-NodeDirect {
    $arch = Get-MachineArchitecture
    $dir = Get-DownloadPath

    # the latest LTS, from nodejs.org's own index
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $index | Where-Object { $_.lts -and $_.files -contains "win-$arch-msi" } | Select-Object -First 1

    if (-not $release) {
        Write-Host '   could not find a Node.js release for this machine - install Node.js from https://nodejs.org'
        return
    }

    # The index lists the MSI as "win-x64-msi", but the FILE it names is
    # "node-<version>-x64.msi" - the "win-" is in the index's name, not in the
    # file's. Getting this wrong is a 404.
    $file = "node-$($release.version)-$arch.msi"
    $path = Join-Path $dir $file

    Write-Host "   downloading $file"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($release.version)/$file" -OutFile $path -UseBasicParsing

    Write-Host '   installing'
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $path, '/qn', '/norestart') -Wait -PassThru

    if ($process.ExitCode -ne 0) {
        Write-Host "   the installer returned $($process.ExitCode) - install Node.js from https://nodejs.org"
        return
    }

    Update-PathFromMachine
    Write-Host "   Node.js $($release.version) installed"
}

function Install-EditorDirect {
    param(
        [string]$Url,
        [string]$FileName
    )

    $dir = Get-DownloadPath
    $path = Join-Path $dir $FileName

    Write-Host "   downloading $FileName"
    Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing

    Write-Host '   installing'
    # the VS Code and VSCodium installers are Inno Setup: /VERYSILENT is quiet
    $process = Start-Process -FilePath $path -ArgumentList @('/VERYSILENT', '/NORESTART', '/MERGETASKS=!runCode', '/SP-') -Wait -PassThru

    if ($process.ExitCode -ne 0) {
        Write-Host "   the installer returned $($process.ExitCode)"
    }

    Update-PathFromMachine
}

function Install-VSCodeDirect {
    $arch = Get-MachineArchitecture
    Install-EditorDirect -Url "https://update.code.visualstudio.com/latest/win32-$arch-user/stable" -FileName "vscode-$arch-setup.exe"
}

function Install-VSCodiumDirect {
    $arch = Get-MachineArchitecture
    Install-EditorDirect -Url "https://github.com/VSCodium/vscodium/releases/latest/download/VSCodium-win32-$arch-user.exe" -FileName "vscodium-$arch-setup.exe"
}

function Install-VSCode {
    if ($Facts.Winget) {
        & winget install --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements
        Update-PathFromMachine
        return
    }

    Install-VSCodeDirect
}

function Install-VSCodium {
    if ($Facts.Winget) {
        & winget install --id VSCodium.VSCodium --accept-source-agreements --accept-package-agreements
        Update-PathFromMachine
        return
    }

    Install-VSCodiumDirect
}

function Install-Python {
    & winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
}

function Install-Java {
    & winget install --id EclipseAdoptium.Temurin.21.JDK --accept-source-agreements --accept-package-agreements
}

function Install-YarnWithCorepack {
    & corepack enable
}

function Build-Extension {
    $node = Get-CommandPath 'node'

    if ($null -eq $node) {
        $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    }

    & $node $BuildScript
}

function Install-ExtensionInto {
    param(
        [string]$EditorPath,
        [string]$EditorCli
    )

    $command = $EditorCli

    if ($EditorPath -and (Test-Path -LiteralPath $EditorPath)) {
        # the standard install path is the editor's own binary, and it takes
        # the same arguments the CLI does
        $command = $EditorPath
    }

    & $command --install-extension $ExtensionFile --force
}

function Install-AppDependencies {
    Push-Location $RepoRoot

    try {
        & yarn install --frozen-lockfile
    } finally {
        Pop-Location
    }
}

$installed = @()

# The plan is made ONCE, from what the machine has at the start - and installing
# Node.js changes what the machine has. So the plan is made again after the
# first pass: the things that needed Node (Corepack, the extension's build,
# the app's dependencies) can now be done, and they are done in THIS run
# rather than telling the reader to come back.
for ($pass = 1; $pass -le 2; $pass++) {
    if ($pass -gt 1) {
        Update-PathFromMachine
        $Facts = Get-SetupFacts
        $Plan = Get-SetupPlan -Facts $Facts

        if ($Plan.Actions.Count -eq 0) {
            break
        }

        Write-Host ''
        Write-Host 'Looking again, now that Node.js is here:'
    }

    foreach ($action in $Plan.Actions) {
        if (-not $action.Automatic) {
            Write-Step "$($action.Label) - this one is yours to do"
            Write-Host "   $($action.Instruction)"
            continue
        }

        # One thing failing must not stop the others: a download that 404s is a
        # fact about that thing, not about the whole setup.
        try {
            switch ($action.Id) {
        'node.install' {
            Write-Step 'Installing Node.js'
            Install-Node
            $installed += 'Node.js'
        }
        'yarn.corepack' {
            Write-Step 'Enabling Yarn through Corepack'
            Install-YarnWithCorepack
            $installed += 'Yarn'
        }
        'extension.build' {
            Write-Step 'Building the extension'
            Build-Extension
            $installed += 'the extension'
        }
        'extension.install.vscode' {
            Write-Step 'Installing the extension into VS Code'
            Install-ExtensionInto -EditorPath $Facts.Vscode.Path -EditorCli 'code'
            $installed += 'the extension in VS Code'
        }
        'extension.install.vscodium' {
            Write-Step 'Installing the extension into VSCodium'
            Install-ExtensionInto -EditorPath $Facts.Vscodium.Path -EditorCli 'codium'
            $installed += 'the extension in VSCodium'
        }
        'editor.install.vscode' {
            Write-Step 'Installing VS Code'
            Install-VSCode
            $installed += 'VS Code'
        }
        'editor.install.vscodium' {
            Write-Step 'Installing VSCodium'
            Install-VSCodium
            $installed += 'VSCodium'
        }
        'dependencies.install' {
            Write-Step "Installing the app's dependencies"
            Install-AppDependencies
            $installed += "the app's dependencies"
        }
        'runtime.python' {
            Write-Step 'Installing Python'
            Install-Python
            $installed += 'Python'
        }
        'runtime.java' {
            Write-Step 'Installing Java'
            Install-Java
            $installed += 'Java'
        }
    }
        }
        catch {
            Write-Host "   it did not work: $($_.Exception.Message)"
            Write-Host "   this one is left to you - the report above says what to do"
        }
    }
}

# ---------------------------------------------------------------------------
# the summary
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'What was installed:'

if ($installed.Count -eq 0) {
    Write-Host '  nothing'
} else {
    foreach ($item in $installed) {
        Write-Host "  $item"
    }
}

$After = Get-SetupFacts
$AfterPlan = Get-SetupPlan -Facts $After

Write-Host ''
Show-Report -Plan $AfterPlan
Write-Host ''
Write-Host (Get-SummaryText -Plan $AfterPlan)
Write-Host ''
