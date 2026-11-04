import type { Clarification, Outcome, Plan } from './types';

const hr = '─'.repeat(64);

export function renderOutcome(o: Outcome & { dataRevision?: number }, target: string, apply: boolean): string {
  const { plan } = o;
  const out: string[] = [];
  out.push(hr);
  out.push(`Target:  ${target}`);
  out.push(`Command: ${plan.command}  —  ${o.applied ? 'APPLIED' : apply ? 'NOT APPLIED' : 'DRY RUN (nothing written; add --apply to write)'}`);
  if (plan.summary) out.push(`Summary: ${plan.summary}`);
  out.push(hr);

  const d = plan.details as Record<string, unknown>;
  const resolved = d['resolved'] as { input: string; displayName: string; playerId: string; via: string }[] | undefined;
  if (resolved?.length) {
    out.push('Names resolved:');
    for (const r of resolved) out.push(`  ${r.input.padEnd(14)} → ${r.displayName} (${r.playerId})  [matched by ${r.via}]`);
    out.push('');
  }

  if (plan.clarifications.length) {
    out.push('NEEDS YOUR INPUT — nothing has been written:');
    for (const c of plan.clarifications) out.push(`  ? ${c.question}`);
    out.push('');
  }
  if (plan.errors.length) {
    out.push('ERRORS — nothing has been written:');
    for (const e of plan.errors) out.push(`  ✖ [${e.code}] ${e.message}`);
    out.push('');
  }
  if (plan.warnings.length) {
    out.push('Warnings:');
    for (const w of plan.warnings) out.push(`  ⚠ [${w.code}] ${w.message}`);
    out.push('');
  }

  const changes = d['changes'] as string[] | undefined;
  if (changes?.length) {
    out.push('Changes:');
    for (const c of changes) out.push(`  • ${c}`);
    out.push('');
  }
  const lines = d['statChangeLines'] as string[] | undefined;
  if (lines?.length) {
    out.push('Player statistics that change (all-time):');
    for (const l of lines) out.push(`  • ${l}`);
    out.push('');
  }
  if (plan.ops.length) {
    out.push(`${o.applied ? 'Written' : 'Would write'} (${plan.ops.length}, atomically):`);
    for (const op of plan.ops) out.push(`  ${op.action === 'create' ? '+' : op.action === 'delete' ? '−' : '~'} ${op.collection}/${op.id} — ${op.summary}`);
    out.push('');
  }

  const facts = d['facts'] as { statements: string[]; notRecorded: string[]; records: string[] } | null | undefined;
  if (facts && plan.ok && !o.applied) {
    out.push('FACT SHEET — write the report using ONLY these facts (plus anything the user told you):');
    for (const s of facts.statements) out.push(`  • ${s}`);
    out.push('  Not recorded (do not state as fact):');
    for (const s of facts.notRecorded) out.push(`    – ${s}`);
    out.push('  (run `facts match <id>` for the complete structured fact sheet)');
    out.push('');
  }

  const article = d['article'] as { slug: string; title: string; action: string; url: string } | null | undefined;
  if (o.applied) {
    out.push(`✔ Done. Site data revision ${o.dataRevision}. Browsers pick the change up on their next page load — no redeploy needed.`);
    const matchId = d['matchId'] as string | null | undefined;
    if (matchId && plan.command.startsWith('match') && !plan.command.includes('delete')) out.push(`  Match page:   /matches/${matchId}`);
    if (article) out.push(`  Report:       ${article.url}`);
    const slug = d['slug'] as string | null | undefined;
    if (slug && plan.command.startsWith('article')) out.push(`  Article:      /news/${slug}`);
    out.push(`  Undo with:    npm run mnf -- revert ${o.opId} --apply`);
  } else if (plan.ok && plan.ops.length) {
    out.push('Ready. Re-run the same command with --apply to write this.');
  } else if (plan.clarifications.length) {
    out.push('Ask the user the question(s) above, then re-run with the answer.');
  } else if (!plan.ok) {
    out.push('Not publishable as written. Fix the errors above (ask the user for any missing facts — never invent them).');
  }
  return out.join('\n');
}

export function renderClarifications(cs: Clarification[]): string {
  return cs.map((c) => `? ${c.question}`).join('\n');
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0]!.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  const lines = all.map(fmt);
  if (header) lines.splice(1, 0, widths.map((w) => '─'.repeat(w)).join('  '));
  return lines.join('\n');
}

export type { Plan };
