export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.titleIXDesktop !== undefined;
}

export function desktopPlatform(): string | null {
  return typeof window !== "undefined"
    ? window.titleIXDesktop?.platform ?? null
    : null;
}