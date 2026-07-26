// alert.js — 特别关注提醒窗：同人合并 + 常驻 + 右侧滑入 + 已读消隐 + 全读完自动关
// 每条行 = 一个博主（可含多条未读新帖，name 右侧数字角标）

const AVATAR_COLORS = [
  '#86B4C9', '#A8B5A0', '#D4A5A5', '#C9B8A8',
  '#A5ADC4', '#C4B5AA', '#B8ADA0', '#BCA5C4',
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
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function postUrl(userId, postId) {
  return `https://xueqiu.com/${userId || '0'}/${postId}`;
}

// 按内容实测高度自适应窗口高度：1 人少量帖 → 紧凑；多人多帖 → 自动增高。
// 上下（header / footer）固定，中间列表区随内容伸缩，夹在 [MIN, MAX] 之间（超出滚动）。
function measureContentHeight() {
  const list = document.getElementById('list');
  if (!list) return 0;
  let h = 0;
  const rows = list.querySelectorAll('.row');
  rows.forEach(r => { h += r.offsetHeight; });
  if (!document.body.classList.contains('layout-inbox') && rows.length > 1) {
    h += 10 * (rows.length - 1); // 卡片布局的卡片间距 margin-bottom
  }
  const cs = getComputedStyle(list);
  h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return h;
}
function resizeToContent() {
  try {
    const hd = document.querySelector('.hd');
    const ft = document.querySelector('.ft');
    const hdH = hd ? hd.offsetHeight : 44;
    const ftH = ft ? ft.offsetHeight : 32;
    const desired = hdH + measureContentHeight() + ftH;
    const MIN = 240, MAX = 540;
    const h = Math.max(MIN, Math.min(MAX, Math.round(desired)));
    chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { height: h });
  } catch (e) {}
}

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
      document.getElementById('total').textContent = '';
      list.innerHTML = '<div class="empty">🎉 全部已读，没有新帖<br><span style="font-size:11px;color:var(--subtitle);">本窗口即将自动关闭…</span></div>';
      resizeToContent();
      setTimeout(() => window.close(), 1500);
      return;
    }

    document.getElementById('total').textContent = `★ ${merged.length} 人 · ${unreadTotal} 条未读`;

    merged.forEach(g => {
      const latest = g.posts[0];
      const row = document.createElement('div');
      row.className = 'row';
      const multi = g.posts.length > 1;
      row.innerHTML =
        `<div class="avatar" style="background:${colorFor(g.name)}">${esc(initialOf(g.name))}</div>` +
        `<div class="body">` +
        `<div class="row1"><span class="name">${esc(g.name)}</span>` +
        (multi ? `<span class="badge">${g.posts.length}</span>` : '') +
        `</div>` +
        `<div class="summary">${esc(latest.text || '')}</div>` +
        `</div>`;
      row.addEventListener('click', () => onRowClick(row, g, latest));
      list.appendChild(row);
    });
    resizeToContent();
  });
}

function uiLog(level, ...a) {
  try {
    const msg = a.map(x => x instanceof Error ? (x.stack || x.message) : (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    chrome.runtime.sendMessage({ type: 'uiLog', level: level || 'INFO', msg });
  } catch (e) {}
}

function onRowClick(row, group, latest) {
  const url = postUrl(group.userId, latest.id);
  uiLog('INFO', '点击卡片，打开原帖：' + url);
  chrome.tabs.create({ url }, (tab) => {
    if (chrome.runtime.lastError) { uiLog('ERROR', '打开原帖失败：' + chrome.runtime.lastError.message); return; }
    if (tab && tab.windowId) chrome.windows.update(tab.windowId, { focused: true });
  });
  const ids = group.posts.map(p => p.id);
  Promise.all(ids.map(id => chrome.runtime.sendMessage({ type: 'markRead', postId: id })))
    .then(() => {
      row.classList.add('read');
      setTimeout(() => render(), 320);
    });
}

// 关闭按钮：关掉所有 alert 弹窗（含跨 SW 重启遗留的孤儿窗口）
document.getElementById('close').addEventListener('click', () => {
  uiLog('INFO', '点击「关闭」→ 关闭全部弹窗');
  try { chrome.runtime.sendMessage({ type: 'closeAllAlertWindows' }); } catch (e) {}
  window.close();
});

// 已读全部：标记全部已读 + 关掉所有 alert 弹窗
document.getElementById('markAll').addEventListener('click', async () => {
  uiLog('INFO', '点击「已读全部」→ 标记已读并关闭全部弹窗');
  try { await chrome.runtime.sendMessage({ type: 'closeAllAlerts' }); } catch (e) { uiLog('ERROR', '全部已读并关闭失败：' + e.message); }
  document.querySelectorAll('.row').forEach(c => c.classList.add('read'));
  setTimeout(() => {
    const list = document.getElementById('list');
    list.innerHTML = '<div class="empty" style="color:#1E6FFF;font-size:13px;">✅ 已全部标记为已读</div>';
    document.getElementById('total').textContent = '';
    resizeToContent();
    setTimeout(() => window.close(), 800);
  }, 350);
});

// 应用外观设置（布局 + 主题），由设置页存储，弹窗启动时读取
async function applyAppearance() {
  try {
    const s = await new Promise(r => chrome.storage.local.get('appearance', r));
    const a = s.appearance || { layout: 'card', theme: 'light' };
    if (a.theme === 'dark') document.body.classList.add('theme-dark');
    if (a.layout === 'inbox') document.body.classList.add('layout-inbox');
  } catch (e) {}
}

// 贴边精校（兜底）：用弹窗自身所在屏幕的坐标（availLeft + availWidth），
// 不受多屏 / 主屏错位影响，把右侧残余间隙补平。background.js 已先按浏览器屏幕算过一次。
function snapToRight() {
  try {
    const screenRight = (window.screen.availLeft || 0) + (window.screen.availWidth || window.screen.width || 0);
    const curRight = window.screenX + window.outerWidth;
    const gap = screenRight - curRight;
    if (gap > 1) {
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left: Math.round(window.screenX + gap) });
      uiLog('INFO', '弹窗内部贴边校正 → 右移=' + Math.round(gap) + 'px');
    }
  } catch (e) {}
}

// 窗口已开时，background 会发 alertRefresh 让本页重渲染最新列表
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'alertRefresh') render();
});

// 先应用外观（加 body class），再渲染，避免样式闪烁；渲染后按内容自适应高度 + 贴边兜底
// 分多个时间点调用，覆盖字体加载、动画结束等坐标未稳定的瞬间。
(async () => {
  await applyAppearance();
  render();
  setTimeout(() => { resizeToContent(); snapToRight(); }, 80);
  setTimeout(() => { resizeToContent(); snapToRight(); }, 400);
  setTimeout(resizeToContent, 900);
})();
