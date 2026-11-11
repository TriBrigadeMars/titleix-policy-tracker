import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_ID } from "./constants";

export const INGEST_KEYRING_KEYS = [
  "CONGRESS_GOV_API_KEY",
  "OPEN_STATES_API_KEY",
  "LEGISCAN_API_KEY",
  "LEGISCAN_SESSION_ID",
] as const;

export type IngestKeyName = (typeof INGEST_KEYRING_KEYS)[number];

export type SecretLookupFn = (
  service: string,
  keyName: IngestKeyName
) => Promise<string | null>;

function execSecretCommand(
  cmd: string,
  args: string[],
  timeoutMs = 2000
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const trimmed = stdout.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
  });
}

/**
 * Default OS keyring lookup compatible with both the Electron shell and the
 * Rust/Tauri shell (`keyring` crate uses the same service + key attributes on
 * Freedesktop Secret Service / GNOME Keyring / KWallet and macOS Keychain).
 */
export async function lookupSystemKeyringSecret(
  service: string,
  keyName: IngestKeyName,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (platform === "linux") {
    // Standard Freedesktop Secret Service CLI (`libsecret` on Arch, Ubuntu, Fedora).
    // Check both `username` (Rust `keyring` crate convention) and `key` attributes.
    const byUsername = await execSecretCommand("secret-tool", [
      "lookup",
      "service",
      service,
      "username",
      keyName,
    ]);
    if (byUsername) return byUsername;

    return execSecretCommand("secret-tool", [
      "lookup",
      "service",
      service,
      "key",
      keyName,
    ]);
  }

  if (platform === "darwin") {
    return execSecretCommand("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      keyName,
      "-w",
    ]);
  }

  return null;
}

/**
 * Optional fallback reading a `0600` safeStorage-encrypted blob at
 * `$XDG_CONFIG_HOME/titleix-policy-tracker/keyring.enc` when available.
 */
export function readEncryptedKeyringFallback(
  configDir: string,
  decrypt: ((encrypted: Buffer) => string) | null
): Partial<Record<IngestKeyName, string>> {
  if (!decrypt) return {};
  const encPath = path.join(configDir, "keyring.enc");
  if (!fs.existsSync(encPath)) return {};
  try {
    const raw = fs.readFileSync(encPath);
    const json = JSON.parse(decrypt(raw)) as Record<string, unknown>;
    const out: Partial<Record<IngestKeyName, string>> = {};
    for (const k of INGEST_KEYRING_KEYS) {
      const val = json[k];
      if (typeof val === "string" && val.trim().length > 0) {
        out[k] = val.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read user-supplied ingest API keys from the OS keyring (plus optional
 * safeStorage fallback) to pass via child environment when spawning the local
 * server. Never logs secret values.
 */
export async function readIngestKeysFromKeyring(options?: {
  lookup?: SecretLookupFn;
  fallback?: Partial<Record<IngestKeyName, string>>;
  service?: string;
}): Promise<Record<string, string>> {
  const lookup = options?.lookup ?? lookupSystemKeyringSecret;
  const service = options?.service ?? APP_ID;
  const fallback = options?.fallback ?? {};
  const out: Record<string, string> = {};

  for (const keyName of INGEST_KEYRING_KEYS) {
    const fromKeyring = await lookup(service, keyName);
    const resolved = fromKeyring?.trim() || fallback[keyName]?.trim();
    if (resolved) {
      out[keyName] = resolved;
    }
  }

  return out;
}
