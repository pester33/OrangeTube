# Orange Tube

A video-sharing site with an orange theme: upload, watch, like, comment, subscribe. It runs as a static site with no build step. Supabase handles auth, the database and file storage.

## Features
- **Log in / Sign up** with just a channel name and password (no email). Turn off *Confirm email* in Supabase for this.
- **Shorts**: vertical videos you swipe up through, with likes, comments and sound toggle.
- **Pictures**: posts with up to 10 pictures you swipe sideways. Double-tap to like.
- **Upload** with drag & drop. A thumbnail is grabbed from the video automatically, or you can upload your own.
- **Watch page** with a player, view counter, likes, subscribe, share, comments and recommended videos.
- **Home**, **Trending**, **Subscriptions**, **Liked videos** and **Search**.
- **Channel pages** with a banner, subscriber, video and view counts.
- **Settings**: avatar, channel name, about text, password.
- Works on phones (the sidebar collapses).

## Setup (one time)
1. Open your Supabase project, then **SQL Editor → New query**. Paste in all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   This creates the tables, Row Level Security policies, the sign-up trigger and the `videos`, `thumbnails` and `avatars` storage buckets.
   Then run [`supabase/02_shorts_and_posts.sql`](supabase/02_shorts_and_posts.sql) the same way, for Shorts and Pictures.
2. In **Authentication → URL Configuration**, set **Site URL** to where you host the site (e.g. `https://pester33.github.io/OrangeTube/`).
3. Optional: in **Authentication → Providers → Email**, turn off *Confirm email* if you want sign-ups to log in straight away.
4. Optional: in **Storage → Settings**, raise the upload file size limit. The free tier allows 50 MB per file.

Supabase keys are set in [`config.js`](config.js).

## Hosting
Go to **Settings → Pages → Deploy from branch → `main` / root**. The site will then be live at `https://pester33.github.io/OrangeTube/`.

To run it locally: `npx serve .` (or any static server), then open the printed URL.

## Files
```
index.html         page shell, top bar, sidebar, auth modal
styles.css         orange theme
app.js             router and all pages (Supabase JS v2 from CDN)
config.js          Supabase URL and publishable key
assets/logo.svg    Orange Tube logo
supabase/schema.sql database, policies, storage buckets
```
