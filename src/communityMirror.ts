import type { Message } from "discord.js";
import type { QuoteData } from "makeitaquote";
import { supabaseClient } from "./config/supabase.js";
import { MOD_ROLE_ID } from "./config/env.js";

const BUCKET = "community-quotes";

export interface MirrorQuoteParams {
  /** The original message that was quoted — never set for a `/fakequote`. */
  target: Message;
  /** The bot's own posted reply, carrying the rendered image. */
  reply: Message;
  data: QuoteData;
  png: Buffer;
}

/** A community_quotes row, in the same shape regardless of where it came from — the live mirror below, or `backfillQuotes.ts`'s one-off import from the previous quote bot's channel history. */
export interface CommunityQuoteRow {
  guildId: string;
  channelId: string;
  messageId: string;
  replyMessageId: string;
  quoteText: string;
  quoteAuthor: string;
  quoteAuthorId: string | null;
  imageUrl: string;
  discordMessageUrl: string;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string | null;
  approvedAt?: string | null;
}

/** Uploads one quote-card image to the public Storage bucket, keyed by the ORIGINAL message's id (not the reply's) — matches the live mirror's path scheme so a backfilled row and a freshly-posted one can never collide. Returns the public URL, or `null` when Supabase isn't configured. Throws on an actual upload failure — callers decide how to handle that (the live path swallows it, the backfill script logs and skips that one item). */
export async function uploadQuoteImage(
  guildId: string,
  messageId: string,
  image: Buffer,
): Promise<string | null> {
  const supabase = supabaseClient();
  if (!supabase) return null;
  const path = `${guildId}/${messageId}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, image, { contentType: "image/png", upsert: true });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return publicUrl;
}

/** Upserts one community_quotes row, keyed on (guild_id, message_id) — a second attempt at the same original message (a re-run of the backfill, or a double-fire of the live mirror) is silently ignored rather than erroring. No-op when Supabase isn't configured. */
export async function insertCommunityQuote(
  row: CommunityQuoteRow,
): Promise<void> {
  const supabase = supabaseClient();
  if (!supabase) return;
  const { error } = await supabase.from("community_quotes").upsert(
    {
      guild_id: row.guildId,
      channel_id: row.channelId,
      message_id: row.messageId,
      reply_message_id: row.replyMessageId,
      quote_text: row.quoteText,
      quote_author: row.quoteAuthor,
      quote_author_id: row.quoteAuthorId,
      image_url: row.imageUrl,
      discord_message_url: row.discordMessageUrl,
      status: row.status,
      approved_by: row.approvedBy ?? null,
      approved_at: row.approvedAt ?? null,
    },
    { onConflict: "guild_id,message_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Best-effort mirror of a freshly-posted REAL quote (never a `/fakequote` —
 * callers only reach this from the two `fake: false` paths) into
 * public.community_quotes, status 'pending', for the website's /community
 * page. Never throws — a Supabase outage must never block or break the
 * actual Discord reply, same fail-soft contract GossipGirl's mirror uses on
 * its side. Skipped entirely for DMs (no guild_id to key on) and whenever
 * SUPABASE_URL/SUPABASE_SERVICE_KEY aren't set.
 */
export async function mirrorQuoteToSupabase({
  target,
  reply,
  data,
  png,
}: MirrorQuoteParams): Promise<void> {
  if (!target.guildId) return;
  try {
    const imageUrl = await uploadQuoteImage(target.guildId, target.id, png);
    if (!imageUrl) return; // Supabase not configured
    await insertCommunityQuote({
      guildId: target.guildId,
      channelId: target.channelId,
      messageId: target.id,
      replyMessageId: reply.id,
      quoteText: data.text,
      quoteAuthor: data.displayName || data.username,
      quoteAuthorId: target.author?.id ?? null,
      imageUrl,
      discordMessageUrl: target.url,
      status: "pending",
    });
  } catch (error) {
    console.error("community_quotes mirror failed; continuing.", error);
  }
}

/** Approves a pending quote, or re-approves/retracts an already-decided one — ✅ always means "show this". */
export async function approveQuote(
  replyMessageId: string,
  approverId: string,
): Promise<void> {
  await setQuoteStatus(replyMessageId, "approved", approverId);
}

/**
 * Rejects a quote. Used for ❌ on a pending quote (reject) AND on an
 * already-approved one (retraction) — same effect either way, nothing on
 * the public site once this lands. Also called when the quote's own
 * generator/subject presses the existing "Remove" button, so a Discord-side
 * takedown doesn't leave a stale public copy behind.
 */
export async function rejectQuote(replyMessageId: string): Promise<void> {
  await setQuoteStatus(replyMessageId, "rejected", null);
}

async function setQuoteStatus(
  replyMessageId: string,
  status: "approved" | "rejected",
  approverId: string | null,
): Promise<void> {
  const supabase = supabaseClient();
  if (!supabase) return;
  try {
    const patch: Record<string, unknown> = { status };
    if (status === "approved") {
      patch.approved_by = approverId;
      patch.approved_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("community_quotes")
      .update(patch)
      .eq("reply_message_id", replyMessageId);
    if (error) throw error;
  } catch (error) {
    console.error(`community_quotes ${status} failed; continuing.`, error);
  }
}

/** Whether MOD_ROLE_ID is configured at all — lets the reaction listener skip work entirely when it isn't. */
export function moderationConfigured(): boolean {
  return MOD_ROLE_ID !== null;
}
