import path from "node:path";

/** Discord user IDs allowed to run `/admin` commands. */
export const ADMIN_IDS: ReadonlySet<string> = new Set(
  (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export function isAdmin(userId: string): boolean {
  return ADMIN_IDS.has(userId);
}

/** Where per-user/guild/bot settings are persisted as JSON. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

/** Locale used when nothing else (user, guild, bot default) sets one. */
export const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE?.trim() || "en";

/** Directory to also save a copy of every generated image to. Disabled (`null`) by default. */
export const SAVE_IMAGES_DIR = process.env.SAVE_IMAGES_DIR?.trim()
  ? path.resolve(process.env.SAVE_IMAGES_DIR.trim())
  : null;

/** The bot's icon image, synced to the Discord application by `deploy:images`. Unset (`null`) by default — no icon is synced. */
export const ICON_PATH = process.env.ICON_PATH?.trim()
  ? path.resolve(process.env.ICON_PATH.trim())
  : null;

/** The bot's logo image, drawn as the quote watermark in place of the bot's tag. Unset (`null`) by default — the watermark stays the bot's tag. */
export const LOGO_PATH = process.env.LOGO_PATH?.trim()
  ? path.resolve(process.env.LOGO_PATH.trim())
  : null;

/**
 * Community-page mirror (writes to the NXGF Supabase project so
 * blog.nextexgirlfriend.com/community can show approved quotes). Optional —
 * unset either one and mirroring/approval is silently disabled, same as
 * every other optional feature in this file.
 */
export const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || null;
export const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY?.trim() || null;

/** Discord role id allowed to approve/reject a quote via reaction. Required for the mirror's approval step to do anything. */
export const MOD_ROLE_ID = process.env.MOD_ROLE_ID?.trim() || null;

/** Reaction that approves a pending (or retracts an approved) quote. ❌ always rejects/retracts; this only configures the "yes" side. */
export const APPROVAL_EMOJI = process.env.APPROVAL_EMOJI?.trim() || "✅";
