<#
  Brings an editor window that is out of reach back to the main display.

  WHY THIS EXISTS (D-360): the Excalidraw Bridge can put the editor's window on a
  virtual display or park it off every display, and the whiteboard's buttons bring
  it back - but those need the whiteboard to be connected, and a window that the
  teacher cannot see cannot be reached to connect it. This file needs nothing:
  not the editor, not the whiteboard, not the extension. Double-click
  `rescue-editor-window.cmd` (it runs this file).

  It looks at every visible window of the editor's program (`Code` by default;
  `-ProcessName VSCodium` for the other build), and a window whose middle is not
  on a REAL display - it is parked at -30000,-30000, or it is on a virtual
  display - is placed on the main display, centred, no bigger than 90 percent of
  the display. A window that is on a real display, and a minimised one, is left
  alone.

  Arguments: -ProcessName <name>   the editor's program (Code)
             -List                 say what would be moved, and move nothing
             -SelfTest             compile and say OK
#>
param(
  [string]$ProcessName = 'Code',
  [switch]$List,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class Rescue {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public int dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }

  public delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);
  public delegate bool WindowProc(IntPtr hwnd, IntPtr data);

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc proc, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, uint index, ref DISPLAY_DEVICE found, uint flags);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowProc proc, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, out RECT rect, uint flags);

  public static void BeDpiAware() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }

  // the REAL displays: a virtual display is one whose adapter names itself virtual
  static List<RECT> RealDisplays() {
    Dictionary<string, string> adapters = new Dictionary<string, string>();
    for (uint i = 0; i < 64; i++) {
      DISPLAY_DEVICE device = new DISPLAY_DEVICE();
      device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref device, 0)) break;
      adapters[device.DeviceName] = device.DeviceString + " | " + device.DeviceID + " | " + device.DeviceKey;
    }

    List<RECT> real = new List<RECT>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data) {
      MONITORINFOEX info = new MONITORINFOEX();
      info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(monitor, ref info)) {
        string text;
        if (!adapters.TryGetValue(info.szDevice, out text)) text = "";
        bool isVirtual = System.Text.RegularExpressions.Regex.IsMatch(text, "virtual|indirect|\\bidd\\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!isVirtual) real.Add(info.rcMonitor);
      }
      return true;
    }, IntPtr.Zero);
    return real;
  }

  public class Found {
    public long Handle;
    public string Title;
    public int X, Y, Width, Height;
    public bool OnRealDisplay;
    public bool Minimised;
  }

  public static List<Found> Windows(string processName) {
    HashSet<uint> pids = new HashSet<uint>();
    foreach (Process p in Process.GetProcessesByName(processName)) { pids.Add((uint)p.Id); }

    List<RECT> real = RealDisplays();
    List<Found> found = new List<Found>();

    EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (!pids.Contains(pid)) return true;
      if (!IsWindowVisible(hwnd)) return true;
      // only a window of its own: an owned one is a dialog or a tool tip
      if (GetWindow(hwnd, 4) != IntPtr.Zero) return true;
      StringBuilder text = new StringBuilder(1024);
      if (GetWindowTextW(hwnd, text, text.Capacity) <= 0) return true;
      RECT r;
      if (!GetWindowRect(hwnd, out r)) return true;
      int width = r.Right - r.Left, height = r.Bottom - r.Top;
      if (width < 300 || height < 200) return true;

      Found f = new Found();
      f.Handle = hwnd.ToInt64();
      f.Title = text.ToString();
      f.X = r.Left; f.Y = r.Top; f.Width = width; f.Height = height;
      f.Minimised = IsIconic(hwnd);
      int mx = r.Left + width / 2, my = r.Top + height / 2;
      foreach (RECT d in real) {
        if (mx >= d.Left && mx < d.Right && my >= d.Top && my < d.Bottom) { f.OnRealDisplay = true; break; }
      }
      found.Add(f);
      return true;
    }, IntPtr.Zero);

    return found;
  }

  // the window goes to the main display, centred, and no bigger than 90 percent of it
  public static string Bring(Found f) {
    RECT work;
    if (!SystemParametersInfo(0x0030, 0, out work, 0)) return "no main display was found";
    IntPtr hwnd = new IntPtr(f.Handle);
    if (IsZoomed(hwnd)) ShowWindow(hwnd, 9);
    int aw = work.Right - work.Left, ah = work.Bottom - work.Top;
    int w = Math.Min(f.Width, (int)(aw * 0.9)), h = Math.Min(f.Height, (int)(ah * 0.9));
    int x = work.Left + (aw - w) / 2, y = work.Top + (ah - h) / 2;
    // SWP_NOZORDER | SWP_SHOWWINDOW
    if (!SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0040)) return "the window did not move";
    return "moved to " + x + "," + y + " " + w + "x" + h;
  }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Core'

if ($SelfTest) {
  Write-Output 'OK'
  exit 0
}

[Rescue]::BeDpiAware()

$windows = @([Rescue]::Windows($ProcessName))
$lost = @($windows | Where-Object { (-not $_.OnRealDisplay) -and (-not $_.Minimised) })

if ($List) {
  $report = @()
  foreach ($w in $windows) {
    $report += [ordered]@{
      title = $w.Title
      x = $w.X
      y = $w.Y
      width = $w.Width
      height = $w.Height
      onRealDisplay = $w.OnRealDisplay
      minimised = $w.Minimised
      wouldMove = ((-not $w.OnRealDisplay) -and (-not $w.Minimised))
    }
  }
  ConvertTo-Json -InputObject @($report) -Compress
  exit 0
}

if ($windows.Count -eq 0) {
  Write-Output "No visible '$ProcessName' window was found."
  exit 0
}

if ($lost.Count -eq 0) {
  Write-Output "Every '$ProcessName' window is on a real display - nothing to rescue."
  exit 0
}

foreach ($w in $lost) {
  $answer = [Rescue]::Bring($w)
  Write-Output ("{0} (was at {1},{2}): {3}" -f $w.Title, $w.X, $w.Y, $answer)
}
