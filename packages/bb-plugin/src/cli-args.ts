// `bb rehearse …`: open the panel, or pass a read-only command to the rehearse CLI.
// There is no approve and no sign-off command here, now or later (R13, R14, D41):
// those happen in the UI only, signed with the builder's key.

export type BbRehearseCommand =
  | { kind: 'open'; slug: string | null }
  | { kind: 'help' }
  /** Run `rehearse <args…>` unchanged. */
  | { kind: 'pass'; args: string[] }
  /** Exit 2 with this message. */
  | { kind: 'usage'; message: string };

export const USAGE = `Usage: bb rehearse [open] [<slug>]
       bb rehearse validate <epic-dir-or-slug> [--json]
       bb rehearse simulate <epic-dir-or-slug> [--json]
       bb rehearse gate check <epic-dir-or-slug> [--json]
       bb rehearse new <slug> --title "<title>"

open        Open the rehearse panel (the same UI as \`rehearse serve\`), for <slug> if given.
validate, simulate, gate check, new
            Run the rehearse CLI in the thread's checkout. Same output and exit codes.

There is no approve and no sign-off command: approve in the panel.
Exit codes: 0 OK, 1 findings, 2 usage error, 3 internal error.
`;

/** Commands passed to the rehearse CLI. Each one is read-only, except `new`, which only adds a folder. */
export const PASS_THROUGH = ['validate', 'simulate', 'gate', 'new'] as const;

const REFUSED: Record<string, string> = {
  approve: 'bb rehearse has no approve command: approve in the panel, which signs with your key (R13, D41)',
  'sign-off': 'bb rehearse has no sign-off command: sign off in the panel, which signs with your key (R14, D41)',
  signoff: 'bb rehearse has no sign-off command: sign off in the panel, which signs with your key (R14, D41)',
  serve: 'bb rehearse does not run serve: the panel starts and stops it (`bb rehearse open`)',
};

/** EPIC slugs are folder names under docs/epics. No path separators, no dot names. */
export function isSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value.length <= 200;
}

/** argv excludes the command name: `bb rehearse gate check x` → ['gate', 'check', 'x']. */
export function parseBbRehearse(argv: readonly string[]): BbRehearseCommand {
  const [first, ...rest] = argv;
  if (first === undefined) return { kind: 'open', slug: null };
  if (first === '--help' || first === '-h' || first === 'help') return { kind: 'help' };
  if (first === 'open') return parseOpen(rest);
  const refused = REFUSED[first];
  if (refused !== undefined) return { kind: 'usage', message: refused };
  if (first === 'gate') {
    if (rest[0] !== 'check') return { kind: 'usage', message: 'bb rehearse gate: only `gate check` (the gate never signs off here)' };
    return { kind: 'pass', args: [...argv] };
  }
  if ((PASS_THROUGH as readonly string[]).includes(first)) return { kind: 'pass', args: [...argv] };
  if (!first.startsWith('-') && isSlug(first) && rest.length === 0 && /^\d{4}-\d{2}-\d{2}-/.test(first)) {
    return { kind: 'open', slug: first };
  }
  return { kind: 'usage', message: `bb rehearse: unknown command ${first}` };
}

function parseOpen(rest: readonly string[]): BbRehearseCommand {
  if (rest.length === 0) return { kind: 'open', slug: null };
  if (rest.length > 1) return { kind: 'usage', message: 'bb rehearse open: expected at most one <slug>' };
  const slug = rest[0]!;
  if (!isSlug(slug)) return { kind: 'usage', message: `bb rehearse open: not an EPIC slug: ${slug}` };
  return { kind: 'open', slug };
}
