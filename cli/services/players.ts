import { z } from 'zod';
import { normaliseName, slugify, uniqueId } from '../../src/shared/ids';
import { resolveName } from '../../src/shared/names';
import { playerSchema, SCHEMA_VERSION, type Player } from '../../src/shared/schema';
import type { Snapshot } from '../store';
import type { Ctx, Plan } from '../types';
import { err, newPlan, op, seal, warn } from './common';

export const playerAddSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    nickname: z.string().trim().min(1).max(30).optional(),
    aliases: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    bio: z.string().trim().min(1).max(600).optional(),
    fictional: z.boolean().optional(),
    instruction: z.string().max(4000).optional(),
  })
  .strict();

export const playerPatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    nickname: z.string().trim().min(1).max(30).nullable().optional(),
    addAliases: z.array(z.string().trim().min(1).max(40)).optional(),
    removeAliases: z.array(z.string().trim().min(1).max(40)).optional(),
    bio: z.string().trim().min(1).max(600).nullable().optional(),
    photo: z.string().nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
    instruction: z.string().max(4000).optional(),
  })
  .strict();
export type PlayerPatch = z.infer<typeof playerPatchSchema>;

export interface PlayerDetails {
  playerId: string | null;
  player: Player | null;
  changes: string[];
}

const firstToken = (s: string) => normaliseName(s).split(' ')[0] ?? '';

export function planAddPlayer(snap: Snapshot, input: unknown, ctx: Ctx): Plan<PlayerDetails> {
  const plan = newPlan<PlayerDetails>('player add', { playerId: null, player: null, changes: [] });
  const parsed = playerAddSchema.safeParse(input);
  if (!parsed.success) {
    plan.errors.push(...parsed.error.issues.map((i) => err('SPEC_INVALID', `${i.path.join('.') || '(root)'}: ${i.message}`)));
    return seal(plan);
  }
  const spec = parsed.data;
  if (spec.instruction) plan.instruction = spec.instruction;

  const norm = normaliseName(spec.name);
  const clash = snap.players.find((p) => normaliseName(p.displayName) === norm);
  if (clash) {
    plan.errors.push(err('PLAYER_EXISTS', `A player called "${clash.displayName}" already exists (id ${clash.id}). Display names must be unique. Use that player, or choose a distinguishing name such as "${spec.name} B".`));
    return seal(plan);
  }
  for (const other of snap.players) {
    const names = [other.nickname, ...other.aliases].filter(Boolean).map((n) => normaliseName(n!));
    if (names.includes(norm)) {
      plan.errors.push(err('NAME_TAKEN_BY_ALIAS', `"${spec.name}" is already used as a nickname/alias of ${other.displayName} (${other.id}). Using it for a new player would make requests ambiguous.`));
      return seal(plan);
    }
  }
  const sameFirst = snap.players.filter((p) => firstToken(p.displayName) === firstToken(spec.name));
  if (sameFirst.length) {
    plan.warnings.push(
      warn('FIRST_NAME_OVERLAP', `${sameFirst.map((p) => p.displayName).join(', ')} share the first name "${firstToken(spec.name)}". Plain "${firstToken(spec.name)}" will be ambiguous in future requests — always use the full display name or a nickname for them.`),
    );
  }
  const aliasClash = (spec.aliases ?? []).filter((a) => snap.players.some((p) => normaliseName(p.displayName) === normaliseName(a)));
  if (aliasClash.length) {
    plan.errors.push(err('ALIAS_CLASH', `Alias ${aliasClash.map((a) => `"${a}"`).join(', ')} is already another player's display name.`));
    return seal(plan);
  }

  const id = uniqueId(slugify(spec.name, 'player'), new Set(snap.players.map((p) => p.id)));
  const now = ctx.now.toISOString();
  const doc: Player = {
    schemaVersion: SCHEMA_VERSION,
    id,
    displayName: spec.name,
    ...(spec.nickname ? { nickname: spec.nickname } : {}),
    aliases: spec.aliases ?? [],
    ...(spec.bio ? { bio: spec.bio } : {}),
    status: 'active',
    ...(spec.fictional ? { fictional: true as const } : {}),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const check = playerSchema.safeParse(doc);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('PLAYER_INVALID', `${i.path.join('.')}: ${i.message}`)));
    return seal(plan);
  }
  plan.details = { playerId: id, player: check.data, changes: [] };
  plan.ops.push(op('players', id, 'create', null, check.data, `Created player ${spec.name} (${id})`));
  plan.summary = `Create player "${spec.name}" with id "${id}"`;
  return seal(plan);
}

export function planUpdatePlayer(snap: Snapshot, ref: string, input: unknown, ctx: Ctx): Plan<PlayerDetails> {
  const plan = newPlan<PlayerDetails>('player update', { playerId: null, player: null, changes: [] });
  const r = resolveName(ref, snap.players);
  if (r.kind !== 'resolved') {
    if (r.kind === 'ambiguous') {
      plan.clarifications.push({
        kind: 'ambiguous',
        input: ref,
        where: 'player to update',
        candidates: r.candidates.map(({ playerId, displayName }) => ({ playerId, displayName })),
        question: `"${ref}" could be ${r.candidates.map((c) => `${c.displayName} (use "id:${c.playerId}")`).join(' or ')}. Which one?`,
      });
    } else {
      plan.clarifications.push({
        kind: 'unknown',
        input: ref,
        where: 'player to update',
        suggestions: r.suggestions,
        question: `No player called "${ref}".${r.suggestions.length ? ` Did you mean ${r.suggestions.map((s) => s.displayName).join(' or ')}?` : ''}`,
      });
    }
    return seal(plan);
  }
  const parsed = playerPatchSchema.safeParse(input);
  if (!parsed.success) {
    plan.errors.push(...parsed.error.issues.map((i) => err('SPEC_INVALID', `${i.path.join('.') || '(root)'}: ${i.message}`)));
    return seal(plan);
  }
  const patch = parsed.data;
  if (patch.instruction) plan.instruction = patch.instruction;
  const cur = snap.players.find((p) => p.id === r.playerId)!;
  const next: Player = { ...cur, aliases: [...cur.aliases] };
  const changes: string[] = [];

  if (patch.displayName !== undefined && patch.displayName !== cur.displayName) {
    const clash = snap.players.find((p) => p.id !== cur.id && normaliseName(p.displayName) === normaliseName(patch.displayName!));
    if (clash) plan.errors.push(err('PLAYER_EXISTS', `Another player is already called "${clash.displayName}".`));
    changes.push(`name "${cur.displayName}" → "${patch.displayName}" (id stays "${cur.id}")`);
    next.displayName = patch.displayName;
  }
  if (patch.nickname !== undefined) {
    if (patch.nickname === null) {
      delete next.nickname;
      if (cur.nickname) changes.push('nickname removed');
    } else if (patch.nickname !== cur.nickname) {
      next.nickname = patch.nickname;
      changes.push(`nickname → "${patch.nickname}"`);
    }
  }
  for (const a of patch.addAliases ?? []) {
    if (!next.aliases.some((x) => normaliseName(x) === normaliseName(a))) {
      next.aliases.push(a);
      changes.push(`alias + "${a}"`);
    }
  }
  for (const a of patch.removeAliases ?? []) {
    const before = next.aliases.length;
    next.aliases = next.aliases.filter((x) => normaliseName(x) !== normaliseName(a));
    if (next.aliases.length !== before) changes.push(`alias − "${a}"`);
  }
  if (patch.bio !== undefined) {
    if (patch.bio === null) {
      delete next.bio;
      if (cur.bio) changes.push('bio removed');
    } else if (patch.bio !== cur.bio) {
      next.bio = patch.bio;
      changes.push('bio updated');
    }
  }
  if (patch.photo !== undefined) {
    if (patch.photo === null) {
      delete next.photo;
      if (cur.photo) changes.push('photo removed (placeholder avatar will be used)');
    } else if (patch.photo !== cur.photo) {
      next.photo = patch.photo;
      changes.push(`photo → ${patch.photo}`);
    }
  }
  if (patch.status !== undefined && patch.status !== cur.status) {
    next.status = patch.status;
    changes.push(`status ${cur.status} → ${patch.status}`);
  }

  // New names must not collide with other players' names.
  const taken = (n: string) =>
    snap.players.some((p) => p.id !== cur.id && [p.displayName, p.nickname, ...p.aliases].filter(Boolean).some((x) => normaliseName(x!) === normaliseName(n)));
  for (const n of [next.displayName, next.nickname, ...next.aliases].filter(Boolean) as string[]) {
    if (taken(n) && ![cur.displayName, cur.nickname, ...cur.aliases].includes(n)) {
      plan.errors.push(err('NAME_TAKEN', `"${n}" is already another player's name, nickname or alias.`));
    }
  }
  if (plan.errors.length) return seal(plan);
  if (changes.length === 0) {
    plan.errors.push(err('NO_CHANGES', `Nothing to change for ${cur.displayName}.`));
    return seal(plan);
  }
  next.revision = cur.revision + 1;
  next.updatedAt = ctx.now.toISOString();
  const check = playerSchema.safeParse(next);
  if (!check.success) {
    plan.errors.push(...check.error.issues.map((i) => err('PLAYER_INVALID', `${i.path.join('.')}: ${i.message}`)));
    return seal(plan);
  }
  plan.details = { playerId: cur.id, player: check.data, changes };
  plan.ops.push(op('players', cur.id, 'update', cur, check.data, `Updated ${cur.displayName}: ${changes.join('; ')}`));
  plan.summary = `Update ${cur.displayName}: ${changes.join('; ')}`;
  return seal(plan);
}
