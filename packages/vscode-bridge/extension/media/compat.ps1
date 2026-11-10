# The shim that lets the editor-window helpers (capture.ps1, window.ps1,
# input.ps1) run on PowerShell 2.0, the one that Windows 7 has (D-477, D-481).
#
# The helpers are DOT-SOURCED from it: `. (Join-Path (Split-Path -Parent
# $MyInvocation.MyCommand.Path) 'compat.ps1')`. (`$PSScriptRoot` is empty in a
# script on PowerShell 2.0, so it is not used.)
#
# What PowerShell 2.0 lacks, and what stands in for it here:
#
#   - `ConvertTo-Json` (PowerShell 3): a function of the same name, written
#     ONLY when the command does not exist, so PowerShell 3 and later keep
#     their own. It writes the same compact text the helpers' reader parses:
#     objects, lists, strings (every non-ASCII character as \uXXXX, so the
#     text survives any console code page), numbers, booleans and null.
#   - `[ordered]@{ ... }` (PowerShell 3): `Ordered 'key' value 'key' value`,
#     which gives an ordered dictionary on every version, so the keys come out
#     in the order they were written.
#   - `[IntPtr]::new(x)` (PowerShell 5): `New-IntPtr x`.
#   - `Add-Type -TypeDefinition` (the C# 3 the helpers are written in): on PowerShell 2.0 the command compiles C# 2,
#     so a function of the same name compiles through CSharpCodeProvider with CompilerVersion=v3.5 (last block).
#
# Nothing here changes what the helpers do on PowerShell 3 and later.

function Ordered {
  # Ordered 'a' 1 'b' 2  ->  an ordered dictionary { a = 1; b = 2 }
  $dictionary = New-Object System.Collections.Specialized.OrderedDictionary
  for ($i = 0; $i -lt $args.Count; $i += 2) {
    $dictionary.Add([string]$args[$i], $args[$i + 1])
  }
  # the leading comma keeps the dictionary from being unrolled into a list
  , $dictionary
}

function New-IntPtr([long]$Value) {
  New-Object System.IntPtr $Value
}

function ConvertTo-JsonText($Value, [int]$Depth) {
  if ($null -eq $Value) { return 'null' }

  if ($Value -is [bool]) {
    if ($Value) { return 'true' } else { return 'false' }
  }

  if ($Value -is [string] -or $Value -is [char]) {
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    foreach ($character in ([string]$Value).ToCharArray()) {
      $code = [int]$character
      if ($character -eq '"') { [void]$builder.Append('\"') }
      elseif ($character -eq '\') { [void]$builder.Append('\\') }
      elseif ($code -eq 8) { [void]$builder.Append('\b') }
      elseif ($code -eq 9) { [void]$builder.Append('\t') }
      elseif ($code -eq 10) { [void]$builder.Append('\n') }
      elseif ($code -eq 12) { [void]$builder.Append('\f') }
      elseif ($code -eq 13) { [void]$builder.Append('\r') }
      elseif ($code -lt 32 -or $code -gt 126) {
        [void]$builder.Append('\u' + $code.ToString('x4'))
      }
      else { [void]$builder.Append($character) }
    }
    [void]$builder.Append('"')
    return $builder.ToString()
  }

  if ($Value -is [System.Enum]) {
    return [string][int]$Value
  }

  if ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or
      $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or
      $Value -is [int64] -or $Value -is [uint64]) {
    return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }

  if ($Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
    return $Value.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
  }

  if ($Value -is [System.IntPtr]) {
    return $Value.ToInt64().ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }

  if ($Depth -le 0) {
    return ConvertTo-JsonText ([string]$Value) 0
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $parts = @()
    foreach ($key in $Value.Keys) {
      $parts += ((ConvertTo-JsonText ([string]$key) 0) + ':' + (ConvertTo-JsonText $Value[$key] ($Depth - 1)))
    }
    return '{' + ($parts -join ',') + '}'
  }

  if ($Value -is [System.Collections.IEnumerable]) {
    $items = @()
    foreach ($item in $Value) {
      $items += (ConvertTo-JsonText $item ($Depth - 1))
    }
    return '[' + ($items -join ',') + ']'
  }

  # any other object: its properties
  $properties = @()
  foreach ($property in $Value.PSObject.Properties) {
    if ($property.MemberType -notmatch 'Property|NoteProperty') { continue }
    $properties += ((ConvertTo-JsonText $property.Name 0) + ':' + (ConvertTo-JsonText $property.Value ($Depth - 1)))
  }
  return '{' + ($properties -join ',') + '}'
}

if (-not (Get-Command ConvertTo-Json -ErrorAction SilentlyContinue)) {
  function ConvertTo-Json {
    param(
      $InputObject,
      [int]$Depth = 2,
      [switch]$Compress
    )
    # the shim always writes the compact form
    ConvertTo-JsonText $InputObject $Depth
  }
}

# `Add-Type -TypeDefinition` on PowerShell 2.0 compiles with the C# 2 compiler, and the helpers' C# uses
# object initializers (`new WindowInfo { Handle = hwnd }`), which are C# 3. The compiler of the .NET 3.5
# runtime that Windows 7 has understands them, so the shim compiles through CSharpCodeProvider with
# CompilerVersion=v3.5. Written ONLY on PowerShell 2.0; the other things Add-Type does (-AssemblyName)
# are handed to the real command.
if ($PSVersionTable.PSVersion.Major -lt 3) {
  function Add-Type {
    param(
      [string]$TypeDefinition,
      [string[]]$ReferencedAssemblies = @(),
      [string[]]$AssemblyName
    )

    if (-not $TypeDefinition) {
      Microsoft.PowerShell.Utility\Add-Type -AssemblyName $AssemblyName
      return
    }

    $options = New-Object 'System.Collections.Generic.Dictionary[System.String,System.String]'
    $options.Add('CompilerVersion', 'v3.5')
    $provider = New-Object Microsoft.CSharp.CSharpCodeProvider -ArgumentList (, $options)

    $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
    $parameters.GenerateInMemory = $true
    $parameters.GenerateExecutable = $false
    foreach ($reference in (@('System') + $ReferencedAssemblies)) {
      $file = [string]$reference
      if (-not $file.EndsWith('.dll', [System.StringComparison]::OrdinalIgnoreCase)) { $file = $file + '.dll' }
      [void]$parameters.ReferencedAssemblies.Add($file)
    }

    $result = $provider.CompileAssemblyFromSource($parameters, $TypeDefinition)
    if ($result.Errors.HasErrors) {
      $messages = @()
      foreach ($e in $result.Errors) { $messages += ('line ' + $e.Line + ': ' + $e.ErrorNumber + ' ' + $e.ErrorText) }
      throw ('the C# did not compile: ' + ($messages -join '; '))
    }
  }
}
