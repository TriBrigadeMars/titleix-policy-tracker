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

app.setAppUserModelId(APP_ID); // set BEFORE window creation

let mainWindow: BrowserWindow | null = null;

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

function buildApplicationMenu(win: BrowserWindow, appOrigin: string): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Exit",
          accelerator: "CommandOrControl+Q",
          click: () => win.close(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Website",
          click: () => {
            if (isSafeExternalUrl(appOrigin)) {
              shell.openExternal(appOrigin);
            }
          },
        },
        {
          type: "separator",
        },
        {
          label: "About Title IX Policy Tracker",
          click: async () => {
            await dialog.showMessageBox(win, {
              type: "info",
              title: "About Title IX Policy Tracker",
              message: APP_NAME,
              detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nChromium ${process.versions.chrome}`,
              buttons: ["OK"],
            });
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
          accelerator: "CommandOrControl+Shift+I",
          click: () => win.webContents.toggleDevTools(),
        },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

function createMainWindow(): void {
  // WP-10: application menu

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
  const appOrigin = urlOrigin(resolveAppUrl(app.isPackaged));
  if (appOrigin === null) {
    console.error("Fatal: app origin could not be resolved from app URL");
  }

    // WP-10: application menu (File, Help, Developer)
      Menu.setApplicationMenu(buildApplicationMenu(win, appOrigin ?? ""));

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

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  app.quit();
});
