import { app, BrowserWindow, screen } from "electron";
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
} from "./constants";
import {
  isBoundsVisibleOnAnyDisplay,
  parseSavedBounds,
  resolveInitialBounds,
  type WindowBounds,
} from "./window-state";

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
