// Subtle terminal colour for divesend's own chrome (errors, "Wrote" notices,
// headings). Data on stdout is never styled. Colour is disabled when stderr is
// not a TTY, when NO_COLOR is set (https://no-color.org), or when FORCE_COLOR=0.

import pc from 'picocolors';

const enabled =
  process.env.FORCE_COLOR !== '0' &&
  process.env.NO_COLOR === undefined &&
  (process.env.FORCE_COLOR !== undefined || process.stderr.isTTY === true);

const paint = (fn: (s: string) => string) => (s: string) => (enabled ? fn(s) : s);

export const style = {
  enabled,
  error: paint(pc.red),
  warn: paint(pc.yellow),
  dim: paint(pc.dim),
  bold: paint(pc.bold),
  heading: paint((s) => pc.bold(pc.cyan(s))),
};
