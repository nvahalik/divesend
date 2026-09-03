// `divesend login` / `divesend logout` -- manage the persisted SSI credentials
// in `~/.config/divesend/auth.json` (see `../auth.ts`).
//
//   login                          prompt for email (visible) + password
//                                  (hidden), verify against SSI, then store them
//   login --email E --password P   same, non-interactive
//   login --status                 print the stored email, or exit 1 if none
//   logout                         remove the stored credentials

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fail } from '../io.js';
import { style } from '../style.js';
import { authenticate } from '../ssi/client.js';
import { loadAuth, saveAuth, clearAuth } from '../auth.js';

export interface LoginOptions {
  email?: string;
  password?: string;
  /** Print the stored email and exit, or exit 1 if no credentials are stored. */
  status?: boolean;
}

export async function login(options: LoginOptions = {}): Promise<void> {
  if (options.status) {
    const current = loadAuth();
    if (!current) {
      fail('Not logged in.');
    }
    process.stderr.write(`Logged in as ${current.email}.\n`);
    return;
  }

  let email = options.email;
  let password = options.password;

  if ((!email || !password) && !process.stdin.isTTY) {
    fail('Not a terminal. Pass --email and --password to log in non-interactively.');
  }
  if (!email) email = await promptVisible('SSI email: ');
  if (!password) password = await promptHidden('SSI password: ');
  if (!email || !password) {
    fail('Not a terminal. Pass --email and --password to log in non-interactively.');
  }

  // Verify before persisting. A bad login throws `Authentication failed: ...`,
  // which propagates to cli.ts's top-level handler ("Error: <message>", exit 1);
  // nothing is written in that case.
  await authenticate(email, password);

  saveAuth({ email, password });
  process.stderr.write(style.dim(`Logged in as ${email}.`) + '\n');
}

export function logout(): void {
  clearAuth();
  process.stderr.write(style.dim('Logged out.') + '\n');
}

/** Read one line with a visible prompt and local echo. */
function promptVisible(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Read one line with no echo: the prompt is written, then a muted output stream
 * swallows everything readline would otherwise echo (the typed characters).
 * Ctrl-C is left to readline's default (the process receives SIGINT and exits).
 */
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const mutedOut = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk as Buffer, encoding);
        callback();
      },
    });
    const rl = createInterface({
      input: process.stdin,
      output: mutedOut,
      terminal: true,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
