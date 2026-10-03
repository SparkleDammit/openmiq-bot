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
  const supabase = supabaseClient();
  if (!supabase || !target.guildId) return;

  try {
    const path = `${target.guildId}/${target.id}.png`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    const { error: insertError } = await supabase
      .from("community_quotes")
      .insert({
        guild_id: target.guildId,
        channel_id: target.channelId,
        message_id: target.id,
        reply_message_id: reply.id,
        quote_text: data.text,
        quote_author: data.displayName || data.username,
        quote_author_id: target.author?.id ?? null,
        image_url: publicUrl,
        discord_message_url: target.url,
        status: "pending",
      });
    if (insertError) throw insertError;
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
