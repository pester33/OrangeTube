-- =========================================================
-- Orange Tube — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query
-- =========================================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  avatar_url  text,
  bio         text default '',
  created_at  timestamptz default now()
);

-- Auto-create a profile whenever someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1))
      || case when exists (select 1 from public.profiles p
                           where p.username = coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)))
              then '_' || substr(new.id::text, 1, 4) else '' end
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- VIDEOS ----------
create table if not exists public.videos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  description    text default '',
  video_url      text not null,
  thumbnail_url  text,
  views          bigint default 0,
  created_at     timestamptz default now()
);
create index if not exists videos_created_idx on public.videos (created_at desc);
create index if not exists videos_user_idx on public.videos (user_id);

-- ---------- LIKES ----------
create table if not exists public.likes (
  user_id    uuid references public.profiles(id) on delete cascade,
  video_id   uuid references public.videos(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, video_id)
);

-- ---------- COMMENTS ----------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.videos(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now()
);
create index if not exists comments_video_idx on public.comments (video_id, created_at desc);

-- ---------- SUBSCRIPTIONS ----------
create table if not exists public.subscriptions (
  subscriber_id uuid references public.profiles(id) on delete cascade,
  channel_id    uuid references public.profiles(id) on delete cascade,
  created_at    timestamptz default now(),
  primary key (subscriber_id, channel_id),
  check (subscriber_id <> channel_id)
);

-- ---------- VIEW COUNTER ----------
create or replace function public.increment_views(vid uuid)
returns void language sql security definer set search_path = public as $$
  update public.videos set views = views + 1 where id = vid;
$$;
grant execute on function public.increment_views(uuid) to anon, authenticated;

-- ---------- ROW LEVEL SECURITY ----------
alter table public.profiles      enable row level security;
alter table public.videos        enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.subscriptions enable row level security;

-- Everyone can read
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select using (true);
drop policy if exists "read videos" on public.videos;
create policy "read videos" on public.videos for select using (true);
drop policy if exists "read likes" on public.likes;
create policy "read likes" on public.likes for select using (true);
drop policy if exists "read comments" on public.comments;
create policy "read comments" on public.comments for select using (true);
drop policy if exists "read subs" on public.subscriptions;
create policy "read subs" on public.subscriptions for select using (true);

-- Owners can write their own rows
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "insert own video" on public.videos;
create policy "insert own video" on public.videos for insert with check (auth.uid() = user_id);
drop policy if exists "update own video" on public.videos;
create policy "update own video" on public.videos for update using (auth.uid() = user_id);
drop policy if exists "delete own video" on public.videos;
create policy "delete own video" on public.videos for delete using (auth.uid() = user_id);

drop policy if exists "like" on public.likes;
create policy "like" on public.likes for insert with check (auth.uid() = user_id);
drop policy if exists "unlike" on public.likes;
create policy "unlike" on public.likes for delete using (auth.uid() = user_id);

drop policy if exists "comment" on public.comments;
create policy "comment" on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists "delete own comment" on public.comments;
create policy "delete own comment" on public.comments for delete using (auth.uid() = user_id);

drop policy if exists "subscribe" on public.subscriptions;
create policy "subscribe" on public.subscriptions for insert with check (auth.uid() = subscriber_id);
drop policy if exists "unsubscribe" on public.subscriptions;
create policy "unsubscribe" on public.subscriptions for delete using (auth.uid() = subscriber_id);

-- ---------- STORAGE BUCKETS ----------
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true), ('thumbnails', 'thumbnails', true), ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Anyone can view files; logged-in users can upload/delete only inside their own folder (<user id>/...)
drop policy if exists "ot public read" on storage.objects;
create policy "ot public read" on storage.objects for select
  using (bucket_id in ('videos', 'thumbnails', 'avatars'));

drop policy if exists "ot upload own folder" on storage.objects;
create policy "ot upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('videos', 'thumbnails', 'avatars')
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ot update own folder" on storage.objects;
create policy "ot update own folder" on storage.objects for update to authenticated
  using (bucket_id in ('videos', 'thumbnails', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ot delete own folder" on storage.objects;
create policy "ot delete own folder" on storage.objects for delete to authenticated
  using (bucket_id in ('videos', 'thumbnails', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);
