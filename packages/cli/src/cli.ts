#!/usr/bin/env node
// divesend -- offline dive-file converters + SSI logbook client.
//
// This module is the whole CLI surface: every command, its options, and its
// help text live here. The command modules under ./commands are plain async
// functions that take an options object -- they do no argv parsing themselves.

import { createRequire } from 'node:module';
import { cac } from 'cac';
import { printError } from './io.js';
import { convert } from './commands/convert.js';
import { list, get, push, create, update } from './commands/logbook.js';
import { login, logout } from './commands/login.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

// `divesend ... | head` closes the pipe early; don't crash on the SIGPIPE.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const DESCRIPTION = [
  'Offline converter and logbook client for divers who use SSI.',
  '',
  "Turn a dive-computer export into SSI's save_divelog JSON (or UDDF): Garmin FIT",
  'files, Shearwater Cloud XML, and libdivecomputer "dctool parse" XML, with the',
  'format detected automatically. Then talk to the SSI logbook API directly to',
  'list, inspect, create, and update dives.',
  '',
  'Conversions are fully offline. Downloading dives from a computer over Bluetooth',
  'is out of scope -- see the DiveSend web app for that.',
]
  .map((line) => (line ? `  ${line}` : line))
  .join('\n');

const cli = cac('divesend');

cli
  .command('convert [file]', 'Convert a dive file to SSI save_divelog JSON or UDDF.')
  .option(
    '--from <format>',
    'Input format: fit, sw-xml, or dc-xml. Auto-detected from the file when omitted.',
  )
  .option('--to <target>', 'Output format: ssi or uddf.', { default: 'ssi' })
  .option('-o, --output <path>', 'Write to a file instead of stdout.')
  .example('  $ divesend convert dive.fit -o dive.ssi.json')
  .example('  $ divesend convert shearwater-export.xml -o dive.ssi.json')
  .example('  $ divesend convert dive.dctool.xml --to uddf -o dive.uddf')
  .example('  $ cat dive.fit | divesend convert --to uddf')
  .action((file: string | undefined, options: { from?: string; to?: string; output?: string }) =>
    convert(file, { from: options.from, to: options.to, output: options.output }),
  );

cli
  .command('list', 'List every dive in the SSI logbook as a table.')
  .option('--json', 'Print the raw dive objects as JSON instead of a table.')
  .option('--email <email>', 'SSI account email (overrides SSI_EMAIL and stored credentials).')
  .option('--password <password>', 'SSI account password (overrides SSI_PASSWORD and stored credentials).')
  .example('  $ divesend list')
  .example('  $ divesend list --json')
  .action((options) => list(options));

cli
  .command('get [id]', "Dump one dive's fields as JSON, or a single field with --field.")
  .option('--field <name>', 'Print just this field instead of the whole dive.')
  .option('-o, --output <path>', 'Write to a file instead of stdout.')
  .option('--email <email>', 'SSI account email (overrides SSI_EMAIL and stored credentials).')
  .option('--password <password>', 'SSI account password (overrides SSI_PASSWORD and stored credentials).')
  .example('  $ divesend get 123456')
  .example('  $ divesend get 123456 --field odin_user_log_depth_m')
  .action((id: string, options) => get(id, options));

cli
  .command('push [file]', 'Send an edited save_divelog payload for an existing dive.')
  .option('--show-response', 'Also print the full API response, not just the summary.')
  .option('--email <email>', 'SSI account email (overrides SSI_EMAIL and stored credentials).')
  .option('--password <password>', 'SSI account password (overrides SSI_PASSWORD and stored credentials).')
  .example('  $ divesend push dive.ssi.json')
  .action((file: string, options) => push(file, options));

cli
  .command('create', 'Create a new dive from field overrides and/or a JSON file.')
  .option('--set <name=value>', 'Set one field. Repeatable. Values are JSON-parsed when possible.', {
    type: [String],
  })
  .option('--from-file <path>', 'Seed the new dive from this JSON object of field overrides.')
  .option('--account-dive-id <id>', 'Derive account fields from this dive instead of the most recent one.')
  .option('--show-response', 'Also print the full API response, not just the summary.')
  .option('--email <email>', 'SSI account email (overrides SSI_EMAIL and stored credentials).')
  .option('--password <password>', 'SSI account password (overrides SSI_PASSWORD and stored credentials).')
  .example('  $ divesend create --set odin_user_log_depth_m=18.3 --set odin_user_log_divetime=42')
  .example('  $ divesend create --from-file new-dive.json')
  .action((options) => create(options));

cli
  .command('update [id]', 'Merge field overrides into an existing dive.')
  .option('--set <name=value>', 'Set one field. Repeatable. Values are JSON-parsed when possible.', {
    type: [String],
  })
  .option('--from-file <path>', 'Merge this JSON object of field overrides into the dive.')
  .option('--show-response', 'Also print the full API response, not just the summary.')
  .option('--email <email>', 'SSI account email (overrides SSI_EMAIL and stored credentials).')
  .option('--password <password>', 'SSI account password (overrides SSI_PASSWORD and stored credentials).')
  .example('  $ divesend update 123456 --set odin_user_log_notes=\'"great viz"\'')
  .action((id: string, options) => update(id, options));

cli
  .command('login', 'Verify SSI credentials and store them for later commands.')
  .option('--email <email>', 'SSI account email. Prompted for when omitted on a terminal.')
  .option('--password <password>', 'SSI account password. Prompted for (hidden) when omitted on a terminal.')
  .option('--status', 'Print the stored account email, or exit 1 if none is stored.')
  .example('  $ divesend login')
  .example('  $ divesend login --email me@example.com --password secret')
  .example('  $ divesend login --status')
  .action((options) => login(options));

cli
  .command('logout', 'Remove the stored SSI credentials.')
  .action(() => logout());

cli.help((sections) => {
  // Show the "About" blurb on `divesend --help` only, not on every
  // per-command help screen -- slot it in just after the version banner.
  if (!cli.matchedCommand) {
    sections.splice(1, 0, { title: 'About', body: DESCRIPTION });
  }
});
cli.version(pkg.version);

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false });

  // cac prints the help / version text itself while parsing those flags.
  if (cli.options.help || cli.options.version) return;

  if (!cli.matchedCommand) {
    const unknown = cli.args[0];
    if (unknown) {
      printError(`Unknown command "${unknown}". Run \`divesend --help\` to see the available commands.`);
      process.exit(1);
    }
    cli.outputHelp();
    return;
  }

  await cli.runMatchedCommand();
}

main().catch((exc) => {
  // Every user-facing failure (CliError, a converter's parse error, a network
  // error) surfaces here as a single "Error: <message>" line.
  printError(exc instanceof Error ? exc.message : String(exc));
  process.exit(1);
});
