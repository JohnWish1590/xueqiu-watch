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
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;  // 所有日志保留 7 天，超期自动清理
const logBuf = [];            // INFO / WARN 滚动缓冲
const errBuf = [];            // ERROR 同样受 7 天保留约束
let logFlushTimer = null;

// 过滤掉超期的日志条目（通用函数）
function pruneOld(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const cutoff = Date.now() - LOG_RETENTION_MS;
  return entries.filter(e => (e.t || 0) >= cutoff);
}

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
    await chrome.storage.local.set({ [LOG_KEY]: pruneOld(logBuf).slice(), [LOG_ERR_KEY]: pruneOld(errBuf).slice() });
  } catch (e) { /* 写入失败忽略，下次再试 */ }
}

// 合并返回（按时间排序），ERROR 与 INFO/WARN 交错在一条时间线里（超期条目不导出）
async function getLog() {
  const all = pruneOld(errBuf.concat(logBuf));
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

// 冷启动：把上次持久化的日志读回内存，保持连续（超期条目自动丢弃）
(async () => {
  try {
    const stored = await chrome.storage.local.get([LOG_KEY, LOG_ERR_KEY]);
    const saved = pruneOld(stored[LOG_KEY]);
    if (saved.length) {
      for (const e of saved) logBuf.push(e);
      if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
    }
    const savedErr = pruneOld(stored[LOG_ERR_KEY]);
    if (savedErr.length) {
      for (const e of savedErr) errBuf.push(e);
    }
    // 存盘也同步清理一次（防止 storage 里堆积过期数据）
    if (saved.length !== (stored[LOG_KEY] || []).length || savedErr.length !== (stored[LOG_ERR_KEY] || []).length) {
      flushLog();
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
//   ③（已废弃）显式 Cookie 注入：SW 跨域 fetch 手动设的 Cookie 头属 forbidden header
//      会被浏览器静默丢弃，credentials 又只带 SW 自身 jar（无雪球 Cookie），故无效。
//      本扩展要求保持至少一个雪球标签页打开，由 ①/② 在标签页内注入完成取数。
// ═══════════════════════════════════════════════════════════════

// tabs.sendMessage 没有原生 timeout 参数（options 只认 {frameId}），
// 用 setTimeout 自己加一个超时，避免 content script 不响应时卡死。
// tabs.sendMessage 在 MV3 返回 Promise，直接用 Promise.race 包一层超时。
// ⚠️ 旧写法在 setTimeout 回调里 throw，那个 throw 发生在异步回调上下文，不在本函数
// Promise 链上 → 外层 try/catch 接不住，content script 挂起时 Promise 永不 reject、轮询静默卡死。
async function sendMessageWithTimeout(tabId, msg, ms = 6000) {
  const sendP = chrome.tabs.sendMessage(tabId, msg);
  const timeoutP = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('content script 无响应（超时）')), ms)
  );
  return Promise.race([sendP, timeoutP]);
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
      } catch (e) {
        // 标签页在此期间被关闭 → 直接判定失败，避免空轮询到 8 秒超时
        clearInterval(timer);
        resolve(false);
        return;
      }
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

// 三条取数路径统一返回的 { status, text } 解析：429 / 非200 / error_code 统一在此处理，
// 避免 ①/② 重复两份几乎一样的解析逻辑（历史上 ③ 也有一份）。
function parseXQResponse(r, url) {
  if (!r) return null;
  if (r.status === 429) throw new Error('触发限流 429，请稍后重试');
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const data = safeParseJSON(r.text, url);
  if (data && data.error_code) {
    const desc = data.error_description || data.message || '';
    throw new Error(`雪球返回错误码 ${data.error_code}${desc ? '：' + desc : ''}`);
  }
  return data;
}

// ─── 统一入口：按优先级尝试各路径 ───
async function fetchJSON(url, opts = {}) {
  // ① scripting 注入（主路径：随用随注入，无需刷新标签页，最稳）
  if (opts.viaTab !== false) {
    log('取数路径① 尝试 scripting 注入：', url);
    try {
      const r = await apiViaTab(url, opts);
      if (r) {
        const data = parseXQResponse(r, url);
        if (data) { log('取数路径① 成功（scripting 注入）', url); return data; }
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
        const data = parseXQResponse(r, url);
        if (data) { log('取数路径② 成功（content script）', url); return data; }
      }
    } catch (e) {
      if (/429|HTTP \d/.test(e.message)) throw e;
      if (/错误码|不是 JSON|重定向/.test(e.message)) throw e;
      logWarn('content script 路径不可用，回退…', e.message);
    }
  }

  // 全部失败：本扩展要求保持至少一个雪球标签页打开，由 ①/② 在标签页内注入完成取数
  // （SW 跨域 fetch 无法携带雪球 Cookie，故不设「无标签页」的 Cookie 兜底路径）。
  throw new Error(
    '无法获取登录态。请确保已在 Chrome 打开并登录 xueqiu.com（保持至少一个雪球标签页打开）' +
    '——本扩展通过标签页内注入的方式随用随取，无需手动配置 Cookie。'
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

async function getUserTimeline(userId, page = 1, sinceId = 0) {
  // 防御式增量：附加 since_id 只取该 id 之后的新帖，减少流量与 429 概率。
  // 同时保留 checkOnce 里的客户端 id 过滤作安全网——即使雪球接口不认 since_id
  // （参数名不符）也只会多返回几条旧帖，客户端过滤仍能正确识别新帖，不会漏。
  const since = Number(sinceId || 0);
  const sinceParam = since > 0 ? `&since_id=${since}` : '';
  const urls = [
    `${XQ_BASE}/v4/statuses/user_timeline.json?user_id=${userId}&page=${page}&count=10${sinceParam}`,
    `${XQ_BASE}/statuses/user_timeline.json?user_id=${userId}&page=${page}&count=10${sinceParam}`,
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
  return String(html)
    // 1) 整段移除「不会显示」的内容：注释、样式表、脚本
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // 2) 块级/换行标签转换行
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>|<\/tr>/gi, '\n')
    // 3) 剥掉所有剩余标签
    .replace(/<[^>]+>/g, '')
    // 4) 解码实体（&amp; 必须先于其他实体，才能正确处理双重转义）
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, c) => {
      try { return String.fromCodePoint(Number(c)); } catch (e) { return ''; }
    })
    .replace(/\u00A0/g, ' ')   // &#160; 归一为普通空格
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    // 5) 清理空白与多余换行
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function truncate(s, n) {
  // 用 Array.from 按码点切分，避免 emoji / 代理对（length=2）在边界被劈成半个字符
  const chars = Array.from(s == null ? '' : String(s));
  if (n == null) return chars.join('');
  return chars.length <= n ? s : chars.slice(0, n - 1).join('') + '…';
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

// 通知点击 → 原帖 URL 映射：模块级内存缓存 + 异步整写落盘，
// 避免多条通知回调并发时 storage 读改写覆盖（lost update）。
const urlMap = {};

// ---------- 启动引导（ready） ----------
// MV3 Service Worker 每次冷启动都从头执行本文件，urlMap 等内存状态需从 storage 恢复。
// 但 onInstalled / onAlarm / onStartup 可能在恢复完成前就触发 → 用 ready Promise 显式化
// 「恢复完成」这一刻，关键监听器 await 它，杜绝竞态。
const ready = (async () => {
  try {
    const d = await chrome.storage.local.get('urlMap');
    Object.assign(urlMap, (d && d.urlMap) || {});
  } catch (e) {
    // 测试 / 无 storage 环境：忽略，urlMap 留空即可
  }
})();

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
      // JS 单线程，回调写内存对象不会并发覆盖；再整写落盘（即使后写也含全部 key）
      urlMap[id] = url;
      chrome.storage.local.set({ urlMap: Object.assign({}, urlMap) });
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
    // 冷启动检查：SW 重启后内存 offscreenReady 归零，但离屏文档可能仍在跑。
    // 先问浏览器要文档是否真实存在，避免重复 create 触发 "exists" 错误分支。
    if (chrome.offscreen.hasDocument) {
      const exists = await chrome.offscreen.hasDocument();
      if (exists) { offscreenReady = true; return true; }
    }
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
// 用「窗口集合 + 持久化 + 真实扫描」三重保障维护，杜绝孤儿窗口。
//
// 根因（v1.4.3 及以前反复出现空白 chrome://newtab 窗口）：
//   ① MV3 Service Worker 会被浏览器空闲 ~5 分钟后杀掉 → 内存变量全部归零
//   ② 之前创建的 alert 弹窗还在屏幕上，但 SW 已不知道它的 id
//   ③ 扩展更新/重载后，弹窗 URL 从 chrome-extension://xxx/alert.html 变成
//      chrome://newtab（Chrome 对失效扩展页面的默认回退）
//   ④ 新 SW 的 findExistingAlertWin() 只认 url.contains('alert.html') → 匹配不上孤儿
//   ⑤ 以为没窗口 → 又新建 → maybeRepopAlert 每轮轮询都触发 → 堆出几十个孤儿
//
// 修复：
//   - alertWinIds 持久化到 storage（跨 SW 重启不丢）
//   - 扫描时也认 newtab/orphan popup（按尺寸+位置兜底匹配）
//   - 创建前先清理孤儿，创建后验证 URL
//   - maybeRepopAlert 加防抖（短时间不重复创建）
const ALERT_WINS_KEY = 'alertWinIds';
const alertWinIds = new Set();

// 持久化 alertWinIds 到 storage（防 SW 重启丢失）
async function persistAlertWinIds() {
  try {
    await chrome.storage.local.set({ [ALERT_WINS_KEY]: [...alertWinIds] });
  } catch (e) {}
}

// 从 storage 恢复 alertWinIds（冷启动时调用）
async function restoreAlertWinIds() {
  try {
    const stored = await chrome.storage.local.get(ALERT_WINS_KEY);
    const ids = stored[ALERT_WINS_KEY];
    if (Array.isArray(ids)) {
      for (const id of ids) alertWinIds.add(id);
    }
  } catch (e) {}
}

// 冷启动时立即恢复（在日志恢复之后）
(async () => { await restoreAlertWinIds(); })();

// 找当前还活着的 alert 弹窗（三重匹配：集合 ID → alert.html URL → 孤儿兜底）
async function findExistingAlertWin() {
  const myId = chrome.runtime.id;

  // ① 先查内存集合里的 ID（最快路径）
  for (const id of [...alertWinIds]) {
    try {
      const win = await chrome.windows.get(id, { populate: false });
      if (win) return win;
      alertWinIds.delete(id);
    } catch (e) { alertWinIds.delete(id); }
  }

  // ② 扫描所有 popup 窗口，找 URL 含 alert.html 的（正常弹窗）
  try {
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const w of all || []) {
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      if (url.indexOf('alert.html') !== -1 || (myId && url.indexOf(myId) !== -1 && url.indexOf('alert') !== -1)) {
        alertWinIds.add(w.id);
        await persistAlertWinIds();
        return w;
      }
    }

    // ③ 兜底：找「疑似孤儿」的 popup 窗口
    // 特征：URL 是 chrome://newtab / about:blank，且尺寸接近我们的弹窗（宽 380~500，高 200~600）
    // 这些很可能是扩展更新后 URL 失效的旧 alert 弹窗
    for (const w of all || []) {
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      if (url === 'chrome://newtab' || url === 'about:blank' || (!url.startsWith('http') && url.indexOf('alert') === -1 && !url.startsWith('chrome-extension'))) {
        const ww = w.width || 0;
        const wh = w.height || 0;
        if (ww >= 380 && ww <= 500 && wh >= 200 && wh <= 600) {
          log('发现疑似孤儿弹窗 id=' + w.id + ' url=' + url + ' 尺寸=' + ww + 'x' + wh + ' → 当作 alert 孤儿复用');
          alertWinIds.add(w.id);
          await persistAlertWinIds();
          return w;
        }
      }
    }
  } catch (e) {}
  return null;
}

// 关掉所有 alert 弹窗：集合里的 + 兜底扫到的 + 孤儿窗口（覆盖 SW 重启遗留）
async function closeAllAlertWindows() {
  const ids = [...alertWinIds];
  for (const id of ids) { try { await chrome.windows.remove(id); } catch (e) {} }
  alertWinIds.clear();
  await persistAlertWinIds();
  try {
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const w of all || []) {
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      // 关闭 alert.html 的 + 疑似孤儿的（newtab/blank + 弹窗尺寸）
      const isAlert = url.indexOf('alert.html') !== -1;
      const isOrphan = (url === 'chrome://newtab' || url === 'about:blank') &&
        (w.width || 0) >= 380 && (w.width || 0) <= 500 &&
        (w.height || 0) >= 200 && (w.height || 0) <= 600;
      if (isAlert || isOrphan) {
        try { await chrome.windows.remove(w.id); } catch (e) {}
      }
    }
  } catch (e) {}
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
const BROWSER_CHROME_HEIGHT = 95;

async function openAlertWindow() {
  try {
    // 关键修复（v1.4.4）：先真实扫描当前是否已有 alert 弹窗（跨 SW 重启也能复用），
    // 有就聚焦 + 重渲染，绝不新建第二个 → 杜绝堆出几十个窗口。
    const existing = await findExistingAlertWin();
    if (existing) {
      // 如果找到的是孤儿窗口（URL 不是 alert.html），尝试导航到正确 URL
      const url = (existing.tabs && existing.tabs[0] && existing.tabs[0].url) || '';
      if (url.indexOf('alert.html') === -1) {
        log('复用孤儿弹窗 id=' + existing.id + '（原url=' + url + '）→ 导航到 alert.html');
        try { await chrome.tabs.update(existing.tabs[0].id, { url: 'alert.html' }); } catch (e) {}
      }
      await chrome.windows.update(existing.id, { focused: true }).catch(() => {});
      try { await chrome.runtime.sendMessage({ type: 'alertRefresh' }); } catch (e) {}
      return;
    }

    // 创建前先清理残留的孤儿 popup 窗口（防止堆积）
    await cleanupOrphanPopups();

    // 创建弹窗：不传 left/top —— 多显示器环境下 background.js 算出的坐标
    // 很容易落到副屏之外导致 "Bounds must be at least 50% within visible screen space" 错误。
    // 精确贴边完全交给 alert.js 内部的 snapToRight()（用 window.screen 坐标，
    // 即窗口实际所在屏的宽高，天然适配多屏 / DPI）。Chrome 会把新窗口建在
    // 当前活动屏幕，snapToRight 再把它推到该屏右边缘。
    const W = 440, H = 360;
    const createData = { url: 'alert.html', type: 'popup', width: W, height: H, focused: false };
    log('弹窗创建 → 不预设位置（由 alert.js snapToRight 精确定位到当前屏右边缘）');
    const w = await chrome.windows.create(createData);
    alertWinIds.add(w.id);
    await persistAlertWinIds();
    log('弹窗已创建 id=' + w.id + '，等待 alert.js 内部贴边校正…');

    // 延迟验证：确认窗口确实加载了 alert.html（而非回退到 newtab）
    setTimeout(async () => {
      try {
        const check = await chrome.windows.get(w.id, { populate: true });
        const actualUrl = (check.tabs && check.tabs[0] && check.tabs[0].url) || '';
        if (actualUrl.indexOf('alert.html') === -1) {
          logErr('弹窗验证失败！id=' + w.id + ' 实际URL=' + actualUrl + '（预期 alert.html）→ 尝试关闭此异常窗口');
          try { await chrome.windows.remove(w.id); } catch (e) {}
          alertWinIds.delete(w.id);
          await persistAlertWinIds();
        }
      } catch (e) {
        // 窗口已不存在，从集合清除
        alertWinIds.delete(w.id);
        await persistAlertWinIds();
      }
    }, 3000);
  } catch (e) {
    logErr('弹窗创建失败：', e.message);
  }
}

// 清理疑似孤儿的 popup 窗口（chrome://newtab / about:blank + 弹窗尺寸）
// 在创建新弹窗前调用，防止堆积
async function cleanupOrphanPopups() {
  try {
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const w of all || []) {
      // 跳过我们已知管理的窗口
      if (alertWinIds.has(w.id)) continue;
      const url = (w.tabs && w.tabs[0] && w.tabs[0].url) || w.url || '';
      const isOrphan = (url === 'chrome://newtab' || url === 'about:blank' || url === '') &&
        (w.width || 0) >= 380 && (w.width || 0) <= 500 &&
        (w.height || 0) >= 200 && (w.height || 0) <= 600;
      if (isOrphan) {
        log('清理孤儿 popup id=' + w.id + ' url=' + url + ' 尺寸=' + (w.width||0) + 'x' + (w.height||0));
        try { await chrome.windows.remove(w.id); } catch (e) {}
      }
    }
  } catch (e) {}
}
// 窗口被关闭时从集合移除 + 持久化（跨 SW 重启的孤儿窗口由扫描兜底处理）
chrome.windows.onRemoved.addListener(async (id) => {
  if (alertWinIds.has(id)) {
    alertWinIds.delete(id);
    await persistAlertWinIds();
  }
});

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
let lastRepopTime = 0;           // 防抖：记录上次实际执行重弹的时间戳
const REPOP_DEBOUNCE_MS = 60 * 1000; // 重弹冷却：两次重弹至少间隔 1 分钟

async function maybeRepopAlert() {
  const unread = await unreadCount();
  if (!unread) return;                       // 全读完了，不重弹
  const live = await findExistingAlertWin();
  if (live) return;                          // 窗口已开着（真实扫描），不重弹 → 复用而非新建
  const { lastNewPostAt } = await chrome.storage.local.get(['lastNewPostAt']);
  if (!lastNewPostAt) return;
  // 防抖：距上次重弹不到 1 分钟 → 跳过（避免 SW 重启后每轮轮询都重复创建）
  if (Date.now() - lastRepopTime < REPOP_DEBOUNCE_MS) return;
  if (Date.now() - lastNewPostAt >= REPOP_MS) {
    log(`3 分钟已过仍有 ${unread} 条未读，重新弹出提醒窗口`);
    lastRepopTime = Date.now();
    await openAlertWindow();
    // 重弹后更新计时起点，避免每轮轮询都弹（相当于再给你 3 分钟）
    await chrome.storage.local.set({ lastNewPostAt: Date.now() });
  }
}

// ---------- 主检查逻辑 ----------
// 有限并发：把 items 按 limit 并发交给 fn，结果顺序与 items 一致
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;                 // idx++ 是同步原子操作，并发 worker 不会取到同一 i
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// 单用户：拉时间线 → 过滤新帖 → 返回 maxId / 映射后的新帖 / 状态
async function fetchUserFresh(u, lastIds, initialized) {
  try {
    const localMax = Number(lastIds[u.id] || 0);
    const tl = await getUserTimeline(u.id, 1, localMax);   // 传 since_id 做防御式增量
    const fresh = tl.filter(s => Number(s.id) > localMax);
    const maxId = tl.reduce((mx, s) => Math.max(mx, Number(s.id)), localMax);
    let mapped = [];
    if (fresh.length && initialized) {
      fresh.sort((a, b) => Number(b.id) - Number(a.id));   // 用户内新→旧
      mapped = fresh.map(s => ({ ...s, _name: u.name, _id: u.id }));
    }
    return { id: u.id, name: u.name, ok: true, parsed: tl.length, maxId, mapped };
  } catch (e) {
    return { id: u.id, name: u.name, ok: false, error: e.message };
  }
}

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

  // 有限并发抓取（默认 3 路），避免串行慢 + 易触发 429；
  // 各用户独立解析，结果按 users 顺序合并，最后全局按时间线排序。
  const results = await mapConcurrent(users, 3, u => fetchUserFresh(u, lastIds, initialized));
  for (const r of results) {
    if (r.ok) {
      perUser[r.id] = { name: r.name, ok: true, parsed: r.parsed };
      if (r.maxId !== undefined) lastIds[r.id] = r.maxId;
      if (r.mapped) newAll.push(...r.mapped);
    } else {
      perUser[r.id] = { name: r.name, ok: false, error: r.error };
      runError = runError || r.error;
    }
  }
  // 全局按帖子 id 降序：避免跨用户按遍历顺序而非真实时间线排列
  newAll.sort((a, b) => Number(b.id) - Number(a.id));

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
  await ready; // 等 urlMap 等内存状态从 storage 恢复完，再跑首轮
  const opts = await getOptions();
  log('扩展已安装/更新，调度轮询（间隔', opts.intervalMin, '分钟），立即首跑');
  scheduleAlarm(opts.intervalMin);
  checkOnce(); // 首次立即跑一次（只记录不推送）
});

chrome.runtime.onStartup.addListener(async () => {
  await ready;
  log('浏览器启动，检查/重建轮询');
  chrome.alarms.get('poll', (a) => {
    if (!a) getOptions().then(o => scheduleAlarm(o.intervalMin));
  });
  checkOnce();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') { await ready; log('alarm 触发：开始轮询'); checkOnce(); }
});

// ---------- 通知点击 / 按钮 ----------
function openPost(nid) {
  const url = urlMap[nid];
  if (url) { chrome.tabs.create({ url }); chrome.notifications.clear(nid); return; }
  chrome.storage.local.get('urlMap', ({ urlMap: m }) => {
    const u = m && m[nid];
    if (u) chrome.tabs.create({ url: u });
    chrome.notifications.clear(nid);
  });
}
chrome.notifications.onClicked.addListener(openPost);
chrome.notifications.onButtonClicked.addListener(openPost);

// （弹窗 onRemoved 监听已在上文 openAlertWindow 处注册，此处不再重复）

// ---------- 与弹窗/选项页通信 ----------
// ── 消息路由：用 dispatch map 替代一长串 if (msg.type === 'xxx') ──
// 每个 handler 返回结果对象（或原始值），由统一包装负责 sendResponse；
// 返回 undefined 视为 { ok: true }，handler 抛错则回包 { ok:false, err }。
// 新增一个消息类型 = 在 msgHandlers 里加一行，无需再复制粘贴 try/catch + return true。
const msgHandlers = {
  async getLog() { return { ok: true, entries: await getLog() }; },
  async clearLog() { await clearLog(); return { ok: true }; },
  async clearErrors() { await clearErrors(); return { ok: true }; },
  async checkNow() { await checkOnce(); return { ok: true }; },
  async getStatus() {
    return chrome.storage.local.get(['lastCheck', 'recent', 'trackedCount', 'perUser', 'lastError', 'lastRunAt', 'initialized']);
  },
  async testWecom(msg) {
    const opts = await getOptions();
    const cfg = msg.cfg || opts.wecom;
    if (!cfg || !cfg.enabled) return { ok: false, err: '企微推送未开启，请先在④勾选「启用」' };
    if (!cfg.corpid || !cfg.corpsecret || !cfg.agentid) return { ok: false, err: '企微配置不完整（需 corpid / corpsecret / agentid）' };
    await sendWecomText(cfg, '【雪球·特别关注】这是一条测试推送 ✅\n若你在微信里收到本条，说明配置成功。');
    return { ok: true };
  },
  async saveOptions(msg) {
    await chrome.storage.local.set({ options: msg.options });
    scheduleAlarm(msg.options.intervalMin);
    return { ok: true };
  },
  async apiGet(msg) {
    const data = await fetchJSON(msg.url);
    return { ok: true, data, method: '自动（scripting 注入 / content script）' };
  },
  async testNotify() { return await testNotify(); },
  async markRead(msg) { return { ok: true, left: await markPostRead(msg.postId) }; },
  async markAllRead() {
    const { recent } = await chrome.storage.local.get(['recent']);
    const items = recent || [];
    let count = 0;
    for (const it of items) { if (!it.read) { it.read = true; count++; } }
    await chrome.storage.local.set({ recent: items });
    log('全部已读：标记', count, '条');
    return { ok: true, marked: count };
  },
  async closeAllAlerts() {
    const { recent } = await chrome.storage.local.get(['recent']);
    const items = recent || [];
    let count = 0;
    for (const it of items) { if (!it.read) { it.read = true; count++; } }
    await chrome.storage.local.set({ recent: items });
    log('全部已读并关闭所有弹窗：标记', count, '条');
    await closeAllAlertWindows();
    return { ok: true };
  },
  async closeAllAlertWindows() { await closeAllAlertWindows(); return { ok: true }; },
  async uiLog(msg) {
    if (msg.level === 'ERROR') logErr('[弹窗] ' + msg.msg);
    else if (msg.level === 'WARN') logWarn('[弹窗] ' + msg.msg);
    else log('[弹窗] ' + msg.msg);
    return { ok: true };
  },
  async openAlert() { await openAlertWindow(); return { ok: true }; },
  async getUnread() { return { ok: true, unread: await unreadCount() }; },
  async getSpecialFollow() { return { ok: true, users: await getSpecialFollowUsers() }; },
  async diagnose() { return { ok: true, report: await diagnose() }; },
  async setSound(msg) {
    // 用户在设置页勾选=一次用户手势，正好用来解锁音频
    if (msg.on) { const ok = await ensureOffscreen(); return { ok }; }
    await closeOffscreen();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msgHandlers[msg.type];
  if (!handler) return; // 不归本扩展处理，交还其它监听器
  // 统一包装：handler 可能同步抛错，用 Promise 兜住；异步结果经 sendResponse 回包
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(r => sendResponse(r === undefined ? { ok: true } : r))
    .catch(e => sendResponse({ ok: false, err: e.message }));
  return true; // 保持消息通道开放，异步 sendResponse
});
