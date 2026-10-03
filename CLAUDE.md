# CLAUDE.md — openmiq-bot

Repo-root brief for Claude / any dev. Part of the **NextEx Girlfriend** ecosystem — feeds the blog's `/community` page (`../getting-off`). Cross-app docs live at `../nextex-root/docs/`.

## What this is

A **public fork** of [`otnc/OpenMiQ`](https://github.com/otnc/OpenMiQ) (self-hosted Discord quote-image bot, AGPL-3.0-or-later with additional terms — see `ADDITIONAL_TERMS.md`), self-hosted in the Patreon/community server, with one addition: a posted quote is mirrored to Supabase and goes public only after a mod approves it in Discord.

**Why forked instead of built fresh:** `makeitaquote` (the image-rendering library this depends on) handles fonts, emoji, Discord markdown and Japanese line-breaking — real, nontrivial work not worth reimplementing. **Why a public repo** (the one exception to "every repo is private" in this estate): AGPL's network-use clause means members interacting with a modified AGPL bot over Discord are entitled to its source — a private repo wouldn't satisfy that. **Why Node/TypeScript** (the first in this estate; house default for bots is Python + discord.py): it's what OpenMiQ and `makeitaquote` are written in — forking beats rewriting a rendering pipeline in a different stack.

**AGPL obligations that actually bind here** (`ADDITIONAL_TERMS.md`, Section 7): keep this a _public_ repo; keep the `/credits` command (and `/help`'s last page) showing OpenMiQ/otoneko./the upstream URL — untouched by this fork, still correct; and the live Discord bot's **display name must not be literally "OpenMiQ"** (Section 7(c), "mark it... as modified... under a name that is not identical to OpenMiQ") — that's a Discord Developer Portal setting, so whoever creates the bot application picks the name, not this repo.

## What's actually modified (everything else is vanilla upstream)

- `src/config/env.ts` — four new optional env vars (below).
- `src/config/supabase.ts` (new) — lazily-built `@supabase/supabase-js` client, `null` when the two Supabase env vars aren't both set (mirroring is entirely optional, same pattern as every other optional feature in this file).
- `src/communityMirror.ts` (new) — `mirrorQuoteToSupabase()`, `approveQuote()`, `rejectQuote()`. All **best-effort**: try/catch, log-and-swallow, never throw — a Supabase outage must never block or break the actual Discord reply (same fail-soft contract GossipGirl's own mirror uses).
- `src/commands/quote.ts` and `src/handlers/messageCreate.ts` — the two REAL-quote paths (both already save `fake: false` state) call `mirrorQuoteToSupabase({ target, reply, data, png })` right after their existing `saveQuoteState(...)`. **`src/commands/fakequote.ts` is untouched on purpose** — a `/fakequote` has no real `target` message to link back to, and mirroring fabricated text as if it were something a member actually said would misattribute it. Don't add a mirror call there.
- `src/handlers/messageReactionAdd.ts` (new) + a new `Events.MessageReactionAdd` listener in `src/index.ts` — the entire approval UI. ✅ from a `MOD_ROLE_ID` holder on the bot's own reply approves (pending→approved, or a no-op re-approve); ❌ rejects a pending quote **or retracts an already-approved one** — same branch, same effect either way.
- `src/handlers/interactionCreate.ts`'s `handleDeleteButton` — now also calls `rejectQuote()` after the existing soft-delete, so the quote's own generator/subject pressing **Remove** retracts the public copy too, not just the Discord message.

## Env vars

Upstream's own list (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `ADMIN_IDS`, `DATA_DIR`, `SAVE_IMAGES_DIR`, …) is unchanged — see `.env.example`. New, all optional as a pair/triple:

- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — same NXGF project as the blog (`https://ckrgundqozpnwzpsnndd.supabase.co`), service-role key. Unset either one and the mirror is silently disabled; the bot behaves exactly like unmodified OpenMiQ.
- `MOD_ROLE_ID` — Discord role id allowed to approve/reject. Required for the approval step to do anything; quotes still mirror as `pending` without it, they just can never become public.
- `APPROVAL_EMOJI` — defaults to `✅`. `❌` is hardcoded as the reject/retract side, not configurable.

## Database

`sql/001_community_quotes.sql` — hand-run in the Supabase SQL editor already (2026-10-03). Base table `public.community_quotes` grants `anon` **nothing** (not row-filtered, just inaccessible); the public surface is `public.community_quotes_public`, a view with no author column in its definition, filtered to `status='approved'`. Full reasoning in [ADR-0021](../nextex-root/docs/adrs/ADR-0021-public-community-tables-exception.md).

## Backfilling the old quotes

The 284 quotes already sitting in the channel from the previous (third-party) quote bot aren't touched by anything above — the mirror only fires at the moment a _new_ quote is generated through _this_ bot. `pnpm run backfill:quotes` (`src/backfillQuotes.ts` / `backfillQuotesCli.ts`) is a one-off import for those: it scans `QUOTE_CHANNEL_ID`'s full history via the Discord REST API (no gateway login needed — this is a read-only batch job, can run independent of the live bot), finds every message from `OLD_BOT_USER_ID`, and for each one:

- Pulls the rendered quote-card image off it (embed image → embed thumbnail → plain attachment, tried in that order).
- Finds the "Jump to original message" link by regexing the whole raw message rather than assuming one specific field — the old bot's exact message shape wasn't confirmed ahead of time, so this is deliberately shape-agnostic.
- Fetches that original message directly, for the **real** quote text and **real** author — far more reliable than OCR'ing the picture. If the original's since been deleted (expected for some of 284), the image still imports fine with a generic placeholder for both, since neither is ever shown publicly anyway (`quote_text` is alt-text only; `quote_author`/`quote_author_id` are moderation-only).
- Uploads + upserts exactly like the live mirror (shares `uploadQuoteImage`/`insertCommunityQuote` from `communityMirror.ts`), **pre-approved** (`status: 'approved'`, `approved_at` = the old quote's own post timestamp) — confirmed with the repo owner: these were already sitting visibly in the channel, so they skip the ✅/❌ gate new quotes go through. `reply_message_id` is set to the _old_ bot's own message id, so a mod ❌-reacting on that original message later still retracts it, same mechanism as a live quote.

Safe to re-run: the unique `(guild_id, message_id)` index plus `insertCommunityQuote`'s `ignoreDuplicates` upsert mean a second run (or a crash partway through 284 items) just skips what's already imported.

```bash
pnpm run backfill:quotes   # needs DISCORD_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY,
                            # QUOTE_CHANNEL_ID, OLD_BOT_USER_ID in .env — none of these
                            # need the full bot to be live yet
```

Prints a running `[ok]`/`[skip]` log per message and a final scanned/matched/imported/failed summary. Not something a Claude session can run — it needs a real Discord bot token.

## Deploy

New service inside the existing **`discord-bots`** Railway project (not the Toy Room project — this is a bot, not a web app), **EU West** (co-locate with Supabase eu-west-1). `Procfile`: `worker: node dist/index.js` — gateway-only, no HTTP listener, so `worker:` from day one rather than repeating [Gossip Girl's documented `web:`/`worker:` nit](../GossipGirl/CLAUDE.md). Build step (`tsdown`) runs via the `build` script in `package.json`; Railway's Node auto-detection picks it up without extra config — no `nixpacks.toml` needed. Node `>=24` per `package.json engines`.

## Work here

```bash
corepack enable && corepack prepare pnpm@10.34.5 --activate
pnpm install
cp .env.example .env    # fill in DISCORD_TOKEN at minimum; Supabase/MOD_ROLE_ID optional for local dev
pnpm run dev
```

`pnpm run typecheck` / `pnpm run lint` / `pnpm run test` / `pnpm run format:check` all pass as of this fork (139 tests, verified 2026-10-03 against Node 23 locally despite the `>=24` engine field — works fine for dev/typecheck/test; match the real version in Railway).

## Still needed before this is live (not something a Claude session can do)

1. **Create the Discord bot application** in the Developer Portal — pick a display name that is **not** "OpenMiQ" (AGPL Section 7(c), see above). Enable the **Message Content** intent (the mention-based quote path needs it, same as upstream).
2. Invite it to the Patreon/community server with permission to send messages, embed links, attach files, add reactions, and read message history.
3. Set `MOD_ROLE_ID` to the Cummander role's id, and `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` to the NXGF project's values (Railway only — never commit these).
4. Decide whether this replaces the current third-party Make-It-A-Quote bot in that server, or runs alongside it — an operational/server-settings call, not a code change.
