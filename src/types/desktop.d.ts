export {};

declare global {
  interface Window {
    titleIXDesktop?: {
      readonly platform: string;
      readonly version: string;
    };
  }
}