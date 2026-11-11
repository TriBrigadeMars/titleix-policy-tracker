import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  safeStorage,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  APP_ID,
  APP_NAME,
  DESKTOP_MIN_HEIGHT,
  DESKTOP_MIN_WIDTH,
  LOCAL_HOST,
  LOCAL_SCHEME,
  VERSION_ARG_PREFIX,
  authAllowlistOrigins,
  isLocalModeUrl,
  resolveAppUrl,
  urlOrigin,
} from "./constants";
import {
  readEncryptedKeyringFallback,
  readIngestKeysFromKeyring,
} from "./keyring";
import {
  proxyCustomSchemeToSocket,
  resolveShellConfigDir,
  startManagedLocalServer,
  type ManagedLocalServer,
} from "./local-runtime";
import {
  classifyUrl,
  createAuthFlowGuard,
  isNetworkError,
  isSafeExternalUrl,
} from "./security";
import { resolveInitialBounds, type WindowBounds } from "./window-state";

export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 3.0;
const ZOOM_STEP = 0.1;

export function adjustZoom(win: BrowserWindow, delta: number): void {
  if (win.isDestroyed()) {
    return;
  }
  const next = Math.min(
    MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, win.webContents.getZoomFactor() + delta)
  );
  win.webContents.setZoomFactor(next);
}

export function setZoom(win: BrowserWindow, factor: number): void {
  if (win.isDestroyed()) {
    return;
  }
  const clamped = Math.min(
    MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, factor)
  );
  win.webContents.setZoomFactor(clamped);
}

// Register `app://` as a privileged standard scheme BEFORE `app.whenReady()` so
// Fetch API, RSC streaming, relative URLs, and styles work identically to https.
protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.setAppUserModelId(APP_ID);

// Defect D1 fix: enforce single-instance lock BEFORE starting the embedded
// PGlite server or opening a window so two instances can never contend on the
// local database directory or Unix domain socket.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let localServer: ManagedLocalServer | null = null;

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

let resolvedTargetUrl: string | null = null;
try {
  resolvedTargetUrl = resolveAppUrl(app.isPackaged);
} catch {
  resolvedTargetUrl = null;
}
const appOrigin = resolvedTargetUrl ? urlOrigin(resolvedTargetUrl) : null;

const OFFLINE_PAGE_FILE_NAME = "offline.html";
const offlinePagePath = path.join(__dirname, OFFLINE_PAGE_FILE_NAME);

export function showOfflinePage(
  win: BrowserWindow,
  targetUrl: string,
  detail: string
): Promise<void> {
  const params = new URLSearchParams({ detail, target: targetUrl });
  return win.loadFile(offlinePagePath, { hash: params.toString() });
}

function buildAppMenu(): Menu {
  const helpSubmenu: MenuItemConstructorOptions[] = [];
  if (appOrigin && isSafeExternalUrl(appOrigin)) {
    helpSubmenu.push({
      label: "Open Website",
      click: () => {
        if (isSafeExternalUrl(appOrigin)) {
          void shell.openExternal(appOrigin);
        }
      },
    });
  }
  helpSubmenu.push({
    label: "About Title IX Policy Tracker",
    click: () => {
      const target = mainWindow;
      if (target && !target.isDestroyed()) {
        void dialog.showMessageBox(target, {
          type: "info",
          title: "About",
          message: APP_NAME,
          detail: [
            `Version: ${app.getVersion()}`,
            `Mode: ${localServer ? "Standalone Local (PGlite + UDS)" : "Hosted Web"}`,
            `Platform: ${process.platform} (${process.arch})`,
            `Electron: ${process.versions.electron}`,
          ].join("\n"),
        });
      }
    },
  });

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
      submenu: helpSubmenu,
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

function resolveLinuxWindowIcon(): string | undefined {
  if (process.platform !== "linux") return undefined;
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.resolve(__dirname, "..", "build", "icon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function renderFatalErrorCard(
  win: BrowserWindow,
  heading: string,
  body: string
): void {
  const escapedHeading = heading
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const escapedBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const errorHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapedHeading}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
    }
    .card {
      max-width: 500px;
      padding: 32px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    h1 { margin-top: 0; font-size: 1.25rem; color: #dc2626; }
    p { margin-bottom: 0; line-height: 1.5; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapedHeading}</h1>
    <p>${escapedBody}</p>
  </div>
</body>
</html>`;
  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`
  );
}

function createMainWindow(): void {
  const savedRaw = readSavedBounds();
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const initialBounds = resolveInitialBounds(savedRaw, displays);
  const linuxIcon = resolveLinuxWindowIcon();

  const win = new BrowserWindow({
    title: APP_NAME,
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: DESKTOP_MIN_WIDTH,
    minHeight: DESKTOP_MIN_HEIGHT,
    ...(linuxIcon ? { icon: linuxIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`${VERSION_ARG_PREFIX}${app.getVersion()}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow = win;
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

  const authOrigins = authAllowlistOrigins(appOrigin ?? "");
  const guard = createAuthFlowGuard();

  const isSignInPath = (url: string): boolean => {
    return (
      urlOrigin(url) === appOrigin &&
      (() => {
        try {
          return new URL(url).pathname.startsWith("/sign-in");
        } catch {
          return false;
        }
      })()
    );
  };

  win.webContents.on("will-navigate", (_event, url) => {
    if (isSignInPath(url)) {
      guard.begin();
    }
  });

  win.webContents.on("did-navigate", (_event, url) => {
    if (appOrigin !== null && urlOrigin(url) === appOrigin && !isSignInPath(url)) {
      guard.end();
    }
  });

  win.webContents.on("did-finish-load", () => {
    const url = win.webContents.getURL();
    if (appOrigin !== null && urlOrigin(url) === appOrigin && !isSignInPath(url)) {
      guard.end();
    }
  });

  win.webContents.on("will-navigate", (event, url) => {
    const action = classifyUrl(
      url,
      appOrigin ?? "",
      authOrigins,
      guard.isActive()
    );
    if (action.kind === "ALLOW") {
      // Allow in-app navigation
    } else if (action.kind === "OPEN_EXTERNAL") {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    } else {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const action = classifyUrl(
      url,
      appOrigin ?? "",
      authOrigins,
      guard.isActive()
    );
    if (action.kind === "ALLOW") {
      return { action: "allow" };
    }
    if (action.kind === "OPEN_EXTERNAL") {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  win.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDesc,
      validatedURL,
      isMainFrame
    ) => {
      if (!isMainFrame || !isNetworkError(errorCode)) {
        return;
      }
      const detail = `${errorCode} ${errorDesc}`.trim();
      showOfflinePage(win, validatedURL, detail).catch((error) => {
        console.error("Failed to show offline page:", error);
      });
    }
  );

  try {
    const appUrl = resolveAppUrl(app.isPackaged);
    void win.loadURL(appUrl);
  } catch (error) {
    console.error("Fatal configuration error:", error);
    renderFatalErrorCard(
      win,
      "Configuration Error",
      "Desktop application configuration is invalid (DESKTOP_APP_URL must use https:// when overriding local mode)."
    );
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (resolvedTargetUrl && isLocalModeUrl(resolvedTargetUrl)) {
      try {
        const decrypt = safeStorage.isEncryptionAvailable()
          ? (buf: Buffer) => safeStorage.decryptString(buf)
          : null;
        const fallback = readEncryptedKeyringFallback(
          resolveShellConfigDir(),
          decrypt
        );
        const keyringEnv = await readIngestKeysFromKeyring({ fallback });

        localServer = await startManagedLocalServer({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          keyringEnv,
        });

        const activeServer = localServer;
        protocol.handle(LOCAL_SCHEME, (request) => {
          let parsed: URL;
          try {
            parsed = new URL(request.url);
          } catch {
            return new Response("Bad Request", { status: 400 });
          }
          if (parsed.hostname !== LOCAL_HOST || parsed.port !== "") {
            return new Response("Forbidden", { status: 403 });
          }
          return proxyCustomSchemeToSocket(
            request,
            activeServer.socketPath,
            activeServer.sessionToken
          );
        });
      } catch (err) {
        console.error("Failed to start local server:", err);
        createMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          renderFatalErrorCard(
            mainWindow,
            "Local Database Startup Error",
            "Could not initialize the local Title IX database or runtime socket. Verify permissions on $XDG_DATA_HOME/titleix-policy-tracker and $XDG_RUNTIME_DIR."
          );
        }
        return;
      }
    }

    createMainWindow();

    app.on("browser-window-focus", () => {
      Menu.setApplicationMenu(buildAppMenu());
    });
  });

  app.on("before-quit", (event) => {
    if (localServer) {
      const toStop = localServer;
      localServer = null;
      event.preventDefault();
      toStop.stop().finally(() => {
        app.quit();
      });
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
