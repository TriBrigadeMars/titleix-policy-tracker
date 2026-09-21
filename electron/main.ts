import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  APP_ID,
  APP_NAME,
  DESKTOP_DEFAULT_HEIGHT,
  DESKTOP_DEFAULT_WIDTH,
  DESKTOP_MIN_HEIGHT,
  DESKTOP_MIN_WIDTH,
  resolveAppUrl,
  urlOrigin,
  authAllowlistOrigins,
} from "./constants";
import {
  isBoundsVisibleOnAnyDisplay,
  parseSavedBounds,
  resolveInitialBounds,
  type WindowBounds,
} from "./window-state";
import {
  classifyUrl,
  createAuthFlowGuard,
  isSafeExternalUrl,
} from "./security";

// WP-09: single-instance lock

// WP-09B: zoom clamp range enforced by the View menu
export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 3.0;
const ZOOM_STEP = 0.1;

/**
 * Step the zoom factor of a window by `delta`, clamped strictly to
 * [MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR]. Reads the current factor so repeated
 * accelerators accumulate exactly one step per press. Safe when the window is
 * destroyed (no-op).
 */
export function adjustZoom(win: BrowserWindow, delta: number): void {
  if (win.isDestroyed()) {
    return;
  }
  const next = Math.min(
    MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, win.webContents.getZoomFactor() + delta),
  );
  win.webContents.setZoomFactor(next);
}

/**
 * Zoom the window to the given factor, clamped strictly to the same range as
 * zoom in/out. Safe when the window is destroyed (no-op).
 */
export function setZoom(win: BrowserWindow, factor: number): void {
  if (win.isDestroyed()) {
    return;
  }
  const clamped = Math.min(
    MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, factor),
  );
  win.webContents.setZoomFactor(clamped);
}

app.setAppUserModelId(APP_ID); // set BEFORE window creation

const appOrigin = urlOrigin(resolveAppUrl(app.isPackaged));

let mainWindow: BrowserWindow | null = null;

/**
 * Build the native application menu. WP-09B adds the View submenu with zoom
 * clamping and full-screen controls. Menu item handlers resolve the window
 * from `mainWindow` at click time, and the template is rebuilt on
 * `browser-window-focus` (see `app.whenReady`) so accelerators keep working
 * after a loss/re-gain of focus (macOS drops F11 on blur).
 */
function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Exit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              target.close();
            }
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              target.webContents.reload();
            }
          },
        },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              setZoom(target, 1.0);
            }
          },
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              adjustZoom(target, ZOOM_STEP);
            }
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              adjustZoom(target, -ZOOM_STEP);
            }
          },
        },
        { type: "separator" },
        {
          label: "Toggle Full Screen",
          accelerator: "F11",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              target.setFullScreen(!target.isFullScreen());
            }
          },
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Website",
          click: () => {
            if (appOrigin && isSafeExternalUrl(appOrigin)) {
              shell.openExternal(appOrigin);
            }
          },
        },
        {
          label: "About Title IX Policy Tracker",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              dialog.showMessageBox(target, {
                type: "info",
                title: "About",
                message: APP_NAME,
                detail: [
                  `Version: ${app.getVersion()}`,
                  `Electron: ${process.versions.electron}`,
                  `Chrome: ${process.versions.chrome}`,
                ].join("\n"),
              });
            }
          },
        },
      ],
    },
  ];

  if (!app.isPackaged) {
    template.push({
      label: "Developer",
      submenu: [
        {
          label: "Open DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => {
            const target = mainWindow;
            if (target && !target.isDestroyed()) {
              target.webContents.toggleDevTools();
            }
          },
        },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

function getWindowStateFilePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readSavedBounds(): string | null {
  try {
    return fs.readFileSync(getWindowStateFilePath(), "utf8");
  } catch {
    return null;
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) {
      return;
    }
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    const state: WindowBounds = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: isMaximized,
    };
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(state), "utf8");
  } catch (error) {
    console.error("Failed to save window state:", error);
  }
}

function createMainWindow(): void {
  const savedRaw = readSavedBounds();
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const initialBounds = resolveInitialBounds(savedRaw, displays);

  const win = new BrowserWindow({
    title: APP_NAME,
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: DESKTOP_MIN_WIDTH,
    minHeight: DESKTOP_MIN_HEIGHT,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow = win;

  // WP-09B: native application menu (View: reload, zoom, full screen)
  Menu.setApplicationMenu(buildAppMenu());

  if (initialBounds.maximized) {
    win.maximize();
  }

  let saveTimeout: NodeJS.Timeout | null = null;
  const debouncedSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveWindowState(win);
    }, 250);
  };

  win.on("resize", debouncedSave);
  win.on("move", debouncedSave);

  win.on("close", () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    saveWindowState(win);
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  // WP-07: navigation lockdown
  if (appOrigin === null) {
    console.error("Fatal: app origin could not be resolved from app URL");
  }
  const authOrigins = authAllowlistOrigins(appOrigin ?? "");
  const guard = createAuthFlowGuard();

  // Mark the auth flow active when navigation to /sign-in begins, and
  // inactive once the loaded URL is back on the app origin with a path
  // other than /sign-in.
  const isSignInPath = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.origin === appOrigin && parsed.pathname.startsWith("/sign-in");
    } catch {
      return false;
    }
  };

  win.webContents.on("will-navigate", (_event, url) => {
    if (isSignInPath(url)) {
      guard.begin();
    }
  });

  win.webContents.on("did-navigate", (_event, url) => {
    if (appOrigin !== null && url.startsWith(appOrigin) && !isSignInPath(url)) {
      guard.end();
    }
  });

  win.webContents.on("did-finish-load", () => {
    const url = win.webContents.getURL();
    if (appOrigin !== null && url.startsWith(appOrigin) && !isSignInPath(url)) {
      guard.end();
    }
  });

  win.webContents.on("will-navigate", (event, url) => {
    const action = classifyUrl(url, appOrigin ?? "", authOrigins, guard.isActive());
    if (action.kind === "ALLOW") {
      // in-app navigation — allow
    } else if (action.kind === "OPEN_EXTERNAL") {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url);
      }
    } else {
      // BLOCK
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const action = classifyUrl(url, appOrigin ?? "", authOrigins, guard.isActive());
    if (action.kind === "ALLOW") {
      return { action: "allow" };
    }
    if (action.kind === "OPEN_EXTERNAL") {
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    }
    // BLOCK or anything unclassifiable
    return { action: "deny" };
  });

  // Defense in depth: the app doesn't use webviews; block them entirely.
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  // WP-11: offline handling

  try {
    const appUrl = resolveAppUrl(app.isPackaged);
    win.loadURL(appUrl);
  } catch (error) {
    console.error("Fatal configuration error:", error);
    const errorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Configuration Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
    }
    .card {
      max-width: 480px;
      padding: 32px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    h1 {
      margin-top: 0;
      font-size: 1.25rem;
      color: #dc2626;
    }
    p {
      margin-bottom: 0;
      line-height: 1.5;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Configuration Error</h1>
    <p>Desktop application configuration is missing or invalid (DESKTOP_APP_URL). Please reinstall or contact support.</p>
  </div>
</body>
</html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  }
}

app.whenReady().then(() => {
  createMainWindow();

  // WP-09B: keep menu accelerators working when the window regains focus.
  // macOS strips F11 when the app loses focus, so the menu template is
  // rebuilt with the active window on every focus.
  app.on("browser-window-focus", () => {
    Menu.setApplicationMenu(buildAppMenu());
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
