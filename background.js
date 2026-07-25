// background.js — Manifest V3 service worker
// 负责：定时轮询雪球特别关注分组 → 比对新帖 → 弹系统通知

const XQ_BASE = 'https://xueqiu.com';

// ---------- 运行日志（持久化到 storage，供诊断导出） ----------
// 设计：
//   - INFO / WARN 进滚动缓冲 logBuf（上限 LOG_MAX），高频轮询也不至于无限增长；
//   - ERROR 进永久缓冲 errBuf，不设定上限、不被覆盖，一直保留；
//   - 用户「复制日志」后调用 clearErrors() 把 errBuf 清空（已交出去，无需再留）；
//   - service worker 每次冷启动把上次持久化的两部分都读回内存，跨重启不丢。
const LOG_KEY = 'runLog';
const LOG_ERR_KEY = 'runLogErrors';
const LOG_MAX = 300;          // INFO/WARN 最多保留最近 300 条
const logBuf = [];            // INFO / WARN 滚动缓冲
const errBuf = [];            // ERROR 永久保留（复制日志后清空）
let logFlushTimer = null;

function safeStr(x) {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return x.stack || (x.message || String(x));
  try { return JSON.stringify(x); } catch (e) { return String(x); }
}

function pushLog(level, args) {
  const msg = args.map(safeStr).join(' ');
  const entry = { t: Date.now(), level, msg };
  // ERROR 永久保留，其余进滚动缓冲
  if (level === 'ERROR') errBuf.push(entry);
  else {
    logBuf.push(entry);
    if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
  }
  // 同步输出到后台控制台（开发者工具里也看得到）
  console.log(`[雪球监控][${level}]`, ...args);
  // 错误立即落盘，其余防抖落盘，减少 storage 写入频率
  if (level === 'ERROR') flushLog();
  else scheduleLogFlush();
}

function log(...a) { pushLog('INFO', a); }
function logWarn(...a) { pushLog('WARN', a); }
function logErr(...a) { pushLog('ERROR', a); }

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLog(); }, 1000);
}

async function flushLog() {
  try {
    await chrome.storage.local.set({ [LOG_KEY]: logBuf.slice(), [LOG_ERR_KEY]: errBuf.slice() });
  } catch (e) { /* 写入失败忽略，下次再试 */ }
}

// 合并返回（按时间排序），ERROR 与 INFO/WARN 交错在一条时间线里
async function getLog() {
  const all = errBuf.concat(logBuf);
  all.sort((a, b) => a.t - b.t);
  return all;
}

// 复制日志后调用：只清 ERROR 永久缓冲，INFO/WARN 滚动日志保留
async function clearErrors() {
  if (!errBuf.length) return;
  errBuf.length = 0;
  try { await chrome.storage.local.set({ [LOG_ERR_KEY]: [] }); } catch (e) {}
}

// 手动「🗑 清空」按钮：两部分都清
async function clearLog() {
  logBuf.length = 0; errBuf.length = 0;
  try { await chrome.storage.local.set({ [LOG_KEY]: [], [LOG_ERR_KEY]: [] }); } catch (e) {}
}

// 冷启动：把上次持久化的日志读回内存，保持连续
(async () => {
  try {
    const stored = await chrome.storage.local.get([LOG_KEY, LOG_ERR_KEY]);
    const saved = stored[LOG_KEY];
    if (Array.isArray(saved) && saved.length) {
      for (const e of saved) logBuf.push(e);
      if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
    }
    const savedErr = stored[LOG_ERR_KEY];
    if (Array.isArray(savedErr) && savedErr.length) {
      for (const e of savedErr) errBuf.push(e);
    }
  } catch (e) {}
})();

// ═══════════════════════════════════════════════════════════════
// 请求路径优先级（从最稳到兜底）：
//   ① scripting 注入（主路径）—— 用 chrome.scripting.executeScript 在已打开的
//      雪球标签页里临时注入 fetch，随用随注入，不需要用户去 F5 刷新页面，
//      浏览器自动带该标签页的全部 Cookie（含 httpOnly）。最稳、零操作。
//
//   ② Content Script 路径 —— 若标签页已注入 content.js（页面加载/刷新后），
//      直接 sendMessage 代发，比 ① 少一次注入开销，更快。标签页未刷新时
//      会报 "Receiving end does not exist"，此时自动回退 ①，无影响。
//
//   ③ 显式 Cookie 注入 —— 用户手动粘贴 / chrome.cookies 读取的 Cookie，
//      作为没有任何雪球标签页时的备用。
// ═══════════════════════════════════════════════════════════════

// tabs.sendMessage 没有原生 timeout 参数（options 只认 {frameId}），
// 用 setTimeout 自己加一个超时，避免 content script 不响应时卡死。
async function sendMessageWithTimeout(tabId, msg, ms = 6000) {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) { settled = true; throw new Error('content script 无响应（超时）'); }
  }, ms);
  try {
    const r = await chrome.tabs.sendMessage(tabId, msg);
    if (!settled) { settled = true; clearTimeout(timer); return r; }
  } catch (e) {
    if (!settled) { settled = true; clearTimeout(timer); throw e; }
  }
}

// ① Content Script 路径：通过消息让雪球页面内的 content.js 代发请求
async function apiViaContentScript(url) {
  if (!chrome.tabs || !chrome.runtime.sendMessage) return null;
  const tabs = await chrome.tabs.query({ url: 'https://xueqiu.com/*', status: 'complete' });
  const tab = tabs && tabs[0];
  if (!tab) return null; // 没有已加载完的雪球标签页

  try {
    // 发消息给目标标签页的 content script（content.js 监听 'xqFetch' 消息）
    const resp = await sendMessageWithTimeout(tab.id, { type: 'xqFetch', url });
    if (!resp || !resp.ok) return null;
    return { status: resp.status, text: resp.text };
  } catch (e) {
    // 标签页可能还没注入 content script（扩展刚装/刷新），或页面导航中
    log('content script 路径失败：', e.message);
    return null;
  }
}

// ② 显式 Cookie 注入路径
async function getXueqiuCookies() {
  try {
    if (chrome.cookies && chrome.cookies.getAll) {
      let cookies = await chrome.cookies.getAll({ url: 'https://xueqiu.com' });
      if (!cookies || !cookies.length) {
        cookies = await chrome.cookies.getAll({ domain: 'xueqiu.com' });
      }
      if (cookies && cookies.length) {
        const map = {};
        for (const c of cookies) map[c.name] = c.value;
        return Object.keys(map).map(k => `${k}=${map[k]}`).join('; ');
      }
    }
  } catch (e) {}
  try {
    const stored = await chrome.storage.local.get('xqCookie');
    if (stored.xqCookie) return stored.xqCookie;
  } catch (e) {}
  return '';
}

async function fetchWithCookie(url, opts, cookieHeader) {
  const headers = Object.assign({
    'User-Agent': navigator.userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://xueqiu.com/',
    'X-Requested-With': 'XMLHttpRequest',
  }, opts.headers || {});
  headers['Cookie'] = cookieHeader;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
  });
  if (res.status === 429) throw new Error('触发限流 429，请稍后重试');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const data = safeParseJSON(text, url);
  if (data && data.error_code) {
    const desc = data.error_description || data.message || '';
    throw new Error(`雪球返回错误码 ${data.error_code}${desc ? '：' + desc : ''}`);
  }
  return data;
}

// ③ scripting 注入借标签页（最后兜底）
async function apiViaTab(url, opts = {}) {
  if (!chrome.scripting || !chrome.tabs) return null;
  let tabs = await chrome.tabs.query({ url: 'https://xueqiu.com/*' });
  let tab = tabs && tabs[0];
  if (!tab) {
    if (!opts.ensureTab) return null;
    tab = await chrome.tabs.create({ url: 'https://xueqiu.com/', active: false });
    await waitTabComplete(tab.id);
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (u) => {
      return fetch(u, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Referer': 'https://xueqiu.com/',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/plain, */*',
        },
      }).then(r => r.text().then(t => ({ ok: true, status: r.status, text: t })))
        .catch(e => ({ ok: false, err: String(e) }));
    },
    args: [url],
  });
  const r = results && results[0] && results[0].result;
  if (!r || !r.ok) return null;
  return r;
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t && t.status === 'complete') { clearInterval(timer); resolve(true); return; }
      } catch (e) {}
      if (Date.now() - t0 > 8000) { clearInterval(timer); resolve(false); }
    }, 300);
  });
}

function safeParseJSON(text, url) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('返回的不是 JSON（可能被重定向到登录页）');
  }
}

// ─── 统一入口：按优先级尝试各路径 ───
async function fetchJSON(url, opts = {}) {
  // ① scripting 注入（主路径：随用随注入，无需刷新标签页，最稳）
  if (opts.viaTab !== false) {
    log('取数路径① 尝试 scripting 注入：', url);
    try {
      const r = await apiViaTab(url, opts);
      if (r) {
        if (r.status === 429) throw new Error('触发限流 429，请稍后重试');
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const data = safeParseJSON(r.text, url);
        if (data && data.error_code) {
          const desc = data.error_description || data.message || '';
          throw new Error(`雪球返回错误码 ${data.error_code}${desc ? '：' + desc : ''}`);
        }
        log('取数路径① 成功（scripting 注入）', url);
        return data; // ✅ 成功！走的是雪球标签页内注入的 fetch
      }
    } catch (e) {
      // 网络层错误（限流 / HTTP）→ 直接抛出，不回退
      if (/429|HTTP \d/.test(e.message)) throw e;
      // 业务层错误（未登录 / 解析失败）→ 同一用户登录态一致，回退无意义，直接抛出
      if (/错误码|不是 JSON|重定向/.test(e.message)) throw e;
      logWarn('scripting 路径不可用，回退…', e.message);
    }
  }

  // ② Content Script 路径（标签页已注入 content.js 时更快）
  if (opts.viaContent !== false) {
    log('取数路径② 尝试 content script：', url);
    try {
      const r = await apiViaContentScript(url);
      if (r) {
        if (r.status === 429) throw new Error('触发限流 429，请稍后重试');
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        const data = safeParseJSON(r.text, url);
        if (data && data.error_code) {
          const desc = data.error_description || data.message || '';
          throw new Error(`雪球返回错误码 ${data.error_code}${desc ? '：' + desc : ''}`);
        }
        log('取数路径② 成功（content script）', url);
        return data;
      }
    } catch (e) {
      if (/429|HTTP \d/.test(e.message)) throw e;
      if (/错误码|不是 JSON|重定向/.test(e.message)) throw e;
      logWarn('content script 路径不可用，回退…', e.message);
    }
  }

  // ③ 显式 Cookie 注入（用户粘贴的 / chrome.cookies 读到的）
  const cookieHeader = await getXueqiuCookies();
  if (cookieHeader) {
    log('取数路径③ 使用 Cookie 注入：', url);
    return fetchWithCookie(url, opts, cookieHeader);
  }

  // 全部失败
  throw new Error(
    '无法获取登录态。请确保：\n' +
    '1. Chrome 已打开并登录 xueqiu.com（保持至少一个雪球标签页打开）\n' +
    '2. 扩展已拥有「标签页 / 脚本」权限（chrome://extensions 里检查）\n' +
    '3. 或在设置页手动粘贴 Cookie（F12 → Network → 复制 Cookie 整行）'
  );
}

// ---------- 诊断：逐条测试登录态获取的每一个环节，收集日志 ----------
// 返回结构化报告，供设置页「一键诊断」展示，定位"获取不到"的根因。
async function diagnose() {
  const report = { env: {}, steps: [], ts: new Date().toLocaleString() };

  report.env = {
    hasTabs: !!chrome.tabs,
    hasCookies: !!chrome.cookies,     // 当前 manifest 未声明 cookies 权限时为 false
    hasScripting: !!chrome.scripting,
  };

  // ① 列出所有雪球标签页
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: 'https://xueqiu.com/*' }); }
  catch (e) { tabs = []; }
  report.steps.push({
    step: '① 查询雪球标签页',
    ok: true,
    count: tabs.length,
    tabs: tabs.map(t => ({ id: t.id, status: t.status, url: t.url })),
  });

  // ② 逐个测试 content script 是否响应（关键路径）
  if (!tabs.length) {
    report.steps.push({
      step: '② content script 测试', ok: false,
      error: '没有任何 xueqiu.com 标签页打开',
      hint: '请先在 Chrome 打开并登录 xueqiu.com',
    });
  }
  for (const tab of tabs) {
    try {
      const resp = await sendMessageWithTimeout(
        tab.id,
        { type: 'xqFetch', url: `${XQ_BASE}/friendships/groups.json?_diag=1` },
        6000
      );
      const text = resp ? String(resp.text || '') : '';
      let verdict = 'ok';
      if (resp && resp.status && resp.status !== 200) verdict = 'HTTP ' + resp.status;
      if (/error_code|请.{0,4}登录|重新登录|登录帐号/.test(text)) verdict = '返回未登录(雪球要求重新登录)';
      if (/<html|<!doctype/i.test(text.slice(0, 60))) verdict = '返回的是 HTML（可能被反爬拦截，非 JSON）';
      report.steps.push({
        step: `② content script 标签页#${tab.id}（状态:${tab.status}）`,
        ok: !!(resp && resp.ok),
        status: resp && resp.status,
        verdict,
        preview: text.slice(0, 400),
      });
    } catch (e) {
      let hint = 'content script 未注入 —— 请在 xueqiu.com 标签页按 F5 刷新，让扩展脚本生效';
      if (/无响应|超时/.test(e.message)) hint = 'content script 无响应 —— 请刷新 xueqiu.com 标签页，或关闭该标签页重新打开 xueqiu.com';
      else if (/Receiving end/.test(e.message)) hint = 'content script 未注入（扩展刚加载 / 页面未刷新）—— 可忽略：只要下方 ②b scripting 路径成功，本步失败不影响使用，无需 F5';
      report.steps.push({
        step: `② content script 标签页#${tab.id}（状态:${tab.status}）`,
        ok: false,
        error: e.message,
        hint,
      });
    }
  }

  // ②b 直接用 scripting 注入测试（主路径，与 content script 对比）
  if (tabs.length) {
    try {
      const r = await apiViaTab(`${XQ_BASE}/friendships/groups.json`);
      let gCount = 0, hasSpecial = false, names = [];
      if (r && r.text) {
        try {
          const arr = JSON.parse(r.text);
          const groups = Array.isArray(arr) ? arr : (arr.groups || []);
          gCount = groups.length;
          hasSpecial = groups.some(g => g.special || (g.name || '').toLowerCase().includes('特别关注'));
          names = groups.map(g => g.name);
        } catch (e) {}
      }
      report.steps.push({
        step: '②b scripting 注入路径（主路径）',
        ok: !!(r && r.status === 200),
        status: r && r.status,
        groupCount: gCount,
        hasSpecialFollow: hasSpecial,
        groupNames: names,
        preview: r ? String(r.text || '').slice(0, 160) : '',
      });
    } catch (e) {
      report.steps.push({ step: '②b scripting 注入路径', ok: false, error: e.message });
    }
  }

  // ③ chrome.cookies
  try {
    if (chrome.cookies) {
      const cs = await chrome.cookies.getAll({ url: 'https://xueqiu.com' });
      report.steps.push({
        step: '③ chrome.cookies 读取',
        ok: true, count: cs.length,
        hasToken: cs.some(c => c.name === 'xq_a_token'),
        names: cs.map(c => c.name),
      });
    } else {
      report.steps.push({
        step: '③ chrome.cookies 读取', ok: false,
        error: 'chrome.cookies 不可用（manifest 未声明 cookies 权限）',
      });
    }
  } catch (e) {
    report.steps.push({ step: '③ chrome.cookies 读取', ok: false, error: e.message });
  }

  // ④ 手动粘贴的 Cookie
  try {
    const s = await chrome.storage.local.get('xqCookie');
    report.steps.push({
      step: '④ 手动粘贴 Cookie',
      ok: !!s.xqCookie, hasCookie: !!s.xqCookie,
      len: s.xqCookie ? s.xqCookie.length : 0,
    });
  } catch (e) {}

  // ⑤ 真正跑一次完整 fetchJSON（friendships/groups.json，兼做登录探针）
  try {
    const data = await fetchJSON(`${XQ_BASE}/friendships/groups.json`);
    const groupsArr = Array.isArray(data) ? data : (data.groups || []);
    report.steps.push({
      step: '⑤ 完整 fetchJSON（friendships/groups.json）',
      ok: true, groupCount: groupsArr.length,
    });
  } catch (e) {
    report.steps.push({ step: '⑤ 完整 fetchJSON', ok: false, error: e.message });
  }

  return report;
}

async function getOptions() {
  const def = { intervalMin: 2, manualUsers: '', soundOn: false, wecom: { enabled: false, corpid: '', corpsecret: '', agentid: '', touser: '' } };
  const stored = await chrome.storage.local.get('options');
  return Object.assign(def, stored.options || {});
}

// ---------- 取特别关注分组 ----------
async function getSpecialFollowUsers(opts = {}) {
  try {
    const data = await fetchJSON(`${XQ_BASE}/friendships/groups.json`, opts);
    // 注意：该接口登录后返回的是【顶层数组】 [group, group, ...]（未登录才返回 {error_code}）
    const groups = Array.isArray(data) ? data : (data.groups || []);
    if (!groups.length) return null;

    let target = null;
    for (const g of groups) {
      const name = (g.name || '').toLowerCase();
      if (g.special || name.includes('特别关注') || name.includes('special')) {
        target = g;
        break;
      }
    }
    if (!target) return null; // 没有特别关注分组

    // 部分账号 groups[].users 直接带成员
    if (Array.isArray(target.users) && target.users.length) {
      return target.users.map(u => ({ id: String(u.id), name: u.screen_name || u.name || '' }));
    }
    // 否则拉成员列表（members 接口也兼容顶层数组 / {users} 两种形态）
    const gid = target.id;
    const m = await fetchJSON(`${XQ_BASE}/friendships/groups/members.json?gid=${gid}`);
    const users = Array.isArray(m) ? m : (m.users || (m.groups && m.groups[0] && m.groups[0].users) || []);
    return users.map(u => ({ id: String(u.id), name: u.screen_name || u.name || '' }));
  } catch (e) {
    logErr('取特别关注失败：', e.message);
    return null;
  }
}

// ---------- 取某用户时间线 ----------
// 雪球不同版本接口返回的时间线字段名不一致（旧版 statuses / v4 可能是 list/items/data），
// 这里统一兼容；v4 是当前活接口，放前面优先，旧接口兜底。
function extractStatuses(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.statuses)) return data.statuses;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.items)) return data.items;
  if (data.data) {
    const dd = data.data;
    if (Array.isArray(dd.statuses)) return dd.statuses;
    if (Array.isArray(dd.list)) return dd.list;
    if (Array.isArray(dd.items)) return dd.items;
  }
  if (Array.isArray(data)) return data;
  return [];
}

async function getUserTimeline(userId, page = 1) {
  const urls = [
    `${XQ_BASE}/v4/statuses/user_timeline.json?user_id=${userId}&page=${page}&count=10`,
    `${XQ_BASE}/statuses/user_timeline.json?user_id=${userId}&page=${page}&count=10`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const data = await fetchJSON(u);
      return extractStatuses(data);
    } catch (e) {
      lastErr = e;
      if (/400016|请登录|重新登录|error_code/.test(e.message)) throw e; // 登录类错误，没必要再试
    }
  }
  throw lastErr || new Error('时间线获取失败');
}

// ---------- 工具 ----------
function parseManualUsers(str) {
  if (!str) return [];
  return String(str).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    .map(id => ({ id: String(id), name: '' }));
}

function postUrl(userId, postId) {
  return `${XQ_BASE}/${userId || '0'}/${postId}`;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// ---------- 测试提醒（验证 系统通知 / 弹窗 / 声音 链路）----------
async function testNotify() {
  const ts = Date.now();
  const post = {
    id: 'test-' + ts,
    text: '这是一条<b>测试提醒</b>：看到右侧滑入的「特别关注」窗口即说明链路正常。\n点击本卡片可标记已读，全部读完窗口自动关闭。',
    user: { id: '0', screen_name: '雪球特别关注' },
    _name: '雪球特别关注（测试）',
  };
  // 1. 系统通知
  await notifyNewPosts([post]);
  // 2. 提示音（需在设置页开启）
  const opts = await getOptions();
  if (opts.soundOn) await playAlertSound();
  // 3. 把测试帖写入 recent（未读），让弹窗有内容可显示、可点掉
  const { recent } = await chrome.storage.local.get(['recent']);
  const items = recent || [];
  items.unshift({ id: post.id, userId: '0', name: post._name, text: stripHtml(post.text), ts });
  if (items.length > 50) items.length = 50;
  await chrome.storage.local.set({ recent: items });
  await noteNewPostsArrived();
  // 4. 弹窗（此时 recent 已有这条未读，render 能正常渲染，不会闪关）
  await openAlertWindow();
  return { ok: true };
}

// ---------- 通知 ----------
async function notifyNewPosts(posts) {
  log('生成系统通知 ×' + posts.length);
  for (const p of posts) {
    const text = stripHtml(p.text || '');
    const url = postUrl(p.user && p.user.id, p.id);
    const id = 'xq-' + p.id;
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: `🔥 ${p._name || '雪球博主'} 发了新帖`,
      message: truncate(text, 220),
      priority: 2,            // 高优先级
      requireInteraction: true, // 不自动消失，需手动关闭/点击
      buttons: [{ title: '打开原帖' }],
    }, () => {
      chrome.storage.local.get('urlMap', ({ urlMap }) => {
        const m = urlMap || {};
        m[id] = url;
        chrome.storage.local.set({ urlMap: m });
      });
    });
  }
  await pushWecom(posts);
}

// ---------- 企业微信自建应用推送 ----------
// 配置存于 options.wecom：{ enabled, corpid, corpsecret, agentid, touser }
// 凭证仅存本机 chrome.storage.local，不上传任何服务器。
const WECOM_API = 'https://qyapi.weixin.qq.com';
const WECOM_TOKEN_KEY = 'wecomToken';

async function getWecomToken(cfg) {
  try {
    const cached = await chrome.storage.local.get(WECOM_TOKEN_KEY);
    const t = cached[WECOM_TOKEN_KEY];
    // 提前 5 分钟视为过期，避免临界点用到失效 token
    if (t && t.token && t.expireAt > Date.now() + 5 * 60 * 1000) return t.token;
  } catch (e) {}

  const url = `${WECOM_API}/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpid)}&corpsecret=${encodeURIComponent(cfg.corpsecret)}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (data.errcode !== 0) throw new Error(`企微获取 access_token 失败（${data.errcode}：${data.errmsg || ''}）`);
  const token = { token: data.access_token, expireAt: Date.now() + (data.expires_in || 7200) * 1000 };
  try { await chrome.storage.local.set({ [WECOM_TOKEN_KEY]: token }); } catch (e) {}
  return token.token;
}

async function sendWecomText(cfg, content) {
  const token = await getWecomToken(cfg);
  const url = `${WECOM_API}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: cfg.touser && cfg.touser.trim() ? cfg.touser.trim() : '@all',
    msgtype: 'text',
    agentid: Number(cfg.agentid),
    text: { content },
    safe: 0,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (data.errcode !== 0) throw new Error(`企微发送失败（${data.errcode}：${data.errmsg || ''}）`);
  return data;
}

async function pushWecom(posts) {
  const opts = await getOptions();
  const cfg = opts.wecom;
  if (!cfg || !cfg.enabled) return;
  if (!cfg.corpid || !cfg.corpsecret || !cfg.agentid) {
    logWarn('企微推送未配置完整（需 corpid / corpsecret / agentid），已跳过。请在设置页④填写');
    return;
  }
  try {
    for (const p of posts) {
      const text = stripHtml(p.text || '');
      const url = postUrl(p.user && p.user.id, p.id);
      const content = `【雪球·特别关注】${p._name || '博主'} 发了新帖：\n${truncate(text, 400)}\n\n查看原帖：${url}`;
      await sendWecomText(cfg, content);
    }
    log('企微推送 ×' + posts.length + ' 条已发送');
  } catch (e) {
    logErr('企微推送失败：' + e.message);
  }
}

// ---------- 声音（Offscreen Document 播放，Chrome 最小化也响） ----------
let offscreenReady = false;
async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  if (offscreenReady) return true;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: '播放雪球新帖提示音',
    });
    offscreenReady = true;
    return true;
  } catch (e) {
    // 文档已存在等错误都视为可用
    if (/exist/i.test(e.message || '')) { offscreenReady = true; return true; }
    logErr('离屏文档创建失败：', e.message);
    return false;
  }
}
async function playAlertSound() {
  const ok = await ensureOffscreen();
  if (!ok) return;
  try { await chrome.runtime.sendMessage({ type: 'beep' }); }
  catch (e) { /* 离屏文档未就绪，忽略 */ }
}
async function closeOffscreen() {
  if (chrome.offscreen && chrome.offscreen.closeDocument) {
    try { await chrome.offscreen.closeDocument(); } catch (e) {}
  }
  offscreenReady = false;
}

// ---------- 弹窗（贴屏幕右边缘 + 浏览器内容区下方） ----------
// 用「窗口集合 + 真实扫描」维护，而非单一内存变量。
// 原因：MV3 的 service worker 会被系统频繁重启，内存变量会归零，
// 但上一辈子 SW 开出来的弹窗仍开着 → 新 SW 误以为没窗口又新建，
// 半小时就能堆出几十个孤儿窗口。扫描当前真实窗口可跨 SW 重启复用。
const alertWinIds = new Set();

// 找当前还活着的 alert 弹窗（优先集合，兜底扫全部 popup）
async function findExistingAlertWin() {
  for (const id of [...alertWinIds]) {
    try {
      const win = await chrome.windows.get(id, { populate: false });
      if (win) return win;
      alertWinIds.delete(id);
    } catch (e) { alertWinIds.delete(id); }
  }
  try {
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    const myId = chrome.runtime.id;
    for (const w of all || []) {
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      if (url.indexOf('alert.html') !== -1 || (myId && url.indexOf(myId) !== -1 && url.indexOf('alert') !== -1)) {
        alertWinIds.add(w.id);
        return w;
      }
    }
  } catch (e) {}
  return null;
}

// 关掉所有 alert 弹窗：集合里的 + 兜底扫到的（覆盖 SW 重启遗留的孤儿窗口）
async function closeAllAlertWindows() {
  const ids = [...alertWinIds];
  for (const id of ids) { try { await chrome.windows.remove(id); } catch (e) {} }
  alertWinIds.clear();
  try {
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const w of all || []) {
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      if (url.indexOf('alert.html') !== -1) {
        try { await chrome.windows.remove(w.id); } catch (e) {}
      }
    }
  } catch (e) {}
}

// 拿主屏可用区域（横坐标用这个贴边）
async function getPrimaryDisplayBounds() {
  try {
    if (chrome.system && chrome.system.display && chrome.system.display.getInfo) {
      const infos = await chrome.system.display.getInfo();
      // 优先主屏，其次第一块
      const d = (infos || []).find(x => x.isPrimary) || (infos || [])[0];
      if (d && d.workArea) return d.workArea; // {left, top, width, height}
    }
  } catch (e) { /* 不可用走兜底 */ }
  return null;
}

// 拿到当前最前台的浏览器窗口（normal 类型）的位置与尺寸（纵坐标用这个对齐）
async function getActiveBrowserWindow() {
  try {
    let win = null;
    if (chrome.windows && chrome.windows.getLastFocused) {
      win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    }
    if (!win || !win.width) {
      const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
      win = (all || []).find(w => w.focused) || (all || [])[0];
    }
    return win || null;
  } catch (e) { return null; }
}

// 浏览器顶部 chrome（标签栏 + 地址栏 + 收藏夹栏）的高度估算
// 默认 Chrome：标签栏 ~36 + 地址栏 ~40 + 收藏夹栏 ~32 ≈ 108
// 实测有书签栏的环境需 ~145；多留点余量
const BROWSER_CHROME_HEIGHT = 150;

async function openAlertWindow() {
  try {
    // 关键修复：先真实扫描当前是否已有 alert 弹窗（跨 SW 重启也能复用），
    // 有就聚焦 + 重渲染，绝不新建第二个 → 杜绝堆出几十个窗口。
    const existing = await findExistingAlertWin();
    if (existing) {
      await chrome.windows.update(existing.id, { focused: true }).catch(() => {});
      try { await chrome.runtime.sendMessage({ type: 'alertRefresh' }); } catch (e) {}
      return;
    }
    const W = 360, H = 460;
    let left, top;

    // 横向：贴**屏幕**右边缘（不是浏览器窗口右边缘——浏览器可能没全屏）
    // 纵向：从**浏览器窗口**顶部 + chrome 高度开始（落在地址栏/书签栏下方）
    const area = await getPrimaryDisplayBounds();
    const browser = await getActiveBrowserWindow();
    if (area && browser) {
      left = area.left + area.width - W;           // 贴屏幕右 0px
      top = browser.top + BROWSER_CHROME_HEIGHT;   // 浏览器顶部 + 150（标签+地址+书签栏）
    } else if (area) {
      // 兜底：只有屏幕信息
      left = area.left + area.width - W - 16;
      top = area.top + 80;
    } else {
      left = undefined; top = undefined;
    }
    const createData = { url: 'alert.html', type: 'popup', width: W, height: H, focused: false };
    if (left !== undefined) { createData.left = Math.round(left); createData.top = Math.round(top); }
    const branch = area && browser ? '屏幕右+浏览器内容区下方' : (area ? '仅屏幕' : '默认');
    log('弹窗定位 → left=' + Math.round(left) + ' top=' + Math.round(top) + ' 策略:' + branch + ' (屏右=' + (area ? area.left + area.width : '?') + ' 浏览器top=' + (browser ? browser.top : '?') + ')');
    const w = await chrome.windows.create(createData);
    alertWinIds.add(w.id);
  } catch (e) {
    logErr('弹窗创建失败：', e.message);
  }
}
// 窗口被关闭时从集合移除（跨 SW 重启的孤儿窗口由扫描兜底处理）
chrome.windows.onRemoved.addListener(id => { alertWinIds.delete(id); });

// ---------- 已读管理 + 3分钟未读完重弹 ----------
// recent 每条结构：{ id, userId, name, text, ts, read }（read 默认 undefined=未读）

// 把某条帖子标记为已读；返回剩余未读数
async function markPostRead(postId) {
  const { recent } = await chrome.storage.local.get(['recent']);
  const items = recent || [];
  const it = items.find(x => String(x.id) === String(postId));
  if (it) it.read = true;
  await chrome.storage.local.set({ recent: items });
  return items.filter(x => !x.read).length;
}

// 未读数
async function unreadCount() {
  const { recent } = await chrome.storage.local.get(['recent']);
  return (recent || []).filter(x => !x.read).length;
}

// 3 分钟后若仍有未读 → 再弹一次（复用轮询 alarm 做检查，避免多定时器）
// 记录最近一次有新帖入列的时间
async function noteNewPostsArrived() {
  await chrome.storage.local.set({ lastNewPostAt: Date.now() });
}

const REPOP_MS = 3 * 60 * 1000; // 3 分钟
async function maybeRepopAlert() {
  const unread = await unreadCount();
  if (!unread) return;                       // 全读完了，不重弹
  const live = await findExistingAlertWin();
  if (live) return;                          // 窗口已开着（真实扫描），不重弹 → 复用而非新建
  const { lastNewPostAt } = await chrome.storage.local.get(['lastNewPostAt']);
  if (!lastNewPostAt) return;
  if (Date.now() - lastNewPostAt >= REPOP_MS) {
    log(`3 分钟已过仍有 ${unread} 条未读，重新弹出提醒窗口`);
    await openAlertWindow();
    // 重弹后更新计时起点，避免每轮轮询都弹（相当于再给你 3 分钟）
    await chrome.storage.local.set({ lastNewPostAt: Date.now() });
  }
}

// ---------- 主检查逻辑 ----------
async function checkOnce() {
  const opts = await getOptions();
  log('── 开始轮询检查（间隔', opts.intervalMin, '分钟）──');

  let users = await getSpecialFollowUsers();
  if (!users || !users.length) {
    users = parseManualUsers(opts.manualUsers); // 兜底：手动名单
  }
  if (!users || !users.length) {
    log('没有可监控的用户（特别关注为空且未配置手动名单）');
    await chrome.storage.local.set({ lastCheck: Date.now(), trackedCount: 0 });
    return;
  }

  const stored = await chrome.storage.local.get(['lastIds', 'initialized', 'recent']);
  const lastIds = stored.lastIds || {};
  const initialized = stored.initialized === true;
  const newAll = [];
  const perUser = {};
  let runError = '';

  for (const u of users) {
    try {
      const tl = await getUserTimeline(u.id);
      perUser[u.id] = { name: u.name, ok: true, parsed: tl.length };
      if (!tl.length) continue;
      const localMax = Number(lastIds[u.id] || 0);
      const fresh = tl.filter(s => Number(s.id) > localMax);
      if (fresh.length) {
        const maxId = tl.reduce((mx, s) => Math.max(mx, Number(s.id)), localMax);
        lastIds[u.id] = maxId;
        if (initialized) {
          fresh.sort((a, b) => Number(b.id) - Number(a.id)); // 新→旧
          newAll.push(...fresh.map(s => ({ ...s, _name: u.name, _id: u.id })));
        }
      }
    } catch (e) {
      log('时间线拉取失败', u.id, e.message);
      perUser[u.id] = { name: u.name, ok: false, error: e.message };
      runError = runError || e.message;
    }
  }

  await chrome.storage.local.set({
    lastIds,
    lastCheck: Date.now(),
    lastRunAt: Date.now(),
    initialized: true,
    trackedCount: users.length,
    perUser,
    lastError: runError,
  });

  // 每用户抓取结果摘要（便于诊断"某人不提醒"）
  for (const u of users) {
    const pu = perUser[u.id];
    if (pu && pu.ok) log('  抓取', pu.name || u.id, '→', pu.parsed, '条时间线');
    else if (pu) logWarn('  抓取', pu.name || u.id, '失败：', pu.error);
  }

  let recent = stored.recent || [];
  if (newAll.length) {
    log('发现', newAll.length, '条新帖，发送系统通知 + 弹窗');
    await notifyNewPosts(newAll);                       // 系统通知
    if (opts.soundOn) await playAlertSound();           // 提示音（需用户在设置里开启）
    await openAlertWindow();                            // 弹出小窗口
    for (const p of newAll) {
      recent.unshift({ id: p.id, userId: p._id, name: p._name, text: stripHtml(p.text || ''), ts: Date.now() });
    }
    await noteNewPostsArrived();                        // 记录新帖到达时间（用于3分钟重弹）
  }
  if (recent.length > 50) recent.length = 50;
  if (newAll.length) await chrome.storage.local.set({ recent });

  // 每次轮询顺带检查：3 分钟未读完是否该重弹
  await maybeRepopAlert();

  log('── 检查完成，本次新帖：', newAll.length, '｜监控', users.length, '人 ──');
}

// ---------- 定时器 ----------
function scheduleAlarm(min) {
  const m = Math.min(60, Math.max(1, Number(min) || 2));
  chrome.alarms.clear('poll', () => {
    chrome.alarms.create('poll', { periodInMinutes: m });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const opts = await getOptions();
  log('扩展已安装/更新，调度轮询（间隔', opts.intervalMin, '分钟），立即首跑');
  scheduleAlarm(opts.intervalMin);
  checkOnce(); // 首次立即跑一次（只记录不推送）
});

chrome.runtime.onStartup.addListener(() => {
  log('浏览器启动，检查/重建轮询');
  chrome.alarms.get('poll', (a) => {
    if (!a) getOptions().then(o => scheduleAlarm(o.intervalMin));
  });
  checkOnce();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') { log('alarm 触发：开始轮询'); checkOnce(); }
});

// ---------- 通知点击 / 按钮 ----------
function openPost(nid) {
  chrome.storage.local.get('urlMap', ({ urlMap }) => {
    const url = urlMap && urlMap[nid];
    if (url) chrome.tabs.create({ url });
    chrome.notifications.clear(nid);
  });
}
chrome.notifications.onClicked.addListener(openPost);
chrome.notifications.onButtonClicked.addListener(openPost);

// （弹窗 onRemoved 监听已在上文 openAlertWindow 处注册，此处不再重复）

// ---------- 与弹窗/选项页通信 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getLog') {
    getLog().then(entries => sendResponse({ ok: true, entries }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'clearLog') {
    clearLog().then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'clearErrors') {
    clearErrors().then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'checkNow') {
    checkOnce().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'getStatus') {
    chrome.storage.local.get(['lastCheck', 'recent', 'trackedCount', 'perUser', 'lastError', 'lastRunAt', 'initialized'], d => sendResponse(d));
    return true;
  }
  if (msg.type === 'testWecom') {
    // 设置页「测试企微推送」按钮：发一条测试文本，验证 corpid/secret/agentid/touser 是否可用
    getOptions().then(opts => {
      const cfg = msg.cfg || opts.wecom;
      if (!cfg || !cfg.enabled) { sendResponse({ ok: false, err: '企微推送未开启，请先在④勾选「启用」' }); return; }
      if (!cfg.corpid || !cfg.corpsecret || !cfg.agentid) { sendResponse({ ok: false, err: '企微配置不完整（需 corpid / corpsecret / agentid）' }); return; }
      sendWecomText(cfg, '【雪球·特别关注】这是一条测试推送 ✅\n若你在微信里收到本条，说明配置成功。')
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, err: e.message }));
    }).catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'saveOptions') {
    chrome.storage.local.set({ options: msg.options }).then(() => {
      scheduleAlarm(msg.options.intervalMin);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'apiGet') {
  // 选项页代理请求：走统一入口 fetchJSON（自动按 scripting 注入 > content script > Cookie 注入 选最佳路径）
  fetchJSON(msg.url).then(data => {
    sendResponse({ ok: true, data, method: '自动（scripting 注入 / content script / Cookie 注入）' });
  }).catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'testNotify') {
    testNotify().then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'markRead') {
    // 弹窗里点了某条帖子 → 标记已读，返回剩余未读数
    markPostRead(msg.postId).then(left => sendResponse({ ok: true, left }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'markAllRead') {
    // 弹窗「全部已读」按钮：把 recent 里所有未读条目标记为已读
    (async () => {
      try {
        const { recent } = await chrome.storage.local.get(['recent']);
        const items = recent || [];
        let count = 0;
        for (const it of items) { if (!it.read) { it.read = true; count++; } }
        await chrome.storage.local.set({ recent: items });
        log('全部已读：标记', count, '条');
        sendResponse({ ok: true, marked: count });
      } catch (e) {
        sendResponse({ ok: false, err: e.message });
      }
    })();
    return true;
  }
  if (msg.type === 'closeAllAlerts') {
    // 弹窗「全部已读」按钮：标记全部已读 + 关掉所有 alert 弹窗（含跨 SW 孤儿窗口）
    (async () => {
      try {
        const { recent } = await chrome.storage.local.get(['recent']);
        const items = recent || [];
        let count = 0;
        for (const it of items) { if (!it.read) { it.read = true; count++; } }
        await chrome.storage.local.set({ recent: items });
        log('全部已读并关闭所有弹窗：标记', count, '条');
      } catch (e) { logErr('closeAllAlerts 标记已读失败：', e.message); }
      await closeAllAlertWindows();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.type === 'closeAllAlertWindows') {
    // 仅关闭所有 alert 弹窗（不标记已读），供「关闭」按钮清理残留窗口
    closeAllAlertWindows().then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'uiLog') {
    // 弹窗页面里记回来的交互日志（如「点击卡片打开原帖」）
    if (msg.level === 'ERROR') logErr('[弹窗] ' + msg.msg);
    else if (msg.level === 'WARN') logWarn('[弹窗] ' + msg.msg);
    else log('[弹窗] ' + msg.msg);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'openAlert') {
    // 手动唤出提醒窗口（popup 按钮 / 其他入口）
    openAlertWindow().then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'getUnread') {
    unreadCount().then(n => sendResponse({ ok: true, unread: n }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'getSpecialFollow') {
    getSpecialFollowUsers().then(users => sendResponse({ ok: true, users }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'diagnose') {
    diagnose().then(report => sendResponse({ ok: true, report }))
      .catch(e => sendResponse({ ok: false, err: e.message }));
    return true;
  }
  if (msg.type === 'setSound') {
    // 用户在设置页勾选=一次用户手势，正好用来解锁音频
    if (msg.on) {
      ensureOffscreen().then(ok => sendResponse({ ok }));
    } else {
      closeOffscreen().then(() => sendResponse({ ok: true }));
    }
    return true;
  }
});
