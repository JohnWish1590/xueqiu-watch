// alert.js — 特别关注提醒窗：同人合并 + 常驻 + 右侧滑入 + 已读消隐 + 全读完自动关
// 每条卡片 = 一个博主（可含多条未读新帖，右上角数字角标）

// 马卡龙低饱和色系（柔和、不刺眼、有质感）
const AVATAR_COLORS = [
  '#86B4C9',  // 柔蓝
  '#A8B5A0',  // 鼠尾草绿
  '#D4A5A5',  // 藕粉
  '#C9B8A8',  // 奶茶
  '#A5ADC4',  // 雾霾蓝
  '#C4B5AA',  // 杏仁
  '#B8ADA0',  // 灰绿
  '#BCA5C4',  // 淡紫
];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || '雪')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initialOf(name) {
  const s = String(name || '雪').trim();
  return s ? s[0].toUpperCase() : '雪';
}
function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const p = n => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function postUrl(userId, postId) {
  return `https://xueqiu.com/${userId || '0'}/${postId}`;
}

// 只取未读帖，按博主合并
function groupUnread(items) {
  const unread = (items || []).filter(p => !p.read);
  const groups = new Map();
  for (const p of unread) {
    const uid = String(p.userId || (p.user && p.user.id) || '0');
    if (!groups.has(uid)) {
      groups.set(uid, { userId: uid, name: p.name || (p.user && p.user.screen_name) || '雪球博主', posts: [] });
    }
    groups.get(uid).posts.push(p);
  }
  const merged = [...groups.values()].map(g => {
    g.posts.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    return g;
  });
  merged.sort((a, b) => Number(b.posts[0].id || 0) - Number(a.posts[0].id || 0));
  return { merged, unreadTotal: unread.length };
}

function render() {
  chrome.storage.local.get(['recent'], ({ recent }) => {
    const list = document.getElementById('list');
    list.innerHTML = '';
    const { merged, unreadTotal } = groupUnread(recent);

    if (!merged.length) {
      // 没有未读：不立即闪关（避免"一闪而过"），显示空态短暂停留后自动关
      document.getElementById('total').textContent = '';
      list.innerHTML = '<div class="empty">🎉 全部已读，没有新帖<br><span style="font-size:11px;color:#bbb;">本窗口即将自动关闭…</span></div>';
      setTimeout(() => window.close(), 1500);
      return;
    }

    document.getElementById('total').textContent = `${merged.length} 人 · ${unreadTotal} 条未读`;

    merged.forEach(g => {
      const latest = g.posts[0];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div class="avatar" style="background:${colorFor(g.name)}">${esc(initialOf(g.name))}` +
        (g.posts.length > 1 ? `<span class="badge">${g.posts.length}</span>` : '') +
        `</div>` +
        `<div class="body">` +
        `  <div class="row1"><span class="name">${esc(g.name)}</span><span class="time">${fmt(latest.ts)}</span></div>` +
        `  <div class="txt">${esc(latest.text || '')}</div>` +
        `  <div class="readhint">点击打开 · 标记已读</div>` +
        `</div>`;
      card.addEventListener('click', () => onCardClick(card, g, latest));
      list.appendChild(card);
    });
  });
}

// 把弹窗内的关键交互记回后台日志（便于复现"点了不跳"等问题）
function uiLog(level, ...a) {
  try {
    const msg = a.map(x => x instanceof Error ? (x.stack || x.message) : (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    chrome.runtime.sendMessage({ type: 'uiLog', level: level || 'INFO', msg });
  } catch (e) {}
}

// 点击卡片：打开原帖 → 标记该博主所有未读为已读 → 卡片滑出 → 全读完关窗
function onCardClick(card, group, latest) {
  const url = postUrl(group.userId, latest.id);
  uiLog('INFO', '点击卡片，打开原帖：' + url);
  chrome.tabs.create({ url }, (tab) => {
    if (chrome.runtime.lastError) {
      uiLog('ERROR', '打开原帖失败：' + chrome.runtime.lastError.message);
      return;
    }
    // 新标签开在普通窗口，把它提到前台，确保用户"看得到跳"
    if (tab && tab.windowId) chrome.windows.update(tab.windowId, { focused: true });
  });

  // 该组所有未读帖都标记已读
  const ids = group.posts.map(p => p.id);
  Promise.all(ids.map(id => chrome.runtime.sendMessage({ type: 'markRead', postId: id })))
    .then(() => {
      // 播放滑出动画后重渲染
      card.classList.add('read');
      setTimeout(() => render(), 320);
    });
}

render();

// 关闭按钮：关掉所有 alert 弹窗（不只是当前这个，顺手清理残留的孤儿窗口）
document.getElementById('close').addEventListener('click', () => {
  uiLog('INFO', '点击「关闭」→ 关闭全部弹窗');
  try { chrome.runtime.sendMessage({ type: 'closeAllAlertWindows' }); } catch (e) {}
  window.close();
});

// 全部已读：标记全部已读 + 关掉所有 alert 弹窗（含跨 SW 重启遗留的窗口）
document.getElementById('markAll').addEventListener('click', async () => {
  uiLog('INFO', '点击「全部已读」→ 标记已读并关闭全部弹窗');
  try {
    await chrome.runtime.sendMessage({ type: 'closeAllAlerts' });
  } catch (e) { uiLog('ERROR', '全部已读并关闭失败：' + e.message); }
  // 所有卡片加滑出动画（后台已标记已读并关闭窗口，这里只是视觉反馈）
  document.querySelectorAll('.card').forEach(c => c.classList.add('read'));
  setTimeout(() => {
    const list = document.getElementById('list');
    list.innerHTML = '<div class="empty" style="color:#1E6FFF;font-size:13px;">✅ 已全部标记为已读</div>';
    document.getElementById('total').textContent = '';
    setTimeout(() => window.close(), 800);
  }, 350);
});
// 常驻：不做自动关闭（全读完时会主动 window.close）

// 窗口已开时，background 会发 alertRefresh 让本页重渲染最新列表
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'alertRefresh') render();
});
