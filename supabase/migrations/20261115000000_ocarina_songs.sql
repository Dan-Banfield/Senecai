-- Ocarina Song Market: songs published from the web app (see
-- web/src/crafts/ocarina/market/supabaseStorage.ts). Seed songs are generated
-- in the browser and never stored here.
--
-- Visitors publish with a Supabase anonymous identity, so enable
-- Authentication > Sign In / Providers > "Allow anonymous sign-ins".

create table public.ocarina_songs (
  id          text primary key check (char_length(id) between 1 and 80),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 60),   -- TITLE_MAX
  artist      text not null check (char_length(artist) between 1 and 40),  -- ARTIST_MAX
  created_at  timestamptz not null default now(),
  duration_ms integer not null check (duration_ms >= 0),
  note_range  jsonb check (note_range is null or jsonb_typeof(note_range) = 'object'),
  -- The full recorded take (frames included). Capped so one upload can't fill the free tier.
  take        jsonb not null check (
    jsonb_typeof(take) = 'object'
    and coalesce(jsonb_typeof(take -> 'frames'), '') = 'array'
    and pg_column_size(take) <= 5 * 1024 * 1024
  )
);

create index ocarina_songs_created_at_idx on public.ocarina_songs (created_at desc);

alter table public.ocarina_songs enable row level security;

-- Everyone (signed in or not) can browse and play the market.
create policy "Songs are public"
  on public.ocarina_songs for select
  to anon, authenticated
  using (true);

-- Signed-in visitors (anonymous identities included) publish as themselves.
create policy "Publish as yourself"
  on public.ocarina_songs for insert
  to authenticated
  with check (owner = (select auth.uid()));

-- Only the owner can delete. Songs are never edited.
create policy "Delete your own songs"
  on public.ocarina_songs for delete
  to authenticated
  using (owner = (select auth.uid()));

-- Supabase grants everything on new public tables by default; narrow it so
-- clients can't set owner or created_at, or update rows.
revoke all on public.ocarina_songs from anon, authenticated;
grant select on public.ocarina_songs to anon, authenticated;
grant insert (id, title, artist, duration_ms, note_range, take), delete on public.ocarina_songs to authenticated;
