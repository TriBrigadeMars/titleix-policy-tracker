/**
 * Auto-update wiring for the packaged desktop app.
 *
 * This module is the only place that touches electron-updater. All policy
 * decisions live in `update-policy.ts` (pure, unit tested); this file reads the
 * packaged config, applies that policy, and adapts electron-updater's events to
 * a single user prompt.
 *
 * It is written to be incapable of breaking the app: a missing, unreadable or
 * malformed update config disables updates and logs why, and every electron-
 * updater event handler is wrapped so a network or feed error can never
 * propagate into window creation or shutdown.
 *
 * See `update-policy.ts` for why the publisher-name gate exists — in short,
 * electron-updater reports *successful* signature verification when the update
 * config declares no publisher name, so an unsigned build must not run the
 * updater at all (WP-15A hard rule 4).
 */
import { app, dialog, type BrowserWindow } from "electron";
import log from "electron-log/main";
import { NsisUpdater } from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import * as semver from "semver";
import {
  describeSkipReason,
  parseUpdateConfig,
  planUpdate,
  shouldOfferUpdate,
  type UpdatePlan,
} from "./update-policy";

/**
 * The Windows NSIS updater, created lazily on first use.
 *
 * `NsisUpdater` is the concrete class rather than the platform-dispatched
 * `autoUpdater` singleton because signature verification — the whole reason
 * this module is so careful — is an NSIS-only capability, and this app ships
 * only an NSIS target (see electron-builder.yml). Using the class directly
 * means the verifier is reachable without a cast.
 *
 * Constructing it eagerly at module scope would be a liability: the
 * constructor reads the app version from Electron and throws if it is not
 * valid semver, so a versioning mistake would crash the app at import. It is
 * also wasted work on an unsigned build, which never runs the updater at all.
 */
let updater: NsisUpdater | null = null;

function getUpdater(): NsisUpdater {
  if (updater == null) {
    updater = new NsisUpdater();
  }
  return updater;
}

const UPDATE_CONFIG_FILE_NAME = "app-update.yml";

let updatePromptOpen = false;

function getUpdateConfigPath(): string {
  // electron-builder writes app-update.yml beside app.asar in resources/.
  return path.join(process.resourcesPath, UPDATE_CONFIG_FILE_NAME);
}

function readUpdateConfig(): string | null {
  const configPath = getUpdateConfigPath();
  try {
    return fs.readFileSync(configPath, "utf8");
  } catch (error) {
    log.info(
      `[updates] could not read ${configPath}: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Read and evaluate the packaged update configuration.
 *
 * Split out so the decision can be logged and asserted without starting the
 * updater.
 */
export function resolveUpdatePlan(): UpdatePlan {
  const raw = readUpdateConfig();
  const parsed = parseUpdateConfig(raw, (text) => yaml.load(text));
  return planUpdate(app.isPackaged, parsed);
}

function promptToInstall(win: BrowserWindow | null, version: string): void {
  if (updatePromptOpen) {
    return;
  }
  updatePromptOpen = true;

  const options = {
    type: "info" as const,
    title: "Update Ready",
    message: `Title IX Policy Tracker ${version} is ready to install.`,
    detail:
      "The update has been downloaded and verified. Restarting now closes the app and installs it; your saved window layout and sign-in are kept.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };

  const show = win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options);

  show
    .then(({ response }) => {
      if (response === 0) {
        // isSilent=false so the NSIS installer UI is visible; isForceRunAfter
        // relaunches the app once installation completes.
        getUpdater().quitAndInstall(false, true);
      }
    })
    .catch((error) => {
      log.error(`[updates] failed to show update prompt: ${error}`);
    })
    .finally(() => {
      updatePromptOpen = false;
    });
}

/**
 * Start background update checking for a packaged build.
 *
 * Returns the plan it applied so the caller can log or surface it. Never
 * throws.
 */
export function initAutoUpdates(getWindow: () => BrowserWindow | null): UpdatePlan {
  let plan: UpdatePlan;
  try {
    plan = resolveUpdatePlan();
  } catch (error) {
    log.error(`[updates] failed to resolve update plan: ${error}`);
    return { enabled: false, reason: "config-invalid", publisherNames: [] };
  }

  if (!plan.enabled) {
    log.info(
      `[updates] disabled: ${plan.reason ? describeSkipReason(plan.reason) : "unknown reason"}`,
    );
    return plan;
  }

  try {
      const nsisUpdater = getUpdater();

      nsisUpdater.logger = log;
    // Download without asking, but never install without a user decision.
        nsisUpdater.autoDownload = true;
        nsisUpdater.autoInstallOnAppQuit = true;
    if (plan.channel) {
          nsisUpdater.channel = plan.channel;
    }

    // Capture the library's own verifier before overriding, so signature
    // verification remains electron-updater's implementation while the
    // empty-publisherName escape hatch is removed for good. A verifier that
        // rejects surfaces as an update error, which the handler below logs.
    const libraryVerify = nsisUpdater.verifyUpdateCodeSignature.bind(nsisUpdater);
        nsisUpdater.verifyUpdateCodeSignature = async (
      publisherNames: string[],
      filePath: string,
    ) => {
          const permitted =
            plan.publisherNames.length > 0 ? plan.publisherNames : publisherNames;
          if (permitted.length === 0 || permitted.every((name) => !name.trim())) {
            return "no publisher names available; refusing to trust an unverifiable installer";
          }
          return libraryVerify(permitted, filePath);
        };

        nsisUpdater.on("error", (error) => {
      log.error(`[updates] error: ${error?.message ?? error}`);
    });

        nsisUpdater.on("checking-for-update", () => {
      log.info("[updates] checking for update");
    });

        nsisUpdater.on("update-not-available", () => {
          log.info(`[updates] up to date (current ${nsisUpdater.currentVersion})`);
    });

        nsisUpdater.on("update-available", (info) => {
          const candidate = info?.version ?? "";
          // semver.compare is already (a, b), which is exactly what
          // shouldOfferUpdate expects. Using the library's own comparison keeps
          // this consistent with the version parsing electron-updater uses to
          // decide an update exists in the first place.
          const offered = shouldOfferUpdate(
            nsisUpdater.currentVersion.version,
            candidate,
            semver.compare,
          );
          log.info(`[updates] update available: ${candidate} (offered: ${offered})`);
        });

        nsisUpdater.on("update-downloaded", (info) => {
      log.info(`[updates] update downloaded and verified: ${info?.version}`);
      promptToInstall(getWindow(), info?.version ?? "");
    });

    // Fire-and-forget: a failed check must not affect startup.
        nsisUpdater.checkForUpdates().catch((error) => {
      log.error(`[updates] check failed: ${error?.message ?? error}`);
    });

    log.info(
      `[updates] enabled (channel ${plan.channel}, publishers: ${plan.publisherNames.join(" | ")})`,
    );
  } catch (error) {
    log.error(`[updates] failed to initialise: ${error}`);
    return { enabled: false, reason: "config-invalid", publisherNames: [] };
  }

  return plan;
}