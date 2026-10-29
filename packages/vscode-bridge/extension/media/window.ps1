# The window helper: finds the editor's window by rule, moves it WITHOUT taking
# the focus, and measures what the move did (D-328).
#
# The extension spawns this and reads its stdout. Every line is ONE json
# object, so the reader never has to guess where a record ends:
#
#   -Mode Find       one object: the window the RULE finds
#   -Mode Place      one object: what the placement did
#   -Mode Primary    one object: the work area of the primary display
#
# WHY a helper and not a library: the extension has NO runtime dependency of
# its own, and PowerShell is on every Windows machine - the same reason the
# capture helper (capture.ps1) is a PowerShell script.
#
# WHAT it is for: PARKING. The teacher's editor goes far off every display, and
# it keeps working there - measured on this machine, a VS Code window at
# -30000,-30000 kept drawing its frames to PrintWindow, took every kind of input
# and saved its file. So no virtual display driver is needed (D-329), and none
# is used.
#
# WHY the process is DPI aware: a window's place is read and written in pixels,
# and a process that is not DPI aware reads and writes VIRTUALISED ones - the
# window would be parked at -30000 of one scale and measured at another, and
# the places the input helper delivers to would not be the places in the
# window. Every helper of the extension uses the real pixels.
#
# WHY the window is found BY RULE (D-112, D-113): the window is NOT remembered
# by its handle. The handle changes when the editor recreates its window, and
# `MainWindowHandle` is 0 for a hidden or a minimised one. The rule is the
# editor's process and its TITLE - the workspace folder's name is in it - and the
# lookup does not care whether the window is in front: a window that is parked
# is found exactly like a window on the desktop.
#
# WHY the placement does not activate the window: SWP_NOACTIVATE. The teacher
# is typing in their editor while their window is parked, and a window that
# grabs the focus while it moves takes their keystrokes away. The rule: **the
# window may move, and it may never take the focus** (D-147).
#
# WHY the placement is MEASURED and not believed (D-150): SetWindowPos returns
# TRUE on a MAXIMISED window and the window does not move - Windows puts it
# back to the work area of the display it was on. A tool that believes the
# return value tells the teacher their window is parked when it is not. So a
# maximised window is un-maximised first (SW_RESTORE, which never activates a
# window that is not minimised), the rect is READ BACK afterwards, and the
# answer is the measured one. The rule: **a move that did not happen is never
# reported as one.**
#
# WHY a window can come BACK (D-149): the feature is not a one-way door. The
# same helper puts a window back, and -Maximise puts it back into the maximised
# state it was in before it was parked.
#
# Arguments: -Mode <Find|Place|Primary> -TitleLike <substring>
#            -ProcessName <name> -Handle <n> -X -Y -Width -Height -Maximise
param(
  [ValidateSet('Find', 'Place', 'Primary')][string]$Mode = 'Find',
  [string]$TitleLike = '',
  [string]$ProcessName = '',
  [long]$Handle = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [switch]$Maximise
)

$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinPark {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowTextW(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassNameW(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, out RECT rect, uint flags);

  /// Every pixel this helper reads or writes is a real one.
  public static void BeDpiAware() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
  }

  public class WindowInfo {
    public IntPtr Handle;
    public uint Pid;
    public string Title;
    public string Class;
    public bool Visible;
    public int X, Y, Width, Height;
  }

  /// EVERY top-level window on the machine, with its owner and its title.
  public static WindowInfo[] TopLevelWindows() {
    List<WindowInfo> found = new List<WindowInfo>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      StringBuilder text = new StringBuilder(1024);
      int length = GetWindowTextW(hwnd, text, text.Capacity);
      StringBuilder cls = new StringBuilder(256);
      int classLength = GetClassNameW(hwnd, cls, cls.Capacity);
      RECT rect;
      bool hasRect = GetWindowRect(hwnd, out rect);
      found.Add(new WindowInfo {
        Handle = hwnd,
        Pid = pid,
        Title = length > 0 ? text.ToString() : "",
        Class = classLength > 0 ? cls.ToString() : "",
        Visible = IsWindowVisible(hwnd) && !IsIconic(hwnd),
        X = hasRect ? rect.Left : 0,
        Y = hasRect ? rect.Top : 0,
        Width = hasRect ? rect.Right - rect.Left : 0,
        Height = hasRect ? rect.Bottom - rect.Top : 0
      });
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  /// The work area of the primary display: where a window can be put.
  public static int[] WorkArea() {
    RECT rect;
    if (!SystemParametersInfo(0x0030, 0, out rect, 0)) return new int[] { 0, 0, 0, 0 };
    return new int[] { rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top };
  }

  /// SWP_NOACTIVATE (16) + SWP_NOZORDER (4) + SWP_SHOWWINDOW (64)
  ///
  /// NOACTIVATE is the important one: the window moves and it does NOT take
  /// the focus, so the teacher's keystrokes stay in their editor (D-147).
  public const uint SWP_NOACTIVATE = 16;
  public const uint SWP_NOZORDER = 4;
  public const uint SWP_SHOWWINDOW = 64;
  /// SWP_FRAMECHANGED (32): the frame is recalculated after the style changed.
  public const uint SWP_FRAMECHANGED = 32;

  /// ShowWindow: SW_MAXIMIZE (3) and SW_RESTORE (9).
  ///
  /// SW_MAXIMIZE does NOT activate the window, so the focus stays where the
  /// teacher left it. SW_RESTORE DOES activate a window that was MINIMISED -
  /// so it is never used on a minimised window (D-147).
  public const int SW_MAXIMIZE = 3;
  public const int SW_RESTORE = 9;

  /// The window styles and the window long index.
  ///
  /// WS_MAXIMIZE is the bit that says "this window is maximised". It is read
  /// by the STYLE route, which never activates anything.
  public const int WS_MAXIMIZE = 0x01000000;
  public const int GWL_STYLE = -16;

  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  static extern int GetWindowLong(IntPtr hwnd, int index);

  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr hwnd, int command);

  /// How far the measured rect may be from the requested one, in pixels.
  public const int PLACE_TOLERANCE = 2;

  /// What a placement DID - measured, never believed (D-150).
  ///
  /// SetWindowPos returns TRUE on a MAXIMISED window and the window does not
  /// move: Windows puts it back to the work area of the display it was on. So
  /// the return value is not the answer - the rect is READ BACK afterwards and
  /// the answer is the measured one.
  public class Placement {
    /// is the window where it was asked to be?
    public bool Placed;
    /// did the move call itself succeed?
    public bool Moved;
    /// was the window maximised BEFORE the move?
    public bool WasMaximised;
    /// was the window un-maximised to make the move possible?
    public bool Restored;
    /// is the window maximised now?
    public bool Maximised;
    /// was the window minimised, and therefore left alone?
    public bool Minimised;
    /// the MEASURED rect
    public int X, Y, Width, Height;
    /// why it did not land, when it did not
    public string Reason = "";
  }

  /// The window's rect, READ BACK.
  public static RECT RectOf(IntPtr hwnd) {
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) rect = new RECT();
    return rect;
  }

  /// Is the window MAXIMISED?
  public static bool IsMaximised(IntPtr hwnd) {
    return (GetWindowLong(hwnd, GWL_STYLE) & WS_MAXIMIZE) != 0;
  }

  /// Un-maximise a window WITHOUT taking the focus.
  ///
  /// SW_RESTORE puts the window back into the size and place it had before it
  /// was maximised - and it is the route that WORKS: clearing the style bit
  /// alone leaves the window on its old rectangle, and the move that follows
  /// is then undone by the window itself.
  ///
  /// SW_RESTORE activates a window that was MINIMISED, so it is never called
  /// on one: the caller has already left a minimised window alone (D-147).
  public static bool UnMaximise(IntPtr hwnd) {
    if (!IsMaximised(hwnd)) return false;
    ShowWindow(hwnd, SW_RESTORE);
    return !IsMaximised(hwnd);
  }

  /// Put a window on a rectangle, and MEASURE what happened.
  ///
  /// The rule (D-150): **a move that did not happen is never reported as one.**
  /// So the window is read back and the measured rect is the answer.
  public static Placement Place(IntPtr hwnd, int x, int y, int width, int height, bool maximise) {
    Placement result = new Placement();

    if (!IsWindow(hwnd)) {
      result.Reason = "the window is not there any more";
      return result;
    }

    if (IsIconic(hwnd)) {
      // A MINIMISED window is left alone: restoring it would ACTIVATE it and
      // take the teacher's keystrokes away (D-147).
      result.Minimised = true;
      RECT here = RectOf(hwnd);
      result.X = here.Left;
      result.Y = here.Top;
      result.Width = here.Right - here.Left;
      result.Height = here.Bottom - here.Top;
      result.Reason = "the window is minimised, so it was left where it was - restore it and try again";
      return result;
    }

    result.WasMaximised = IsMaximised(hwnd);
    uint flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW;

    if (result.WasMaximised) {
      // A maximised window does not move: Windows re-maximises it to the work
      // area of the display it is on. So it is un-maximised FIRST - without
      // taking the focus.
      if (UnMaximise(hwnd)) {
        result.Restored = true;
        flags |= SWP_FRAMECHANGED;
      }
    }

    result.Moved = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, flags);

    if (maximise) {
      // SW_MAXIMIZE does not activate the window, so the focus stays where
      // the teacher left it, and the window maximises on the display it is
      // now on.
      ShowWindow(hwnd, SW_MAXIMIZE);
      result.Maximised = IsMaximised(hwnd);
    }

    RECT rect = RectOf(hwnd);
    result.X = rect.Left;
    result.Y = rect.Top;
    result.Width = rect.Right - rect.Left;
    result.Height = rect.Bottom - rect.Top;

    if (maximise) {
      // A maximised window fills the WORK AREA of its display, so its rect is
      // not the one that was asked for: what matters is that it is maximised
      // and that it is ON the display that was asked for.
      result.Placed = result.Moved && result.Maximised && Inside(result, x, y, width, height);
    }
    else {
      result.Placed = result.Moved && Near(result.X, x) && Near(result.Y, y) &&
                      Near(result.Width, width) && Near(result.Height, height);
    }

    if (!result.Placed) {
      result.Reason = string.Format(
        "the window stayed where it was ({0}x{1} at {2},{3}) instead of {4}x{5} at {6},{7}",
        result.Width, result.Height, result.X, result.Y, width, height, x, y);
    }

    return result;
  }

  /// Is the measured rect close enough to the wanted one?
  static bool Near(int measured, int wanted) {
    return Math.Abs(measured - wanted) <= PLACE_TOLERANCE;
  }

  /// Is the measured window's middle inside the rectangle that was asked for?
  static bool Inside(Placement placement, int x, int y, int width, int height) {
    int middleX = placement.X + placement.Width / 2;
    int middleY = placement.Y + placement.Height / 2;
    return middleX >= x - PLACE_TOLERANCE && middleX <= x + width + PLACE_TOLERANCE &&
           middleY >= y - PLACE_TOLERANCE && middleY <= y + height + PLACE_TOLERANCE;
  }
}
'@
Add-Type -TypeDefinition $code

[WinPark]::BeDpiAware()

function Write-Json($value) {
  # one json object per line, so the reader never has to guess where a
  # record ends - and nothing else is ever written to stdout
  Write-Output (ConvertTo-Json -InputObject $value -Compress -Depth 4)
}

try {
  if ($Mode -eq 'Find') {
    $owned = @{}
    if ($ProcessName) {
      Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object {
        $owned[[uint32]$_.Id] = $true
      }
    }

    $matches = @()
    foreach ($candidate in [WinPark]::TopLevelWindows()) {
      if ($ProcessName -and -not $owned.ContainsKey($candidate.Pid)) { continue }
      if ($candidate.Class -eq 'ConsoleWindowClass') { continue }
      if (-not $candidate.Title) { continue }
      if ($TitleLike -and ($candidate.Title.IndexOf($TitleLike, [System.StringComparison]::OrdinalIgnoreCase) -lt 0)) { continue }
      $matches += $candidate
    }

    if ($matches.Count -eq 0) {
      Write-Json ([ordered]@{ found = $false; reason = 'NO_WINDOW' })
    }
    else {
      # the first one that is ON SCREEN wins; a window that is there but
      # hidden is a different, stated fact (D-113)
      $onScreen = @($matches | Where-Object { $_.Visible })
      $chosen = if ($onScreen.Count -gt 0) { $onScreen[0] } else { $matches[0] }
      Write-Json ([ordered]@{
        found   = $true
        visible = ($onScreen.Count -gt 0)
        handle  = $chosen.Handle.ToInt64()
        title   = $chosen.Title
        pid     = $chosen.Pid
        x       = $chosen.X
        y       = $chosen.Y
        width   = $chosen.Width
        height  = $chosen.Height
      })
    }
  }
  elseif ($Mode -eq 'Place') {
    $result = [WinPark]::Place([IntPtr]::new($Handle), $X, $Y, $Width, $Height, [bool]$Maximise)

    # The MEASURED rect, and the truth about the move: a move that did not
    # happen is never reported as one (D-150).
    Write-Json ([ordered]@{
      placed      = $result.Placed
      moved       = $result.Moved
      wasMaximised = $result.WasMaximised
      restored    = $result.Restored
      maximised   = $result.Maximised
      minimised   = $result.Minimised
      handle      = $Handle
      measuredX   = $result.X
      measuredY   = $result.Y
      measuredWidth  = $result.Width
      measuredHeight = $result.Height
      reason      = $result.Reason
    })
  }
  elseif ($Mode -eq 'Primary') {
    $area = [WinPark]::WorkArea()
    Write-Json ([ordered]@{ x = $area[0]; y = $area[1]; width = $area[2]; height = $area[3] })
  }
}
catch {
  # a failure is a MESSAGE, not a silence
  Write-Json ([ordered]@{ error = $_.Exception.Message })
  exit 1
}
