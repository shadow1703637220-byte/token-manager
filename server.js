'use strict';
/*
 * 本地 Token 管理工具 - 零依赖 Node 本地版
 * - 所有 Key 只存在本机 data.json，只从本机直连各平台官方接口，不经过任何第三方服务器
 * - 启动: node server.js  然后打开 http://127.0.0.1:3210
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3210;
const DIST = process.env.TM_DIST === '1';
function resolveDataFile() {
  if (process.env.TM_DATA_DIR) return path.join(process.env.TM_DATA_DIR, 'data.json');
  if (DIST) {
    const home = os.homedir();
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'TokenManager', 'data.json');
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'TokenManager', 'data.json');
    return path.join(home, '.local', 'share', 'TokenManager', 'data.json');
  }
  return path.join(__dirname, 'data.json');
}
const DATA_FILE = resolveDataFile();
const APP_VERSION = '1.0.1';
const UPDATE_REPO = 'shadow1703637220-byte/token-manager';

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    if (!Array.isArray(d.accounts)) d.accounts = [];
    if (!Array.isArray(d.items)) d.items = [];
    return d;
  } catch (e) { return { accounts: [], items: [] }; }
}
function saveData(d) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function openBrowser() {
  const url = 'http://127.0.0.1:' + PORT + '/';
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  try { require('child_process').exec(cmd, function () {}); } catch (e) { /* 打不开就算了，用户可手动访问 */ }
}
function cmpVersion(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(function (x) { return parseInt(x, 10) || 0; });
  const pb = String(b || '').replace(/^v/i, '').split('.').map(function (x) { return parseInt(x, 10) || 0; });
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d !== 0) return d > 0 ? 1 : -1; }
  return 0;
}
let updateCache = { at: 0, latest: null, url: '' };
async function checkUpdate() {
  if (updateCache.at > 0 && Date.now() - updateCache.at < 6 * 3600 * 1000) return updateCache;
  updateCache.at = Date.now();
  try {
    const j = await fetchJson('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { 'User-Agent': 'TokenManager', 'Accept': 'application/vnd.github+json' });
    if (j && j.tag_name) { updateCache.latest = String(j.tag_name).replace(/^v/i, ''); updateCache.url = j.html_url || ''; }
  } catch (e) { /* 仓库还不存在或没网时静默，不打扰使用 */ }
  return updateCache;
}
function uid() { return crypto.randomBytes(6).toString('hex'); }
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 3) + '****' + k.slice(-4);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/* ---------------- Provider parsers (pure, testable) ---------------- */
function parseDeepSeek(json) {
  const infos = (json && json.balance_infos) || [];
  if (!infos.length) throw new Error('DeepSeek 返回无余额信息');
  const info = infos[0];
  const total = num(info.total_balance);
  const granted = num(info.granted_balance) || 0;
  const topped = num(info.topped_up_balance) || 0;
  return { remaining: total, total: granted + topped || total, used: null, granted: granted, unit: (info.currency || 'CNY') === 'USD' ? 'USD' : 'CNY', detail: '赠送 ¥/ $' + granted + ' · 充值 ' + topped };
}
function parseSiliconFlow(json) {
  const d = json && json.data;
  if (!d) throw new Error('硅基流动返回异常');
  return { remaining: num(d.totalBalance), total: null, used: null, granted: num(d.balance), unit: 'CNY', detail: '赠送 ' + d.balance + ' · 充值 ' + d.chargeBalance + ' · 状态 ' + (d.status || '') };
}
function parseMoonshot(json) {
  const d = json && json.data;
  if (!d) throw new Error('Kimi 返回异常');
  return { remaining: num(d.available_balance), total: null, used: null, granted: num(d.voucher_balance), unit: 'CNY', detail: '代金券 ' + d.voucher_balance + ' · 现金 ' + d.cash_balance };
}
function parseOpenRouter(creditsJson, keyJson) {
  const c = creditsJson || {};
  const kd = (keyJson && keyJson.data) || {};
  let remaining = null, total = null, used = null;
  if (num(c.total_credits) !== null) { total = num(c.total_credits); used = num(c.total_usage) || 0; remaining = total - used; }
  else if (num(kd.limit_remaining) !== null) { remaining = num(kd.limit_remaining); total = num(kd.limit); used = num(kd.usage); }
  else if (num(kd.usage) !== null) { used = num(kd.usage); }
  if (remaining === null && used === null) throw new Error('OpenRouter 返回无额度信息');
  return { remaining: remaining, total: total, used: used, granted: null, unit: 'USD', detail: kd.label ? ('Key: ' + kd.label) : '' };
}
// NewAPI /api/usage/token/ : raw quota, default 500000 = 1 USD
function parseNewApiTokenUsage(json, quotaPerUnit) {
  const d = json && json.data;
  if (!d) throw new Error('中转站返回异常（未拿到 token 用量）');
  const q = quotaPerUnit && quotaPerUnit > 0 ? quotaPerUnit : 500000;
  const granted = num(d.total_granted), usedRaw = num(d.total_used), avail = num(d.total_available);
  let expiresAt = null;
  if (d.expires_at && Number(d.expires_at) > 0) expiresAt = new Date(Number(d.expires_at) * 1000).toISOString().slice(0, 10);
  if (d.unlimited_quota) return { remaining: null, unlimited: true, total: null, used: usedRaw !== null ? usedRaw / q : null, granted: null, unit: 'USD', expiresAt: expiresAt, detail: '该 Key 不限额' };
  return { remaining: avail !== null ? avail / q : null, total: granted !== null ? granted / q : null, used: usedRaw !== null ? usedRaw / q : null, granted: null, unit: 'USD', expiresAt: expiresAt, detail: '' };
}
// OneAPI 系 billing 接口：subscription 给总额度(USD)，usage 给已用(美分)
function parseBilling(subJson, usageJson) {
  const hard = num(subJson && subJson.hard_limit_usd);
  if (hard === null) throw new Error('billing 接口无 hard_limit_usd');
  const usedCents = num(usageJson && usageJson.total_usage) || 0;
  const used = usedCents / 100;
  if (hard >= 100000000) return { remaining: null, unlimited: true, total: null, used: used, granted: null, unit: 'USD', expiresAt: null, detail: 'billing 接口：该 Key 不限额' };
  return { remaining: Math.max(hard - used, 0), total: hard, used: used, granted: null, unit: 'USD', expiresAt: null, detail: '经 billing 接口查询（部分站 usage 只统计近 100 天，以站内为准）' };
}
// RouteOpen 类自研网关：/v1/balance、/v1/key/info、/v1/usage，字段名各家不一，宽容提取
function parseZhipuQuota(json) {
  if (json && (json.success === false || (json.code && Number(json.code) !== 200))) throw new Error('智谱接口返回：' + (json.msg || json.message || ('code ' + json.code)));
  const d = (json && json.data && typeof json.data === 'object') ? json.data : (json || {});
  const limits = Array.isArray(d.limits) ? d.limits : [];
  const tokens = limits.filter(function (l) { return l && l.type === 'TOKENS_LIMIT'; });
  function pctOf(l) {
    if (!l) return null;
    if (typeof l.percentage === 'number') return l.percentage;
    if (typeof l.remaining === 'number' && typeof l.usage === 'number' && l.usage > 0) return Math.round((1 - l.remaining / l.usage) * 1000) / 10;
    if (typeof l.currentValue === 'number' && typeof l.usage === 'number' && l.usage > 0) return Math.round(l.currentValue / l.usage * 1000) / 10;
    return null;
  }
  const h5 = tokens.find(function (l) { return Number(l.unit) === 3; }) || tokens[0];
  const wk = tokens.find(function (l) { return Number(l.unit) === 6; });
  const p5 = pctOf(h5);
  if (p5 === null) throw new Error('没查到套餐额度——这个 Key 可能不是 GLM Coding Plan 套餐的；智谱普通按量付费余额官方没有开放查询接口');
  const pw = pctOf(wk);
  const parts = ['5小时窗口已用 ' + p5 + '%'];
  if (pw !== null) parts.push('周窗口已用 ' + pw + '%');
  if (d.level) parts.push('套餐 ' + String(d.level).toUpperCase());
  if (h5 && h5.nextResetTime) parts.push('5h重置于 ' + new Date(h5.nextResetTime).toLocaleString('zh-CN'));
  return { total: 100, used: p5, remaining: Math.max(0, Math.round((100 - p5) * 10) / 10), unit: '%', detail: parts.join(' · '), expiresAt: null };
}

function parseGenericKeyInfo(json) {
  const root = (json && typeof json === 'object') ? json : {};
  const o = (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) ? root.data : root;
  function pick(names) { for (const n of names) { const v = num(o[n]); if (v !== null) return v; } return null; }
  let remaining = pick(['balance', 'remaining', 'remain', 'available_balance', 'available', 'limit_remaining', 'remaining_quota', 'quota_remaining', 'left', 'credit_balance']);
  const total = pick(['total', 'limit', 'quota', 'total_quota', 'max_budget', 'budget', 'hard_limit_usd', 'total_credits', 'granted']);
  let used = pick(['used', 'usage', 'spend', 'total_spend', 'used_quota', 'consumed']);
  if (used === null) { const tu = num(o.total_usage); if (tu !== null) used = tu / 100; }
  const unit = typeof o.currency === 'string' ? o.currency : (typeof o.unit === 'string' ? o.unit : 'USD');
  if (remaining === null && total !== null && used !== null) remaining = Math.max(total - used, 0);
  if (remaining !== null) return { remaining: remaining, total: total, used: used, granted: null, unit: unit, expiresAt: null, detail: '经 /v1 接口直读（自研网关）' };
  if (used !== null) return { remaining: null, total: null, used: used, granted: null, unit: unit, expiresAt: null, detail: '该站接口只返回已用量：已用 ' + used + ' ' + unit };
  throw new Error('格式没认出，返回字段：' + Object.keys(o).slice(0, 12).join(','));
}
function normalizeBase(u) {
  return String(u || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}
// NewAPI /api/user/self : account level quota
function parseNewApiUserSelf(json, quotaPerUnit) {
  const d = json && json.data;
  if (!d || num(d.quota) === null) throw new Error('中转站返回异常（未拿到账户额度）');
  const q = quotaPerUnit && quotaPerUnit > 0 ? quotaPerUnit : 500000;
  const remain = num(d.quota) / q, used = (num(d.used_quota) || 0) / q;
  return { remaining: remain, total: remain + used, used: used, granted: null, unit: 'USD', expiresAt: null, detail: '请求次数 ' + (d.request_count || 0) + (d.group ? ' · 分组 ' + d.group : '') };
}

/* ---------------- 自记额度任务栏：刷新周期处理 ---------------- */
function advDate(iso, cycle, days) {
  const d = new Date(iso);
  if (cycle === 'daily') d.setDate(d.getDate() + 1);
  else if (cycle === 'weekly') d.setDate(d.getDate() + 7);
  else if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'custom' && Number(days) > 0) d.setDate(d.getDate() + Number(days));
  else return null;
  return d.toISOString();
}
// 到了下次刷新时间：已打勾的自动恢复可用；有周期的把时间顺延到未来最近一档
function normalizeItem(it, now) {
  let changed = false;
  if (it.nextRefreshAt && new Date(it.nextRefreshAt) <= now) {
    if (it.cycle && it.cycle !== 'none') {
      let nx = it.nextRefreshAt, guard = 0;
      while (new Date(nx) <= now && guard < 500) { const a = advDate(nx, it.cycle, it.cycleDays); if (!a) break; nx = a; guard++; }
      if (nx !== it.nextRefreshAt) { it.nextRefreshAt = nx; changed = true; }
      if (it.done) { it.done = false; it.doneAt = null; changed = true; }
    } else if (it.done) {
      it.done = false; it.doneAt = null; it.nextRefreshAt = null; changed = true;
    }
  }
  return changed;
}
function normalizeItems(d) {
  const now = new Date();
  let any = false;
  (d.items || []).forEach(function (it) { if (normalizeItem(it, now)) any = true; });
  if (any) saveData(d);
}
function publicItem(it) {
  let inMs = null;
  if (it.nextRefreshAt) inMs = new Date(it.nextRefreshAt) - new Date();
  return { id: it.id, title: it.title, note: it.note || '', url: it.url || '', keyMask: maskKey(it.key), nextRefreshAt: it.nextRefreshAt || null, cycle: it.cycle || 'none', cycleDays: it.cycleDays || '', done: !!it.done, doneAt: it.doneAt || null, inMs: inMs };
}
function parseTimeInput(v) {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

const PROVIDERS = {
  deepseek: { name: 'DeepSeek', home: 'https://platform.deepseek.com/usage', needKey: true },
  siliconflow: { name: '硅基流动 SiliconFlow', home: 'https://cloud.siliconflow.cn/account/balance', needKey: true },
  moonshot: { name: 'Kimi / Moonshot', home: 'https://platform.kimi.com/console/account', needKey: true },
  openrouter: { name: 'OpenRouter', home: 'https://openrouter.ai/settings/credits', needKey: true },
  zhipu: { name: '智谱 GLM (Coding Plan)', home: 'https://open.bigmodel.cn/', needKey: true },
  newapi: { name: '中转站 (NewAPI/OneAPI)', home: '', needKey: true },
  manual: { name: '手动记账', home: '', needKey: false }
};

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 15000);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* keep null */ }
    if (!r.ok) throw new Error('HTTP ' + r.status + (json && (json.error && json.error.message || json.message) ? ' ' + (json.error && json.error.message || json.message) : ''));
    if (json === null) throw new Error('返回不是 JSON');
    return json;
  } catch (e) {
    if (e && (e.name === 'AbortError' || String(e.message || '').indexOf('aborted') > -1)) throw new Error('查询超时（15秒）——检查网络/代理，或该平台在当前网络下连不上');
    throw e;
  } finally { clearTimeout(t); }
}

async function refreshAccount(acc) {
  const bearer = { Authorization: 'Bearer ' + acc.apiKey, Accept: 'application/json' };
  if (acc.provider === 'deepseek') return parseDeepSeek(await fetchJson('https://api.deepseek.com/user/balance', bearer));
  if (acc.provider === 'siliconflow') {
    const host = acc.baseUrl && acc.baseUrl.indexOf('.com') > -1 ? 'https://api.siliconflow.com' : 'https://api.siliconflow.cn';
    return parseSiliconFlow(await fetchJson(host + '/v1/user/info', bearer));
  }
  if (acc.provider === 'moonshot') {
    const host = acc.baseUrl && acc.baseUrl.indexOf('moonshot.ai') > -1 ? 'https://api.moonshot.ai' : 'https://api.moonshot.cn';
    return parseMoonshot(await fetchJson(host + '/v1/users/me/balance', bearer));
  }
  if (acc.provider === 'openrouter') {
    let credits = null, key = null, err = null;
    try { credits = await fetchJson('https://openrouter.ai/api/v1/credits', bearer); } catch (e) { err = e; }
    try { key = await fetchJson('https://openrouter.ai/api/v1/auth/key', bearer); } catch (e) { err = err || e; }
    if (!credits && !key) throw err || new Error('OpenRouter 查询失败');
    return parseOpenRouter(credits, key);
  }
  if (acc.provider === 'zhipu') {
    const zurl = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
    try {
      return parseZhipuQuota(await fetchJson(zurl, { Authorization: acc.apiKey, Accept: 'application/json' }));
    } catch (e) {
      if (/HTTP (401|403)/.test(e.message)) return parseZhipuQuota(await fetchJson(zurl, bearer));
      throw e;
    }
  }
  if (acc.provider === 'newapi') {
    if (!acc.baseUrl) throw new Error('中转站必须填站点地址 Base URL');
    const base = normalizeBase(acc.baseUrl);
    const hdrs = { Authorization: 'Bearer ' + acc.apiKey, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };
    const attempts = [];
    if (acc.accessToken && acc.userId) {
      try {
        const j = await fetchJson(base + '/api/user/self', { Authorization: 'Bearer ' + acc.accessToken, 'New-Api-User': String(acc.userId), Accept: 'application/json', 'User-Agent': hdrs['User-Agent'] });
        return parseNewApiUserSelf(j, num(acc.quotaPerUnit));
      } catch (e) { attempts.push('账户接口：' + String(e.message || e)); if (!acc.apiKey) throw new Error(attempts.join('；')); }
    }
    if (acc.apiKey) {
      try { return parseNewApiTokenUsage(await fetchJson(base + '/api/usage/token/', hdrs), num(acc.quotaPerUnit)); }
      catch (e) { attempts.push('token接口(/)：' + String(e.message || e)); }
      try { return parseNewApiTokenUsage(await fetchJson(base + '/api/usage/token', hdrs), num(acc.quotaPerUnit)); }
      catch (e) { attempts.push('token接口：' + String(e.message || e)); }
      try {
        const sub = await fetchJson(base + '/dashboard/billing/subscription', hdrs);
        const usage = await fetchJson(base + '/dashboard/billing/usage', hdrs);
        return parseBilling(sub, usage);
      } catch (e) { attempts.push('billing接口：' + String(e.message || e)); }
      const v1paths = ['/v1/balance', '/v1/key/info', '/v1/usage'];
      for (const vp of v1paths) {
        try { return parseGenericKeyInfo(await fetchJson(base + vp, hdrs)); }
        catch (e) { attempts.push('v1接口(' + vp + ')：' + String(e.message || e)); }
      }
    }
    throw new Error('几条路都没查到——' + attempts.join('；') + '。若全是 404，多半是站点地址填成了 API 域名：点卡片「改地址」换成能打开网站控制台的域名再试；还不行把报错+站名发我，我按它家接口再适配');
  }
  if (acc.provider === 'manual') {
    const total = num(acc.manualTotal) || 0, used = num(acc.manualUsed) || 0;
    return { remaining: Math.max(total - used, 0), total: total, used: used, granted: null, unit: acc.manualUnit || 'CNY', expiresAt: acc.expiresAt || null, detail: '手动记账' };
  }
  throw new Error('未知平台');
}

/* ---------------- HTTP server ---------------- */
function publicAccount(acc) {
  const s = acc.snapshot || {};
  let remainPct = null;
  if (s.remaining !== null && s.remaining !== undefined && s.total) remainPct = Math.round(s.remaining / s.total * 1000) / 10;
  let daysLeft = null;
  const exp = s.expiresAt || acc.expiresAt;
  if (exp) daysLeft = Math.ceil((new Date(exp + 'T23:59:59') - new Date()) / 86400000);
  return {
    id: acc.id, provider: acc.provider, providerName: (PROVIDERS[acc.provider] || {}).name || acc.provider,
    label: acc.label, keyMask: maskKey(acc.apiKey), baseUrl: acc.baseUrl || '',
    manualTotal: acc.manualTotal, manualUsed: acc.manualUsed, manualUnit: acc.manualUnit,
    loginUrl: acc.loginUrl || (PROVIDERS[acc.provider] || {}).home || '',
    rechargeUrl: acc.rechargeUrl || '',
    jumpUrl: acc.rechargeUrl || acc.loginUrl || (acc.provider === 'newapi' ? (acc.baseUrl || '') : '') || (PROVIDERS[acc.provider] || {}).home || '',
    snapshot: acc.snapshot || null, remainPct: remainPct, daysLeft: daysLeft,
    low: (remainPct !== null && remainPct < 20) || (s.remaining !== null && s.remaining !== undefined && s.remaining <= 0) || (daysLeft !== null && daysLeft <= 7 && daysLeft >= 0),
    expired: daysLeft !== null && daysLeft < 0
  };
}
function send(res, code, obj, type) {
  const body = type === 'html' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': type === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve) {
    let b = '';
    req.on('data', function (c) { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/') return send(res, 200, HTML, 'html');
    if (req.method === 'GET' && p === '/api/update') {
      const u = await checkUpdate();
      return send(res, 200, { current: APP_VERSION, latest: u.latest, available: !!(u.latest && cmpVersion(u.latest, APP_VERSION) > 0), url: u.url || ('https://github.com/' + UPDATE_REPO + '/releases') });
    }
    if (req.method === 'GET' && p === '/api/accounts') {
      const d = loadData();
      normalizeItems(d);
      return send(res, 200, { accounts: d.accounts.map(publicAccount), providers: PROVIDERS, items: (d.items || []).map(publicItem) });
    }
    if (req.method === 'POST' && p === '/api/accounts') {
      const body = await readBody(req);
      if (!PROVIDERS[body.provider]) return send(res, 400, { error: '平台不对' });
      if (!body.label) return send(res, 400, { error: '给这个账户起个名字' });
      if (PROVIDERS[body.provider].needKey && !body.apiKey && body.provider !== 'newapi') return send(res, 400, { error: '请填 API Key' });
      if (body.provider === 'newapi' && !body.apiKey && !(body.accessToken && body.userId)) return send(res, 400, { error: '中转站二选一：填 API Key，或填系统访问令牌+用户ID' });
      const d = loadData();
      const acc = { id: uid(), provider: body.provider, label: String(body.label).slice(0, 60), apiKey: body.apiKey || '', baseUrl: body.baseUrl || '', accessToken: body.accessToken || '', userId: body.userId || '', quotaPerUnit: body.quotaPerUnit || '', manualTotal: body.manualTotal, manualUsed: body.manualUsed, manualUnit: body.manualUnit || 'CNY', expiresAt: body.expiresAt || '', loginUrl: body.loginUrl || '', rechargeUrl: body.rechargeUrl || body.loginUrl || '', snapshot: null };
      d.accounts.push(acc); saveData(d);
      return send(res, 200, { account: publicAccount(acc) });
    }
    const mRefresh = p.match(/^\/api\/accounts\/([a-f0-9]+)\/refresh$/);
    if (req.method === 'POST' && mRefresh) {
      const d = loadData(); const acc = d.accounts.find(function (a) { return a.id === mRefresh[1]; });
      if (!acc) return send(res, 404, { error: '账户不存在' });
      try {
        const snap = await refreshAccount(acc);
        acc.snapshot = Object.assign({}, snap, { ok: true, at: new Date().toISOString(), error: '' });
      } catch (e) {
        acc.snapshot = Object.assign({}, acc.snapshot || {}, { ok: false, at: new Date().toISOString(), error: String(e.message || e) });
      }
      saveData(d); return send(res, 200, { account: publicAccount(acc) });
    }
    const mUsed = p.match(/^\/api\/accounts\/([a-f0-9]+)\/used$/);
    if (req.method === 'POST' && mUsed) {
      const body = await readBody(req);
      const d = loadData(); const acc = d.accounts.find(function (a) { return a.id === mUsed[1]; });
      if (!acc) return send(res, 404, { error: '账户不存在' });
      acc.manualUsed = num(body.used) || 0;
      try { const snap = await refreshAccount(acc); acc.snapshot = Object.assign({}, snap, { ok: true, at: new Date().toISOString(), error: '' }); } catch (e) { /* ignore */ }
      saveData(d); return send(res, 200, { account: publicAccount(acc) });
    }
    const mDel = p.match(/^\/api\/accounts\/([a-f0-9]+)$/);
    if (req.method === 'DELETE' && mDel) {
      const d = loadData(); d.accounts = d.accounts.filter(function (a) { return a.id !== mDel[1]; }); saveData(d);
      return send(res, 200, { ok: true });
    }
    const mKey = p.match(/^\/api\/accounts\/([a-f0-9]+)\/key$/);
    if (req.method === 'GET' && mKey) {
      const d = loadData(); const acc = d.accounts.find(function (a) { return a.id === mKey[1]; });
      if (!acc) return send(res, 404, { error: '账户不存在' });
      return send(res, 200, { key: acc.apiKey || '', accessToken: acc.accessToken || '' });
    }
    const mBase = p.match(/^\/api\/accounts\/([a-f0-9]+)\/base$/);
    if (req.method === 'POST' && mBase) {
      const body = await readBody(req);
      const d = loadData(); const acc = d.accounts.find(function (a) { return a.id === mBase[1]; });
      if (!acc) return send(res, 404, { error: '账户不存在' });
      acc.baseUrl = String(body.baseUrl || '').trim();
      saveData(d); return send(res, 200, { account: publicAccount(acc) });
    }
    const mJump = p.match(/^\/api\/accounts\/([a-f0-9]+)\/jump$/);
    if (req.method === 'POST' && mJump) {
      const body = await readBody(req);
      const d = loadData(); const acc = d.accounts.find(function (a) { return a.id === mJump[1]; });
      if (!acc) return send(res, 404, { error: '账户不存在' });
      acc.rechargeUrl = String(body.url || '').trim();
      saveData(d); return send(res, 200, { account: publicAccount(acc) });
    }
    if (req.method === 'POST' && p === '/api/items') {
      const body = await readBody(req);
      if (!body.title) return send(res, 400, { error: '给这条额度起个名字' });
      const d = loadData();
      if (!Array.isArray(d.items)) d.items = [];
      const it = { id: uid(), title: String(body.title).slice(0, 60), note: String(body.note || '').slice(0, 120), url: String(body.url || '').slice(0, 300), key: String(body.key || '').slice(0, 300), nextRefreshAt: parseTimeInput(body.nextRefreshAt), cycle: ['daily', 'weekly', 'monthly', 'custom'].indexOf(body.cycle) > -1 ? body.cycle : 'none', cycleDays: body.cycleDays || '', done: false, doneAt: null, createdAt: new Date().toISOString() };
      d.items.push(it); saveData(d);
      return send(res, 200, { item: publicItem(it) });
    }
    const mItemKey = p.match(/^\/api\/items\/([a-f0-9]+)\/key$/);
    if (req.method === 'GET' && mItemKey) {
      const d = loadData(); const it = (d.items || []).find(function (x) { return x.id === mItemKey[1]; });
      if (!it) return send(res, 404, { error: '条目不存在' });
      return send(res, 200, { key: it.key || '' });
    }
    const mToggle = p.match(/^\/api\/items\/([a-f0-9]+)\/toggle$/);
    if (req.method === 'POST' && mToggle) {
      const d = loadData(); const it = (d.items || []).find(function (x) { return x.id === mToggle[1]; });
      if (!it) return send(res, 404, { error: '条目不存在' });
      it.done = !it.done; it.doneAt = it.done ? new Date().toISOString() : null;
      saveData(d); return send(res, 200, { item: publicItem(it) });
    }
    const mItemUpd = p.match(/^\/api\/items\/([a-f0-9]+)\/update$/);
    if (req.method === 'POST' && mItemUpd) {
      const body = await readBody(req);
      const d = loadData(); const it = (d.items || []).find(function (x) { return x.id === mItemUpd[1]; });
      if (!it) return send(res, 404, { error: '条目不存在' });
      if (body.nextRefreshAt !== undefined) it.nextRefreshAt = parseTimeInput(body.nextRefreshAt);
      if (body.cycle !== undefined) it.cycle = ['daily', 'weekly', 'monthly', 'custom'].indexOf(body.cycle) > -1 ? body.cycle : 'none';
      if (body.cycleDays !== undefined) it.cycleDays = body.cycleDays;
      if (body.title) it.title = String(body.title).slice(0, 60);
      if (body.note !== undefined) it.note = String(body.note).slice(0, 120);
      if (body.url !== undefined) it.url = String(body.url).slice(0, 300);
      if (body.key !== undefined) it.key = String(body.key).slice(0, 300);
      normalizeItem(it, new Date());
      saveData(d); return send(res, 200, { item: publicItem(it) });
    }
    const mItemDel = p.match(/^\/api\/items\/([a-f0-9]+)$/);
    if (req.method === 'DELETE' && mItemDel) {
      const d = loadData(); d.items = (d.items || []).filter(function (x) { return x.id !== mItemDel[1]; }); saveData(d);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/refresh-all') {
      const d = loadData();
      for (const acc of d.accounts) {
        try { const snap = await refreshAccount(acc); acc.snapshot = Object.assign({}, snap, { ok: true, at: new Date().toISOString(), error: '' }); }
        catch (e) { acc.snapshot = Object.assign({}, acc.snapshot || {}, { ok: false, at: new Date().toISOString(), error: String(e.message || e) }); }
      }
      saveData(d); return send(res, 200, { accounts: d.accounts.map(publicAccount) });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
});

/* ---------------- Frontend (no backticks inside) ---------------- */
const HTML = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>本地 Token 管家</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;background:#F5F7FA;color:#111827}header{padding:24px 24px 4px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;max-width:1200px;margin:0 auto}h1{margin:0;font-size:24px}.sub{color:#6B7280;font-size:13px;margin-top:6px;max-width:720px;line-height:1.6}button{background:#6366F1;color:#fff;border:0;border-radius:10px;padding:9px 16px;cursor:pointer;font-size:14px}button:hover{background:#4F46E5}button.ghost{background:#fff;color:#111827;border:1px solid #E5E7EB}button.ghost:hover{background:#F3F4F6}button.danger{background:transparent;color:#DC2626;padding:4px 8px;font-size:12px}button.danger:hover{background:#FEF2F2}button:disabled{opacity:.5}.wrap{padding:16px 24px 40px;max-width:1200px;margin:0 auto}.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}.stat{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px 18px;min-width:150px;box-shadow:0 1px 2px rgba(16,24,40,.04)}.stat b{font-size:20px;display:block}.stat span{color:#6B7280;font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}.card{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}.card.low{border-color:#F59E0B}.card.expired,.card.err{border-color:#DC2626}.card h3{margin:0 0 2px;font-size:16px}.prov{color:#6B7280;font-size:12px}.keymask{cursor:pointer;word-break:break-all;color:#4F46E5}.remain{font-size:28px;font-weight:700;margin:10px 0 2px}.unit{font-size:13px;color:#6B7280;font-weight:400}.bar{height:8px;background:#E5E7EB;border-radius:99px;overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;background:#6366F1}.bar i.warn{background:#F59E0B}.bar i.bad{background:#DC2626}.meta{color:#6B7280;font-size:12px;line-height:1.7}.err-text{color:#DC2626;font-size:12px}.actions{display:flex;gap:8px;margin-top:12px;align-items:center}form{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}form h3{margin:0 0 12px}label{display:block;font-size:12px;color:#6B7280;margin:10px 0 4px}input,select{width:100%;background:#fff;color:#111827;border:1px solid #D1D5DB;border-radius:10px;padding:9px 10px;font-size:14px}input:focus,select:focus{outline:2px solid #C7D2FE;border-color:#6366F1}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.row{grid-template-columns:1fr}}.hint{font-size:12px;color:#6B7280;line-height:1.6;background:#EEF2FF;border-radius:10px;padding:10px 12px;margin-top:10px}a{color:#4F46E5}.item{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:12px 14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(16,24,40,.04)}.item.done{opacity:.55}.item .t{font-size:15px}.item.done .t{text-decoration:line-through}.chk{width:22px;height:22px;flex:none;cursor:pointer;accent-color:#6366F1}.chip{font-size:11px;padding:2px 8px;border-radius:99px;background:#DCFCE7;color:#16A34A}.chip.off{background:#FEF3C7;color:#B45309}/* 交互动效：悬停上浮/按压回弹/进度平滑 */.card,.item{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.card:hover{transform:translateY(-3px);border-color:#C7CDFB;box-shadow:0 12px 24px rgba(79,70,229,.13)}.item:hover{transform:translateY(-2px);border-color:#C7CDFB;box-shadow:0 8px 20px rgba(79,70,229,.10)}.btn{transition:background .15s ease,box-shadow .15s ease,transform .1s ease}.btn.primary:hover{box-shadow:0 4px 14px rgba(99,102,241,.38)}.btn:active{transform:scale(.96)}.iconbtn{transition:background .15s ease,color .15s ease,transform .1s ease}.iconbtn:active{transform:scale(.92)}.iconbtn.danger:hover{background:#FEF2F2}.eye{transition:color .15s ease}.eye:hover{color:#4F46E5;text-decoration:underline}.bar>i{transition:width .6s ease}input,select,textarea{transition:border-color .15s ease,box-shadow .15s ease}@keyframes riseIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.card,.item{animation:riseIn .28s ease}@media (prefers-reduced-motion:reduce){.card,.item{animation:none}.card:hover,.item:hover{transform:none}*{transition:none!important}}</style></head><body><header><div><h1>🔑 本地 Token 管家</h1><div class=\"sub\">所有 Key 只存在你这台电脑的 data.json 里，刷新时由本机直连各平台官方接口，不经过任何第三方服务器。支持自动查询的平台先查，查不了的用手动记账兜底，到期/低余额会标黄提醒。</div></div><div><label style=\"display:inline;color:#6B7280;font-size:13px\"><input type=\"checkbox\" id=\"auto\" style=\"width:auto\"> 每60秒自动刷新</label> <button id=\"refreshAll\">⟳ 刷新全部</button></div></header><div class=\"wrap\"><div id=\"updbar\" style=\"display:none;background:#EEF2FF;border:1px solid #C7CDFB;color:#3730A3;border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:12px\"></div><div class=\"stats\" id=\"stats\"></div><form id=\"addForm\"><h3>➕ 添加一个账户 / Token</h3><div class=\"row\"><div><label>平台</label><select id=\"f_provider\"></select></div><div><label>名字（自己认就行，如：DeepSeek 主号）</label><input id=\"f_label\" required></div></div><div id=\"keyFields\"><label>API Key（sk-...）</label><input id=\"f_key\" autocomplete=\"off\" placeholder=\"粘贴 API Key\"></div><div id=\"newapiFields\" style=\"display:none\"><div class=\"row\"><div><label>中转站地址 Base URL</label><input id=\"f_base\" placeholder=\"https://xxx.com\"></div><div><label>额度换算（默认 500000 = $1，一般不用改）</label><input id=\"f_qpu\" type=\"number\" placeholder=\"500000\"></div></div><label>（可选，账户级查询）系统访问令牌 + 用户ID —— 在中转站 个人设置→安全设置 里生成，比只填 Key 查得更全</label><div class=\"row\"><div><input id=\"f_at\" placeholder=\"系统访问令牌\"></div><div><input id=\"f_uid\" placeholder=\"用户ID，如 1234\"></div></div></div><div id=\"manualFields\" style=\"display:none\"><div class=\"row\"><div><label>总额度</label><input id=\"f_total\" type=\"number\" step=\"any\"></div><div><label>已用</label><input id=\"f_used\" type=\"number\" step=\"any\"></div></div><div class=\"row\"><div><label>单位</label><select id=\"f_unit\"><option>CNY</option><option>USD</option><option>Tokens</option><option>次</option></select></div><div><label>到期日（领的免费额度常有期限）</label><input id=\"f_exp\" type=\"date\"></div></div></div><label>充值 / 跳转网址（可选）—— 用光了点卡片上的「💰 去充值」直接跳过去</label><input id=\"f_jump\" placeholder=\"https://...（充值页或官网地址）\"><div class=\"hint\" id=\"formHint\"></div><div style=\"margin-top:14px\"><button type=\"submit\">添加并查询</button></div></form><div class=\"grid\" id=\"grid\"></div><h3 style=\"margin:24px 0 10px\">📋 自记额度任务栏 <span style=\"color:#6B7280;font-size:12px;font-weight:400\">—— 不显示额度的平台自己记：用光打勾，到刷新时间自动恢复</span></h3><form id=\"itemForm\"><div class=\"row\"><div><label>名称（如：Cursor 免费版 / 某站每日签到）</label><input id=\"i_title\" required></div><div><label>额度说明（自己记的数，如：每月 50 次 / 每天 20 次）</label><input id=\"i_note\"></div></div><div class=\"row\"><div><label>下一次刷新时间</label><input id=\"i_next\" type=\"datetime-local\"></div><div><label>刷新周期</label><select id=\"i_cycle\"><option value=\"none\">不循环（到点恢复一次）</option><option value=\"daily\">每天</option><option value=\"weekly\">每周</option><option value=\"monthly\">每月</option><option value=\"custom\">自定义天数</option></select></div></div><div class=\"row\"><div><label>自定义天数（选了自定义才填）</label><input id=\"i_days\" type=\"number\" min=\"1\" placeholder=\"如 3\"></div><div><label>网址（可空，填了条目旁一键打开网站）</label><input id=\"i_url\" placeholder=\"https://…\"></div></div><div><label>Key（可空，存这里点条目旁 👁 就能看，不用再翻备忘录）</label><input id=\"i_key\" autocomplete=\"off\" placeholder=\"粘贴这个平台的 Key\"></div><div class=\"row\"><div style=\"display:flex;align-items:flex-end\"><button type=\"submit\" style=\"width:100%\">添加到任务栏</button></div></div></form><div id=\"items\"></div><div class=\"hint\" style=\"margin-top:16px\">⚠️ 查不了自动额度的：OpenAI / Anthropic 官方把用量接口锁给了 Admin 管理员 Key，普通 Key 查不到自己的用量；ChatGPT Plus、Claude Pro、Cursor 这类订阅也没有余额接口。这几类先用「手动记账」建卡，把总额和到期日填上，至少不会过期浪费。<div class=\"hint\" style=\"text-align:center;margin-top:22px\">觉得好用？<a href=\"#\" onclick=\"return toggleCoffee(event)\" style=\"color:#4F46E5;font-weight:600;text-decoration:none\">☕ 请作者喝杯咖啡</a><div id=\"coffeebox\" style=\"display:none;margin-top:14px\"><div style=\"display:flex;gap:20px;justify-content:center;flex-wrap:wrap\"><div><img src=\"https://nixinhai.de5.net/assets/pay/wechat-pay.svg\" width=\"160\" height=\"160\" alt=\"微信收款码\" style=\"border-radius:12px;border:1px solid #E5E7EB;background:#fff\"><div style=\"margin-top:6px;color:#374151\">微信</div></div><div><img src=\"https://nixinhai.de5.net/assets/pay/alipay-pay.svg\" width=\"160\" height=\"160\" alt=\"支付宝收款码\" style=\"border-radius:12px;border:1px solid #E5E7EB;background:#fff\"><div style=\"margin-top:6px;color:#374151\">支付宝</div></div></div><div style=\"margin-top:8px\">这个工具免费开源，如果它帮你省下了逐个登录查额度的麻烦，欢迎请作者喝杯咖啡，多少随心意。</div></div></div></div></div><script>var accounts=[],providers={},items=[];var HINTS={deepseek:\"官方有余额接口，填 Key 即可自动查：赠送+充值分开显示。\",siliconflow:\"官方有余额接口，填 Key 即可自动查。注意：其 /user/info 接口官方公告将于 2026-08-14 下线，之后等新接口。\",moonshot:\"官方有余额接口，填 Key 即可自动查：可用=代金券+现金。\",openrouter:\"官方有额度接口，填 Key 即可自动查总Credits、已用和剩余。\",newapi:\"绝大多数领免费额度的公益站/中转站都是 NewAPI 搭的。只填站点地址+API Key 就能查这个 Key 的总额/已用/剩余/到期；填系统访问令牌+用户ID 可查账户级余额。\",zhipu:\"智谱 GLM Coding Plan 套餐：填 API Key 可查 5 小时窗口与周窗口的剩余额度（走智谱 monitor 接口，非官方文档接口、可能变动）。智谱普通按量付费的账户余额官方没开放查询接口，那种请用手动记账。\",manual:\"没有自动接口的平台用这个：填总额、已用、到期日，工具帮你算剩余并到期提醒。\"};function esc(s){return String(s==null?\"\":s).replace(/[&<>\"]/g,function(c){return {\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\"}[c]})}function fmt(n){if(n==null)return \"—\";return Number(n).toLocaleString(\"zh-CN\",{maximumFractionDigits:2})}function money(u){return u===\"USD\"?\"$\":u===\"CNY\"?\"¥\":\"\"}async function load(){var r=await fetch(\"/api/accounts\");var d=await r.json();accounts=d.accounts;providers=d.providers;items=d.items||[];renderForm();render();renderItems();}function renderForm(){var sel=document.getElementById(\"f_provider\");if(!sel.options.length){Object.keys(providers).forEach(function(k){var o=document.createElement(\"option\");o.value=k;o.textContent=providers[k].name;sel.appendChild(o)});sel.onchange=syncForm;syncForm();}}function syncForm(){var v=document.getElementById(\"f_provider\").value;document.getElementById(\"newapiFields\").style.display=v===\"newapi\"?\"block\":\"none\";document.getElementById(\"manualFields\").style.display=v===\"manual\"?\"block\":\"none\";document.getElementById(\"keyFields\").style.display=v===\"manual\"?\"none\":\"block\";document.getElementById(\"formHint\").textContent=HINTS[v]||\"\";}function render(){var g=document.getElementById(\"grid\");var totalCards=accounts.length,low=0,err=0,last=\"—\";accounts.forEach(function(a){if(a.low||a.expired)low++;if(a.snapshot&&!a.snapshot.ok)err++;if(a.snapshot&&a.snapshot.at)last=new Date(a.snapshot.at).toLocaleString(\"zh-CN\")});document.getElementById(\"stats\").innerHTML=\"<div class=stat><b>\"+totalCards+\"</b><span>已管理账户</span></div><div class=stat><b>\"+low+\"</b><span>低余额/快到期</span></div><div class=stat><b>\"+err+\"</b><span>查询失败</span></div><div class=stat><b style=font-size:14px;line-height:28px>\"+esc(last)+\"</b><span>上次刷新</span></div>\";if(!accounts.length){g.innerHTML=\"<div class=card>还没有账户。先在上面添加你领过额度的平台，比如 DeepSeek、硅基流动、Kimi、OpenRouter，或者某个中转站。</div>\";return;}g.innerHTML=accounts.map(function(a){var s=a.snapshot||{};var pct=a.remainPct;var barCls=pct==null?\"\":pct<20?\"bad\":pct<50?\"warn\":\"\";var cls=a.expired?\"expired\":(s.ok===false?\"err\":a.low?\"low\":\"\");var remainHtml=s.unlimited?\"不限额\":(s.remaining==null?\"未查询\":esc(money(s.unit)+fmt(s.remaining))+\" <span class=unit>\"+esc(s.unit||\"\")+\"</span>\");var h=\"<div class=\\\"card \"+cls+\"\\\"><h3>\"+esc(a.label)+\"</h3><div class=prov>\"+esc(a.providerName)+(a.keyMask?\" · <span class=keymask onclick='showKey(\\\"\"+a.id+\"\\\",this)'>\"+esc(a.keyMask)+\" 👁</span>\":\"\")+\"</div><div class=remain>\"+remainHtml+\"</div>\";if(pct!=null)h+=\"<div class=bar><i class=\\\"\"+barCls+\"\\\" style=\\\"width:\"+Math.max(0,Math.min(100,pct))+\"%\\\"></i></div><div class=meta>剩余 \"+pct+\"%\"+(s.total!=null?\" · 总额 \"+esc(money(s.unit)+fmt(s.total)):\"\")+(s.used!=null?\" · 已用 \"+esc(money(s.unit)+fmt(s.used)):\"\")+\"</div>\";else if(s.total!=null||s.used!=null)h+=\"<div class=meta>\"+(s.total!=null?\"总额 \"+esc(money(s.unit)+fmt(s.total))+\" \":\"\")+(s.used!=null?\"已用 \"+esc(money(s.unit)+fmt(s.used)):\"\")+\"</div>\";if(s.detail)h+=\"<div class=meta>\"+esc(s.detail)+\"</div>\";if(a.daysLeft!=null)h+=\"<div class=meta>\"+(a.daysLeft<0?\"⛔ 已过期\":\"⏰ 到期：\"+(s.expiresAt||\"\")+\"（剩 \"+a.daysLeft+\" 天）\")+\"</div>\";if(s.ok===false)h+=\"<div class=err-text>查询失败：\"+esc(s.error||\"\")+\"</div>\";if(s.at)h+=\"<div class=meta>更新于 \"+new Date(s.at).toLocaleString(\"zh-CN\")+\"</div>\";h+=\"<div class=actions><button class=ghost onclick=\\\"refreshOne('\"+a.id+\"')\\\">刷新</button>\";if(a.provider===\"manual\")h+=\"<button class=ghost onclick=\\\"updUsed('\"+a.id+\"')\\\">更新已用</button>\";if(a.jumpUrl)h+=\"<a href=\\\"\"+esc(a.jumpUrl)+\"\\\" target=_blank>💰 去充值 →</a>\";h+=\"<button class=ghost onclick=\\\"setJump('\"+a.id+\"')\\\">改网址</button>\";if(a.provider===\"newapi\")h+=\"<button class=ghost onclick=\\\"setBase('\"+a.id+\"')\\\">改地址</button>\";h+=\"<button class=danger onclick=\\\"delAcc('\"+a.id+\"')\\\">删除</button></div></div>\";return h}).join(\"\");}async function refreshOne(id){await fetch(\"/api/accounts/\"+id+\"/refresh\",{method:\"POST\"});load();}async function delAcc(id){if(!confirm(\"删除这个账户？Key 会从本机 data.json 一并删掉。\"))return;await fetch(\"/api/accounts/\"+id,{method:\"DELETE\"});load();}async function updUsed(id){var a=accounts.find(function(x){return x.id===id});var v=prompt(\"已用额度（总额 \"+(a.manualTotal||\"?\")+\"）\",a.manualUsed||0);if(v==null)return;await fetch(\"/api/accounts/\"+id+\"/used\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({used:Number(v)})});load();}document.getElementById(\"refreshAll\").onclick=async function(){this.disabled=true;this.textContent=\"刷新中…\";await fetch(\"/api/refresh-all\",{method:\"POST\"});this.disabled=false;this.textContent=\"⟳ 刷新全部\";load();};document.getElementById(\"addForm\").onsubmit=async function(e){e.preventDefault();var v=document.getElementById(\"f_provider\").value;var body={provider:v,label:document.getElementById(\"f_label\").value,apiKey:document.getElementById(\"f_key\").value.trim(),baseUrl:document.getElementById(\"f_base\").value.trim(),accessToken:document.getElementById(\"f_at\").value.trim(),userId:document.getElementById(\"f_uid\").value.trim(),quotaPerUnit:document.getElementById(\"f_qpu\").value,manualTotal:Number(document.getElementById(\"f_total\").value)||undefined,manualUsed:Number(document.getElementById(\"f_used\").value)||0,manualUnit:document.getElementById(\"f_unit\").value,expiresAt:document.getElementById(\"f_exp\").value,rechargeUrl:document.getElementById(\"f_jump\").value.trim()};var r=await fetch(\"/api/accounts\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(body)});var d=await r.json();if(!r.ok){alert(d.error||\"添加失败\");return;}this.reset();syncForm();await fetch(\"/api/accounts/\"+d.account.id+\"/refresh\",{method:\"POST\"});load();};async function setBase(id){var a=accounts.find(function(x){return x.id===id});var v=prompt(\"站点地址（填能打开网站控制台的域名，不是 api 开头的调用域名）\",a.baseUrl||\"\");if(v==null||!v.trim())return;await fetch(\"/api/accounts/\"+id+\"/base\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({baseUrl:v.trim()})});refreshOne(id);}async function showKey(id,el){if(el.dataset.full){el.textContent=el.dataset.mask;delete el.dataset.full;return}var r=await fetch(\"/api/accounts/\"+id+\"/key\");var d=await r.json();var k=d.key||d.accessToken||\"\";if(!k){el.textContent=\"（没存 Key）\";return}el.dataset.mask=el.textContent;el.dataset.full=\"1\";el.textContent=k;}async function setJump(id){var a=accounts.find(function(x){return x.id===id});var v=prompt(\"充值/跳转网址（用光了点卡片上的「去充值」直达，留空=清除自定义网址）\",a.rechargeUrl||\"\");if(v==null)return;await fetch(\"/api/accounts/\"+id+\"/jump\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({url:v.trim()})});load();}function leftText(ms){if(ms==null)return \"\";if(ms<=0)return \"已到刷新时间\";var m=Math.floor(ms/60000),h=Math.floor(m/60),d=Math.floor(h/24);if(d>0)return d+\"天\"+(h%24)+\"小时后刷新\";if(h>0)return h+\"小时\"+(m%60)+\"分后刷新\";return m+\"分钟后刷新\"}function cycleText(it){return it.cycle===\"daily\"?\"每天刷新\":it.cycle===\"weekly\"?\"每周刷新\":it.cycle===\"monthly\"?\"每月刷新\":it.cycle===\"custom\"?\"每\"+(it.cycleDays||\"?\")+\"天刷新\":\"不循环\"}function renderItems(){var w=document.getElementById(\"items\");if(!items.length){w.innerHTML=\"<div class=hint>任务栏还空着。把不显示额度的平台加进来（比如 Cursor、每日签到的站），用光了打勾，到点自动回来。</div>\";return}w.innerHTML=items.map(function(it){var chip=it.done?\"<span class=chip off>已用完 · 等刷新</span>\":\"<span class=chip>使用中</span>\";var nx=it.nextRefreshAt?new Date(it.nextRefreshAt).toLocaleString(\"zh-CN\"):\"未设刷新时间\";var left=it.done?\"\":leftText(it.inMs);return \"<div class=\\\"item \"+(it.done?\"done\":\"\")+\"\\\"><input type=checkbox class=chk \"+(it.done?\"checked\":\"\")+\" onclick=\\\"toggleItem('\"+it.id+\"')\\\"><div style=flex:1><div class=t>\"+esc(it.title)+\" \"+chip+\"</div><div class=meta>\"+(it.note?esc(it.note)+\" · \":\"\")+cycleText(it)+\" · 下次：\"+nx+(left?\" · \"+left:\"\")+(it.keyMask?\" · <span class=keymask onclick='showItemKey(\\\"\"+it.id+\"\\\",this)'>\"+esc(it.keyMask)+\" 👁</span>\":\"\")+\"</div></div>\"+(it.url?\"<a href=\\\"\"+esc(it.url)+\"\\\" target=_blank>打开网站 →</a>\":\"\")+\"<button class=ghost onclick=\\\"setItemUrl('\"+it.id+\"')\\\">网址</button>\"+\"<button class=ghost onclick=\\\"setItemKey('\"+it.id+\"')\\\">Key</button><button class=ghost onclick=\\\"editItem('\"+it.id+\"')\\\">改时间</button><button class=danger onclick=\\\"delItem('\"+it.id+\"')\\\">删除</button></div>\"}).join(\"\")}async function toggleItem(id){await fetch(\"/api/items/\"+id+\"/toggle\",{method:\"POST\"});load();}async function delItem(id){if(!confirm(\"从任务栏删掉这条？\"))return;await fetch(\"/api/items/\"+id,{method:\"DELETE\"});load();}async function editItem(id){var it=items.find(function(x){return x.id===id});var cur=it.nextRefreshAt?it.nextRefreshAt.slice(0,10)+\" \"+it.nextRefreshAt.slice(11,16):\"\";var v=prompt(\"下次刷新时间（格式 2026-11-03 09:00，留空=清除）\",cur);if(v==null)return;await fetch(\"/api/items/\"+id+\"/update\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({nextRefreshAt:v})});load();}async function showItemKey(id,el){if(el.dataset.full){el.textContent=el.dataset.mask;delete el.dataset.full;return}var r=await fetch(\"/api/items/\"+id+\"/key\");var d=await r.json();var k=d.key||\"\";if(!k){el.textContent=\"（没存 Key）\";return}el.dataset.mask=el.textContent;el.dataset.full=\"1\";el.textContent=k;}async function setItemKey(id){var v=prompt(\"这个平台的 Key（粘贴进来，之后点条目上的 👁 就能看；留空提交=清除已存的 Key）\",\"\");if(v==null)return;await fetch(\"/api/items/\"+id+\"/update\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({key:v.trim()})});load();}async function setItemUrl(id){var it=items.find(function(x){return x.id===id});var v=prompt(\"网址（填了点条目旁「打开网站」直达，留空=清除）\",it.url||\"\");if(v==null)return;await fetch(\"/api/items/\"+id+\"/update\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({url:v.trim()})});load();}document.getElementById(\"itemForm\").onsubmit=async function(e){e.preventDefault();var body={title:document.getElementById(\"i_title\").value,note:document.getElementById(\"i_note\").value,url:document.getElementById(\"i_url\").value,key:document.getElementById(\"i_key\").value,nextRefreshAt:document.getElementById(\"i_next\").value,cycle:document.getElementById(\"i_cycle\").value,cycleDays:document.getElementById(\"i_days\").value};var r=await fetch(\"/api/items\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(body)});var d=await r.json();if(!r.ok){alert(d.error||\"添加失败\");return}this.reset();load();};var timer=null;document.getElementById(\"auto\").onchange=function(){if(this.checked){timer=setInterval(async function(){await fetch(\"/api/refresh-all\",{method:\"POST\"});load();},60000)}else if(timer)clearInterval(timer)};function dismissUpd(v){try{localStorage.setItem(\"tm_upd_dismiss\",v)}catch(e){}document.getElementById(\"updbar\").style.display=\"none\"}async function checkUpd(){try{var r=await fetch(\"/api/update\");var u=await r.json();if(u&&u.available){try{if(localStorage.getItem(\"tm_upd_dismiss\")===u.latest)return}catch(e){}var b=document.getElementById(\"updbar\");b.innerHTML=\"🎉 有新版本 v\"+u.latest+\" 可用（当前 v\"+u.current+\"） <a href=\\\"\"+u.url+\"\\\" target=\\\"_blank\\\" rel=\\\"noopener\\\" style=\\\"font-weight:600\\\">去下载 →</a><span style=\\\"float:right;cursor:pointer;color:#6B7280\\\" onclick=\\\"dismissUpd('\"+u.latest+\"')\\\">✕</span>\";b.style.display=\"block\"}}catch(e){}}function toggleCoffee(e){if(e)e.preventDefault();var b=document.getElementById(\"coffeebox\");b.style.display=b.style.display===\"none\"?\"block\":\"none\";return false}load();checkUpd();</script></body></html>";
if (require.main === module) {
  server.on('error', function (e) {
    if (DIST && e && e.code === 'EADDRINUSE') { openBrowser(); process.exit(0); }
    throw e;
  });
  server.listen(PORT, '127.0.0.1', function () {
    console.log('本地 Token 管家已启动: http://127.0.0.1:' + PORT);
    console.log('数据文件: ' + DATA_FILE + '（只在本机，请勿外传）');
    if (DIST) { console.log('浏览器会自动打开；关掉这个窗口即可退出。'); if (!process.env.TM_NO_BROWSER) openBrowser(); setTimeout(function () { checkUpdate().catch(function () {}); }, 3000); }
  });
}
module.exports = { parseDeepSeek, parseSiliconFlow, parseMoonshot, parseOpenRouter, parseNewApiTokenUsage, parseNewApiUserSelf, maskKey, normalizeItem, advDate, parseTimeInput, parseBilling, normalizeBase, parseGenericKeyInfo, parseZhipuQuota, resolveDataFile, cmpVersion, HTML, APP_VERSION };
