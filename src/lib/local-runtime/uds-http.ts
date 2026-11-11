import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { ensurePrivateDir } from "./paths";

const AUTH_SESSION_COOKIE = "authjs.session-token";
const SECURE_AUTH_SESSION_COOKIE = "__Secure-authjs.session-token";

/**
 * Inject the local Auth.js session cookie into an outgoing `Cookie` header,
 * stripping any incoming `authjs.session-token` values so untrusted renderer
 * scripts cannot spoof a different session token.
 */
export function mergeSessionCookie(
  existingCookie: string | undefined,
  sessionToken: string
): string {
  const preserved = (existingCookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const eq = part.indexOf("=");
      const name = eq === -1 ? part : part.slice(0, eq).trim();
      return (
        name !== AUTH_SESSION_COOKIE && name !== SECURE_AUTH_SESSION_COOKIE
      );
    });

  preserved.unshift(`${AUTH_SESSION_COOKIE}=${sessionToken}`);
  return preserved.join("; ");
}

function probeExistingSocket(socketPath: string): Promise<"LIVE" | "STALE"> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path: socketPath });
    sock.once("connect", () => {
      sock.destroy();
      resolve("LIVE");
    });
    sock.once("error", () => {
      sock.destroy();
      resolve("STALE");
    });
  });
}

/**
 * Bind `server` exclusively to `socketPath` (Unix domain socket on POSIX,
 * named pipe on Windows). Never binds a TCP port.
 *
 * Ensures the parent directory is mode `0700`, refuses to clobber an active
 * listener, unlinks stale crash-leftover sockets, and sets socket mode `0600`.
 */
export async function listenOnUnixSocket(
  server: http.Server,
  socketPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform !== "win32") {
    ensurePrivateDir(path.dirname(socketPath), platform);
    if (fs.existsSync(socketPath)) {
      const state = await probeExistingSocket(socketPath);
      if (state === "LIVE") {
        throw new Error(
          `Another instance is already listening on ${socketPath}`
        );
      }
      fs.unlinkSync(socketPath);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      if (platform !== "win32") {
        fs.chmodSync(socketPath, 0o600);
      }
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

export interface ForwardedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer | Uint8Array | null;
}

export interface ForwardedResponse {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
}

/**
 * Forward an `app://tracker/...` request over the Unix domain socket at
 * `socketPath`, injecting the local session cookie on every forwarded request.
 */
export function forwardOverUnixSocket(
  request: ForwardedRequest,
  socketPath: string,
  sessionToken: string
): Promise<ForwardedResponse> {
  return new Promise((resolve, reject) => {
    const outHeaders: Record<string, string> = {};
    let incomingCookie: string | undefined;

    for (const [k, v] of Object.entries(request.headers ?? {})) {
      const lower = k.toLowerCase();
      if (lower === "cookie") {
        incomingCookie = v;
        continue;
      }
      if (lower === "host" || lower === "connection") {
        continue;
      }
      outHeaders[k] = v;
    }

    outHeaders["Host"] = "tracker";
    outHeaders["Cookie"] = mergeSessionCookie(incomingCookie, sessionToken);
    if (request.body && request.body.byteLength > 0) {
      outHeaders["Content-Length"] = String(request.body.byteLength);
    }

    const req = http.request(
      {
        socketPath,
        method: request.method,
        path: request.path || "/",
        headers: outHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 502,
            statusMessage: res.statusMessage ?? "",
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);
    if (request.body && request.body.byteLength > 0) {
      req.write(Buffer.from(request.body));
    }
    req.end();
  });
}
