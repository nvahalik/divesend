// tsconfig.app.json uses moduleDetection: "force", so this file needs an
// explicit `export {}` to be a module and a `declare global` block to put
// __APP_VERSION__ in global scope. It's replaced at build time by Vite's
// `define` (see vite.config.ts).
export {};

declare global {
  const __APP_VERSION__: string;
}
