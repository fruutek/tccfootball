/**
 * Runs ONE `mnf` command on behalf of the "Publish" GitHub workflow.
 *
 * The workflow's inputs are untrusted text (this repository is public), so nothing here ever
 * reaches a shell: the command is tokenised by hand, checked against an allow-list, and passed
 * to the CLI as an argument array.
 *
 * Env in:  MNF_COMMAND  e.g.  match publish   |   player update "Josh Brown" --nickname Brownie
 *          MNF_APPLY    "true" to add --apply (anything else is a dry run)
 *          MNF_REQUEST  optional JSON request, fed to the CLI on stdin (adds --stdin)
 */
import { spawnSync } from 'node:child_process';

export const ALLOWED_COMMANDS = new Set([
  'help', 'status', 'players', 'player', 'match', 'article', 'fixture', 'settings', 'stats', 'facts', 'audit', 'revert', 'demo',
]);
/** Controlled by the workflow, or meaningless/unsafe on a CI runner. */
export const FORBIDDEN_FLAGS = new Set(['--apply', '--stdin', '--file', '--project', '--photo']);

export class CommandRejected extends Error {}

/** Splits on spaces, honouring "double quotes" (with \" and \\ escapes). No other shell syntax exists. */
export function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '\n' || c === '\r' || c === '\0') throw new CommandRejected('Line breaks are not allowed in a command.');
    if (inQuotes) {
      if (c === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) cur += input[++i]!;
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === ' ' || c === '\t') {
      if (started || cur) tokens.push(cur);
      cur = '';
      started = false;
    } else if (/[A-Za-z0-9_:./=+@%-]/.test(c)) {
      cur += c;
    } else {
      throw new CommandRejected(`Character "${c}" is not allowed outside quotes.`);
    }
  }
  if (inQuotes) throw new CommandRejected('Unclosed quote.');
  if (started || cur) tokens.push(cur);
  return tokens;
}

export function buildArgs(command: string, apply: boolean, hasRequest: boolean): string[] {
  const tokens = tokenise(command.trim());
  if (tokens.length === 0) throw new CommandRejected('No command given.');
  if (!ALLOWED_COMMANDS.has(tokens[0]!)) {
    throw new CommandRejected(`"${tokens[0]}" is not a publishing command. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}.`);
  }
  for (const t of tokens) {
    if (FORBIDDEN_FLAGS.has(t.split('=')[0]!)) {
      throw new CommandRejected(`${t.split('=')[0]} is not accepted here (the workflow sets it, or it needs files that do not exist on the runner).`);
    }
  }
  return [...tokens, ...(hasRequest ? ['--stdin'] : []), ...(apply ? ['--apply'] : [])];
}

function main() {
  const command = process.env['MNF_COMMAND'] ?? '';
  const apply = process.env['MNF_APPLY'] === 'true';
  const request = process.env['MNF_REQUEST'] ?? '';
  let args: string[];
  try {
    args = buildArgs(command, apply, request.trim().length > 0);
  } catch (e) {
    console.error(`Rejected: ${(e as Error).message}`);
    process.exit(64);
  }
  if (request.trim()) {
    try {
      JSON.parse(request);
    } catch (e) {
      console.error(`The request is not valid JSON: ${(e as Error).message}`);
      process.exit(64);
    }
  }
  console.log(`▶ mnf ${args.join(' ')}\n`);
  const r = spawnSync('npx', ['tsx', 'cli/index.ts', ...args], {
    stdio: [request.trim() ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    input: request.trim() ? request : undefined,
    env: process.env,
  });
  const code = r.status ?? 1;
  console.log(`\nMNF_RESULT exit=${code} mode=${apply ? 'apply' : 'dry-run'}`);
  process.exit(code);
}

if (process.argv[1] && /run-mnf\.ts$/.test(process.argv[1])) main();
