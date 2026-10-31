# The input helper: the mouse and the keyboard of the canvas, delivered to the
# editor's OWN window (D-323, D-325, D-326).
#
# The extension spawns this ONCE while Control is on, writes one line to its
# stdin for each event, and reads what it says off its stdout:
#
#   stdin   P <move|down|up> <x> <y> <l|m|r> <mods>      a pointer event
#           W <x> <y> <dx> <dy> <mods>                   the wheel, in notches
#           K <down|up> <vk> <char> <mods>               a key (char: a code point or 0)
#           T <base64 of the UTF-8 text>                 a typed text
#   stdout  ROUTE <background|focus|none> <the reason>   which way the input goes, and why
#           STATUS <text>                                 something the teacher should read
#
# A place is a FRACTION of the window's client area (D-324); the helper turns it
# into pixels only here, at the moment of delivery, so the same place is the same
# place whatever the size of the window and the DPI of the screen.
#
# WHY the window is found BY RULE and never by a remembered handle (D-112,
# D-113): the process the extension named, and the workspace folder's name in the
# title. The title rule is STRICT here - the capture may fall back to any window
# of the editor, but input must never go into a window of another folder.
#
# THE TWO ROUTES
#
# background (D-325) - measured on this machine on 2026-10-29 against a real VS
# Code window that was NOT in front and then parked far off every display:
# messages POSTED to the window's page (its `Chrome_RenderWidgetHostHWND`) are
# enough for the mouse (move, press, release, double click, drag, the wheel) and
# the keyboard (characters, Enter, Backspace, the arrows). The teacher's own
# focus, keyboard and mouse are never touched. Three things were learned:
#
#   - a MODIFIER is read by Chromium from the thread's KEY STATE and not from the
#     message, so Ctrl+S did nothing from posts alone. It worked once the key
#     state was SHARED with the window's thread (AttachThreadInput) and the
#     modifier was set in it with SetKeyboardState. The state is set when an event
#     needs it, it is left alone while the events keep coming, and it is put back
#     when they stop - after Chromium has had the time to read it;
#   - Enter, Tab and Backspace are KEYS, not characters: a carriage return posted
#     as a character is ignored. A printed character is posted as a CHARACTER and
#     nothing else: the window's own message loop turns a posted KEY into a
#     character too (TranslateMessage), so a key posted beside its character
#     types it twice - found in a real run, not in a test with a fake;
#   - a wheel message carries the place on the SCREEN, not in the window.
#
# focus (D-326) - the graceful fall-back, for a window that has no page to post
# to, and for a teacher who chose it: REAL input (SendInput). For the length of a
# burst of events the window is brought to the front; when the burst has been
# quiet for a moment the window that was in front is put back, the modifiers are
# released and the pointer returns to where the teacher left it. It needs the
# window ON a display.
#
# Arguments: -ProcessName <name> -TitleLike <substring> -Route <auto|background|focus>
#            -SelfTest   compile, say OK and leave (the tests use it)
param(
  [string]$ProcessName = 'Code',
  [string]$TitleLike = '',
  [ValidateSet('auto', 'background', 'focus')][string]$Route = 'auto',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class InputEngine {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }

  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder t, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder t, int max);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern bool SetKeyboardState(byte[] s);
  [DllImport("user32.dll")] static extern uint MapVirtualKeyW(uint code, uint type);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);

  const uint WM_MOUSEMOVE = 0x0200, WM_MOUSEWHEEL = 0x020A, WM_MOUSEHWHEEL = 0x020E;
  const uint WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_CHAR = 0x0102, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
  const int MOD_CTRL = 1, MOD_SHIFT = 2, MOD_ALT = 4;

  static string processName = "", titleLike = "", routeSetting = "auto";
  static IntPtr top = IntPtr.Zero, render = IntPtr.Zero;
  static string route = "", routeReason = "";
  static DateTime resolvedAt = DateTime.MinValue;
  static DateTime lastEvent = DateTime.MinValue;
  static DateTime lastModsEvent = DateTime.MinValue;
  static int held = 0;
  static int heldKey = 0;
  static int appliedMods = 0;
  static uint attachedTo = 0;
  static int lastDownTick = 0, lastDownX = 0, lastDownY = 0;
  static char lastDownButton = ' ';
  static bool burst = false;
  // a button of the mouse is down on the focus route: only then does a move
  // have to drag the real pointer
  static bool focusPressed = false;
  static IntPtr prevForeground = IntPtr.Zero;
  static POINT prevCursor;
  static int focusMods = 0;
  static BlockingCollection<string> queue = new BlockingCollection<string>();

  static void Say(string line) {
    Console.Out.WriteLine(line);
    Console.Out.Flush();
  }

  // ------------------------------------------------------------ the window, by rule

  static IntPtr FindWindow() {
    HashSet<uint> pids = new HashSet<uint>();
    foreach (Process p in Process.GetProcessesByName(processName)) { pids.Add((uint)p.Id); }
    IntPtr best = IntPtr.Zero;
    bool bestVisible = false;
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (!pids.Contains(pid)) return true;
      StringBuilder cls = new StringBuilder(256);
      GetClassNameW(hwnd, cls, cls.Capacity);
      if (cls.ToString() == "ConsoleWindowClass") return true;
      StringBuilder text = new StringBuilder(1024);
      int length = GetWindowTextW(hwnd, text, text.Capacity);
      if (length <= 0) return true;
      if (titleLike.Length > 0 && text.ToString().IndexOf(titleLike, StringComparison.OrdinalIgnoreCase) < 0) return true;
      bool visible = IsWindowVisible(hwnd);
      if (best == IntPtr.Zero || (visible && !bestVisible)) { best = hwnd; bestVisible = visible; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  static IntPtr FindRender(IntPtr parent) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr lParam) {
      StringBuilder cls = new StringBuilder(256);
      GetClassNameW(hwnd, cls, cls.Capacity);
      if (cls.ToString() == "Chrome_RenderWidgetHostHWND") { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // says the way in, once - and whether it said anything
  static bool Announce(string next, string reason) {
    if (next == route && reason == routeReason) return false;
    route = next;
    routeReason = reason;
    Say("ROUTE " + next + " " + reason);
    return true;
  }

  static void Resolve(bool force) {
    if (!force && top != IntPtr.Zero && IsWindow(top) && (DateTime.UtcNow - resolvedAt).TotalSeconds < 5) return;
    top = FindWindow();
    render = IntPtr.Zero;
    resolvedAt = DateTime.UtcNow;
    if (top == IntPtr.Zero) {
      Announce("none", "no editor window was found to control");
      return;
    }
    render = FindRender(top);
    bool onDisplay = MonitorFromWindow(top, 0) != IntPtr.Zero;
    if (routeSetting == "focus" || (routeSetting == "auto" && render == IntPtr.Zero)) {
      string why = routeSetting == "focus"
        ? "real input was chosen: the editor's window is brought to the front for a moment"
        : "this window has no page to post input to, so the input goes with the focus";
      if (!onDisplay) {
        // real input goes to the window in front, and a parked window is on no
        // display: the extension is asked to bring it back (once per change)
        if (Announce("none", "real input needs the editor's window on a display - it is being brought back")) {
          Say("NEED display");
        }
      } else {
        Announce("focus", why);
      }
      return;
    }
    if (render == IntPtr.Zero) {
      Announce("none", "this window has no page to post input to - choose real input in the settings");
      return;
    }
    Announce("background", "input goes to the editor's window without taking the focus");
  }

  // ------------------------------------------------------------ places

  static POINT ClientPixel(double fx, double fy) {
    RECT cr;
    GetClientRect(top, out cr);
    int w = Math.Max(1, cr.Right - cr.Left), h = Math.Max(1, cr.Bottom - cr.Top);
    POINT p = new POINT();
    p.X = Math.Min(w - 1, Math.Max(0, (int)Math.Round(fx * (w - 1))));
    p.Y = Math.Min(h - 1, Math.Max(0, (int)Math.Round(fy * (h - 1))));
    return p;
  }

  static POINT ScreenPixel(double fx, double fy) {
    POINT p = ClientPixel(fx, fy);
    ClientToScreen(top, ref p);
    return p;
  }

  static IntPtr Pack(int lo, int hi) {
    return new IntPtr(unchecked((int)(((uint)(hi & 0xFFFF) << 16) | (uint)(lo & 0xFFFF))));
  }

  static void Post(IntPtr window, uint msg, long w, IntPtr l) {
    PostMessageW(window, msg, new IntPtr(w), l);
  }

  static int ModFlags(int mods) {
    return ((mods & MOD_CTRL) != 0 ? 0x0008 : 0) | ((mods & MOD_SHIFT) != 0 ? 0x0004 : 0);
  }

  static bool IsExtended(int vk) {
    return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x6F;
  }

  // ------------------------------------------------------------ modifiers (background)

  static void SetState(byte[] st, int generic, int left, bool on) {
    st[generic] = (byte)(on ? 0x80 : 0);
    st[left] = (byte)(on ? 0x80 : 0);
  }

  // Share the key state with the window's thread and set the modifiers in it.
  // Chromium reads a modifier from the thread's key state, not from the message.
  static void SyncMods(int mods) {
    if (mods == appliedMods) return;
    if (mods == 0) {
      // the events that needed the modifiers may still be waiting in the
      // window's queue: they get the time to be read before the state goes back
      double since = (DateTime.UtcNow - lastModsEvent).TotalMilliseconds;
      if (since < 40) Thread.Sleep((int)(40 - since));
    }
    uint pid;
    uint target = GetWindowThreadProcessId(top, out pid);
    if (mods != 0 && attachedTo == 0) {
      AttachThreadInput(GetCurrentThreadId(), target, true);
      attachedTo = target;
    }
    if (attachedTo != 0) {
      byte[] st = new byte[256];
      GetKeyboardState(st);
      SetState(st, 0x11, 0xA2, (mods & MOD_CTRL) != 0);
      SetState(st, 0x10, 0xA0, (mods & MOD_SHIFT) != 0);
      SetState(st, 0x12, 0xA4, (mods & MOD_ALT) != 0);
      SetKeyboardState(st);
    }
    appliedMods = mods;
    if (mods == 0 && attachedTo != 0) {
      AttachThreadInput(GetCurrentThreadId(), attachedTo, false);
      attachedTo = 0;
    }
  }

  // ------------------------------------------------------------ the background route

  static void PointerBackground(string action, double x, double y, char button, int mods) {
    if (render == IntPtr.Zero) return;
    SyncMods(mods);
    if (mods != 0) lastModsEvent = DateTime.UtcNow;
    POINT p = ScreenPixel(x, y);
    ScreenToClient(render, ref p);
    IntPtr lp = Pack(p.X, p.Y);
    int flags = ModFlags(mods);
    if (action == "move") {
      Post(render, WM_MOUSEMOVE, held | flags, lp);
      return;
    }
    int bit = button == 'r' ? 0x0002 : (button == 'm' ? 0x0010 : 0x0001);
    uint down = button == 'r' ? 0x0204u : (button == 'm' ? 0x0207u : 0x0201u);
    if (action == "down") {
      // a second quick press of the same button, near the first, is a double
      // click - the way Windows makes one
      int now = Environment.TickCount;
      bool dbl = lastDownButton == button && (uint)(now - lastDownTick) <= GetDoubleClickTime() &&
                 Math.Abs(p.X - lastDownX) <= 4 && Math.Abs(p.Y - lastDownY) <= 4;
      held |= bit;
      Post(render, dbl ? (uint)(down + 2) : down, held | flags, lp);
      lastDownButton = dbl ? ' ' : button;
      lastDownTick = now;
      lastDownX = p.X;
      lastDownY = p.Y;
    } else {
      held &= ~bit;
      Post(render, (uint)(down + 1), held | flags, lp);
    }
  }

  static void WheelBackground(double x, double y, double dx, double dy, int mods) {
    if (render == IntPtr.Zero) return;
    SyncMods(mods);
    if (mods != 0) lastModsEvent = DateTime.UtcNow;
    POINT s = ScreenPixel(x, y);
    // the place of a wheel message is on the SCREEN, and it is 16 bits each
    IntPtr lp = Pack(Math.Max(-32767, Math.Min(32767, s.X)), Math.Max(-32767, Math.Min(32767, s.Y)));
    int flags = held | ModFlags(mods);
    int vertical = (int)Math.Round(-dy * 120);
    int horizontal = (int)Math.Round(dx * 120);
    if (vertical != 0) Post(render, WM_MOUSEWHEEL, (long)((vertical << 16) | flags), lp);
    if (horizontal != 0) Post(render, WM_MOUSEHWHEEL, (long)((horizontal << 16) | flags), lp);
  }

  static void KeyBackground(bool down, int vk, int ch, int mods) {
    if (render == IntPtr.Zero) return;
    SyncMods(mods);
    if (mods != 0) lastModsEvent = DateTime.UtcNow;

    // A key that types a character is that CHARACTER, posted as one. Posting
    // the key as well would type it twice: the window's own message loop turns
    // a posted key into a character (TranslateMessage), as it does for Enter
    // and Backspace - found in a real run on 2026-10-29. The character is the
    // one the teacher's own key made, so a layout that is not US types what it
    // typed. A key that types nothing (Enter, an arrow, a shortcut) is a key.
    if (ch != 0 && (mods & (MOD_CTRL | MOD_ALT)) == 0) {
      if (down) {
        foreach (char unit in char.ConvertFromUtf32(ch)) { Post(render, WM_CHAR, unit, new IntPtr(1)); }
      }
      return;
    }

    bool alt = (mods & MOD_ALT) != 0;
    long scan = MapVirtualKeyW((uint)vk, 0);
    long lp = 1 | (scan << 16) | (IsExtended(vk) ? (1L << 24) : 0) | (alt ? (1L << 29) : 0);
    if (down) {
      bool repeat = heldKey == vk;
      heldKey = vk;
      Post(render, alt ? WM_SYSKEYDOWN : WM_KEYDOWN, vk, new IntPtr(lp | (repeat ? (1L << 30) : 0)));
      // Enter, Tab and Backspace become their character INSIDE the window, at
      // the end of its queue: what is posted right behind them would be typed
      // first, and a text with a line feed in it came out in the wrong order in
      // a real run. A short settle lets the window make the character before
      // the next message is posted.
      if (vk == 0x0D || vk == 0x09 || vk == 0x08) Thread.Sleep(15);
    } else {
      heldKey = 0;
      Post(render, alt ? WM_SYSKEYUP : WM_KEYUP, vk, new IntPtr(lp | (1L << 30) | (1L << 31)));
    }
  }

  static void TextBackground(string text) {
    if (render == IntPtr.Zero) return;
    SyncMods(0);
    for (int i = 0; i < text.Length; i++) {
      char c = text[i];
      if (c == '\r' || c == '\n') {
        if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
        KeyBackground(true, 0x0D, 0, 0);
        KeyBackground(false, 0x0D, 0, 0);
      } else if (c == '\t') {
        KeyBackground(true, 0x09, 0, 0);
        KeyBackground(false, 0x09, 0, 0);
      } else {
        Post(render, WM_CHAR, c, new IntPtr(1));
      }
    }
  }

  // ------------------------------------------------------------ the focus route

  static void Send(INPUT input) {
    INPUT[] one = new INPUT[] { input };
    SendInput(1, one, Marshal.SizeOf(typeof(INPUT)));
  }

  static void SendMouse(uint flags, uint data, int dx, int dy) {
    INPUT i = new INPUT();
    i.type = 0;
    i.u.mi.dwFlags = flags;
    i.u.mi.mouseData = data;
    i.u.mi.dx = dx;
    i.u.mi.dy = dy;
    Send(i);
  }

  static void SendKey(int vk, int unicode, bool down) {
    INPUT i = new INPUT();
    i.type = 1;
    uint flags = down ? 0u : 2u;
    if (unicode != 0) {
      i.u.ki.wScan = (ushort)unicode;
      flags |= 4u;
    } else {
      i.u.ki.wVk = (ushort)vk;
      i.u.ki.wScan = (ushort)MapVirtualKeyW((uint)vk, 0);
      if (IsExtended(vk)) flags |= 1u;
    }
    i.u.ki.dwFlags = flags;
    Send(i);
  }

  // Take the editor's window to the front (D-342).
  //
  // Windows lets only the program that has the foreground - or one that has just
  // had input - give it to another window, so a helper that was started by the
  // editor is refused whenever the teacher is working in the browser. The
  // refusals are answered in turn: the threads are attached to each other; a
  // key that does nothing (F24) is tapped, which makes this program the one that
  // has just had input; and the shell's own way of switching to a window is the
  // last resort.
  static bool Front() {
    if (IsIconic(top)) ShowWindow(top, 9);
    for (int attempt = 0; attempt < 3; attempt++) {
      IntPtr fg = GetForegroundWindow();
      uint pid;
      uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out pid);
      uint me = GetCurrentThreadId();
      bool attach = fgThread != me && fgThread != 0;
      if (attempt == 1) {
        keybd_event(0x87, 0, 0, UIntPtr.Zero);
        keybd_event(0x87, 0, 2, UIntPtr.Zero);
      }
      if (attach) AttachThreadInput(me, fgThread, true);
      BringWindowToTop(top);
      SetForegroundWindow(top);
      if (attempt == 2) SwitchToThisWindow(top, true);
      if (attach) AttachThreadInput(me, fgThread, false);
      Thread.Sleep(40);
      if (GetForegroundWindow() == top) return true;
    }
    return false;
  }

  static bool BeginBurst() {
    if (MonitorFromWindow(top, 0) == IntPtr.Zero) {
      Say("STATUS real input needs the editor's window on a display - bring it back first");
      return false;
    }
    if (!burst) {
      prevForeground = GetForegroundWindow();
      GetCursorPos(out prevCursor);
      burst = true;
    }
    if (GetForegroundWindow() != top && !Front()) {
      Say("STATUS the editor's window would not come to the front");
      return false;
    }
    return true;
  }

  static void EndBurst() {
    if (!burst) return;
    FocusMods(0);
    focusPressed = false;
    if (prevForeground != IntPtr.Zero && prevForeground != top && IsWindow(prevForeground)) {
      SetForegroundWindow(prevForeground);
    }
    SetCursorPos(prevCursor.X, prevCursor.Y);
    burst = false;
  }

  static void FocusMods(int mods) {
    if (mods == focusMods) return;
    if (((mods ^ focusMods) & MOD_CTRL) != 0) SendKey(0x11, 0, (mods & MOD_CTRL) != 0);
    if (((mods ^ focusMods) & MOD_SHIFT) != 0) SendKey(0x10, 0, (mods & MOD_SHIFT) != 0);
    if (((mods ^ focusMods) & MOD_ALT) != 0) SendKey(0x12, 0, (mods & MOD_ALT) != 0);
    focusMods = mods;
  }

  static void MoveTo(POINT s) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int ax = (int)((long)(s.X - vx) * 65535 / Math.Max(1, vw - 1));
    int ay = (int)((long)(s.Y - vy) * 65535 / Math.Max(1, vh - 1));
    SendMouse(0x8000u | 0x4000u | 0x0001u, 0, ax, ay);
  }

  static void PointerFocus(string action, double x, double y, char button, int mods) {
    // A move with no button down is a HOVER, and on this route a hover would
    // take the teacher's real pointer out of the page they are working in
    // and into the editor, again for every move they make. The window is not
    // brought forward for it either (D-337).
    if (action == "move" && !focusPressed) return;
    if (!BeginBurst()) return;
    FocusMods(mods);
    MoveTo(ScreenPixel(x, y));
    if (action == "move") return;
    bool down = action == "down";
    focusPressed = down;
    uint flag = button == 'r' ? (down ? 0x0008u : 0x0010u) : (button == 'm' ? (down ? 0x0020u : 0x0040u) : (down ? 0x0002u : 0x0004u));
    SendMouse(flag, 0, 0, 0);
  }

  static void WheelFocus(double x, double y, double dx, double dy, int mods) {
    if (!BeginBurst()) return;
    FocusMods(mods);
    MoveTo(ScreenPixel(x, y));
    int vertical = (int)Math.Round(-dy * 120);
    int horizontal = (int)Math.Round(dx * 120);
    if (vertical != 0) SendMouse(0x0800u, unchecked((uint)vertical), 0, 0);
    if (horizontal != 0) SendMouse(0x1000u, unchecked((uint)horizontal), 0, 0);
  }

  static void KeyFocus(bool down, int vk, int ch, int mods) {
    if (!BeginBurst()) return;
    FocusMods(mods);
    if (ch != 0 && (mods & (MOD_CTRL | MOD_ALT)) == 0) {
      // a printed character is typed as itself, whatever the layout
      if (down) {
        foreach (char unit in char.ConvertFromUtf32(ch)) { SendKey(0, unit, true); SendKey(0, unit, false); }
      }
      return;
    }
    SendKey(vk, 0, down);
  }

  static void TextFocus(string text) {
    if (!BeginBurst()) return;
    FocusMods(0);
    for (int i = 0; i < text.Length; i++) {
      char c = text[i];
      if (c == '\r' || c == '\n') {
        if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
        SendKey(0x0D, 0, true); SendKey(0x0D, 0, false);
      } else if (c == '\t') {
        SendKey(0x09, 0, true); SendKey(0x09, 0, false);
      } else {
        SendKey(0, c, true); SendKey(0, c, false);
      }
    }
  }

  // ------------------------------------------------------------ the loop

  static double Num(string s) {
    return double.Parse(s, CultureInfo.InvariantCulture);
  }

  static void Handle(string line) {
    string[] f = line.Split(' ');
    if (f.Length == 0 || f[0].Length == 0) return;
    // "R": look again now - the extension has brought the window back
    if (f[0] == "R") {
      Resolve(true);
      return;
    }
    Resolve(false);
    if (top == IntPtr.Zero || route == "none") return;
    lastEvent = DateTime.UtcNow;
    bool background = route == "background";
    // On the focus route the KEYBOARD is real input - it goes to the window in
    // front - but the mouse is posted to the window's page as on the other
    // route (D-355): a real click has to take the teacher's own pointer to the
    // editor's window and bring it back, and that was what made clicks bad.
    bool postMouse = background || (routeSetting == "focus" && render != IntPtr.Zero);
    switch (f[0]) {
      case "P": {
        char button = f.Length > 4 && f[4].Length > 0 ? f[4][0] : 'l';
        int mods = f.Length > 5 ? int.Parse(f[5], CultureInfo.InvariantCulture) : 0;
        if (postMouse) PointerBackground(f[1], Num(f[2]), Num(f[3]), button, mods);
        else PointerFocus(f[1], Num(f[2]), Num(f[3]), button, mods);
        break;
      }
      case "W": {
        int mods = int.Parse(f[5], CultureInfo.InvariantCulture);
        if (postMouse) WheelBackground(Num(f[1]), Num(f[2]), Num(f[3]), Num(f[4]), mods);
        else WheelFocus(Num(f[1]), Num(f[2]), Num(f[3]), Num(f[4]), mods);
        break;
      }
      case "K": {
        bool down = f[1] == "down";
        int vk = int.Parse(f[2], CultureInfo.InvariantCulture);
        int ch = int.Parse(f[3], CultureInfo.InvariantCulture);
        int mods = int.Parse(f[4], CultureInfo.InvariantCulture);
        if (background) KeyBackground(down, vk, ch, mods);
        else KeyFocus(down, vk, ch, mods);
        break;
      }
      case "T": {
        string text = Encoding.UTF8.GetString(Convert.FromBase64String(f[1]));
        if (background) TextBackground(text);
        else TextFocus(text);
        break;
      }
    }
  }

  // what is left to do when the events have stopped coming
  static void Idle() {
    double quiet = (DateTime.UtcNow - lastEvent).TotalMilliseconds;
    if (appliedMods != 0 && quiet > 250) SyncMods(0);
    // the window stays in front through a pause in the typing and the pointer
    // is given back after it, so a burst is not paid for again at every word
    if (burst && quiet > 1500) EndBurst();
    // Without the way in (none), and on the focus route (a window that is
    // parked in the meantime is on no display any more), the window is looked
    // at again every two seconds: the background route does not care where the
    // window is.
    if ((route == "none" || route == "focus") && !burst &&
        (DateTime.UtcNow - resolvedAt).TotalSeconds >= 2) Resolve(true);
  }

  public static void Release() {
    if (appliedMods != 0) SyncMods(0);
    EndBurst();
    if (held != 0 && render != IntPtr.Zero && IsWindow(render)) {
      held = 0;
    }
  }

  public static void Run(string process, string title, string setting) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    processName = process;
    titleLike = title;
    routeSetting = setting;
    Thread reader = new Thread(delegate() {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) queue.Add(line);
      } catch (Exception) { }
      queue.CompleteAdding();
    });
    reader.IsBackground = true;
    reader.Start();
    Resolve(true);
    while (true) {
      string line;
      if (queue.TryTake(out line, 120)) {
        try { Handle(line); } catch (Exception e) { Say("STATUS " + e.Message); }
      } else if (queue.IsCompleted) {
        break;
      }
      Idle();
    }
    Release();
  }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Core'

if ($SelfTest) {
  Write-Output 'OK'
  exit 0
}

[InputEngine]::Run($ProcessName, $TitleLike, $Route)
