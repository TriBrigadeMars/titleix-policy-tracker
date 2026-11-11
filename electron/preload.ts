import { contextBridge } from "electron";

// Sandboxed preload cannot require relative modules; parse the version passed
// via BrowserWindow `additionalArguments` (`--titleix-app-version=x.y.z`),
// falling back to `npm_package_version` in dev. Fixes Defect D3.
const VERSION_PREFIX = "--titleix-app-version=";
const argMatch = process.argv.find((arg) => arg.startsWith(VERSION_PREFIX));
const parsedVersion = argMatch?.slice(VERSION_PREFIX.length).trim();
const version =
  parsedVersion && parsedVersion.length > 0
    ? parsedVersion
    : (process.env.npm_package_version ?? "0.0.0");

contextBridge.exposeInMainWorld("titleIXDesktop", {
  platform: process.platform,
  version,
} as const);
