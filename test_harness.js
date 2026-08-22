// test_harness.js v1.2 — 测试 background.js 逻辑
// 关键事实（来自真实诊断）：
//   雪球 /friendships/groups.json 登录后返回【顶层数组】 [group, group, ...]（未登录才返回 {error_code}）
//   主路径是 chrome.scripting.executeScript 注入（随用随注入，无需刷新标签页）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

// ---- 内存版 chrome API mock ----
const store = {};
let cookieJar = [ { name: 'xq_a_token', value: 'TOKEN_ABC', httpOnly: true }, { name: 'u', value: '123' } ];
let notifications = [];
let tabList = [ { id: 1, status: 'complete', url: 'https://xueqiu.com/' } ];
let contentScriptEnabled = true; // 控制 content script 路径是否可用
let scriptingEnabled = true;     // 控制 scripting 注入主路径是否可用
const captured = {};
// 可变窗口状态：模拟「上一个 SW 重启遗留的孤儿 alert 弹窗」等场景
let windowsState = [ { id: 1, focused: true, type: 'normal', left: 0, top: 0, width: 1920, height: 1080 } ];
const ALERT_URL = 'chrome-extension://EXT_TEST/alert.html';
function alertWin(id) { return { id, type: 'popup', tabs: [ { url: ALERT_URL } ] }; }

// fetch mock 数据：注意 groups.json 返回【顶层数组】（与真实雪球一致）
let groupsResponse = [
  { id: 101, name: '特别关注', special: true,
    users: [ { id: '1', screen_name: '张三' }, { id: '2', screen_name: '李四' } ] },
  { id: 102, name: '默认分组', users: [] },
];
// 多页成员模拟：只在「特别关注分组不含内联 users」时启用，强制走 members.json 分页路径。
// 形如 [ 第1页, 第2页, ... ]，每页 { users:[...], maxPage:N }
let membersPages = null;
let blockUserTimeline = false;   // 场景13：让 user_timeline 返回雪球 WAF 阻断页
let user1Posts = [ { id: 101, text: '<p>昨天发的帖</p>' }, { id: 100, text: '更早的帖' } ];
let user2Posts = [ { id: 50, text: '李四旧帖' } ];

function fetchMockText(url) {
  if (url && url.includes('notlogin')) {
    return JSON.stringify({ error_code: 400016, error_description: '请重新登录' });
  }
  if (url && url.includes('/friendships/groups.json')) return JSON.stringify(groupsResponse);
  if (url && url.includes('/friendships/groups/members.json')) {
    if (membersPages) {
      const pm = url.match(/[?&]page=(\d+)/);
      const page = pm ? Number(pm[1]) : 1;
      return JSON.stringify(membersPages[page - 1] || { users: [] });
    }
    return JSON.stringify({ users: [] });
  }
  if (blockUserTimeline && url && (url.includes('/user_timeline.json') || url.includes('/home_timeline.json'))) {
    return '<html><body>很抱歉，由于您访问的URL有可能对网站造成安全威胁，您的访问被阻断。请求ID：test</body></html>';
  }
  // 合并信息流（v1.5.7 新取数路径）：一次返回关注流里张三+李四的帖，本地按 id 过滤
  // 真实雪球帖子带 user.id 字段，这里在桩边界补上（与真实接口行为一致）
  if (url && url.includes('/home_timeline.json')) {
    const mixed = [
      ...user1Posts.map(p => ({ ...p, user: { id: '1' } })),
      ...user2Posts.map(p => ({ ...p, user: { id: '2' } })),
    ];
    return JSON.stringify({ statuses: mixed });
  }
  if (url && url.includes('/user_timeline.json')) {
    const m = url.match(/user_id=(\d+)/);
    const uid = m && m[1];
    if (uid === '1') return JSON.stringify({ statuses: user1Posts });
    if (uid === '2') return JSON.stringify({ statuses: user2Posts });
    return JSON.stringify({ statuses: [] });
  }
  return JSON.stringify({});
}

function jsonResp(obj) {
  const text = JSON.stringify(obj);
  return { ok: true, status: 200, json: async () => obj, text: async () => text };
}
async function fetchMock(url) {
  await new Promise(r => setTimeout(r, 3));
  if (url.includes('qyapi.weixin.qq.com')) {
    if (url.includes('/cgi-bin/gettoken')) { captured.wecomTokenCall = (captured.wecomTokenCall || 0) + 1; return jsonResp({ errcode: 0, access_token: 'WECOM_TOKEN_123', expires_in: 7200 }); }
    if (url.includes('/cgi-bin/message/send')) { captured.wecomSendCall = (captured.wecomSendCall || 0) + 1; return jsonResp({ errcode: 0, errmsg: 'ok' }); }
    return jsonResp({});
  }
  if (url.includes('/friendships/groups.json')) return jsonResp(groupsResponse);
  if (url.includes('/home_timeline.json')) return jsonResp({ statuses: [ ...user1Posts.map(p => ({ ...p, user: { id: '1' } })), ...user2Posts.map(p => ({ ...p, user: { id: '2' } })) ] });
  if (url.includes('/user_timeline.json')) {
    const m = url.match(/user_id=(\d+)/);
    const uid = m && m[1];
    if (uid === '1') return jsonResp({ statuses: user1Posts });
    if (uid === '2') return jsonResp({ statuses: user2Posts });
    return jsonResp({ statuses: [] });
  }
  return jsonResp({});
}

const chromeMock = {
  storage: {
    local: {
      get(keys) {
        if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
        return Promise.resolve(Object.fromEntries((keys || []).map(k => [k, store[k]])));
      },
      set(obj) { Object.assign(store, obj); return Promise.resolve(); },
    },
  },
  alarms: {
    create: (n, o) => { captured.alarm = { n, o }; },
    clear: (n, cb) => { if (cb) cb(true); },
    get: (n, cb) => { if (cb) cb(undefined); },
    onAlarm: { addListener: cb => captured.onAlarm = cb },
  },
  notifications: {
    create: (id, opts, cb) => { notifications.push({ id, opts }); if (cb) cb(); },
    clear: () => {},
    onClicked: { addListener: cb => captured.onClicked = cb },
    onButtonClicked: { addListener: cb => captured.onButtonClicked = cb },
  },
  runtime: {
    onInstalled: { addListener: cb => captured.onInstalled = cb },
    onStartup: { addListener: cb => captured.onStartup = cb },
    onMessage: { addListener: cb => captured.onMessage = cb },
    openOptionsPage: () => {},
    sendMessage: async (tabIdOrMsg, msg) => {
      if (typeof tabIdOrMsg === 'number' && msg && msg.type === 'xqFetch') {
        captured.contentScriptCall = msg;
        if (!contentScriptEnabled) throw new Error('Content script not responding');
        return { ok: true, status: 200, text: fetchMockText(msg.url) };
      }
      return {};
    },
  },
  offscreen: {
    createDocument: async (o) => { captured.offscreen = o; },
    closeDocument: async () => { captured.offscreenClosed = true; },
  },
  windows: {
    create: async (o) => { captured.win = o; captured.createCount++; return { id: 999 }; },
    update: async () => ({}),
    remove: async (id) => { captured.removed.push(id); },
    get: async (id) => windowsState.find(w => w.id === id) || null,
    onRemoved: { addListener: cb => captured.onWinRemoved = cb },
    getLastFocused: async () => ({ id: 1, focused: true, type: 'normal', left: 0, top: 0, width: 1920, height: 1080 }),
    getAll: async () => windowsState,
    getCurrent: async () => ({ id: 1, focused: true, type: 'normal', left: 0, top: 0, width: 1920, height: 1080 }),
  },
  system: {
    display: { getInfo: async () => [{ id: 'd1', isPrimary: true, workArea: { left: 0, top: 0, width: 1920, height: 1040 } }] },
  },
  cookies: {
    getAll: async () => cookieJar,
    get: async (o) => cookieJar.find(c => c.name === o.name) || null,
  },
  tabs: {
    query: async (q) => tabList.filter(t => t.status === 'complete'),
    create: async (o) => { captured.createdTab = o; const t = { id: 4242, status: 'complete', url: o.url }; tabList.push(t); return t; },
    get: async (id) => tabList.find(t => t.id === id) || { id, status: 'complete' },
    sendMessage: async (tabId, msg) => {
      if (msg && msg.type === 'xqFetch') {
        captured.contentScriptCall = msg;
        if (!contentScriptEnabled) throw new Error('CS not ready');
        return { ok: true, status: 200, text: fetchMockText(msg.url) };
      }
      return {};
    },
  },
  scripting: {
    executeScript: async (o) => {
      if (!scriptingEnabled) return [{ result: { ok: false, err: 'scripting disabled' } }];
      captured.scriptExec = o;
      const url = o.args && o.args[0];
      return [{ result: { ok: true, status: 200, text: fetchMockText(url) } }];
    },
  },
};

const sandbox = {
  chrome: chromeMock,
  navigator: { userAgent: 'Mozilla/5.0 Test' },
  fetch: fetchMock,
  console, setTimeout, clearTimeout, Promise, JSON,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const assert = (cond, msg) => console.log((cond ? 'PASS ' : 'FAIL ') + msg);

(async () => {
  console.log('=== 场景1：正常取特别关注分组（scripting 主路径）===');
  store.selectedUsers = ['1', '2'];    // 模拟「读取分组后默认全选」
  await sandbox.checkOnce();           // , 首次：只记录不通知
  assert(store.initialized === true, '首次检查后 initialized=true');
  assert(notifications.length === 0, '首次检查不发通知（避免刷历史帖）');
  assert(Number(store.lastIds['1']) === 101, '记录张三最大帖id=101');
  assert(captured.scriptExec !== undefined, '使用 scripting 主路径调 API');

  user1Posts = [ { id: 102, text: '<b>刚发的重磅</b>分析' }, { id: 101, text: '昨天' }, { id: 100, text: '更早' } ];
  notifications = [];
  await sandbox.checkOnce();
  assert(notifications.length === 1, '二次检查弹 1 条新帖通知');
  assert(/张三/.test(notifications[0].opts.title), '通知标题含博主名「张三」');
  assert(notifications[0].opts.requireInteraction === true, '通知 requireInteraction=true');
  assert(/刚发的重磅/.test(notifications[0].opts.message), '通知正文去HTML后含新帖内容');

  console.log('=== 场景2：特别关注为空 → 不监控任何人 ===');
  groupsResponse = [ { id: 999, name: '默认分组', users: [] } ];
  store.options = { intervalMin: 2, soundOn: false };
  delete store.selectedUsers;          // 勾选为空（未勾选任何博主）
  store.initialized = false; store.lastIds = {};
  notifications = [];
  await sandbox.checkOnce();
  assert(store.trackedCount === 0, '特别关注为空 → trackedCount=0（不监控任何人）');
  assert(notifications.length === 0, '无监控对象时不发通知');

  console.log('=== 场景2b：勾选子集生效（只监控勾选的博主）===');
  groupsResponse = [
    { id: 101, name: '特别关注', special: true,
      users: [ { id: '1', screen_name: '张三' }, { id: '2', screen_name: '李四' } ] },
  ];
  store.selectedUsers = ['2'];          // 只勾选李四
  store.options = { intervalMin: 2, soundOn: false };
  store.initialized = true; store.lastIds = { '1': 0, '2': 0 };
  notifications = [];
  await sandbox.checkOnce();
  assert(store.trackedCount === 1, '只勾选 1 人 → 监控 1 人');
  user2Posts = [ { id: 60, text: '李四新帖' }, ...user2Posts ];
  notifications = [];
  await sandbox.checkOnce();
  assert(notifications.length === 1, '勾选成员的新帖被检测到');
  assert(/李四/.test(notifications[0].opts.title), '通知标题含被勾选博主「李四」');
  assert(notifications[0].opts.message.indexOf('张三') === -1, '未勾选的张三不触发通知');

  console.log('=== 场景2c：勾选为空 + 有特别关注分组 → 仍不监控 ===');
  store.selectedUsers = [];            // 有分组但一个都不勾
  store.initialized = true; store.lastIds = {};
  notifications = [];
  await sandbox.checkOnce();
  assert(store.trackedCount === 0, '分组非空但勾选为空 → 不监控（用户要求：空=不监控）');

  console.log('=== 场景3：纯函数单测 ===');
  assert(sandbox.stripHtml('<p>aa</p><br>b<b>x</b>') === 'aa\nbx', 'stripHtml 去标签保留换行');
  assert(sandbox.truncate('一二三四五六七八九十', 5) === '一二三四…', 'truncate 截断');
  assert(sandbox.postUrl('1', '102') === 'https://xueqiu.com/1/102', 'postUrl');

  console.log('=== 场景4：声音 + 弹窗 ===');
  groupsResponse = [
    { id: 101, name: '特别关注', special: true,
      users: [ { id: '1', screen_name: '张三' }, { id: '2', screen_name: '李四' } ] },
  ];
  store.selectedUsers = ['1', '2'];   // 恢复全选（场景2c 曾置空）
  store.options = { intervalMin: 2, soundOn: true };
  store.initialized = true;
  store.lastIds = { '1': 200, '2': 50 };
  // 重置 user2 数据（场景2b 改过），保证本场景只有张三有 1 条新帖
  user2Posts = [ { id: 50, text: '李四旧帖' } ];
  if (captured.onWinRemoved) captured.onWinRemoved(999);
  captured.offscreen = undefined; captured.win = undefined;
  user1Posts = [ { id: 301, text: '声音弹窗测试' }, { id: 200, text: '旧' } ];
  notifications = [];
  await sandbox.checkOnce();
  assert(notifications.length === 1, '弹 1 条系统通知');
  assert(captured.offscreen && captured.offscreen.url === 'offscreen.html', '创建离屏文档播声音');
  assert(captured.win && captured.win.url === 'alert.html' && captured.win.type === 'popup', '弹出 alert 窗口');

  console.log('=== 场景5：登录检测 — scripting 主路径（groups.json 顶层数组）===');
  let loginRes = await new Promise(r => captured.onMessage({ type: 'apiGet', url: 'https://xueqiu.com/friendships/groups.json' }, {}, r));
  assert(loginRes.ok === true, 'scripting 主路径登录检测 ok=true');
  assert(Array.isArray(loginRes.data) && loginRes.data.length > 0, '返回分组【顶层数组】（已登录）');

  // 未登录（scripting 返回 error_code 400016）
  let notLoginRes = await new Promise(r =>
    captured.onMessage({ type: 'apiGet', url: 'https://xueqiu.com/friendships/groups.json?notlogin=1' }, {}, r));
  assert(notLoginRes.ok === false, '未登录时 ok=false');
  assert(/400016/.test(notLoginRes.err || ''), '识别 error_code 400016');

  console.log('=== 场景6：分层回退测试 ===');
  // 6a：scripting 关 + content script 开 → 用 content script 次路径
  scriptingEnabled = false; contentScriptEnabled = true;
  captured.scriptExec = undefined; captured.contentScriptCall = undefined;
  let r6a = await new Promise(r =>
    captured.onMessage({ type: 'apiGet', url: 'https://xueqiu.com/friendships/groups.json' }, {}, r));
  assert(r6a.ok === true, 'scripting关+CS开 → content script 次路径成功');
  assert(captured.contentScriptCall !== undefined, '使用 content script 路径');
  assert(captured.scriptExec === undefined, '未使用 scripting（已禁用）');

  // 6b：scripting 关 + content script 关（无可用取数路径）→ 即使有 cookie 也无法获取
  // （方案A：SW 跨域 fetch 无法携带雪球 Cookie，本扩展要求保持雪球标签页，由标签页内注入取数）
  scriptingEnabled = false; contentScriptEnabled = false;
  captured.scriptExec = undefined; captured.contentScriptCall = undefined;
  cookieJar = [ { name: 'xq_a_token', value: 'FALLBACK_TOKEN', httpOnly: true } ];
  delete store.xqCookie;
  let r6b = await new Promise(r =>
    captured.onMessage({ type: 'apiGet', url: 'https://xueqiu.com/friendships/groups.json' }, {}, r));
  assert(r6b.ok === false, '两条自动路径都关 → 即使有 cookie 也无法获取（需保持雪球标签页）');
  assert(/无法获取登录态/.test(r6b.err || ''), '错误提示引导保持雪球标签页');
  scriptingEnabled = true; contentScriptEnabled = true; cookieJar = [ { name: 'xq_a_token', value: 'TOKEN_ABC', httpOnly: true }, { name: 'u', value: '123' } ];

  console.log('=== 场景7：全不可用 → 返回明确错误 ===');
  scriptingEnabled = false; contentScriptEnabled = false;
  cookieJar = []; delete store.xqCookie; tabList = [];
  let failRes = await new Promise(r =>
    captured.onMessage({ type: 'apiGet', url: 'https://xueqiu.com/friendships/groups.json' }, {}, r));
  assert(failRes.ok === false, '全不可用时返回 ok=false');
  assert(/无法获取登录态/.test(failRes.err || ''), '错误信息含引导提示');
  scriptingEnabled = true; contentScriptEnabled = true;
  cookieJar = [ { name: 'xq_a_token', value: 'TOKEN_ABC', httpOnly: true }, { name: 'u', value: '123' } ];
  tabList = [ { id: 1, status: 'complete', url: 'https://xueqiu.com/' } ];

  console.log('=== 场景8：诊断功能 ===');
  scriptingEnabled = true; contentScriptEnabled = true;
  cookieJar = [ { name: 'xq_a_token', value: 'TOKEN_ABC', httpOnly: true } ];
  tabList = [ { id: 1, status: 'complete', url: 'https://xueqiu.com/' } ];
  delete store.xqCookie;
  let diag = await new Promise(r => captured.onMessage({ type: 'diagnose' }, {}, r));
  assert(diag.ok === true, 'diagnose 返回 ok=true');
  assert(diag.report.steps.length >= 5, '诊断报告含 ≥5 个环节步骤');
  const s2b = diag.report.steps.find(s => s.step.startsWith('②b'));
  assert(s2b && s2b.ok === true, '诊断②b scripting 主路径成功');
  assert(s2b && s2b.groupCount > 0, '②b 正确解析分组数（顶层数组）');
  assert(s2b && s2b.hasSpecialFollow === true, '②b 识别到「特别关注」分组');
  const s5 = diag.report.steps.find(s => s.step.startsWith('⑤'));
  assert(s5 && s5.ok === true && s5.groupCount > 0, '诊断⑤ fetchJSON 成功且 groupCount 正确');

  // content script 不可用时的诊断应给出 hint（且 ②b 仍成功，说明无影响）
  contentScriptEnabled = false;
  let diag2 = await new Promise(r => captured.onMessage({ type: 'diagnose' }, {}, r));
  assert(diag2.report.steps.some(s => s.step.startsWith('②') && s.ok === false && s.hint), 'CS不可用时诊断②给出修复 hint');
  assert(diag2.report.steps.find(s => s.step.startsWith('②b')).ok === true, 'CS不可用时②b仍成功（证明无影响）');
  contentScriptEnabled = true;

  console.log('=== 场景9：测试提醒按钮（验证通知+弹窗链路）===');
  let tn = await new Promise(r => captured.onMessage({ type: 'testNotify' }, {}, r));
  assert(tn.ok === true, 'testNotify 返回 ok=true（通知+弹窗链路不报错）');

  console.log('=== 场景10：错误日志永久保留 + 复制后清空 ===');
  // 注入 1 条错误 + 大量 INFO（超过 300，冲刷滚动缓冲）
  sandbox.logErr('测试错误：模拟一次失败');
  for (let i = 0; i < 305; i++) sandbox.log('info 填充 ' + i);
  await new Promise(r => setTimeout(r, 1200)); // 等防抖落盘
  let g10 = await new Promise(r => captured.onMessage({ type: 'getLog' }, {}, r));
  assert(g10.entries.filter(e => e.level === 'ERROR').length >= 1, '错误日志未被 305 条 INFO 冲刷掉');
  assert(g10.entries.length > 300, '合并后日志条数 >300（错误不在 300 滚动上限内）');
  // 模拟「复制日志」→ 清空错误永久缓冲
  let clr = await new Promise(r => captured.onMessage({ type: 'clearErrors' }, {}, r));
  assert(clr.ok === true, 'clearErrors 返回 ok=true');
  let g10b = await new Promise(r => captured.onMessage({ type: 'getLog' }, {}, r));
  assert(g10b.entries.filter(e => e.level === 'ERROR').length === 0, '复制后错误日志已清空');
  assert(g10b.entries.length > 0, '清空错误后 INFO 滚动日志仍在');

  console.log('=== 场景11：企业微信推送 ===');
  const wpost = { id: 777, user: { id: '1' }, _name: '张三', text: '<p>企微测试帖</p>' };

  // 11a：开启且配置完整 → 调 gettoken + 发消息
  delete store.wecomToken;
  captured.wecomTokenCall = 0; captured.wecomSendCall = 0;
  store.options = Object.assign(store.options || {}, { wecom: { enabled: true, corpid: 'C1', corpsecret: 'S1', agentid: 'A1', touser: 'zhangsan' } });
  await sandbox.pushWecom([wpost, wpost]);
  assert(captured.wecomTokenCall === 1, '企微开启+配置完整 → 调用 gettoken 1 次');
  assert(captured.wecomSendCall === 2, '两条新帖 → 调用 message/send 2 次');
  let g11 = await sandbox.getLog();
  assert(g11.some(e => /企微推送 ×2 条已发送/.test(e.msg)), '日志含「企微推送 ×2 条已发送」');

  // 11b：未开启 → 不调用
  captured.wecomSendCall = 0;
  store.options.wecom.enabled = false;
  await sandbox.pushWecom([wpost]);
  assert(captured.wecomSendCall === 0, '企微未开启 → 不调用 message/send');

  // 11c：开启但配置缺失（缺 corpid）→ 不调用，记 WARN
  captured.wecomSendCall = 0;
  store.options.wecom.enabled = true;
  store.options.wecom.corpid = '';
  await sandbox.pushWecom([wpost]);
  assert(captured.wecomSendCall === 0, '企微缺 corpid → 不调用 message/send（记 WARN）');

  // 11d：testWecom 接口（设置页「测试企微推送」按钮路径）
  store.options.wecom.corpid = 'C1'; // 恢复完整配置
  let tw = await new Promise(r => captured.onMessage({ type: 'testWecom', cfg: { enabled: true, corpid: 'C1', corpsecret: 'S1', agentid: 'A1', touser: '' } }, {}, r));
  assert(tw.ok === true, 'testWecom 配置完整 → 返回 ok=true');
  let tw2 = await new Promise(r => captured.onMessage({ type: 'testWecom', cfg: { enabled: true, corpid: '', corpsecret: '', agentid: '' } }, {}, r));
  assert(tw2.ok === false, 'testWecom 配置缺失 → 返回 ok=false');

  console.log('=== 场景A：特别关注超一页 → 必须翻页取全（防回归：曾只取第1页漏掉靠后成员）===');
  // 构造一个「不含内联 users」的特别关注分组，强制走 members.json 分页路径
  groupsResponse = [
    { id: 101, name: '特别关注', special: true },
  ];
  const mp1 = [], mp2 = [];
  for (let i = 1; i <= 20; i++) mp1.push({ id: String(i), screen_name: 'U' + i });
  for (let i = 21; i <= 25; i++) mp2.push({ id: String(i), screen_name: 'U' + i }); // 第25人即「被漏掉的那位」
  membersPages = [ { users: mp1, maxPage: 2 }, { users: mp2, maxPage: 2 } ];
  let sf = await new Promise(r => captured.onMessage({ type: 'getSpecialFollow' }, {}, r));
  assert(sf && sf.ok === true, 'getSpecialFollow 返回 ok=true');
  assert(sf.users && sf.users.length === 25, '翻页取全 25 人（第2页 U21~U25 不再漏）');
  assert(sf.users.some(u => u.id === '25'), '第2页末位成员 U25 已被取到（修复分页漏人）');
  membersPages = null;

  console.log('=== 场景12：弹窗不重复创建 + 全部关闭（防回归多窗口堆积 bug） ===');
  // 先清空可能残留的窗口集合（跨场景隔离，内部会 alertWinIds.clear()）
  captured.removed = [];
  await sandbox.closeAllAlertWindows();
  captured.createCount = 0;
  captured.removed = [];

  // 模拟 MV3 service worker 重启：内存集合已空，但上辈子开出的 alert 弹窗仍活着（孤儿窗口）
  windowsState = [ alertWin(777) ];
  // 连续两次触发开窗口（相当于多次轮询 / 重启后重入）
  await sandbox.openAlertWindow();
  await sandbox.openAlertWindow();
  assert(captured.createCount === 0, '已有孤儿 alert 窗口 → 复用不新建（修复前会堆出几十个）');

  // 再注入一个真正的窗口，依旧不应新建
  windowsState = [ alertWin(777), alertWin(888) ];
  captured.createCount = 0;
  await sandbox.openAlertWindow();
  assert(captured.createCount === 0, '已有 2 个 alert 窗口 → 仍不新建（复用）');

  // 全部关闭：关掉所有 alert 弹窗（含跨 SW 的孤儿窗口）
  captured.removed = [];
  await sandbox.closeAllAlertWindows();
  assert(captured.removed.includes(777) && captured.removed.includes(888), 'closeAllAlertWindows 关掉了全部 alert 窗口（777+888）');

  // 关闭后再开 → 应新建 1 个
  windowsState = [ { id: 1, focused: true, type: 'normal', left: 0, top: 0, width: 1920, height: 1080 } ];
  captured.createCount = 0;
  await sandbox.openAlertWindow();
  assert(captured.createCount === 1, '全部关闭后再触发 → 新建 1 个窗口');

  console.log('=== 场景13：雪球 WAF 阻断页 → 熔断 + 冷却期跳过（防回归：不识别会每轮重撞墙） ===');
  // 重置熔断状态（内存 + storage）
  sandbox.rlState = null;
  store.rateLimit = undefined;
  blockUserTimeline = true;                       // 让 user_timeline 返回阻断 HTML 页
  groupsResponse = [ { id: 101, name: '特别关注', special: true, users: [ { id: '1', screen_name: '张三' } ] } ];
  store.options = { intervalMin: 2, soundOn: false };
  store.initialized = true; store.lastIds = { '1': 0 };
  notifications = [];
  await sandbox.checkOnce();                      // 本轮应被风控中断
  assert(store.rateLimit && store.rateLimit.retryCount >= 1, '阻断页被识别 → 触发熔断（retryCount≥1）');
  assert(store.rateLimit && store.rateLimit.blockedUntil > Date.now(), '熔断设置冷却期（blockedUntil > now）');
  assert(/BLOCKED|阻断/.test(store.lastError || ''), '记录风控中断错误（lastError 含 BLOCKED/阻断）');
  assert(notifications.length === 0, '风控中断时不发通知');

  const lastCheckAfterTrip = store.lastCheck;
  await sandbox.checkOnce();                      // 冷却期内 → 应直接跳过
  assert(store.lastCheck === lastCheckAfterTrip, '冷却期内跳过本轮（不更新 lastCheck，不再撞墙）');

  // 复位，避免污染（若后续再加场景）
  blockUserTimeline = false;
  sandbox.rlState = null;
  store.rateLimit = undefined;

  console.log('=== 完成 ===');
})();
