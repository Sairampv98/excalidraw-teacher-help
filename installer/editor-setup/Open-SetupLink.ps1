<#
.SYNOPSIS
  What the browser opens when the page's setup link is accepted (D-364).

.DESCRIPTION
  It reads the link against the engine's closed list, shows the plan in a
  window, and only when the teacher presses "Set up" runs the engine. A link
  that asks for anything the list does not allow is refused, and the window
  says why.

  Nothing happens without the press: any page can make a link, and the press
  is the teacher's say.

  The window stays alive while the engine works: the engine runs in its own
  process, writes its lines to a file, and a timer reads them. (Waiting for the
  engine's output inside the window's own thread froze it - Windows said "not
  responding" - while an editor or an extension was being downloaded.)

.PARAMETER Link
  The link the browser was given.

.PARAMETER NoWindow
  For a test or the sandbox: no window; the engine runs at once with the
  options in the link, and its lines go to the standard output.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Link,
  [switch]$NoWindow,
  # for a test: print where the window puts everything, and show no window
  [switch]$Layout
)

$ErrorActionPreference = 'Continue'

$engine = Join-Path $PSScriptRoot 'EditorSetup.ps1'

function Invoke-Engine {
  param([string[]]$More)

  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $engine @More
  return $out
}

$read = ConvertFrom-Json -InputObject ((Invoke-Engine @('-Mode', 'ParseLink', '-Link', $Link)) -join "`n")

function Get-EngineArguments {
  param($Options, [string]$Groups, [string]$Editor = '')

  if ($Editor -eq '') { $Editor = [string]$Options.editor }

  $list = @('-Editor', $Editor, '-ProfileName', $Options.profile, '-Groups', $Groups, '-Json')

  if ($Options.vsix -ne '') { $list += @('-VsixUrl', $Options.vsix) }
  if ($Options.folder -ne '') { $list += @('-Folder', $Options.folder) }

  return $list
}

if (-not $read.ok) {
  if ($NoWindow) {
    [Console]::Error.WriteLine('refused: ' + $read.reason)
    exit 1
  }

  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show('This setup link was refused: ' + $read.reason, 'Excalidraw setup', 'OK', 'Warning')
  exit 1
}

$options = $read.options

if ($NoWindow) {
  $args_ = Get-EngineArguments $options $options.groups
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $engine -Mode Run -Yes @args_
  exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------------------------------------------------------------------
# the engine, in its own process, read by a timer
# ---------------------------------------------------------------------------

$script:proc = $null
$script:outFile = $null
$script:offset = 0
$script:carry = ''
$script:onLine = $null
$script:onExit = $null

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300

# the text the engine wrote since the last look (the file is open for reading and writing by both)
function Read-NewText {
  try {
    $stream = New-Object System.IO.FileStream($script:outFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)

    try {
      if ($stream.Length -le $script:offset) { return '' }

      [void]$stream.Seek($script:offset, [System.IO.SeekOrigin]::Begin)
      $buffer = New-Object byte[] ($stream.Length - $script:offset)
      $got = $stream.Read($buffer, 0, $buffer.Length)
      $script:offset += $got

      return [System.Text.Encoding]::UTF8.GetString($buffer, 0, $got)
    }
    finally { $stream.Close() }
  }
  catch { return '' }
}

function Send-Lines {
  param([string]$Text, [bool]$Last)

  $script:carry += $Text
  $parts = $script:carry -split "`n"

  if ($Last) {
    $script:carry = ''
  }
  else {
    $script:carry = $parts[$parts.Count - 1]
    $parts = $parts[0..($parts.Count - 2)]
  }

  foreach ($part in $parts) {
    $trimmed = $part.Trim()

    if ($trimmed -ne '' -and $script:onLine) { & $script:onLine $trimmed }
  }
}

$timer.Add_Tick({
    if (-not $script:proc) { return }

    $exited = $script:proc.HasExited

    Send-Lines (Read-NewText) $exited

    if ($exited) {
      $timer.Stop()
      $code = $script:proc.ExitCode
      $script:proc = $null

      try { Remove-Item -LiteralPath $script:outFile -Force -ErrorAction SilentlyContinue } catch { }

      if ($script:onExit) { & $script:onExit $code }
    }
  })

function Start-Engine {
  param([string[]]$ArgumentList, $OnLine, $OnExit)

  $script:outFile = Join-Path $env:TEMP ('excalidraw-setup-' + [Guid]::NewGuid().ToString('N') + '.log')
  $script:offset = 0
  $script:carry = ''
  $script:onLine = $OnLine
  $script:onExit = $OnExit

  $text = '-NoProfile -ExecutionPolicy Bypass -File "' + $engine + '" ' + (($ArgumentList | ForEach-Object { '"' + $_ + '"' }) -join ' ')

  $script:proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $text -WindowStyle Hidden -PassThru -RedirectStandardOutput $script:outFile
  $timer.Start()
}

# ---------------------------------------------------------------------------
# the words
# ---------------------------------------------------------------------------

# one engine line as a sentence for the log
function Format-EngineLine {
  param($Obj)

  $mark = '      '

  switch ($Obj.status) {
    'done' { $mark = '[ok]  ' }
    'doing' { $mark = '...   ' }
    'warn' { $mark = '[!]   ' }
    'fail' { $mark = '[X]   ' }
  }

  return $mark + $Obj.text
}

# what the teacher reads when it is over
function Get-ResultText {
  param($Data, [int]$Code)

  if ($Code -ne 0 -or -not $Data) {
    return "The setup did not finish. Read the lines above, fix what they say (often: no internet), and press Set up again - it is safe to run again."
  }

  $lines = @()
  $lines += ('Done. ' + $Data.editor + ' is set up for the board with the "' + $Data.profile + '" profile.')

  if ($Data.bridge) {
    $lines += ('The board bridge ' + $Data.bridgeVersion + ' is in it.')
  }
  else {
    $lines += 'The board bridge could NOT be installed: the board will not be able to connect. Press Set up again.'
  }

  foreach ($name in @($Data.updated | Where-Object { $_ })) {
    $lines += ($name + ' had an old bridge in its usual profile: it is updated too. Reload that editor (Ctrl+Shift+P, Reload Window) to use it.')
  }

  if (@($Data.failed | Where-Object { $_ }).Count -gt 0) {
    $lines += ('Not installed (the rest is ready): ' + (@($Data.failed | Where-Object { $_ }) -join ', ') + '. Press Set up again to retry.')
  }

  $lines += ''

  if ($Data.opened) {
    $lines += ('Next: use the ' + $Data.editor + ' window that just opened (it is on the "' + $Data.profile + '" profile).')
  }
  else {
    $lines += ('Next: open ' + $Data.editor + ' on the "' + $Data.profile + '" profile.')
  }

  $lines += 'Then, in the board, leave the token field empty and press Connect. The editor asks "Allow the whiteboard to connect?" - choose Allow.'

  return ($lines -join "`r`n")
}

# ---------------------------------------------------------------------------
# the window - shown at once, before anything slow is done
# ---------------------------------------------------------------------------

# a point whose arithmetic is done BEFORE it is a point: New-Object Point(16, $y + 12) makes an array and fails
function New-Point([int]$X, [int]$Y) { return New-Object System.Drawing.Point($X, $Y) }
function New-Size([int]$W, [int]$H) { return New-Object System.Drawing.Size($W, $H) }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Set up the editor for the whiteboard'
$form.ClientSize = New-Size 572 660
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.TopMost = $true

$summary = New-Object System.Windows.Forms.Label
$summary.Location = New-Point 16 10
$summary.Size = New-Size 540 112
$summary.Text = 'Looking at this computer (a few seconds)...'
$form.Controls.Add($summary)

# which editor: chosen here, from what the page said, and changeable
$editorLabel = New-Object System.Windows.Forms.Label
$editorLabel.Text = 'Set up:'
$editorLabel.Location = New-Point 16 130
$editorLabel.Size = New-Size 50 22
$form.Controls.Add($editorLabel)

$editorChoices = [ordered]@{
  auto   = 'The one installed'
  code   = 'VS Code'
  codium = 'VSCodium'
  both   = 'Both'
}
$radios = @{}
$x = 70

foreach ($key in $editorChoices.Keys) {
  $radio = New-Object System.Windows.Forms.RadioButton
  $radio.Text = $editorChoices[$key]
  $radio.Tag = $key
  $radio.Location = New-Point $x 128
  $radio.Size = New-Size $(if ($key -eq 'auto') { 150 } else { 110 }) 24
  $radio.Checked = ($key -eq $(if ($options.editor) { [string]$options.editor } else { 'auto' }))
  $form.Controls.Add($radio)
  $radios[$key] = $radio
  $x += $radio.Width
}

$boxes = @{}
$y = 162
$groupLabels = [ordered]@{ python = 'Python'; cpp = 'C and C++'; java = 'Java'; js = 'JavaScript and TypeScript (built in)' }

foreach ($key in $groupLabels.Keys) {
  $box = New-Object System.Windows.Forms.CheckBox
  $box.Text = $groupLabels[$key]
  $box.Location = New-Point 24 $y
  $box.Size = New-Size 500 22
  $box.Checked = (($options.groups -split ',') -contains $key)
  $form.Controls.Add($box)
  $boxes[$key] = $box
  $y += 24
}

$logTop = $y + 8

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.Location = New-Point 16 $logTop
$log.Size = New-Size 540 170
$form.Controls.Add($log)

$result = New-Object System.Windows.Forms.TextBox
$result.Multiline = $true
$result.ReadOnly = $true
$result.ScrollBars = 'Vertical'
$result.Font = New-Object System.Drawing.Font($result.Font.FontFamily, 9.5, [System.Drawing.FontStyle]::Bold)
$result.Location = New-Point 16 ($logTop + 178)
$result.Size = New-Size 540 130
$result.Visible = $false
$form.Controls.Add($result)

$go = New-Object System.Windows.Forms.Button
$go.Text = 'Set up'
$go.Enabled = $false
$go.Location = New-Point 360 620
$go.Size = New-Size 90 30
$form.Controls.Add($go)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.Location = New-Point 460 620
$cancel.Size = New-Size 90 30
$cancel.Add_Click({ $form.Close() })
$form.Controls.Add($cancel)

# for a test: where everything is, as text, and no window
if ($Layout) {
  $rows = @()

  foreach ($c in $form.Controls) {
    $ticked = $null

    if ($c -is [System.Windows.Forms.RadioButton] -or $c -is [System.Windows.Forms.CheckBox]) { $ticked = [bool]$c.Checked }

    $rows += [ordered]@{ type = $c.GetType().Name; text = [string]$c.Text; x = $c.Left; y = $c.Top; w = $c.Width; h = $c.Height; checked = $ticked }
  }

  Write-Output (ConvertTo-Json -InputObject ([ordered]@{ client = [ordered]@{ w = $form.ClientSize.Width; h = $form.ClientSize.Height }; controls = $rows }) -Depth 5 -Compress)
  exit 0
}

# the editor that is chosen in the window
function Get-ChosenEditor {
  foreach ($key in $radios.Keys) {
    if ($radios[$key].Checked) { return [string]$key }
  }

  return 'auto'
}

# the editors one press of Set up goes through, in order
function Get-EditorQueue {
  $chosen = Get-ChosenEditor

  if ($chosen -eq 'both') { return @('code', 'codium') }

  return @($chosen)
}

# the plan: read in the engine's own process while the window is already up
$script:planData = $null

$onPlanLine = {
  param($Text)

  try {
    $obj = ConvertFrom-Json -InputObject $Text

    if ($obj.step -eq 'plan' -and $obj.data) { $script:planData = $obj.data }
  }
  catch { }
}

$onPlanExit = {
  param($Code)

  $planLine = $script:planData
  $lines = @()

  if ((Get-ChosenEditor) -eq 'both') {
    $lines += 'VS Code and VSCodium will both be set up, one after the other (an editor that is not installed is installed for you alone, with no administrator).'
  }

  if ($planLine) {
    if ($planLine.editor.willInstall) {
      $lines += ($planLine.editor.name + ' is not installed here. It will be installed for you alone, with no administrator.')
    }
    else {
      $lines += ($planLine.editor.name + ' ' + $planLine.editor.version + ' is installed here' + $(if ((Get-ChosenEditor) -eq 'both') { '.' } else { ' and will be set up.' }))
    }

    if ((Get-ChosenEditor) -ne 'both') {
      foreach ($other in @($planLine.others | Where-Object { $_ })) {
        $lines += ($other.name + ' is installed too and is left as it is' + $(if (@($planLine.staleBridges | Where-Object { $_.key -eq $other.key }).Count -gt 0) { ' (except its old bridge, below).' } else { '.' }))
      }
    }

    if ($planLine.profile.exists) {
      $lines += ('The "' + $planLine.profile.name + '" profile is there and will be used.')
    }
    else {
      $lines += ('The "' + $planLine.profile.name + '" profile will be made.')
    }

    foreach ($stale in @($planLine.staleBridges | Where-Object { $_ })) {
      $lines += ($stale.name + ' has the board bridge ' + $stale.have + ' in its usual profile: it is updated if it is older than the new one, because an old bridge cannot answer the board.')
    }
  }
  else {
    $lines += 'The plan could not be read. Pressing Set up will still do what the link says.'
  }

  $summary.Text = ($lines -join "`r`n")
  $go.Enabled = $true

  foreach ($radio in $radios.Values) { $radio.Enabled = $true }
}

function Start-PlanFor {
  $go.Enabled = $false
  $script:planData = $null
  $summary.Text = 'Looking at this computer (a few seconds)...'

  foreach ($radio in $radios.Values) { $radio.Enabled = $false }

  $editor = Get-ChosenEditor

  if ($editor -eq 'both') { $editor = 'auto' }

  Start-Engine -ArgumentList ((Get-EngineArguments $options $options.groups $editor) + @('-Mode', 'Plan')) -OnLine $onPlanLine -OnExit $onPlanExit
}

foreach ($radio in $radios.Values) {
  $radio.Add_CheckedChanged({
      # a radio that was just ticked: the plan is read again for it
      if ($this.Checked -and $form.Visible) { Start-PlanFor }
    })
}

# the runs of one press of Set up: one for each editor, one after the other
$script:queue = @()
$script:results = @()

function Start-NextRun {
  if ($script:queue.Count -eq 0) {
    $result.Text = ($script:results -join "`r`n`r`n")
    $result.Visible = $true
    $go.Text = 'Run again'
    $go.Enabled = $true

    foreach ($radio in $radios.Values) { $radio.Enabled = $true }

    return
  }

  $editor = $script:queue[0]
  $script:queue = @($script:queue | Select-Object -Skip 1)
  $script:runData = $null

  if ($editor -ne 'auto') { $log.AppendText("`r`n--- " + $(if ($editor -eq 'code') { 'VS Code' } else { 'VSCodium' }) + " ---`r`n") }

  $chosen = @($boxes.Keys | Where-Object { $boxes[$_].Checked }) -join ','
  $arguments = (Get-EngineArguments $options $chosen $editor) + @('-Mode', 'Run', '-Yes')

  $onRunLine = {
    param($Text)

    try {
      $obj = ConvertFrom-Json -InputObject $Text

      if ($obj.step -eq 'run' -and $obj.status -eq 'done' -and $obj.data) { $script:runData = $obj.data }
      if ($obj.step -ne 'plan') { $log.AppendText((Format-EngineLine $obj) + "`r`n") }
    }
    catch { $log.AppendText($Text + "`r`n") }
  }

  $onRunExit = {
    param($Code)

    $script:results += (Get-ResultText $script:runData $Code)
    Start-NextRun
  }

  Start-Engine -ArgumentList $arguments -OnLine $onRunLine -OnExit $onRunExit
}

$go.Add_Click({
    $go.Enabled = $false
    $cancel.Text = 'Close'
    $result.Visible = $false
    $script:results = @()
    $script:queue = @(Get-EditorQueue)
    $log.Text = 'Working. This can take a few minutes: the editor and its extensions are downloaded. This window stays usable.' + "`r`n"

    foreach ($radio in $radios.Values) { $radio.Enabled = $false }

    Start-NextRun
  })

$form.Add_Shown({ Start-PlanFor })

[void]$form.ShowDialog()
