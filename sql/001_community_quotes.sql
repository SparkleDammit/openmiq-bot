-- Discord quote cards, mirrored by this bot after a real (never fake) quote
-- is posted. Lives in public.community_quotes + a name-scrubbed view
-- (NXGF Supabase project ckrgundqozpnwzpsnndd) — a deliberate extension of
-- the public.blog_posts exception (ADR-0015), see
-- nextex-root/docs/adrs/ADR-0021.
--
-- The base table grants `anon` NOTHING — not row-filtered, just
-- inaccessible, even via a direct PostgREST call. The only public-facing
-- surface is community_quotes_public, a view whose column list doesn't
-- include an author field at all, filtered to status='approved' in its own
-- definition. getting-off (the blog) reads only the view, never this table.
--
-- Status moves pending -> approved/rejected via a mod (MOD_ROLE_ID holder)
-- reacting ✅/❌ on the bot's own reply — see src/communityMirror.ts and
-- src/handlers/messageReactionAdd.ts. ❌ on an already-approved row is the
-- retraction path. The quote's own "Remove" button also retracts it.
--
-- Hand-run in the Supabase SQL editor — already applied 2026-10-03.

create table if not exists public.community_quotes (
    id                   uuid primary key default gen_random_uuid(),
    guild_id             bigint not null,
    channel_id           bigint not null,
    message_id           bigint not null,        -- the original quoted message
    reply_message_id     bigint not null,        -- the bot's own reply (carries ✅/❌)
    quote_text           text not null,
    quote_author         text not null,          -- moderation/removal use ONLY, never public
    quote_author_id      bigint,                 -- moderation/removal use ONLY, never public
    image_url            text not null,          -- public Storage URL
    discord_message_url  text not null,          -- jump link to the original message
    status               text not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected')),
    approved_by          bigint,
    created_at           timestamptz not null default now(),
    approved_at          timestamptz
);

create index if not exists community_quotes_status_created_idx
    on public.community_quotes (status, created_at desc);

create unique index if not exists community_quotes_message_unique
    on public.community_quotes (guild_id, message_id);

alter table public.community_quotes enable row level security;
-- Deliberately NO policy grants anon anything on this base table.

create or replace view public.community_quotes_public as
  select id, quote_text, image_url, discord_message_url, created_at
  from public.community_quotes
  where status = 'approved';

grant select on public.community_quotes_public to anon;

insert into storage.buckets (id, name, public)
values ('community-quotes', 'community-quotes', true)
on conflict (id) do nothing;

drop policy if exists community_quotes_storage_read on storage.objects;
create policy community_quotes_storage_read
    on storage.objects for select to anon
    using (bucket_id = 'community-quotes');
