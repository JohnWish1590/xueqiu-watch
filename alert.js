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

// ── 文字截断由 CSS 完成 ──
// .summary 用 -webkit-line-clamp:2 限制最多 2 行，超出显示省略号
// 卡片 .row 用 overflow:hidden 保证内容不溢出圆角框（包括 CJK 字符）

// 按内容实测高度自适应窗口高度：1 人少量帖 → 紧凑；多人多帖 → 自动增高。
function measureContentHeight() {
  const list = document.getElementById('list');
  if (!list) return 0;
  let h = 0;
  const rows = list.querySelectorAll('.row');
  rows.forEach(r => { h += r.offsetHeight; });
  if (!document.body.classList.contains('layout-inbox') && rows.length > 1) {
    h += 10 * (rows.length - 1);
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
    const contentH = measureContentHeight();
    // chrome.windows.update 的 height 是外部高度（含 Windows 标题栏 ~30-38px）
    // 必须加上 outerHeight - innerHeight 的差值，否则内容会被标题栏截断
    const chromeDelta = window.outerHeight - window.innerHeight;
    const desired = hdH + contentH + ftH + chromeDelta;
    const MIN = 240, MAX = 600;
    const h = Math.max(MIN, Math.min(MAX, Math.round(desired)));
    chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { height: h });
    uiLog('INFO', '高度自适应 => 内容=' + contentH + ' +头尾=' + (hdH+ftH) + ' +标题栏=' + chromeDelta + ' => 设定=' + h + 'px');
  } catch (e) {
    uiLog('ERROR', '高度自适应异常：' + e.message);
  }
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

// 折叠：最多显示 3 张卡片，其余收进「还有 N人·M条未读」折叠行
const MAX_VISIBLE = 3;
let foldExpanded = false;

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

    document.getElementById('total').textContent = `${merged.length} 人 · ${unreadTotal} 条未读`;

    const isInbox = document.body.classList.contains('layout-inbox');

    // 折叠态：仅显示前 3 张；展开态：全部显示
    const shown = foldExpanded ? merged : merged.slice(0, MAX_VISIBLE);
    const rest = foldExpanded ? [] : merged.slice(MAX_VISIBLE);

    shown.forEach(g => {
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

    if (rest.length > 0) {
      // 折叠行：剩余人数 + 剩余未读条数
      const restUnread = rest.reduce((s, g) => s + g.posts.length, 0);
      const fold = document.createElement('div');
      fold.className = 'fold';
      fold.textContent = '▼ 还有 ' + rest.length + '人 · ' + restUnread + '条未读（展开）';
      fold.addEventListener('click', () => { foldExpanded = true; render(); });
      list.appendChild(fold);
    } else if (foldExpanded && merged.length > MAX_VISIBLE) {
      // 展开后显示收起行
      const fold = document.createElement('div');
      fold.className = 'fold';
      fold.textContent = '▲ 收起折叠内容';
      fold.addEventListener('click', () => { foldExpanded = false; render(); });
      list.appendChild(fold);
    }

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

// 关闭按钮
document.getElementById('close').addEventListener('click', () => {
  uiLog('INFO', '点击「关闭」=> 关闭全部弹窗');
  try { chrome.runtime.sendMessage({ type: 'closeAllAlertWindows' }); } catch (e) {}
  window.close();
});

// 已读全部
document.getElementById('markAll').addEventListener('click', async () => {
  uiLog('INFO', '点击「已读全部」=> 标记已读并关闭全部弹窗');
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

// 应用外观设置（布局 + 主题）
async function applyAppearance() {
  try {
    const s = await new Promise(r => chrome.storage.local.get('appearance', r));
    const a = s.appearance || { layout: 'card', theme: 'light' };
    if (a.theme === 'dark') document.body.classList.add('theme-dark');
    if (a.layout === 'inbox') document.body.classList.add('layout-inbox');
    updateThemeButtons();
  } catch (e) {}
}

// 头部 明亮/黑暗 分段按钮：高亮当前主题
function updateThemeButtons() {
  try {
    const isDark = document.body.classList.contains('theme-dark');
    const lb = document.getElementById('themeLight');
    const db = document.getElementById('themeDark');
    if (lb) lb.classList.toggle('active', !isDark);
    if (db) db.classList.toggle('active', isDark);
  } catch (e) {}
}

// 切换主题并持久化到 storage
async function setTheme(theme) {
  try {
    const s = await new Promise(r => chrome.storage.local.get('appearance', r));
    const a = s.appearance || { layout: 'card', theme: 'light' };
    a.theme = theme;
    await chrome.storage.local.set({ appearance: a });
    if (theme === 'dark') document.body.classList.add('theme-dark');
    else document.body.classList.remove('theme-dark');
    updateThemeButtons();
    uiLog('INFO', '切换主题 => ' + theme);
  } catch (e) {
    uiLog('ERROR', '切换主题失败：' + e.message);
  }
}

document.getElementById('themeLight').addEventListener('click', () => setTheme('light'));
document.getElementById('themeDark').addEventListener('click', () => setTheme('dark'));

// ═══════════════════════════════════════════════════
// 贴边精校（闭环校正版）
//
// v1.4.5 改进：设完位置后延迟 150ms 重测，若仍有间隙则递归再校，
// 最多 3 轮（覆盖 Chrome DWM / 窗口管理器异步调整的时序问题）。
// ═══════════════════════════════════════════════════
function snapToRight(round) {
  round = round || 1;
  try {
    // 多屏环境下 window.screen.width 是「窗口所在屏的本地宽」，
    // 但 window.screenX 是「全局虚拟坐标」，两者坐标系不一致 → 副屏算出来 gap 为负、推错屏。
    // 正确做法：用 chrome.system.display 拿到所有显示器真实边界，
    // 找窗口当前 screenX 落在哪块屏，再用该屏 workArea 右沿算目标 left。
    if (chrome.system && chrome.system.display && chrome.system.display.getInfo) {
      chrome.system.display.getInfo(disp => {
        try {
          const curX = window.screenX;
          const outerW = window.outerWidth;
          // 选包含当前窗口左边缘的屏；找不到就选最右那块
          let target = null;
          for (const d of (disp || [])) {
            const b = d.workArea || d.bounds;
            if (curX >= b.left && curX < b.left + b.width) { target = b; break; }
          }
          if (!target) {
            // 兜底：取全局最右屏
            let maxRight = -Infinity;
            for (const d of (disp || [])) {
              const b = d.workArea || d.bounds;
              if (b.left + b.width > maxRight) { maxRight = b.left + b.width; target = b; }
            }
          }
          if (!target) { uiLog('WARN', '贴边跳过：无可用显示器信息'); return; }

          const targetRight = target.left + target.width;       // 该屏 workArea 右沿（全局坐标）
          const gap = targetRight - (curX + outerW);
          uiLog('INFO', '贴边检测#' + round + ' => 屏右沿=' + targetRight + ' 窗口右=' + (curX + outerW) + ' gap=' + gap.toFixed(1) + 'px (curX=' + curX + ' outerW=' + outerW + ')');

          if (Math.abs(gap) > 3) {
            const newLeft = Math.round(curX + gap);
            chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left: newLeft });
            uiLog('INFO', '贴边校正#' + round + ' => 左=' + newLeft + ' (' + (gap > 0 ? '右移+' : '左移') + Math.round(gap) + 'px)');
            if (round < 3) { setTimeout(function() { snapToRight(round + 1); }, 150); }
          } else {
            uiLog('INFO', '贴边OK#' + round + ' => gap=' + gap.toFixed(1) + 'px（无需调整）');
          }
        } catch (e) {
          uiLog('ERROR', '贴边校正异常：' + e.message);
        }
      });
      return;
    }

    // 兜底（无 system.display 权限时）：用 window.screen（单屏可用）
    const screenW = window.screen.width;
    const curRight = window.screenX + window.outerWidth;
    const gap = screenW - curRight;
    uiLog('INFO', '贴边检测#' + round + ' => 屏幕宽=' + screenW + ' 窗口右=' + curRight + ' gap=' + gap.toFixed(1) + 'px (screenX=' + window.screenX + ' outerW=' + window.outerWidth + ')');
    if (Math.abs(gap) > 3) {
      const newLeft = Math.round(window.screenX + gap);
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left: newLeft });
      uiLog('INFO', '贴边校正#' + round + ' => 左=' + newLeft);
      if (round < 3) { setTimeout(function() { snapToRight(round + 1); }, 150); }
    } else {
      uiLog('INFO', '贴边OK#' + round + ' => gap=' + gap.toFixed(1) + 'px');
    }
  } catch (e) {
    uiLog('ERROR', '贴边校正异常：' + e.message);
  }
}

// 窗口刷新消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'alertRefresh') render();
});

// 初始化流程：应用外观 -> 渲染 -> 多次贴边+高度校正
(async () => {
  await applyAppearance();
  render();
  // 分 5 个时间点调用，每个时间点的 snapToRight 内部还会做最多 3 轮闭环校正
  setTimeout(function() { snapToRight(1); resizeToContent(); }, 60);
  setTimeout(function() { snapToRight(1); resizeToContent(); }, 250);
  setTimeout(function() { snapToRight(1); resizeToContent(); }, 600);
  setTimeout(function() { snapToRight(1); resizeToContent(); }, 1200);
  setTimeout(function() { snapToRight(1); resizeToContent(); }, 2000);
})();
