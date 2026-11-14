-- =========================================================
-- Orange Tube — Shorts + Picture posts
-- Run once in Supabase → SQL Editor (after schema.sql). Safe to re-run.
-- =========================================================

-- ---------- SHORTS (a flag on videos) ----------
alter table public.videos add column if not exists is_short boolean not null default false;
create index if not exists videos_short_idx on public.videos (is_short, created_at desc);

-- ---------- PICTURE POSTS ----------
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  caption    text default '' check (char_length(caption) <= 2000),
  images     text[] not null check (array_length(images, 1) between 1 and 10),
  created_at timestamptz default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id);

create table if not exists public.post_likes (
  user_id    uuid references public.profiles(id) on delete cascade,
  post_id    uuid references public.posts(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

alter table public.posts      enable row level security;
alter table public.post_likes enable row level security;

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (true);
drop policy if exists "insert own post" on public.posts;
create policy "insert own post" on public.posts for insert with check (auth.uid() = user_id);
drop policy if exists "update own post" on public.posts;
create policy "update own post" on public.posts for update using (auth.uid() = user_id);
drop policy if exists "delete own post" on public.posts;
create policy "delete own post" on public.posts for delete using (auth.uid() = user_id);

drop policy if exists "read post likes" on public.post_likes;
create policy "read post likes" on public.post_likes for select using (true);
drop policy if exists "like post" on public.post_likes;
create policy "like post" on public.post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "unlike post" on public.post_likes;
create policy "unlike post" on public.post_likes for delete using (auth.uid() = user_id);

-- ---------- STORAGE: add a "posts" bucket ----------
insert into storage.buckets (id, name, public)
values ('posts', 'posts', true)
on conflict (id) do update set public = true;

drop policy if exists "ot public read" on storage.objects;
create policy "ot public read" on storage.objects for select
  using (bucket_id in ('videos', 'thumbnails', 'avatars', 'posts'));

drop policy if exists "ot upload own folder" on storage.objects;
create policy "ot upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('videos', 'thumbnails', 'avatars', 'posts')
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ot update own folder" on storage.objects;
create policy "ot update own folder" on storage.objects for update to authenticated
  using (bucket_id in ('videos', 'thumbnails', 'avatars', 'posts')
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ot delete own folder" on storage.objects;
create policy "ot delete own folder" on storage.objects for delete to authenticated
  using (bucket_id in ('videos', 'thumbnails', 'avatars', 'posts')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- make the API see the new tables/columns right away
notify pgrst, 'reload schema';
