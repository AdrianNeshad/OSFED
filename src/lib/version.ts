// APP_VERSION is injected at build time by Vite from package.json's "version"
// (see vite.config.ts). This is the single source of truth that also drives the
// automated GitHub release workflow.
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
