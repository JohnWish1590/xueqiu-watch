// options.js — v1.2：以 scripting 注入为主路径的设置页

const XQ = 'https://xueqiu.com';

// ---- 通用 ----
function bg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r)));
}
function $(id) { return document.getElementById(id); }

function showStatus(msg, ok) {
  const el = $('status');
  el.textContent = msg || '';
  el.style.color = ok ? '#1a8a3c' : '#c00';
  if (msg) setTimeout(() => (el.textContent = ''), 3500);
}
function spinner(id, on) { $(id).innerHTML = on ? '<span class="spinner"></span>' : ''; }

// ================================================================
// ① 检测登录（优先走 scripting 注入，自动检测，无需刷新标签页）
// ================================================================
async function testLogin() {
  $('btn-login').disabled = true;
  spinner('login-spinner', true);
  const st = $('login-status');
  st.className = ''; st.style.display = 'none'; st.textContent = '';

  try {
    // 先保存手动粘贴的 Cookie（若有），作为 fallback
    await persistManualCookie();
    // 调 background → background 会按 scripting 注入 > content script > cookie 注入 的优先级尝试
    // 注意：雪球 /user/current.json 接口已失效(404)，改用 /friendships/groups.json 作为登录探针：
    //   未登录 → 返回 error_code 400016；已登录 → 返回分组列表。
    const res = await bg({ type: 'apiGet', url: `${XQ}/friendships/groups.json` });
    if (!res.ok) {
      const notLogin = /400016|重新登录|请登录|请刷新页面/.test(res.err || '');
      st.className = 'err';
      st.innerHTML = `❌ <b>${notLogin ? '未登录 / 登录态已失效' : '检测失败'}</b> — ${esc(res.err || '未知错误')}<br><br>` +
        `<b>请检查：</b><br>` +
        `1. Chrome 是否已打开并<b>登录</b> <a href="https://xueqiu.com" target="_blank">xueqiu.com</a><br>` +
        `2. 如果刚刷新了扩展，请 <b>刷新一下 xueqiu.com 页面</b>（F5），让 content script 生效<br>` +
        `3. 仍不行 → 拉到最下方点 <b>「🔧 一键诊断」</b> 把报告发我，我帮你定位原因`;
      return;
    }
    const data = res.data;
    // groups 接口登录后返回【顶层数组】 [group, ...]，未登录才返回 {error_code}
    const groupsArr = Array.isArray(data) ? data : (data.groups || []);
    const special = groupsArr.find(g => g.special || (g.name || '').toLowerCase().includes('特别关注'));
    const hasSpecial = !!special;
    const method = res.method || '自动';
    st.className = 'ok';
    st.innerHTML = `✅ <b>已登录</b>（雪球会话有效）` +
      (hasSpecial
        ? ` · 找到「特别关注」分组` + (special.users && special.users.length ? `（${special.users.length} 人）` : '')
        : '') +
      `<div style="font-size:11.5px;color:#888;margin-top:4px;">通过 ${esc(method)} 获取登录态 · 分组数：${groupsArr.length}</div>`;
    // 自动触发读取分组
    loadGroup();
  } catch (e) {
    st.className = 'err';
    st.textContent = `❌ 检测异常：${e.message}`;
  } finally {
    $('btn-login').disabled = false;
    spinner('login-spinner', false);
  }
}

async function persistManualCookie() {
  const v = $('cookie').value.trim();
  if (v) await chrome.storage.local.set({ xqCookie: v });
}

// ================================================================
// ② 读取特别关注分组
// ================================================================
let groupUsers = [];

async function loadGroup() {
  $('btn-group').disabled = true;
  spinner('group-spinner', true);
  const listEl = $('group-list');

  try {
    const res = await bg({ type: 'getSpecialFollow' });
    if (!res.ok) throw new Error(res.err || '接口异常');
    groupUsers = Array.isArray(res.users) ? res.users : [];

    if (!groupUsers.length) {
      listEl.innerHTML = '<div class="group-empty">⚠️ 未找到「特别关注」分组或该分组为空。请使用下方手动名单补充。</div>';
      return;
    }

    const stored = await new Promise(r => chrome.storage.local.get('selectedUsers', r));
    const selSet = new Set(stored.selectedUsers || []);

    let html = `<div style="font-size:12px;color:#888;margin-bottom:6px;">共 ${groupUsers.length} 人（来自「特别关注」分组）</div>`;
    groupUsers.forEach((u, i) => {
      html += `<div class="user-item">
        <input type="checkbox" value="${u.id}" id="u${i}" ${selSet.has(u.id) ? 'checked' : ''}>
        <label for="u${i}">
          <span class="user-name">${esc(u.name)}</span>
          <span class="user-id">${u.id}</span>
        </label>
      </div>`;
    });
    listEl.innerHTML = html;
    syncManual();
  } catch (e) {
    listEl.innerHTML = `<div class="group-empty" style="color:#c00;">读取失败：${e.message}</div>`;
  } finally {
    $('btn-group').disabled = false;
    spinner('group-spinner', false);
  }
}

function toggleAll(checked) {
  document.querySelectorAll('#group-list input[type=checkbox]').forEach(c => c.checked = checked);
  syncManual();
}

function syncManual() {
  const checked = [...document.querySelectorAll('#group-list input[type=checkbox]:checked')].map(el => el.value);
  $('manual').value = checked.join(', ');
  chrome.storage.local.set({
    selectedUsers: checked,
    manualUsers: checked.join(', '),
  });
}

// ================================================================
// ③ 加载 / 保存
// ================================================================
async function load() {
  const stored = await new Promise(r => chrome.storage.local.get('options', r));
  const o = stored.options || {};
  $('interval').value = o.intervalMin || 2;
  $('sound').checked = !!o.soundOn;
  $('manual').value = o.manualUsers || '';
  const w = o.wecom || {};
  $('wecom-enabled').checked = !!w.enabled;
  $('wecom-corpid').value = w.corpid || '';
  $('wecom-secret').value = w.corpsecret || '';
  $('wecom-agentid').value = w.agentid || '';
  $('wecom-touser').value = w.touser || '';

  const ck = await new Promise(r => chrome.storage.local.get('xqCookie', r));
  if (ck.xqCookie) $('cookie').value = ck.xqCookie;

  // 外观：弹窗布局 + 主题
  const ap = await new Promise(r => chrome.storage.local.get('appearance', r));
  const a = ap.appearance || { layout: 'card', theme: 'light' };
  $('layout').value = a.layout || 'card';
  $('theme').value = a.theme || 'light';

  const su = await new Promise(r => chrome.storage.local.get(['selectedUsers', 'recentGroupUsers'], r));
  if (su.recentGroupUsers && su.recentGroupUsers.length) {
    groupUsers = su.recentGroupUsers;
    const selSet = new Set(su.selectedUsers || []);
    let html = `<div style="font-size:12px;color:#888;margin-bottom:6px;">共 ${groupUsers.length} 人（上次缓存）</div>`;
    groupUsers.forEach((u, i) => {
      html += `<div class="user-item">
        <input type="checkbox" value="${u.id}" id="u${i}" ${selSet.has(u.id) ? 'checked' : ''}>
        <label for="u${i}">
          <span class="user-name">${esc(u.name)}</span>
          <span class="user-id">${u.id}</span>
        </label>
      </div>`;
    });
    $('group-list').innerHTML = html;
  }
}

async function save() {
  const intervalMin = Math.min(60, Math.max(1, parseInt($('interval').value, 10) || 2));
  const soundOn = $('sound').checked;
  const manualUsers = $('manual').value.trim();
  const cookie = $('cookie').value.trim();
  const checked = [...document.querySelectorAll('#group-list input[type=checkbox]:checked')].map(el => el.value);
  const wecom = {
    enabled: $('wecom-enabled').checked,
    corpid: $('wecom-corpid').value.trim(),
    corpsecret: $('wecom-secret').value.trim(),
    agentid: $('wecom-agentid').value.trim(),
    touser: $('wecom-touser').value.trim(),
  };

  const appearance = { layout: $('layout').value, theme: $('theme').value };
  await new Promise(r => chrome.storage.local.set({
    options: { intervalMin, soundOn, manualUsers, wecom },
    selectedUsers: checked,
    recentGroupUsers: groupUsers,
    xqCookie: cookie,
    appearance,
  }, r));

  await bg({ type: 'saveOptions', options: { intervalMin, soundOn, manualUsers, wecom } });
  if (soundOn) await bg({ type: 'setSound', on: true });

  showStatus('✅ 已保存', true);
}

// ---- 外观即时保存（切换下拉即生效到存储，下次弹窗应用）----
async function saveAppearanceLive() {
  const appearance = { layout: $('layout').value, theme: $('theme').value };
  await chrome.storage.local.set({ appearance });
  showStatus('✅ 外观已更新（下次弹窗生效）', true);
}

// ---- 工具 ----
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ================================================================
// 🔧 诊断：把每一步结果展示出来，便于定位"获取不到"的原因
// ================================================================
async function runDiagnose() {
  $('btn-diag').disabled = true;
  spinner('diag-spinner', true);
  const out = $('diag-out');
  out.style.display = 'block';
  out.textContent = '诊断中…';
  try {
    const res = await bg({ type: 'diagnose' });
    if (!res.ok) { out.textContent = '诊断失败：' + res.err; return; }
    out.textContent = formatReport(res.report);
  } catch (e) {
    out.textContent = '诊断异常：' + e.message;
  } finally {
    $('btn-diag').disabled = false;
    spinner('diag-spinner', false);
  }
}

function formatReport(r) {
  let s = `===== 雪球扩展诊断报告 ${r.ts || ''} =====\n\n`;
  s += `[环境] tabs=${r.env.hasTabs}  cookies权限=${r.env.hasCookies}  scripting=${r.env.hasScripting}\n\n`;
  for (const st of (r.steps || [])) {
    s += `● ${st.step}\n`;
    if (st.ok === true) s += '   结果: ✅ 成功\n';
    else if (st.ok === false) s += '   结果: ❌ 失败\n';
    if (st.verdict) s += '   判定: ' + st.verdict + '\n';
    for (const k of ['count', 'status', 'userId', 'name', 'groupCount', 'hasSpecialFollow', 'groupNames', 'hasToken', 'hasCookie', 'len', 'names', 'preview']) {
      if (st[k] !== undefined) s += '   ' + k + ': ' + JSON.stringify(st[k]) + '\n';
    }
    if (st.tabs) s += '   tabs: ' + JSON.stringify(st.tabs) + '\n';
    if (st.error) s += '   错误: ' + st.error + '\n';
    if (st.hint) s += '   建议: ' + st.hint + '\n';
    s += '\n';
  }
  return s;
}

async function copyDiag() {
  const t = $('diag-out').textContent;
  if (!t) { showStatus('没有可复制的报告', false); return; }
  try {
    await navigator.clipboard.writeText(t);
    showStatus('✅ 已复制诊断报告', true);
  } catch (e) {
    // 兜底：选中文本让用户手动复制
    const el = $('diag-out');
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    showStatus('请手动 Ctrl+C 复制', false);
  }
}

// 📢 测试提醒：直接触发一次通知+弹窗（验证提醒链路）
async function testNotify() {
  $('btn-test').disabled = true;
  try {
    const r = await bg({ type: 'testNotify' });
    showStatus(r.ok ? '✅ 已发送测试提醒 — 看右下角通知与置顶小窗（声音需在③开启）' : ('❌ ' + (r.err || '失败')), r.ok);
  } catch (e) {
    showStatus('❌ ' + e.message, false);
  } finally {
    $('btn-test').disabled = false;
  }
}

// 📤 测试企微推送：用当前表单里的配置直接发一条测试消息（无需先保存）
async function testWecomPush() {
  const btn = $('btn-wecom-test');
  btn.disabled = true;
  const st = $('wecom-test-status');
  st.textContent = '发送中…'; st.style.color = '#1a56a8';
  try {
    const cfg = {
      enabled: true,
      corpid: $('wecom-corpid').value.trim(),
      corpsecret: $('wecom-secret').value.trim(),
      agentid: $('wecom-agentid').value.trim(),
      touser: $('wecom-touser').value.trim(),
    };
    const r = await bg({ type: 'testWecom', cfg });
    if (r.ok) { st.textContent = '✅ 已发送，去微信查看'; st.style.color = '#1a8a3c'; }
    else { st.textContent = '❌ ' + r.err; st.style.color = '#c00'; }
  } catch (e) {
    st.textContent = '❌ ' + e.message; st.style.color = '#c00';
  } finally {
    btn.disabled = false;
    setTimeout(() => { st.textContent = ''; }, 5000);
  }
}

// ================================================================
// 📜 运行日志：查看 / 复制 / 下载 / 清空
// ================================================================
function fmtLogTime(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtLogDate(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 纯文本（用于复制/下载）
function formatLogText(entries) {
  const head = `===== 雪球特别关注扩展 运行日志 =====\n导出时间: ${new Date().toLocaleString('zh-CN')}\n共 ${entries.length} 条\n\n`;
  return head + entries.map(e => `[${fmtLogDate(e.t)}] ${e.level}  ${e.msg.replace(/\n+/g, ' ⏎ ')}`).join('\n');
}

async function renderLog() {
  const out = $('log-out');
  out.style.display = 'block';
  out.textContent = '加载中…';
  try {
    const res = await bg({ type: 'getLog' });
    if (!res.ok) { out.textContent = '读取失败：' + res.err; return; }
    const entries = res.entries || [];
    $('log-count').textContent = `共 ${entries.length} 条`;
    if (!entries.length) { out.textContent = '（暂无日志，扩展运行中会自动累积）'; return; }
    // 最新在上，按级别着色
    out.innerHTML = entries.slice().reverse().map(e => {
      const col = e.level === 'ERROR' ? '#ff6b6b' : e.level === 'WARN' ? '#e7c14a' : '#cfcfcf';
      const msg = esc(e.msg.replace(/\n+/g, ' ⏎ '));
      return `<span style="color:${col}">[${fmtLogTime(e.t)}] ${e.level}</span>  ${msg}`;
    }).join('\n');
  } catch (e) {
    out.textContent = '读取异常：' + e.message;
  }
}

async function copyLog() {
  const res = await bg({ type: 'getLog' });
  const entries = (res && res.ok && res.entries) || [];
  if (!entries.length) { showStatus('没有日志可复制', false); return; }
  try {
    await navigator.clipboard.writeText(formatLogText(entries));
    showStatus('✅ 已复制运行日志（错误日志已清空）', true);
    // 复制即视为已导出：清空永久保留的 ERROR 缓冲
    await bg({ type: 'clearErrors' });
    renderLog();
  } catch (e) {
    showStatus('复制失败，请用「下载 .txt」', false);
  }
}

function downloadLog() {
  bg({ type: 'getLog' }).then(res => {
    const entries = (res && res.ok && res.entries) || [];
    const text = formatLogText(entries);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `xueqiu-log-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('✅ 日志已下载', true);
  });
}

async function clearLog() {
  await bg({ type: 'clearLog' });
  showStatus('🗑 日志已清空', true);
  renderLog();
}

// ---- 绑定事件（MV3 CSP 安全）----
function bindEvents() {
  $('btn-login').addEventListener('click', testLogin);
  $('btn-group').addEventListener('click', loadGroup);
  $('sel-all').addEventListener('change', (e) => toggleAll(e.target.checked));
  $('save').addEventListener('click', save);
  $('layout').addEventListener('change', saveAppearanceLive);
  $('theme').addEventListener('change', saveAppearanceLive);
  $('btn-diag').addEventListener('click', runDiagnose);
  $('btn-copy-diag').addEventListener('click', copyDiag);
  $('btn-test').addEventListener('click', testNotify);
  $('btn-wecom-test').addEventListener('click', testWecomPush);
  $('btn-log-refresh').addEventListener('click', renderLog);
  $('btn-log-copy').addEventListener('click', copyLog);
  $('btn-log-download').addEventListener('click', downloadLog);
  $('btn-log-clear').addEventListener('click', clearLog);
  $('group-list').addEventListener('change', (e) => {
    if (e.target && e.target.type === 'checkbox') syncManual();
  });
}

bindEvents();
const _av = document.getElementById('about-ver');
if (_av) _av.textContent = (chrome.runtime.getManifest() || {}).version || '—';
load();
renderLog();   // 打开设置页即自动加载运行日志
