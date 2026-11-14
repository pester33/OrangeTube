import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, MAX_UPLOAD_MB } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');

let session = null;
let profile = null;

// ================= helpers =================
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--orange-2)">$1</a>');

function fmtNum(n = 0) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  const u = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, sec] of u) {
    const v = Math.floor(s / sec);
    if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}
function avatar(p, cls = '') {
  if (p?.avatar_url) return `<img class="avatar ${cls}" src="${esc(p.avatar_url)}" alt="">`;
  return `<div class="avatar ${cls}">${esc((p?.username || '?')[0])}</div>`;
}
const isVerified = p => !!(p && (p.is_admin || p.verified || (p.sub_count || 0) >= 10));
function badge(p) {
  if (!isVerified(p)) return '';
  return `<svg class="vbadge" viewBox="0 0 24 24" role="img" aria-label="Verified"><title>Verified</title><path d="M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1z"/><path class="tick" d="m8.3 12.2 2.6 2.6 4.8-5.2"/></svg>`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}
const spinner = () => (view.innerHTML = '<div class="spinner"></div>');
function skeletonGrid(n = 8) {
  view.innerHTML = `<div class="grid">${Array.from({ length: n }, () => `
    <div class="card skeleton"><div class="thumb"></div><div class="line" style="width:90%"></div><div class="line" style="width:60%"></div></div>`).join('')}</div>`;
}
function empty(title, sub = '', action = '') {
  return `<div class="empty"><img src="assets/logo.svg" alt=""><h2>${title}</h2><p>${sub}</p>${action}</div>`;
}
function requireAuth(msg = 'Log in to do that') {
  if (session) return true;
  openAuth('login', msg);
  return false;
}

const VIDEO_SELECT = 'id,title,description,thumbnail_url,video_url,views,created_at,user_id,is_short,profiles!videos_user_id_fkey(id,username,avatar_url,is_admin,verified,sub_count)';

function thumbHTML(v) {
  return `<div class="thumb">${v.thumbnail_url
    ? `<img src="${esc(v.thumbnail_url)}" alt="" loading="lazy">`
    : `<div class="ph"><img src="assets/logo.svg" alt=""></div>`}</div>`;
}
function cardHTML(v) {
  const p = v.profiles || {};
  return `<div class="card">
    <a href="#/watch/${v.id}">${thumbHTML(v)}</a>
    <div class="card-meta">
      <a href="#/channel/${p.id}">${avatar(p)}</a>
      <div>
        <a href="#/watch/${v.id}"><h3>${esc(v.title)}</h3></a>
        <p><a href="#/channel/${p.id}">${esc(p.username || 'Unknown')}</a>${badge(p)}</p>
        <p>${fmtNum(v.views)} views • ${timeAgo(v.created_at)}</p>
      </div>
    </div>
  </div>`;
}
function rowHTML(v, compact = false) {
  const p = v.profiles || {};
  return `<a class="row ${compact ? 'compact' : ''}" href="#/watch/${v.id}">
    ${thumbHTML(v)}
    <div>
      <h3>${esc(v.title)}</h3>
      <p>${fmtNum(v.views)} views • ${timeAgo(v.created_at)}</p>
      <p>${esc(p.username || '')}${badge(p)}</p>
      ${compact ? '' : `<p class="desc">${esc(v.description || '')}</p>`}
    </div>
  </a>`;
}
function gridOf(videos, emptyHTML) {
  view.innerHTML = videos?.length ? `<div class="grid">${videos.map(cardHTML).join('')}</div>` : emptyHTML;
}

// ================= auth UI =================
// Accounts use channel name + password. Supabase needs an email internally,
// so we derive a hidden one from the channel name (no emails are ever sent).
const AUTH_DOMAIN = 'orangetube.app';
const nameToEmail = name => {
  name = name.trim();
  return name.includes('@') ? name : `${name.toLowerCase()}@${AUTH_DOMAIN}`;
};
function renderAuthArea() {
  const area = $('#authArea');
  if (!session) {
    area.innerHTML = `
      <button class="btn ghost" id="loginBtn">Log in</button>
      <button class="btn primary" id="signupBtn"><span>Sign up</span></button>`;
    $('#loginBtn').onclick = () => openAuth('login');
    $('#signupBtn').onclick = () => openAuth('signup');
    return;
  }
  area.innerHTML = `
    <a class="btn" href="#/upload" title="Upload">
      <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg><span>Upload</span>
    </a>
    <div class="user-menu">
      <button id="avatarBtn" aria-label="Account">${avatar(profile)}</button>
      <div class="dropdown" id="userDrop" hidden>
        <div class="who"><b>${esc(profile?.username || 'You')}${badge(profile)}</b><small>@${esc(profile?.username || '')}</small></div>
        <a href="#/me"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>Your channel</a>
        <a href="#/upload"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg>Upload video</a>
        ${isAdmin() ? `<a href="#/admin"><svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></svg>Admin panel</a>` : ''}
        <a href="#/settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>Settings</a>
        <button id="logoutBtn"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Log out</button>
      </div>
    </div>`;
  const drop = $('#userDrop');
  $('#avatarBtn').onclick = e => { e.stopPropagation(); drop.hidden = !drop.hidden; };
  $('#logoutBtn').onclick = async () => {
    await sb.auth.signOut();
    toast('Logged out');
    location.hash = '#/';
  };
}

function openAuth(tab = 'login', msg = '') {
  $('#authModal').hidden = false;
  switchTab(tab);
  setAuthMsg(msg);
}
function closeAuth() { $('#authModal').hidden = true; }
function setAuthMsg(msg, type = '') {
  const m = $('#authMsg');
  m.textContent = msg;
  m.className = 'auth-msg ' + type;
}
function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
  setAuthMsg('');
}
$$('.tab').forEach(t => (t.onclick = () => switchTab(t.dataset.tab)));
$('[data-close]').onclick = closeAuth;
$('#authModal').addEventListener('click', e => { if (e.target.id === 'authModal') closeAuth(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuth(); });

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; setAuthMsg('Logging in…');
  const { error } = await sb.auth.signInWithPassword({ email: nameToEmail(f.get('username')), password: f.get('password') });
  if (error && /invalid login/i.test(error.message)) { btn.disabled = false; return setAuthMsg('Wrong channel name or password', 'err'); }
  btn.disabled = false;
  if (error) return setAuthMsg(error.message, 'err');
  e.target.reset();
  closeAuth();
  toast('Welcome back!');
};

$('#signupForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('password') !== f.get('confirm')) return setAuthMsg('Passwords do not match', 'err');
  const username = f.get('username').trim();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; setAuthMsg('Creating your channel…');

  const { data: taken } = await sb.from('profiles').select('id').ilike('username', username).maybeSingle();
  if (taken) { btn.disabled = false; return setAuthMsg('That channel name is taken', 'err'); }

  const { data, error } = await sb.auth.signUp({
    email: nameToEmail(username),
    password: f.get('password'),
    options: { data: { username } },
  });
  btn.disabled = false;
  if (error) return setAuthMsg(/already registered/i.test(error.message) ? 'That channel name is taken' : error.message, 'err');
  e.target.reset();
  if (data.session) {
    closeAuth();
    toast(`Channel created — welcome, ${username}!`);
  } else {
    setAuthMsg('Account made, but Supabase still wants email confirmation. Turn off "Confirm email" in Supabase → Authentication → Sign In / Providers → Email.', 'err');
  }
};


async function loadProfile() {
  if (!session) { profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  profile = data || { id: session.user.id, username: session.user.user_metadata?.username || session.user.email.split('@')[0] };
}

// ================= pages =================
async function pageHome() {
  setActive('home');
  skeletonGrid();
  const [vids, shorts] = await Promise.all([
    sb.from('videos').select(VIDEO_SELECT).eq('is_short', false).order('created_at', { ascending: false }).limit(60),
    sb.from('videos').select(VIDEO_SELECT).eq('is_short', true).order('created_at', { ascending: false }).limit(12),
  ]);
  if (vids.error) return showDbError(vids.error);
  const s = shorts.data || [], v = vids.data || [];
  if (!s.length && !v.length) {
    view.innerHTML = empty('Nothing here yet', 'Be the first to upload something fresh.', `<a class="btn primary" href="#/upload">Upload</a>`);
    return;
  }
  view.innerHTML = shortsShelfHTML(s) + (v.length ? `<div class="grid">${v.map(cardHTML).join('')}</div>` : '');
}

async function pageTrending() {
  setActive('trending');
  skeletonGrid();
  const { data, error } = await sb.from('videos').select(VIDEO_SELECT).eq('is_short', false).order('views', { ascending: false }).limit(60);
  if (error) return showDbError(error);
  view.innerHTML = `<h1 class="page-title">Trending</h1>`;
  view.insertAdjacentHTML('beforeend', data?.length ? `<div class="grid">${data.map(cardHTML).join('')}</div>` : empty('Nothing trending yet'));
}

async function pageSearch(q) {
  setActive('');
  $('#searchInput').value = q;
  spinner();
  const term = q.replace(/[%,()]/g, ' ').trim();
  const { data, error } = await sb.from('videos').select(VIDEO_SELECT)
    .or(`title.ilike.%${term}%,description.ilike.%${term}%`)
    .order('views', { ascending: false }).limit(50);
  if (error) return showDbError(error);
  view.innerHTML = `<h1 class="page-title">Results for “${esc(q)}”</h1>` +
    (data?.length ? `<div class="list">${data.map(v => rowHTML(v)).join('')}</div>` : empty('No results', 'Try different keywords.'));
}

async function pageSubscriptions() {
  setActive('subscriptions');
  if (!session) { view.innerHTML = empty('Don’t miss new videos', 'Log in to see updates from your favorite channels.', `<button class="btn primary" id="si">Log in</button>`); $('#si').onclick = () => openAuth('login'); return; }
  skeletonGrid();
  const { data: subs } = await sb.from('subscriptions').select('channel_id').eq('subscriber_id', session.user.id);
  const ids = (subs || []).map(s => s.channel_id);
  if (!ids.length) { view.innerHTML = empty('No subscriptions yet', 'Subscribe to channels and their videos will show up here.'); return; }
  const { data } = await sb.from('videos').select(VIDEO_SELECT).in('user_id', ids).order('created_at', { ascending: false }).limit(60);
  view.innerHTML = `<h1 class="page-title">Subscriptions</h1>`;
  view.insertAdjacentHTML('beforeend', data?.length ? `<div class="grid">${data.map(cardHTML).join('')}</div>` : empty('No videos from your subscriptions yet'));
}

async function pageLiked() {
  setActive('liked');
  if (!requireAuth('Log in to see your liked videos')) { view.innerHTML = empty('Liked videos', 'Log in to see videos you liked.'); return; }
  skeletonGrid();
  const { data } = await sb.from('likes').select(`created_at, videos(${VIDEO_SELECT})`).eq('user_id', session.user.id).order('created_at', { ascending: false });
  const vids = (data || []).map(l => l.videos).filter(Boolean);
  view.innerHTML = `<h1 class="page-title">Liked videos</h1>`;
  view.insertAdjacentHTML('beforeend', vids.length ? `<div class="grid">${vids.map(cardHTML).join('')}</div>` : empty('No liked videos yet'));
}

async function pageWatch(id) {
  setActive('');
  spinner();
  const { data: v, error } = await sb.from('videos').select(VIDEO_SELECT).eq('id', id).maybeSingle();
  if (error) return showDbError(error);
  if (!v) { view.innerHTML = empty('Video not found', 'It may have been deleted.'); return; }
  const p = v.profiles || {};
  document.title = `${v.title} - Orange Tube`;

  sb.rpc('increment_views', { vid: id }).then(() => {});

  const [likesRes, subsRes, myLike, mySub, recs] = await Promise.all([
    sb.from('likes').select('*', { count: 'exact', head: true }).eq('video_id', id),
    sb.from('subscriptions').select('*', { count: 'exact', head: true }).eq('channel_id', p.id),
    session ? sb.from('likes').select('video_id').eq('video_id', id).eq('user_id', session.user.id).maybeSingle() : { data: null },
    session ? sb.from('subscriptions').select('channel_id').eq('channel_id', p.id).eq('subscriber_id', session.user.id).maybeSingle() : { data: null },
    sb.from('videos').select(VIDEO_SELECT).neq('id', id).eq('is_short', false).order('views', { ascending: false }).limit(20),
  ]);

  let likeCount = likesRes.count || 0, liked = !!myLike.data;
  let subCount = subsRes.count || 0, subbed = !!mySub.data;
  const isOwner = session?.user.id === v.user_id;
  const canMod = isOwner || isAdmin();

  view.innerHTML = `
  <div class="watch">
    <div>
      <video class="player" src="${esc(v.video_url)}" ${v.thumbnail_url ? `poster="${esc(v.thumbnail_url)}"` : ''} controls autoplay playsinline></video>
      <h1>${esc(v.title)}</h1>
      <div class="watch-bar">
        <div class="channel-chip">
          <a href="#/channel/${p.id}">${avatar(p)}</a>
          <div><a href="#/channel/${p.id}"><b>${esc(p.username || 'Unknown')}</b>${badge(p)}</a><small id="subCount">${fmtNum(subCount)} subscribers</small></div>
          ${isOwner ? '' : `<button class="btn ${subbed ? 'subbed' : 'primary'}" id="subBtn">${subbed ? 'Subscribed' : 'Subscribe'}</button>`}
        </div>
        <div class="actions">
          <button class="btn ${liked ? 'liked' : ''}" id="likeBtn">
            <svg viewBox="0 0 24 24"><path d="M7 21V10l5-7 1 1c.6.6.8 1.4.6 2.2L13 10h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21zM3 10h4v11H3z"/></svg>
            <span id="likeCount">${fmtNum(likeCount)}</span>
          </button>
          <button class="btn" id="shareBtn"><svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>Share</button>
          ${canMod ? `<button class="btn" id="delVid" style="color:var(--danger)"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete</button>` : ''}
        </div>
      </div>
      <div class="desc-box">
        <div class="stats">${fmtNum((v.views || 0) + 1)} views • ${new Date(v.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>${linkify(v.description || 'No description.')}
      </div>
      <section class="comments">
        <h2 id="cCount">Comments</h2>
        <form class="comment-form" id="cForm">
          ${avatar(profile)}
          <div style="flex:1">
            <textarea name="body" placeholder="${session ? 'Add a comment…' : 'Log in to comment'}" maxlength="2000" required></textarea>
            <div class="cf-actions"><button class="btn primary" type="submit">Comment</button></div>
          </div>
        </form>
        <div id="cList"><div class="spinner"></div></div>
      </section>
    </div>
    <aside class="list">${(recs.data || []).map(r => rowHTML(r, true)).join('') || '<p class="hint">No other videos yet.</p>'}</aside>
  </div>`;

  // like
  $('#likeBtn').onclick = async () => {
    if (!requireAuth('Log in to like videos')) return;
    const btn = $('#likeBtn'); btn.disabled = true;
    if (liked) {
      const { error } = await sb.from('likes').delete().eq('video_id', id).eq('user_id', session.user.id);
      if (!error) { liked = false; likeCount--; }
    } else {
      const { error } = await sb.from('likes').insert({ video_id: id, user_id: session.user.id });
      if (!error) { liked = true; likeCount++; }
    }
    btn.disabled = false;
    btn.classList.toggle('liked', liked);
    $('#likeCount').textContent = fmtNum(likeCount);
  };

  // subscribe
  const subBtn = $('#subBtn');
  if (subBtn) subBtn.onclick = async () => {
    if (!requireAuth('Log in to subscribe')) return;
    subBtn.disabled = true;
    if (subbed) {
      const { error } = await sb.from('subscriptions').delete().eq('channel_id', p.id).eq('subscriber_id', session.user.id);
      if (!error) { subbed = false; subCount--; }
    } else {
      const { error } = await sb.from('subscriptions').insert({ channel_id: p.id, subscriber_id: session.user.id });
      if (!error) { subbed = true; subCount++; }
    }
    subBtn.disabled = false;
    subBtn.className = 'btn ' + (subbed ? 'subbed' : 'primary');
    subBtn.textContent = subbed ? 'Subscribed' : 'Subscribe';
    $('#subCount').textContent = `${fmtNum(subCount)} subscribers`;
  };

  $('#shareBtn').onclick = async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: v.title, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); toast('Link copied!'); }
  };

  const del = $('#delVid');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this video forever?')) return;
    const { error } = await sb.from('videos').delete().eq('id', id);
    if (error) return toast(error.message);
    const paths = [v.video_url, v.thumbnail_url].filter(Boolean);
    for (const u of paths) {
      const m = u.match(/\/object\/public\/(videos|thumbnails)\/(.+)$/);
      if (m) await sb.storage.from(m[1]).remove([decodeURIComponent(m[2])]);
    }
    toast('Video deleted');
    location.hash = '#/me';
  };

  // comments
  const loadComments = async () => {
    const { data } = await sb.from('comments').select('id,body,created_at,user_id,profiles!comments_user_id_fkey(id,username,avatar_url,is_admin,verified,sub_count)')
      .eq('video_id', id).order('created_at', { ascending: false }).limit(200);
    $('#cCount').textContent = `${fmtNum(data?.length || 0)} Comments`;
    $('#cList').innerHTML = (data || []).map(c => `
      <div class="comment">
        <a href="#/channel/${c.profiles?.id}">${avatar(c.profiles, 'sm')}</a>
        <div>
          <div class="head"><b>@${esc(c.profiles?.username || 'user')}</b>${badge(c.profiles)}<span>${timeAgo(c.created_at)}</span></div>
          <p>${linkify(c.body)}</p>
          ${session?.user.id === c.user_id || canMod ? `<button class="del" data-del="${c.id}">Delete</button>` : ''}
        </div>
      </div>`).join('') || '<p class="hint">No comments yet. Start the conversation!</p>';
    $$('[data-del]').forEach(b => (b.onclick = async () => {
      await sb.from('comments').delete().eq('id', b.dataset.del);
      loadComments();
    }));
  };
  loadComments();

  const cForm = $('#cForm');
  cForm.body.addEventListener('focus', () => { if (!session) { cForm.body.blur(); openAuth('login', 'Log in to comment'); } });
  cForm.onsubmit = async e => {
    e.preventDefault();
    if (!requireAuth('Log in to comment')) return;
    const body = cForm.body.value.trim();
    if (!body) return;
    const { error } = await sb.from('comments').insert({ video_id: id, user_id: session.user.id, body });
    if (error) return toast(error.message);
    cForm.reset();
    loadComments();
  };
}

async function pageChannel(id, tab = 'videos') {
  setActive(session?.user.id === id ? 'me' : '');
  spinner();
  const { data: p } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!p) { view.innerHTML = empty('Channel not found'); return; }
  document.title = `${p.username} - Orange Tube`;
  const [vids, subs, mySub] = await Promise.all([
    sb.from('videos').select(VIDEO_SELECT).eq('user_id', id).order('created_at', { ascending: false }),
    sb.from('subscriptions').select('*', { count: 'exact', head: true }).eq('channel_id', id),
    session ? sb.from('subscriptions').select('channel_id').eq('channel_id', id).eq('subscriber_id', session.user.id).maybeSingle() : { data: null },
  ]);
  const isMe = session?.user.id === id;
  let subbed = !!mySub.data, subCount = subs.count || 0;
  const all = vids.data || [];
  const longs = all.filter(v => !v.is_short), shorts = all.filter(v => v.is_short);
  const totalViews = all.reduce((a, v) => a + (v.views || 0), 0);

  view.innerHTML = `
    <div class="banner"></div>
    <div class="channel-head">
      ${avatar(p, 'lg')}
      <div style="flex:1">
        <h1>${esc(p.username)}${badge(p)}${p.is_admin ? '<span class="tag">Admin</span>' : ''}</h1>
        <p>@${esc(p.username)} • <span id="chSubs">${fmtNum(subCount)}</span> subscribers • ${longs.length} videos • ${fmtNum(totalViews)} views</p>
        ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
      </div>
      ${isMe ? `<a class="btn" href="#/settings">Customize channel</a><a class="btn primary" href="#/upload">Upload</a>`
             : `<button class="btn ${subbed ? 'subbed' : 'primary'}" id="chSub">${subbed ? 'Subscribed' : 'Subscribe'}</button>`}
    </div>
    <nav class="ch-tabs">
      <a href="#/channel/${id}/videos" class="${tab === 'videos' ? 'on' : ''}">Videos</a>
      <a href="#/channel/${id}/shorts" class="${tab === 'shorts' ? 'on' : ''}">Shorts</a>
      <a href="#/channel/${id}/posts" class="${tab === 'posts' ? 'on' : ''}">Pictures</a>
    </nav>
    <div id="chBody"></div>`;

  const body = $('#chBody');
  if (tab === 'shorts') {
    body.innerHTML = shorts.length ? `<div class="shorts-grid">${shorts.map(shortCardHTML).join('')}</div>` : empty('No Shorts yet', isMe ? 'Upload your first Short!' : '');
  } else if (tab === 'posts') {
    body.innerHTML = '<div class="spinner"></div>';
    const { data: posts } = await sb.from('posts').select(POST_SELECT).eq('user_id', id).order('created_at', { ascending: false });
    body.innerHTML = '<div class="posts-wrap"><div id="chPosts"></div></div>';
    if (posts?.length) renderPosts($('#chPosts'), posts);
    else $('#chPosts').innerHTML = empty('No pictures yet', '', isMe ? `<a class="btn primary" href="#/upload/pictures">Post pictures</a>` : '');
  } else {
    body.innerHTML = longs.length ? `<div class="grid">${longs.map(cardHTML).join('')}</div>` : empty('No videos yet', isMe ? 'Upload your first video!' : '');
  }

  const b = $('#chSub');
  if (b) b.onclick = async () => {
    if (!requireAuth('Log in to subscribe')) return;
    b.disabled = true;
    if (subbed) { await sb.from('subscriptions').delete().eq('channel_id', id).eq('subscriber_id', session.user.id); subbed = false; subCount--; }
    else { await sb.from('subscriptions').insert({ channel_id: id, subscriber_id: session.user.id }); subbed = true; subCount++; }
    b.disabled = false;
    b.className = 'btn ' + (subbed ? 'subbed' : 'primary');
    b.textContent = subbed ? 'Subscribed' : 'Subscribe';
    $('#chSubs').textContent = fmtNum(subCount);
  };
}

function pageMe() {
  if (!session) { setActive('me'); view.innerHTML = empty('Your channel', 'Log in or sign up to create your channel.', `<button class="btn primary" id="si">Sign up</button>`); $('#si').onclick = () => openAuth('signup'); return; }
  pageChannel(session.user.id);
}

// ---- capture a thumbnail from the video itself ----
function grabFrame(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1.5, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      const w = 1280, h = Math.round(w * (v.videoHeight / v.videoWidth || 9 / 16));
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      c.toBlob(b => { URL.revokeObjectURL(v.src); resolve(b); }, 'image/jpeg', 0.85);
    };
    v.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 8000);
  });
}

function videoMeta(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => { resolve({ w: v.videoWidth, h: v.videoHeight, d: v.duration }); URL.revokeObjectURL(v.src); };
    v.onerror = () => resolve(null);
  });
}

function pageUpload(mode = 'video') {
  setActive('upload');
  if (!['video', 'short', 'pictures'].includes(mode)) mode = 'video';
  if (profile?.banned) { view.innerHTML = empty('Your account is banned', 'You can’t upload, post or comment.'); return; }
  if (!session) {
    view.innerHTML = empty('Upload to Orange Tube', 'You need an account to upload.', `<button class="btn primary" id="si">Log in / Sign up</button>`);
    $('#si').onclick = () => openAuth('login');
    return;
  }
  const modes = `<div class="chips">
    <a class="chip ${mode === 'video' ? 'active' : ''}" href="#/upload/video">Video</a>
    <a class="chip ${mode === 'short' ? 'active' : ''}" href="#/upload/short">Short</a>
    <a class="chip ${mode === 'pictures' ? 'active' : ''}" href="#/upload/pictures">Pictures</a>
  </div>`;
  if (mode === 'pictures') return uploadPictures(modes);

  const isShort = mode === 'short';
  view.innerHTML = `
    <h1 class="page-title">${isShort ? 'Upload a Short' : 'Upload video'}</h1>
    ${modes}
    <div class="panel">
      <form class="form" id="upForm">
        <label class="drop" id="drop">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg>
          <div><b id="dropText">Drag & drop a ${isShort ? 'vertical video' : 'video'}, or click to choose</b></div>
          <p>${isShort ? 'Vertical (9:16), up to 3 minutes' : 'MP4, WebM or MOV'} • up to ${MAX_UPLOAD_MB} MB</p>
          <input type="file" name="video" accept="video/*" required>
        </label>
        <div class="preview-row ${isShort ? 'vertical' : ''}" id="previews" hidden>
          <div><p class="hint">Video</p><video id="vPrev" controls muted></video></div>
          <div><p class="hint">Thumbnail</p><img id="tPrev" alt=""></div>
        </div>
        <p class="hint" id="shortHint"></p>
        <label>Title<input type="text" name="title" maxlength="120" required placeholder="${isShort ? 'Caption your Short' : 'Give your video a title'}"></label>
        ${isShort ? '' : `<label>Description<textarea name="description" maxlength="5000" placeholder="Tell viewers about your video"></textarea></label>`}
        <label>Custom thumbnail (optional — otherwise we grab a frame)<input type="file" name="thumb" accept="image/*"></label>
        <div class="progress" hidden id="prog"><div></div></div>
        <p class="hint" id="upStatus"></p>
        <button class="btn primary block" type="submit" id="upBtn">Publish${isShort ? ' Short' : ''}</button>
      </form>
    </div>`;

  const form = $('#upForm'), drop = $('#drop');
  let autoThumb = null;

  const onVideo = async file => {
    if (!file) return;
    $('#dropText').textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;
    $('#previews').hidden = false;
    $('#vPrev').src = URL.createObjectURL(file);
    if (!form.title.value) form.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    const m = await videoMeta(file);
    const hint = $('#shortHint');
    hint.textContent = '';
    if (m && isShort && (m.w > m.h || m.d > 180)) hint.textContent = 'Shorts work best vertical and under 3 minutes. This one will still upload.';
    if (m && !isShort && m.h > m.w && m.d <= 180) hint.innerHTML = 'This looks like a Short. <a href="#/upload/short" style="color:var(--orange-2)">Upload it as a Short instead</a>';
    if (!form.thumb.files[0]) {
      autoThumb = await grabFrame(file);
      if (autoThumb) $('#tPrev').src = URL.createObjectURL(autoThumb);
    }
  };
  form.video.onchange = () => onVideo(form.video.files[0]);
  form.thumb.onchange = () => { const f = form.thumb.files[0]; if (f) { $('#previews').hidden = false; $('#tPrev').src = URL.createObjectURL(f); } };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('video/')) { const dt = new DataTransfer(); dt.items.add(f); form.video.files = dt.files; onVideo(f); }
  });

  form.onsubmit = async e => {
    e.preventDefault();
    const file = form.video.files[0];
    if (!file) return toast('Choose a video first');
    if (file.size > MAX_UPLOAD_MB * 1048576) {
      $('#upStatus').classList.add('err'); $('#upStatus').textContent = `This video is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_MB} MB, so compress it or trim it first.`;
      return;
    }
    const btn = $('#upBtn'), status = $('#upStatus'), prog = $('#prog'), bar = prog.firstElementChild;
    btn.disabled = true; prog.hidden = false; bar.style.width = '5%';
    const uid = session.user.id, stamp = Date.now();
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    try {
      status.classList.remove('err'); status.textContent = 'Uploading video… (large files can take a while)';
      let pct = 5;
      const tick = setInterval(() => { pct = Math.min(85, pct + 2); bar.style.width = pct + '%'; }, 600);
      const vPath = `${uid}/${stamp}.${ext}`;
      const { error: vErr } = await sb.storage.from('videos').upload(vPath, file, { contentType: file.type || 'video/mp4' });
      clearInterval(tick);
      if (vErr) throw vErr;
      bar.style.width = '88%';
      const video_url = sb.storage.from('videos').getPublicUrl(vPath).data.publicUrl;

      let thumbnail_url = null;
      const thumbFile = form.thumb.files[0] || autoThumb;
      if (thumbFile) {
        status.textContent = 'Uploading thumbnail…';
        const tPath = `${uid}/${stamp}.jpg`;
        const { error: tErr } = await sb.storage.from('thumbnails').upload(tPath, thumbFile, { contentType: thumbFile.type || 'image/jpeg' });
        if (!tErr) thumbnail_url = sb.storage.from('thumbnails').getPublicUrl(tPath).data.publicUrl;
      }
      bar.style.width = '95%';
      status.textContent = 'Publishing…';
      const { data, error } = await sb.from('videos').insert({
        user_id: uid, title: form.title.value.trim(), description: form.description?.value.trim() || '',
        video_url, thumbnail_url, is_short: isShort,
      }).select('id').single();
      if (error) throw error;
      bar.style.width = '100%';
      toast(isShort ? 'Short published!' : 'Video published!');
      location.hash = isShort ? `#/shorts/${data.id}` : `#/watch/${data.id}`;
    } catch (err) {
      console.error(err);
      status.classList.add('err'); status.textContent = (err.message || 'Upload failed') +
        (/size|exceed|413/i.test(err.message || '') ? ` — the file is bigger than the storage limit (${MAX_UPLOAD_MB} MB).` : '');
      btn.disabled = false;
    }
  };
}

function uploadPictures(modes) {
  view.innerHTML = `
    <h1 class="page-title">Post pictures</h1>
    ${modes}
    <div class="panel">
      <form class="form" id="picForm">
        <label class="drop" id="drop">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
          <div><b id="dropText">Drag & drop pictures, or click to choose</b></div>
          <p>Up to 10 pictures • people swipe through them sideways</p>
          <input type="file" name="pics" accept="image/*" multiple>
        </label>
        <div id="picPreview"></div>
        <label>Caption<textarea name="caption" maxlength="2000" placeholder="Say something about these pictures"></textarea></label>
        <div class="progress" hidden id="prog"><div></div></div>
        <p class="hint" id="upStatus"></p>
        <button class="btn primary block" type="submit" id="upBtn">Post</button>
      </form>
    </div>`;
  const form = $('#picForm'), drop = $('#drop');
  let files = [];
  const show = () => {
    $('#dropText').textContent = files.length ? `${files.length} picture${files.length > 1 ? 's' : ''} selected (click to add more)` : 'Drag & drop pictures, or click to choose';
    const el = $('#picPreview');
    if (!files.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="pic-thumbs">${files.map((f, i) => `
      <div class="pic-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove"><svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`).join('')}</div>`;
    $$('[data-rm]', el).forEach(b => (b.onclick = () => { files.splice(+b.dataset.rm, 1); show(); }));
  };
  const add = list => {
    for (const f of list) if (f.type.startsWith('image/') && files.length < 10) files.push(f);
    if ([...list].length && files.length >= 10) toast('Max 10 pictures');
    show();
  };
  form.pics.onchange = () => { add(form.pics.files); form.pics.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => add(e.dataTransfer.files));

  form.onsubmit = async e => {
    e.preventDefault();
    if (!files.length) return toast('Choose at least one picture');
    const big = files.find(f => f.size > MAX_UPLOAD_MB * 1048576);
    if (big) return ($('#upStatus').classList.add('err'), $('#upStatus').textContent = `${big.name} is over ${MAX_UPLOAD_MB} MB.`);
    const btn = $('#upBtn'), status = $('#upStatus'), prog = $('#prog'), bar = prog.firstElementChild;
    btn.disabled = true; prog.hidden = false;
    const uid = session.user.id, stamp = Date.now(), urls = [];
    try {
      for (let i = 0; i < files.length; i++) {
        status.textContent = `Uploading picture ${i + 1} of ${files.length}…`;
        bar.style.width = Math.round((i / files.length) * 90) + '%';
        const f = files[i];
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/${stamp}-${i}.${ext}`;
        const { error } = await sb.storage.from('posts').upload(path, f, { contentType: f.type });
        if (error) throw error;
        urls.push(sb.storage.from('posts').getPublicUrl(path).data.publicUrl);
      }
      status.textContent = 'Posting…';
      const { error } = await sb.from('posts').insert({ user_id: uid, caption: form.caption.value.trim(), images: urls });
      if (error) throw error;
      bar.style.width = '100%';
      toast('Posted!');
      location.hash = '#/posts';
    } catch (err) {
      console.error(err);
      status.classList.add('err'); status.textContent = (err.message || 'Upload failed');
      btn.disabled = false;
    }
  };
}

function pageSettings() {
  setActive('');
  if (!session) { view.innerHTML = empty('Settings', 'Log in to change your settings.'); return; }
  view.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="panel">
      <form class="form" id="setForm">
        <div style="display:flex;align-items:center;gap:16px">${avatar(profile, 'lg')}
          <label style="flex:1">Profile picture<input type="file" name="avatar" accept="image/*"></label></div>
        <label>Channel name<input type="text" name="username" value="${esc(profile?.username || '')}" readonly style="opacity:.6"><span class="hint">Your channel name is also your login, so it can't be changed.</span></label>
        <label>About<textarea name="bio" maxlength="500">${esc(profile?.bio || '')}</textarea></label>
        <label>New password (leave blank to keep)<input type="text" name="password" minlength="6" autocomplete="new-password" style="-webkit-text-security:disc"></label>
        <button class="btn primary block" type="submit">Save changes</button>
      </form>
    </div>`;
  $('#setForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, uid = session.user.id;
    const updates = { bio: f.bio.value.trim() };
    const file = f.avatar.files[0];
    if (file) {
      const path = `${uid}/avatar-${Date.now()}`;
      const { error } = await sb.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true });
      if (error) return toast(error.message);
      updates.avatar_url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }
    const { error } = await sb.from('profiles').update(updates).eq('id', uid);
    if (error) return toast(error.code === '23505' ? 'That channel name is taken' : error.message);
    if (f.password.value) {
      const { error: pErr } = await sb.auth.updateUser({ password: f.password.value });
      if (pErr) return toast(pErr.message);
    }
    await loadProfile();
    renderAuthArea();
    toast('Saved!');
    location.hash = '#/me';
  };
}

function showDbError(error) {
  console.error(error);
  const missing = /does not exist|Could not find the table/i.test(error.message);
  view.innerHTML = empty('Something went wrong', missing
    ? 'Part of the database isn’t set up yet. Run <code>supabase/schema.sql</code> and <code>supabase/02_shorts_and_posts.sql</code> in your Supabase SQL Editor.'
    : esc(error.message));
}

// ================= SHORTS =================
const ICON = {
  like: '<svg viewBox="0 0 24 24"><path d="M7 21V10l5-7 1 1c.6.6.8 1.4.6 2.2L13 10h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21zM3 10h4v11H3z"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  shorts: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>',
};

function shortCardHTML(v) {
  return `<a class="short-card" href="#/shorts/${v.id}">
    <div class="sthumb">${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="" loading="lazy">` : `<div class="ph"><img src="assets/logo.svg" alt=""></div>`}</div>
    <h3>${esc(v.title)}</h3><p>${fmtNum(v.views)} views</p>
  </a>`;
}
function shortsShelfHTML(list) {
  if (!list?.length) return '';
  return `<section class="shelf">
    <h2 class="page-title">${ICON.shorts} Shorts <a class="link-btn" href="#/shorts" style="margin-left:auto;font-size:.95rem">See all</a></h2>
    <div class="shelf-row">${list.map(shortCardHTML).join('')}</div>
  </section>`;
}

let shortsMuted = false;
async function pageShorts(startId) {
  setActive('shorts');
  view.classList.add('flush');
  spinner();
  let { data, error } = await sb.from('videos').select(VIDEO_SELECT).eq('is_short', true).order('created_at', { ascending: false }).limit(60);
  if (error) { view.classList.remove('flush'); return showDbError(error); }
  data = data || [];
  if (startId) {
    const i = data.findIndex(v => v.id === startId);
    if (i > 0) data.unshift(...data.splice(i, 1));
    else if (i < 0) {
      const { data: one } = await sb.from('videos').select(VIDEO_SELECT).eq('id', startId).maybeSingle();
      if (one) data.unshift(one);
    }
  }
  if (!data.length) {
    view.classList.remove('flush');
    view.innerHTML = empty('No Shorts yet', 'Upload a vertical video as a Short.', `<a class="btn primary" href="#/upload/short">Upload a Short</a>`);
    return;
  }
  const ids = data.map(v => v.id);
  const [all, mine] = await Promise.all([
    sb.from('likes').select('video_id').in('video_id', ids),
    session ? sb.from('likes').select('video_id').in('video_id', ids).eq('user_id', session.user.id) : { data: [] },
  ]);
  const counts = {}; (all.data || []).forEach(l => (counts[l.video_id] = (counts[l.video_id] || 0) + 1));
  const liked = new Set((mine.data || []).map(l => l.video_id));

  view.innerHTML = `<div class="shorts-feed" id="sf">${data.map(v => {
    const p = v.profiles || {};
    return `<section class="short" data-id="${v.id}">
      <div class="short-stage">
        <video src="${esc(v.video_url)}" ${v.thumbnail_url ? `poster="${esc(v.thumbnail_url)}"` : ''} loop playsinline preload="metadata"></video>
        <button class="short-mute icon-btn" aria-label="Sound">${shortsMuted ? ICON.mute : ICON.sound}</button>
        <div class="short-info">
          <a href="#/channel/${p.id}" class="short-ch">${avatar(p, 'sm')}<b>@${esc(p.username || 'user')}</b>${badge(p)}</a>
          <p>${esc(v.title)}</p>
        </div>
      </div>
      <div class="short-actions">
        <button class="sa ${liked.has(v.id) ? 'on' : ''}" data-like><span class="ic">${ICON.like}</span><small>${fmtNum(counts[v.id] || 0)}</small></button>
        <a class="sa" href="#/watch/${v.id}"><span class="ic">${ICON.comment}</span><small>Comments</small></a>
        <button class="sa" data-share><span class="ic">${ICON.share}</span><small>Share</small></button>
      </div>
    </section>`;
  }).join('')}</div>`;

  const viewed = new Set();
  const setMuteIcons = () => $$('.short-mute').forEach(b => (b.innerHTML = shortsMuted ? ICON.mute : ICON.sound));
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const vid = e.target.querySelector('video');
      if (e.isIntersecting) {
        vid.muted = shortsMuted;
        vid.play().catch(() => { shortsMuted = true; vid.muted = true; setMuteIcons(); vid.play().catch(() => {}); });
        const id = e.target.dataset.id;
        if (!viewed.has(id)) { viewed.add(id); sb.rpc('increment_views', { vid: id }).then(() => {}); }
      } else {
        vid.pause();
      }
    }
  }, { threshold: 0.6 });
  $$('.short').forEach(s => io.observe(s));
  pageCleanup = () => { io.disconnect(); $$('.short video').forEach(v => v.pause()); };

  $$('.short').forEach(sec => {
    const id = sec.dataset.id, vid = sec.querySelector('video');
    vid.onclick = () => (vid.paused ? vid.play() : vid.pause());
    sec.querySelector('.short-mute').onclick = () => {
      shortsMuted = !shortsMuted;
      $$('.short video').forEach(v => (v.muted = shortsMuted));
      setMuteIcons();
    };
    const lb = sec.querySelector('[data-like]');
    lb.onclick = async () => {
      if (!requireAuth('Log in to like Shorts')) return;
      lb.disabled = true;
      const on = lb.classList.contains('on');
      const { error } = on
        ? await sb.from('likes').delete().eq('video_id', id).eq('user_id', session.user.id)
        : await sb.from('likes').insert({ video_id: id, user_id: session.user.id });
      lb.disabled = false;
      if (error) return toast(error.message);
      counts[id] = (counts[id] || 0) + (on ? -1 : 1);
      lb.classList.toggle('on', !on);
      lb.querySelector('small').textContent = fmtNum(counts[id]);
    };
    sec.querySelector('[data-share]').onclick = () => shareLink(location.href.split('#')[0] + '#/shorts/' + id);
  });
}

async function shareLink(url, title = 'Orange Tube') {
  if (navigator.share) { try { await navigator.share({ title, url }); } catch {} }
  else { await navigator.clipboard.writeText(url); toast('Link copied!'); }
}

// ================= PICTURE POSTS =================
const POST_SELECT = 'id,caption,images,created_at,user_id,profiles!posts_user_id_fkey(id,username,avatar_url,is_admin,verified,sub_count)';

function carouselHTML(images) {
  const n = images.length;
  return `<div class="carousel">
    <div class="track">${images.map(u => `<img src="${esc(u)}" alt="" loading="lazy" draggable="false">`).join('')}</div>
    ${n > 1 ? `
      <button class="cz prev" aria-label="Previous" hidden>‹</button>
      <button class="cz next" aria-label="Next">›</button>
      <span class="cz-count">1/${n}</span>
      <div class="dots">${images.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
  </div>`;
}
function wireCarousels(root = document) {
  $$('.carousel', root).forEach(c => {
    if (c.dataset.wired) return;
    c.dataset.wired = 1;
    const track = $('.track', c), n = track.children.length;
    if (n < 2) return;
    const prev = $('.prev', c), next = $('.next', c), dots = $$('.dots i', c), count = $('.cz-count', c);
    const update = () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
      count.textContent = `${i + 1}/${n}`;
      prev.hidden = i === 0;
      next.hidden = i === n - 1;
    };
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    prev.onclick = e => { e.preventDefault(); track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }); };
    next.onclick = e => { e.preventDefault(); track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }); };
    // mouse drag-to-swipe on desktop
    let down = false, sx = 0, sl = 0;
    track.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; sx = e.clientX; sl = track.scrollLeft; track.classList.add('drag'); });
    window.addEventListener('pointerup', () => {
      if (!down) return; down = false; track.classList.remove('drag');
      const i = Math.round(track.scrollLeft / track.clientWidth);
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
    });
    track.addEventListener('pointermove', e => { if (down) track.scrollLeft = sl - (e.clientX - sx); });
  });
}

function postHTML(p, likes, liked) {
  const u = p.profiles || {};
  const mine = session?.user.id === p.user_id || isAdmin();
  return `<article class="post" data-id="${p.id}">
    <header class="post-head">
      <a href="#/channel/${u.id}">${avatar(u)}</a>
      <div><a href="#/channel/${u.id}"><b>${esc(u.username || 'user')}</b>${badge(u)}</a><small>${timeAgo(p.created_at)}</small></div>
      ${mine ? `<button class="icon-btn post-del" aria-label="Delete post" style="margin-left:auto">${ICON.trash}</button>` : ''}
    </header>
    ${p.caption ? `<p class="post-cap">${linkify(p.caption)}</p>` : ''}
    ${carouselHTML(p.images || [])}
    <footer class="post-foot">
      <button class="btn ${liked ? 'liked' : ''}" data-plike>${ICON.like}<span>${fmtNum(likes)}</span></button>
      <button class="btn" data-pshare>${ICON.share}Share</button>
    </footer>
  </article>`;
}

async function renderPosts(el, posts) {
  if (!posts?.length) { el.innerHTML = empty('No posts yet', 'Share some pictures!', `<a class="btn primary" href="#/upload/pictures">Post pictures</a>`); return; }
  const ids = posts.map(p => p.id);
  const [all, mine] = await Promise.all([
    sb.from('post_likes').select('post_id').in('post_id', ids),
    session ? sb.from('post_likes').select('post_id').in('post_id', ids).eq('user_id', session.user.id) : { data: [] },
  ]);
  const counts = {}; (all.data || []).forEach(l => (counts[l.post_id] = (counts[l.post_id] || 0) + 1));
  const liked = new Set((mine.data || []).map(l => l.post_id));
  el.innerHTML = `<div class="posts">${posts.map(p => postHTML(p, counts[p.id] || 0, liked.has(p.id))).join('')}</div>`;
  wireCarousels(el);

  $$('.post', el).forEach(art => {
    const id = art.dataset.id, post = posts.find(p => p.id === id);
    const lb = $('[data-plike]', art);
    const toggleLike = async (forceOn = false) => {
      if (!requireAuth('Log in to like posts')) return;
      const on = lb.classList.contains('liked');
      if (forceOn && on) return;
      lb.disabled = true;
      const { error } = on
        ? await sb.from('post_likes').delete().eq('post_id', id).eq('user_id', session.user.id)
        : await sb.from('post_likes').insert({ post_id: id, user_id: session.user.id });
      lb.disabled = false;
      if (error) return toast(error.message);
      counts[id] = (counts[id] || 0) + (on ? -1 : 1);
      lb.classList.toggle('liked', !on);
      $('span', lb).textContent = fmtNum(counts[id]);
    };
    lb.onclick = () => toggleLike();
    $('.track', art).addEventListener('dblclick', () => { toggleLike(true); art.classList.add('pop'); setTimeout(() => art.classList.remove('pop'), 600); });
    $('[data-pshare]', art).onclick = () => shareLink(location.href.split('#')[0] + '#/channel/' + post.user_id);
    const del = $('.post-del', art);
    if (del) del.onclick = async () => {
      if (!confirm('Delete this post?')) return;
      const { error } = await sb.from('posts').delete().eq('id', id);
      if (error) return toast(error.message);
      const paths = (post.images || []).map(u => u.match(/\/object\/public\/posts\/(.+)$/)?.[1]).filter(Boolean).map(decodeURIComponent);
      if (paths.length) await sb.storage.from('posts').remove(paths);
      art.remove();
      toast('Post deleted');
    };
  });
}

async function pagePosts() {
  setActive('posts');
  spinner();
  const { data, error } = await sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(40);
  if (error) return showDbError(error);
  view.innerHTML = `<div class="posts-wrap"><h1 class="page-title">Pictures
    <a class="btn primary" href="#/upload/pictures" style="margin-left:auto">+ Post</a></h1><div id="postList"></div></div>`;
  renderPosts($('#postList'), data);
}

// ================= ADMIN PANEL =================
const isAdmin = () => !!profile?.is_admin;

async function pageAdmin(tab = 'users') {
  setActive('admin');
  if (!isAdmin()) { view.innerHTML = empty('Admins only', 'You don’t have access to this page.'); return; }
  view.innerHTML = `
    <h1 class="page-title">Admin panel</h1>
    <div class="stat-row" id="stats">${['Users', 'Videos', 'Shorts', 'Pictures', 'Comments'].map(n => `<div class="stat"><b>–</b><span>${n}</span></div>`).join('')}</div>
    <nav class="ch-tabs">
      <a href="#/admin/users" class="${tab === 'users' ? 'on' : ''}">Users</a>
      <a href="#/admin/videos" class="${tab === 'videos' ? 'on' : ''}">Videos & Shorts</a>
      <a href="#/admin/posts" class="${tab === 'posts' ? 'on' : ''}">Pictures</a>
    </nav>
    <div id="adminBody"><div class="spinner"></div></div>`;

  const head = { count: 'exact', head: true };
  Promise.all([
    sb.from('profiles').select('*', head),
    sb.from('videos').select('*', head).eq('is_short', false),
    sb.from('videos').select('*', head).eq('is_short', true),
    sb.from('posts').select('*', head),
    sb.from('comments').select('*', head),
  ]).then(rs => $$('#stats .stat b').forEach((b, i) => (b.textContent = fmtNum(rs[i].count || 0))));

  const body = $('#adminBody');
  if (tab === 'videos') return adminVideos(body);
  if (tab === 'posts') return adminPosts(body);
  return adminUsers(body);
}

async function adminUsers(body) {
  body.innerHTML = `
    <form class="search admin-search" id="uSearch"><input type="search" name="q" placeholder="Search users" autocomplete="off"><button type="submit" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button></form>
    <div id="uList"><div class="spinner"></div></div>`;
  const load = async (q = '') => {
    let query = sb.from('profiles').select('id,username,avatar_url,is_admin,verified,banned,sub_count,created_at').order('created_at', { ascending: false }).limit(100);
    if (q) query = query.ilike('username', `%${q.replace(/[%,()]/g, '')}%`);
    const { data, error } = await query;
    if (error) return showDbError(error);
    const list = $('#uList');
    list.innerHTML = data?.length ? `<div class="admin-list">${data.map(u => `
      <div class="admin-row" data-id="${u.id}">
        <a href="#/channel/${u.id}">${avatar(u)}</a>
        <div class="ar-main">
          <a href="#/channel/${u.id}"><b>${esc(u.username)}</b>${badge(u)}</a>
          <small>${fmtNum(u.sub_count)} subscribers • joined ${timeAgo(u.created_at)}
            ${u.is_admin ? '<span class="tag">Admin</span>' : ''}${u.banned ? '<span class="tag red">Banned</span>' : ''}</small>
        </div>
        <div class="ar-actions">
          <button class="btn sm" data-act="verified" data-val="${!u.verified}">${u.verified ? 'Unverify' : 'Verify'}</button>
          ${u.id === session.user.id ? '' : `
          <button class="btn sm" data-act="admin" data-val="${!u.is_admin}">${u.is_admin ? 'Remove admin' : 'Make admin'}</button>
          <button class="btn sm ${u.banned ? '' : 'danger'}" data-act="banned" data-val="${!u.banned}">${u.banned ? 'Unban' : 'Ban'}</button>`}
        </div>
      </div>`).join('')}</div>` : empty('No users found');
    $$('[data-act]', list).forEach(b => (b.onclick = async () => {
      const id = b.closest('.admin-row').dataset.id, act = b.dataset.act, val = b.dataset.val === 'true';
      if (act === 'banned' && val && !confirm('Ban this user? They won’t be able to upload, post or comment.')) return;
      if (act === 'admin' && val && !confirm('Give this user full admin powers?')) return;
      b.disabled = true;
      const args = { target: id, p_verified: null, p_admin: null, p_banned: null };
      args['p_' + act] = val;
      const { error } = await sb.rpc('admin_set_user', args);
      if (error) { b.disabled = false; return toast(error.message); }
      toast('Updated');
      load($('#uSearch').q.value.trim());
    }));
  };
  $('#uSearch').onsubmit = e => { e.preventDefault(); load(e.target.q.value.trim()); };
  load();
}

async function adminDeleteVideo(v) {
  const { error } = await sb.from('videos').delete().eq('id', v.id);
  if (error) return toast(error.message), false;
  for (const u of [v.video_url, v.thumbnail_url].filter(Boolean)) {
    const m = u.match(/\/object\/public\/(videos|thumbnails)\/(.+)$/);
    if (m) await sb.storage.from(m[1]).remove([decodeURIComponent(m[2])]);
  }
  return true;
}

async function adminVideos(body) {
  const { data, error } = await sb.from('videos').select(VIDEO_SELECT).order('created_at', { ascending: false }).limit(100);
  if (error) return showDbError(error);
  body.innerHTML = data?.length ? `<div class="admin-list">${data.map(v => `
    <div class="admin-row" data-id="${v.id}">
      <a href="${v.is_short ? '#/shorts/' : '#/watch/'}${v.id}" class="ar-thumb ${v.is_short ? 'short' : ''}">${v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="" loading="lazy">` : ''}</a>
      <div class="ar-main">
        <a href="${v.is_short ? '#/shorts/' : '#/watch/'}${v.id}"><b>${esc(v.title)}</b></a>
        <small>${v.is_short ? '<span class="tag">Short</span>' : ''}by ${esc(v.profiles?.username || '?')} • ${fmtNum(v.views)} views • ${timeAgo(v.created_at)}</small>
      </div>
      <div class="ar-actions"><button class="btn sm danger" data-del>Delete</button></div>
    </div>`).join('')}</div>` : empty('No videos yet');
  $$('[data-del]', body).forEach(b => (b.onclick = async () => {
    const row = b.closest('.admin-row'), v = data.find(x => x.id === row.dataset.id);
    if (!confirm(`Delete "${v.title}"?`)) return;
    b.disabled = true;
    if (await adminDeleteVideo(v)) { row.remove(); toast('Deleted'); } else b.disabled = false;
  }));
}

async function adminPosts(body) {
  const { data, error } = await sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(100);
  if (error) return showDbError(error);
  body.innerHTML = data?.length ? `<div class="admin-list">${data.map(p => `
    <div class="admin-row" data-id="${p.id}">
      <a href="#/channel/${p.user_id}/posts" class="ar-thumb"><img src="${esc(p.images?.[0] || '')}" alt="" loading="lazy"></a>
      <div class="ar-main">
        <b>${esc((p.caption || '(no caption)').slice(0, 80))}</b>
        <small>by ${esc(p.profiles?.username || '?')} • ${p.images?.length || 0} pictures • ${timeAgo(p.created_at)}</small>
      </div>
      <div class="ar-actions"><button class="btn sm danger" data-del>Delete</button></div>
    </div>`).join('')}</div>` : empty('No pictures yet');
  $$('[data-del]', body).forEach(b => (b.onclick = async () => {
    const row = b.closest('.admin-row'), p = data.find(x => x.id === row.dataset.id);
    if (!confirm('Delete this post?')) return;
    b.disabled = true;
    const { error } = await sb.from('posts').delete().eq('id', p.id);
    if (error) { b.disabled = false; return toast(error.message); }
    const paths = (p.images || []).map(u => u.match(/\/object\/public\/posts\/(.+)$/)?.[1]).filter(Boolean).map(decodeURIComponent);
    if (paths.length) await sb.storage.from('posts').remove(paths);
    row.remove();
    toast('Deleted');
  }));
}

// ================= router =================
function setActive(name) {
  const al = $('#adminLink'); if (al) al.hidden = !isAdmin();
  $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}

let pageCleanup = null;
async function router() {
  if (pageCleanup) { pageCleanup(); pageCleanup = null; }
  view.classList.remove('flush');
  const hash = location.hash.slice(2) || '';
  const [route, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest[0] || '');
  const arg2 = decodeURIComponent(rest[1] || '');
  document.title = 'Orange Tube';
  document.body.classList.remove('side-open');
  window.scrollTo(0, 0);
  switch (route) {
    case '': return pageHome();
    case 'trending': return pageTrending();
    case 'subscriptions': return pageSubscriptions();
    case 'liked': return pageLiked();
    case 'watch': return pageWatch(arg);
    case 'channel': return pageChannel(arg, arg2 || 'videos');
    case 'me': return pageMe();
    case 'upload': return pageUpload(arg || 'video');
    case 'shorts': return pageShorts(arg);
    case 'posts': return pagePosts();
    case 'settings': return pageSettings();
    case 'admin': return pageAdmin(arg || 'users');
    case 'search': return pageSearch(arg);
    default: view.innerHTML = empty('Page not found', '', '<a class="btn primary" href="#/">Go home</a>');
  }
}

// ================= global events =================
document.addEventListener('click', () => { const d = $('#userDrop'); if (d) d.hidden = true; });
$('#searchForm').onsubmit = e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
};
$('#menuBtn').onclick = () => {
  if (innerWidth <= 900) document.body.classList.toggle('side-open');
  else document.body.classList.toggle('side-collapsed');
};
window.addEventListener('hashchange', router);

// ================= boot =================
(async () => {
  const { data } = await sb.auth.getSession();
  session = data.session;
  await loadProfile();
  renderAuthArea();
  router();

  sb.auth.onAuthStateChange(async (event, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (event === 'PASSWORD_RECOVERY') { location.hash = '#/settings'; toast('Set a new password below'); }
    if (changed || event === 'USER_UPDATED') {
      await loadProfile();
      renderAuthArea();
      router();
    }
  });
})();
