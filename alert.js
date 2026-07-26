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

// ── CJK 安全截断：按实际渲染行数截断，保证不切半个字 ──
// 原理：用 canvas 测量文本实际渲染宽度，逐字符试探找到恰好不超过
// maxLines 行的截断点。对 CJK 字符（每个约 1em 宽）特别精确。
function truncateTextToLines(text, maxLines) {
  if (!text) return '';
  const MAX_WIDTH = 368; // .summary 容器实际可用宽度（440 - padding*2 - avatar - gap ≈ 368）
  const LINE_HEIGHT_EM = 1.5; // summary 的 line-height
  const FONT = '12px "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif';

  // 创建离屏 canvas 用于测量文字宽度
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = FONT;

  // 逐字符构建，每行结束后检查是否超出
  let lines = [];
  let currentLine = '';
  let currentWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const charWidth = ctx.measureText(ch).width;

    if (currentWidth + charWidth > MAX_WIDTH && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = ch;
      currentWidth = charWidth;
      if (lines.length >= maxLines) break;
    } else {
      currentLine += ch;
      currentWidth += charWidth;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // 如果原文不需要截断（行数 ≤ maxLines），返回原文
  if (lines.length <= maxLines && !text.slice(lines.join('').length).trim()) {
    return text;
  }

  // 截断：保留 maxLines 行的内容，末尾加省略号
  let result = lines.slice(0, maxLines).join('');
  // 确保省略号不会让最后一行溢出
  const ellipsisWidth = ctx.measureText('…').width;
  while (result.length > 0 && ctx.measureText(result.split('\n').pop() + '…').width > MAX_WIDTH) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

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
    const MIN = 240, MAX = 540;
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

    merged.forEach(g => {
      const latest = g.posts[0];
      const row = document.createElement('div');
      row.className = 'row';
      const multi = g.posts.length > 1;
      // 摘要文字用 JS 做 CJK 安全截断（不切半字）
      const truncatedSummary = esc(truncateTextToLines(latest.text || '', isInbox ? 1 : 2));
      row.innerHTML =
        `<div class="avatar" style="background:${colorFor(g.name)}">${esc(initialOf(g.name))}</div>` +
        `<div class="body">` +
        `<div class="row1"><span class="name">${esc(g.name)}</span>` +
        (multi ? `<span class="badge">${g.posts.length}</span>` : '') +
        `</div>` +
        `<div class="summary" data-raw="${esc(latest.text || '').replace(/"/g, '&quot;')}">${truncatedSummary}</div>` +
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
  } catch (e) {}
}

// ═══════════════════════════════════════════════════
// 贴边精校（闭环校正版）
//
// v1.4.5 改进：设完位置后延迟 150ms 重测，若仍有间隙则递归再校，
// 最多 3 轮（覆盖 Chrome DWM / 窗口管理器异步调整的时序问题）。
// ═══════════════════════════════════════════════════
function snapToRight(round) {
  round = round || 1;
  try {
    const screenW = window.screen.width;
    const curRight = window.screenX + window.outerWidth;
    const gap = screenW - curRight;

    uiLog('INFO', '贴边检测#' + round + ' => 屏幕宽=' + screenW + ' 窗口右=' + curRight + ' gap=' + gap.toFixed(1) + 'px (screenX=' + window.screenX + ' outerW=' + window.outerWidth + ')');

    if (gap > 3) {
      const newLeft = Math.round(window.screenX + gap);
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left: newLeft });
      uiLog('INFO', '贴边校正#' + round + ' => 左=' + newLeft + ' (右移+' + Math.round(gap) + 'px)');
      // 闭环验证：150ms 后再测，还有间隙就继续推
      if (round < 3) { setTimeout(function() { snapToRight(round + 1); }, 150); }
    } else if (gap < -5) {
      const newLeft = Math.round(window.screenX + gap);
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left: newLeft });
      uiLog('INFO', '贴边回正#' + round + ' => 左=' + newLeft + ' (左移' + Math.round(gap) + 'px)');
      if (round < 3) { setTimeout(function() { snapToRight(round + 1); }, 150); }
    } else {
      uiLog('INFO', '贴边OK#' + round + ' => gap=' + gap.toFixed(1) + 'px（无需调整）');
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
