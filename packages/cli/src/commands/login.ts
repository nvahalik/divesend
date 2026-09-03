// `divesend login` / `divesend logout` -- manage the persisted SSI credentials
// in `~/.config/divesend/auth.json` (see `../auth.ts`).
//
//   login                     prompt for email (visible) + password (hidden),
//                             verify against SSI, then store them
//   login --email E --password P   same, non-interactive
//   login --status            print the stored email, or exit 1 if none
//   logout                    remove the stored credentials

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fail } from '../io.js';
import { authenticate } from '../ssi/client.js';
import { loadAuth, saveAuth, clearAuth } from '../auth.js';

type Sub = 'login' | 'logout';

export async function run(sub: Sub, args: string[]): Promise<void> {
  if (sub === 'logout') {
    clearAuth();
    process.stderr.write('logged out\n');
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      status: { type: 'boolean' },
    },
  });

  if (values.status) {
    const current = loadAuth();
    if (current) {
      process.stderr.write('logged in as ' + current.email + '\n');
      return;
    }
    process.stderr.write('not logged in\n');
    process.exit(1);
  }

  let email = values.email;
  let password = values.password;

  if ((!email || !password) && !process.stdin.isTTY) {
    fail('login: not a terminal — pass --email and --password');
  }
  if (!email) email = await promptVisible('SSI email: ');
  if (!password) password = await promptHidden('SSI password: ');
  if (!email || !password) {
    fail('login: not a terminal — pass --email and --password');
  }

  // Verify before persisting. A bad login throws `Authentication failed: ...`,
  // which propagates to cli.ts's top-level handler (`error: <message>`, exit 1);
  // nothing is written in that case.
  await authenticate(email, password);

  saveAuth({ email, password });
  process.stderr.write('logged in as ' + email + '\n');
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
