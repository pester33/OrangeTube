-- =========================================================
-- Orange Tube — Admin panel + Verified badge
-- Run once in Supabase → SQL Editor (after the other two files). Safe to re-run.
-- =========================================================

-- ---------- new profile columns ----------
alter table public.profiles add column if not exists is_admin  boolean not null default false;
alter table public.profiles add column if not exists verified  boolean not null default false;
alter table public.profiles add column if not exists banned    boolean not null default false;
alter table public.profiles add column if not exists sub_count integer not null default 0;

-- ---------- keep sub_count in sync (used for the 10-subscriber badge) ----------
update public.profiles p set sub_count = (select count(*) from public.subscriptions s where s.channel_id = p.id);

create or replace function public.sync_sub_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set sub_count = sub_count + 1 where id = new.channel_id;
    return new;
  else
    update public.profiles set sub_count = greatest(sub_count - 1, 0) where id = old.channel_id;
    return old;
  end if;
end; $$;

drop trigger if exists subs_count on public.subscriptions;
create trigger subs_count after insert or delete on public.subscriptions
  for each row execute function public.sync_sub_count();

-- ---------- helpers ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select banned from public.profiles where id = auth.uid()), false);
$$;

-- ---------- users may only edit their own bio + avatar (not admin/verified/banned) ----------
revoke update on public.profiles from anon, authenticated;
grant update (bio, avatar_url) on public.profiles to authenticated;

-- ---------- admin action (verify / admin / ban) ----------
create or replace function public.admin_set_user(
  target uuid, p_verified boolean default null, p_admin boolean default null, p_banned boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can do that'; end if;
  if target = auth.uid() and (p_admin = false or p_banned = true) then
    raise exception 'You can''t remove your own admin or ban yourself';
  end if;
  update public.profiles set
    verified = coalesce(p_verified, verified),
    is_admin = coalesce(p_admin, is_admin),
    banned   = coalesce(p_banned, banned)
  where id = target;
end; $$;
revoke execute on function public.admin_set_user(uuid, boolean, boolean, boolean) from anon;
grant execute on function public.admin_set_user(uuid, boolean, boolean, boolean) to authenticated;

-- ---------- admins can delete anything ----------
drop policy if exists "admin delete videos" on public.videos;
create policy "admin delete videos" on public.videos for delete using (public.is_admin());
drop policy if exists "admin delete posts" on public.posts;
create policy "admin delete posts" on public.posts for delete using (public.is_admin());
drop policy if exists "admin delete comments" on public.comments;
create policy "admin delete comments" on public.comments for delete using (public.is_admin());

drop policy if exists "ot admin delete" on storage.objects;
create policy "ot admin delete" on storage.objects for delete to authenticated
  using (bucket_id in ('videos', 'thumbnails', 'avatars', 'posts') and public.is_admin());

-- ---------- banned users can't upload, post or comment ----------
drop policy if exists "insert own video" on public.videos;
create policy "insert own video" on public.videos for insert
  with check (auth.uid() = user_id and not public.is_banned());
drop policy if exists "insert own post" on public.posts;
create policy "insert own post" on public.posts for insert
  with check (auth.uid() = user_id and not public.is_banned());
drop policy if exists "comment" on public.comments;
create policy "comment" on public.comments for insert
  with check (auth.uid() = user_id and not public.is_banned());

-- ---------- make PesterReal the admin (+ verified) ----------
update public.profiles set is_admin = true, verified = true where lower(username) = 'pesterreal';

notify pgrst, 'reload schema';
