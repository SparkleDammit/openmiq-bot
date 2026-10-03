import { REST, Routes } from "discord.js";
import { insertCommunityQuote, uploadQuoteImage } from "./communityMirror.js";
import { OLD_BOT_USER_ID, QUOTE_CHANNEL_ID } from "./config/env.js";
import { supabaseClient } from "./config/supabase.js";
import { loadDeployEnv } from "./loadDeployEnv.js";

/** The subset of Discord's raw REST message shape this script actually reads. Minimal on purpose — this talks to the REST API directly (no gateway login needed for a read-only batch job), so there's no discord.js Message class wrapping the response. */
interface RawMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string; global_name: string | null };
  embeds?: {
    description?: string;
    image?: { url: string };
    thumbnail?: { url: string };
  }[];
  attachments?: { url: string }[];
}

const JUMP_LINK_RE = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const PAGE_SIZE = 100;
const DELAY_BETWEEN_ITEMS_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-off import of every quote already posted by the PREVIOUS (third-
 * party) quote bot in QUOTE_CHANNEL_ID, before openmiq-bot existed. Run
 * with `pnpm run backfill:quotes` (add `--dev` to read `.env.local`
 * instead of `.env`, same convention as the deploy scripts).
 *
 * Safe to re-run: community_quotes has a unique (guild_id, message_id)
 * index and every insert here goes through insertCommunityQuote's
 * ignoreDuplicates upsert, so a second run (or a crash partway through
 * the first) just skips what's already imported rather than erroring or
 * duplicating.
 *
 * Each old quote message is matched by OLD_BOT_USER_ID (not by display
 * name — names can be renamed or collide). From it we pull: the rendered
 * quote-card image (embed image, embed thumbnail, or a plain attachment —
 * tried in that order), and a `discord.com/channels/.../.../...` jump
 * link to the ORIGINAL quoted message, found by regexing the whole raw
 * message rather than assuming one specific field, since the exact shape
 * wasn't confirmed ahead of time. That original message is then fetched
 * directly so the imported row gets the real quote text and the real
 * author — far more reliable than trying to read either off the picture.
 * If the original has since been deleted (expected for some of a 284-item
 * backlog), the image still imports fine; quote text/author just fall
 * back to a generic placeholder, since neither is ever shown on the
 * public page anyway (quote_text is alt-text only; quote_author is
 * moderation-only).
 *
 * Imported rows land as 'approved' with `approved_at` set to the old
 * quote message's own timestamp — a deliberate choice (confirmed with the
 * repo owner) to skip re-running these through the ✅/❌ gate, since
 * they've already been sitting visibly in the channel. `reply_message_id`
 * is the OLD bot's own message id, so a mod ❌-reacting on that original
 * message later still retracts it, same mechanism as a live quote.
 */
export async function backfillQuotes(): Promise<void> {
  loadDeployEnv();

  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");
  if (!QUOTE_CHANNEL_ID) {
    throw new Error(
      "QUOTE_CHANNEL_ID is not set — the channel to scan for the old bot's quotes.",
    );
  }
  if (!OLD_BOT_USER_ID) {
    throw new Error(
      "OLD_BOT_USER_ID is not set — the previous quote bot's Discord user id. " +
        "Enable Developer Mode, right-click one of its messages, Copy User ID.",
    );
  }
  if (!supabaseClient()) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not both set.");
  }

  const rest = new REST().setToken(token);

  let scanned = 0;
  let matched = 0;
  let imported = 0;
  let failed = 0;
  let before: string | undefined;

  for (;;) {
    const page = (await rest.get(Routes.channelMessages(QUOTE_CHANNEL_ID), {
      query: new URLSearchParams(
        before
          ? { limit: String(PAGE_SIZE), before }
          : { limit: String(PAGE_SIZE) },
      ),
    })) as RawMessage[];

    if (page.length === 0) break;
    scanned += page.length;

    for (const msg of page) {
      if (msg.author.id !== OLD_BOT_USER_ID) continue;
      matched++;

      try {
        await backfillOne(rest, msg);
        imported++;
      } catch (error) {
        failed++;
        console.error(`[skip] message ${msg.id} failed:`, error);
      }

      await sleep(DELAY_BETWEEN_ITEMS_MS);
    }

    before = page[page.length - 1]?.id;
  }

  console.log(
    `Scanned ${scanned} message(s), ${matched} from the old bot, ${imported} imported, ${failed} failed.`,
  );
}

async function backfillOne(rest: REST, msg: RawMessage): Promise<void> {
  const imageUrl =
    msg.embeds?.[0]?.image?.url ??
    msg.embeds?.[0]?.thumbnail?.url ??
    msg.attachments?.[0]?.url;
  if (!imageUrl) {
    throw new Error("no quote-card image found on this message");
  }

  const linkMatch = JSON.stringify(msg).match(JUMP_LINK_RE);
  if (!linkMatch) {
    throw new Error("no 'Jump to original message' link found");
  }
  const [, linkGuildId, linkChannelId, linkMessageId] = linkMatch;

  let quoteText = "(original message no longer available)";
  let quoteAuthor = "(unknown)";
  let quoteAuthorId: string | null = null;
  try {
    const original = (await rest.get(
      Routes.channelMessage(linkChannelId!, linkMessageId!),
    )) as RawMessage;
    quoteText = original.content?.trim() || quoteText;
    quoteAuthor = original.author.global_name || original.author.username;
    quoteAuthorId = original.author.id;
  } catch {
    // Original message deleted or inaccessible — keep the fallbacks above.
    // The image still imports; neither field is ever shown publicly.
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`image download failed: ${imageResponse.status}`);
  }
  const image = Buffer.from(await imageResponse.arrayBuffer());

  const publicUrl = await uploadQuoteImage(linkGuildId!, linkMessageId!, image);
  if (!publicUrl) throw new Error("Supabase not configured");

  await insertCommunityQuote({
    guildId: linkGuildId!,
    channelId: linkChannelId!,
    messageId: linkMessageId!,
    replyMessageId: msg.id,
    quoteText,
    quoteAuthor,
    quoteAuthorId,
    imageUrl: publicUrl,
    discordMessageUrl: `https://discord.com/channels/${linkGuildId}/${linkChannelId}/${linkMessageId}`,
    status: "approved",
    approvedBy: null,
    approvedAt: msg.timestamp,
  });

  console.log(`[ok] message ${msg.id} -> original ${linkMessageId}`);
}
