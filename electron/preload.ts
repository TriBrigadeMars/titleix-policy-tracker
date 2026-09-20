import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("titleIXDesktop", {
  platform: process.platform,
  version: process.env.npm_package_version ?? "0.0.0",
} as const);
