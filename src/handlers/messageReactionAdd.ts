import type {
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import {
  approveQuote,
  moderationConfigured,
  rejectQuote,
} from "../communityMirror.js";
import { APPROVAL_EMOJI, MOD_ROLE_ID } from "../config/env.js";

const REJECTION_EMOJI = "❌";

/**
 * The entire approval UI for community quotes lives here: a Cummander
 * (MOD_ROLE_ID holder) reacting on the bot's own reply is the only way a
 * quote reaches public.community_quotes_public. No admin page, no slash
 * command — Discord itself is the approval surface.
 *
 * ✅ on a pending OR already-approved quote → approved (idempotent).
 * ❌ on a pending quote → rejected. ❌ on an already-approved quote →
 * rejected too — this is the retraction path, so a mod can pull an
 * already-public quote back down from inside Discord.
 */
export async function onMessageReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return;
  if (!moderationConfigured() || !MOD_ROLE_ID) return;

  const emojiName = reaction.emoji.name;
  if (emojiName !== APPROVAL_EMOJI && emojiName !== REJECTION_EMOJI) return;

  if (reaction.partial) await reaction.fetch();
  const message = reaction.message.partial
    ? await reaction.message.fetch()
    : reaction.message;

  const guild = message.guild;
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(MOD_ROLE_ID)) return;

  if (emojiName === APPROVAL_EMOJI) {
    await approveQuote(message.id, user.id);
  } else {
    await rejectQuote(message.id);
  }
}
