#!/usr/bin/env node
// divesend -- offline dive-file converters + SSI logbook client.
// argv[2] is the subcommand; the rest is handed to the subcommand's run().

import { run as fit2ssi } from './commands/fit2ssi.js';
import { run as swXml2ssi } from './commands/swXml2ssi.js';
import { run as dctool2ssi } from './commands/dctool2ssi.js';
import { run as dctool2uddf } from './commands/dctool2uddf.js';
import { run as logbook } from './commands/logbook.js';
import { run as login } from './commands/login.js';

// `divesend ... | head` closes the pipe early; don't crash on the SIGPIPE.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const COMMANDS: Record<string, (args: string[]) => void | Promise<void>> = {
  fit2ssi,
  'sw-xml2ssi': swXml2ssi,
  dctool2ssi,
  dctool2uddf,
  list: (a) => logbook('list', a),
  get: (a) => logbook('get', a),
  push: (a) => logbook('push', a),
  create: (a) => logbook('create', a),
  update: (a) => logbook('update', a),
  login: (a) => login('login', a),
  logout: (a) => login('logout', a),
};

const USAGE = `usage: divesend <subcommand> [options]

subcommands:
  fit2ssi <file.fit> [-o out.json]    Garmin FIT -> SSI save_divelog JSON
  sw-xml2ssi <file.xml> [-o]          Shearwater Cloud XML -> SSI JSON
  dctool2ssi <file.xml> [-o]          dctool / libdivecomputer XML -> SSI JSON
  dctool2uddf <file.xml> [-o]         dctool XML -> UDDF
  list                                list logbook dives
  get <id> [--field K]                dump a dive's fields as JSON
  push <file.json>                    send a save_divelog payload
  create [--set K=V ...]              create a dive from overrides
  update <id> --set K=V ...           merge-update fields on a dive
  login [--email E --password P | --status]   store / check SSI credentials
  logout                             remove stored SSI credentials
`;

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (!sub || sub === '--help' || sub === '-h' || !Object.hasOwn(COMMANDS, sub)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  await COMMANDS[sub](process.argv.slice(3));
}

main().catch((exc) => {
  console.error(exc instanceof Error ? `error: ${exc.message}` : String(exc));
  process.exit(1);
});
