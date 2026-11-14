import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

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

const VIDEO_SELECT = 'id,title,description,thumbnail_url,video_url,views,created_at,user_id,profiles!videos_user_id_fkey(id,username,avatar_url)';

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
        <p><a href="#/channel/${p.id}">${esc(p.username || 'Unknown')}</a></p>
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
      <p>${esc(p.username || '')}</p>
      ${compact ? '' : `<p class="desc">${esc(v.description || '')}</p>`}
    </div>
  </a>`;
}
function gridOf(videos, emptyHTML) {
  view.innerHTML = videos?.length ? `<div class="grid">${videos.map(cardHTML).join('')}</div>` : emptyHTML;
}

// ================= auth UI =================
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
        <div class="who"><b>${esc(profile?.username || 'You')}</b><small>${esc(session.user.email)}</small></div>
        <a href="#/me"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>Your channel</a>
        <a href="#/upload"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg>Upload video</a>
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
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
  btn.disabled = false;
  if (error) return setAuthMsg(error.message, 'err');
  e.target.reset();
  closeAuth();
  toast('Welcome back! 🍊');
};

$('#signupForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('password') !== f.get('confirm')) return setAuthMsg('Passwords do not match', 'err');
  const username = f.get('username').trim();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; setAuthMsg('Creating your channel…');

  const { data: taken } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
  if (taken) { btn.disabled = false; return setAuthMsg('That channel name is taken', 'err'); }

  const { data, error } = await sb.auth.signUp({
    email: f.get('email'),
    password: f.get('password'),
    options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
  });
  btn.disabled = false;
  if (error) return setAuthMsg(error.message, 'err');
  e.target.reset();
  if (data.session) {
    closeAuth();
    toast(`Channel created — welcome, ${username}! 🍊`);
  } else {
    setAuthMsg('Check your email to confirm your account, then log in.', 'ok');
    setTimeout(() => switchTab('login'), 50);
    setTimeout(() => setAuthMsg('Check your email to confirm your account, then log in.', 'ok'), 60);
  }
};

$('#forgotBtn').onclick = async () => {
  const email = $('#loginForm').email.value.trim();
  if (!email) return setAuthMsg('Type your email above first', 'err');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '#/settings' });
  setAuthMsg(error ? error.message : 'Password reset email sent.', error ? 'err' : 'ok');
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
  const { data, error } = await sb.from('videos').select(VIDEO_SELECT).order('created_at', { ascending: false }).limit(60);
  if (error) return showDbError(error);
  gridOf(data, empty('No videos yet', 'Be the first to upload something fresh.', `<a class="btn primary" href="#/upload">Upload a video</a>`));
}

async function pageTrending() {
  setActive('trending');
  skeletonGrid();
  const { data, error } = await sb.from('videos').select(VIDEO_SELECT).order('views', { ascending: false }).limit(60);
  if (error) return showDbError(error);
  view.innerHTML = `<h1 class="page-title">🔥 Trending</h1>`;
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
  view.innerHTML = `<h1 class="page-title">👍 Liked videos</h1>`;
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
    sb.from('videos').select(VIDEO_SELECT).neq('id', id).order('views', { ascending: false }).limit(20),
  ]);

  let likeCount = likesRes.count || 0, liked = !!myLike.data;
  let subCount = subsRes.count || 0, subbed = !!mySub.data;
  const isOwner = session?.user.id === v.user_id;

  view.innerHTML = `
  <div class="watch">
    <div>
      <video class="player" src="${esc(v.video_url)}" ${v.thumbnail_url ? `poster="${esc(v.thumbnail_url)}"` : ''} controls autoplay playsinline></video>
      <h1>${esc(v.title)}</h1>
      <div class="watch-bar">
        <div class="channel-chip">
          <a href="#/channel/${p.id}">${avatar(p)}</a>
          <div><a href="#/channel/${p.id}"><b>${esc(p.username || 'Unknown')}</b></a><small id="subCount">${fmtNum(subCount)} subscribers</small></div>
          ${isOwner ? '' : `<button class="btn ${subbed ? 'subbed' : 'primary'}" id="subBtn">${subbed ? 'Subscribed' : 'Subscribe'}</button>`}
        </div>
        <div class="actions">
          <button class="btn ${liked ? 'liked' : ''}" id="likeBtn">
            <svg viewBox="0 0 24 24"><path d="M7 21V10l5-7 1 1c.6.6.8 1.4.6 2.2L13 10h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21zM3 10h4v11H3z"/></svg>
            <span id="likeCount">${fmtNum(likeCount)}</span>
          </button>
          <button class="btn" id="shareBtn"><svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>Share</button>
          ${isOwner ? `<button class="btn" id="delVid" style="color:var(--danger)"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete</button>` : ''}
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
    const { data } = await sb.from('comments').select('id,body,created_at,user_id,profiles!comments_user_id_fkey(id,username,avatar_url)')
      .eq('video_id', id).order('created_at', { ascending: false }).limit(200);
    $('#cCount').textContent = `${fmtNum(data?.length || 0)} Comments`;
    $('#cList').innerHTML = (data || []).map(c => `
      <div class="comment">
        <a href="#/channel/${c.profiles?.id}">${avatar(c.profiles, 'sm')}</a>
        <div>
          <div class="head"><b>@${esc(c.profiles?.username || 'user')}</b><span>${timeAgo(c.created_at)}</span></div>
          <p>${linkify(c.body)}</p>
          ${session?.user.id === c.user_id || isOwner ? `<button class="del" data-del="${c.id}">Delete</button>` : ''}
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

async function pageChannel(id) {
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
  const list = vids.data || [];
  const totalViews = list.reduce((a, v) => a + (v.views || 0), 0);

  view.innerHTML = `
    <div class="banner"></div>
    <div class="channel-head">
      ${avatar(p, 'lg')}
      <div style="flex:1">
        <h1>${esc(p.username)}</h1>
        <p>@${esc(p.username)} • <span id="chSubs">${fmtNum(subCount)}</span> subscribers • ${list.length} videos • ${fmtNum(totalViews)} views</p>
        ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
      </div>
      ${isMe ? `<a class="btn" href="#/settings">Customize channel</a><a class="btn primary" href="#/upload">Upload</a>`
             : `<button class="btn ${subbed ? 'subbed' : 'primary'}" id="chSub">${subbed ? 'Subscribed' : 'Subscribe'}</button>`}
    </div>
    <h2 class="page-title">Videos</h2>
    ${list.length ? `<div class="grid">${list.map(cardHTML).join('')}</div>` : empty('No videos yet', isMe ? 'Upload your first video!' : '')}`;

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

function pageUpload() {
  setActive('upload');
  if (!session) {
    view.innerHTML = empty('Upload to Orange Tube', 'You need an account to upload videos.', `<button class="btn primary" id="si">Log in / Sign up</button>`);
    $('#si').onclick = () => openAuth('login');
    return;
  }
  view.innerHTML = `
    <h1 class="page-title">Upload video</h1>
    <div class="panel">
      <form class="form" id="upForm">
        <label class="drop" id="drop">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg>
          <div><b id="dropText">Drag & drop a video, or click to choose</b></div>
          <p>MP4, WebM or MOV</p>
          <input type="file" name="video" accept="video/*" required>
        </label>
        <div class="preview-row" id="previews" hidden>
          <div><p class="hint">Video</p><video id="vPrev" controls muted></video></div>
          <div><p class="hint">Thumbnail</p><img id="tPrev" alt=""></div>
        </div>
        <label>Title<input type="text" name="title" maxlength="120" required placeholder="Give your video a title"></label>
        <label>Description<textarea name="description" maxlength="5000" placeholder="Tell viewers about your video"></textarea></label>
        <label>Custom thumbnail (optional — otherwise we grab a frame)<input type="file" name="thumb" accept="image/*"></label>
        <div class="progress" hidden id="prog"><div></div></div>
        <p class="hint" id="upStatus"></p>
        <button class="btn primary block" type="submit" id="upBtn">Publish</button>
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
    const btn = $('#upBtn'), status = $('#upStatus'), prog = $('#prog'), bar = prog.firstElementChild;
    btn.disabled = true; prog.hidden = false; bar.style.width = '5%';
    const uid = session.user.id;
    const stamp = Date.now();
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();

    try {
      status.textContent = 'Uploading video… (large files can take a while)';
      let pct = 5;
      const tick = setInterval(() => { pct = Math.min(85, pct + 2); bar.style.width = pct + '%'; }, 600);
      const vPath = `${uid}/${stamp}.${ext}`;
      const { error: vErr } = await sb.storage.from('videos').upload(vPath, file, { contentType: file.type || 'video/mp4', upsert: false });
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
        user_id: uid, title: form.title.value.trim(), description: form.description.value.trim(), video_url, thumbnail_url,
      }).select('id').single();
      if (error) throw error;
      bar.style.width = '100%';
      toast('Video published! 🍊');
      location.hash = `#/watch/${data.id}`;
    } catch (err) {
      console.error(err);
      status.textContent = '❌ ' + (err.message || 'Upload failed') +
        (/size|exceed|413/i.test(err.message || '') ? ' — your Supabase storage file-size limit may be too low (Storage → Settings).' : '');
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
        <label>Channel name<input type="text" name="username" value="${esc(profile?.username || '')}" minlength="3" maxlength="30" pattern="[A-Za-z0-9_\\.]+" required></label>
        <label>About<textarea name="bio" maxlength="500">${esc(profile?.bio || '')}</textarea></label>
        <label>New password (leave blank to keep)<input type="text" name="password" minlength="6" autocomplete="new-password" style="-webkit-text-security:disc"></label>
        <button class="btn primary block" type="submit">Save changes</button>
      </form>
    </div>`;
  $('#setForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, uid = session.user.id;
    const updates = { username: f.username.value.trim(), bio: f.bio.value.trim() };
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
  const missing = /relation "?[\w.]+"? does not exist|Could not find the table/i.test(error.message);
  view.innerHTML = empty('Something went wrong', missing
    ? 'The database tables aren’t set up yet. Run <code>supabase/schema.sql</code> in your Supabase SQL Editor.'
    : esc(error.message));
}

// ================= router =================
function setActive(name) {
  $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}

async function router() {
  const hash = location.hash.slice(2) || '';
  const [route, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  document.title = 'Orange Tube';
  document.body.classList.remove('side-open');
  window.scrollTo(0, 0);
  switch (route) {
    case '': return pageHome();
    case 'trending': return pageTrending();
    case 'subscriptions': return pageSubscriptions();
    case 'liked': return pageLiked();
    case 'watch': return pageWatch(arg);
    case 'channel': return pageChannel(arg);
    case 'me': return pageMe();
    case 'upload': return pageUpload();
    case 'settings': return pageSettings();
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
