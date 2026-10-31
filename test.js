'use strict';
const assert = require('assert');
const m = require('./server.js');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('✓ ' + name); }

ok('DeepSeek 解析：总额/赠送/充值', function () {
  const r = m.parseDeepSeek({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] });
  assert.strictEqual(r.remaining, 110); assert.strictEqual(r.granted, 10); assert.strictEqual(r.total, 110); assert.strictEqual(r.unit, 'CNY');
});
ok('硅基流动 解析：totalBalance 为剩余', function () {
  const r = m.parseSiliconFlow({ data: { balance: '0.88', chargeBalance: '88.00', totalBalance: '88.88', status: 'normal' } });
  assert.strictEqual(r.remaining, 88.88); assert.strictEqual(r.granted, 0.88);
});
ok('Kimi 解析：available 为剩余、voucher 为赠送', function () {
  const r = m.parseMoonshot({ code: 0, data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 } });
  assert.strictEqual(r.remaining, 49.58894); assert.strictEqual(r.granted, 46.58893);
});
ok('OpenRouter 解析：credits 算剩余', function () {
  const r = m.parseOpenRouter({ total_credits: 10, total_usage: 2.5 }, { data: { usage: 2.5, limit: null } });
  assert.strictEqual(r.remaining, 7.5); assert.strictEqual(r.total, 10); assert.strictEqual(r.used, 2.5);
});
ok('OpenRouter 解析：无 credits 时用 key limit_remaining', function () {
  const r = m.parseOpenRouter(null, { data: { usage: 1, limit: 5, limit_remaining: 4 } });
  assert.strictEqual(r.remaining, 4);
});
ok('NewAPI token 用量：500000 换算 $1 + 到期', function () {
  const r = m.parseNewApiTokenUsage({ data: { total_granted: 5000000, total_used: 500000, total_available: 4500000, unlimited_quota: false, expires_at: 1798761600 } }, 500000);
  assert.strictEqual(r.remaining, 9); assert.strictEqual(r.total, 10); assert.strictEqual(r.used, 1); assert.ok(r.expiresAt);
});
ok('NewAPI token 用量：不限额', function () {
  const r = m.parseNewApiTokenUsage({ data: { total_used: 1000000, unlimited_quota: true, expires_at: 0 } }, 500000);
  assert.strictEqual(r.remaining, null); assert.strictEqual(r.unlimited, true); assert.strictEqual(r.used, 2);
});
ok('NewAPI 账户级：quota 为剩余', function () {
  const r = m.parseNewApiUserSelf({ data: { quota: 1000000, used_quota: 500000, request_count: 42, group: 'default' } }, 500000);
  assert.strictEqual(r.remaining, 2); assert.strictEqual(r.total, 3); assert.strictEqual(r.used, 1);
});
ok('Key 脱敏', function () {
  assert.strictEqual(m.maskKey('sk-1234567890abcd'), 'sk-****abcd');
  assert.strictEqual(m.maskKey('short'), '****');
});
ok('任务栏：已用完+已过刷新时间+每天 → 自动恢复并顺延', function () {
  const it = { done: true, doneAt: 'x', nextRefreshAt: new Date(Date.now() - 26 * 3600e3).toISOString(), cycle: 'daily' };
  const changed = m.normalizeItem(it, new Date());
  assert.strictEqual(changed, true); assert.strictEqual(it.done, false); assert.ok(new Date(it.nextRefreshAt) > new Date());
});
ok('任务栏：已用完+已过时间+不循环 → 恢复一次并清空时间', function () {
  const it = { done: true, doneAt: 'x', nextRefreshAt: new Date(Date.now() - 3600e3).toISOString(), cycle: 'none' };
  m.normalizeItem(it, new Date());
  assert.strictEqual(it.done, false); assert.strictEqual(it.nextRefreshAt, null);
});
ok('任务栏：使用中+已过时间+每周 → 只顺延时间不打勾', function () {
  const it = { done: false, nextRefreshAt: new Date(Date.now() - 8 * 24 * 3600e3).toISOString(), cycle: 'weekly' };
  m.normalizeItem(it, new Date());
  assert.strictEqual(it.done, false); assert.ok(new Date(it.nextRefreshAt) > new Date());
});
ok('任务栏：未到刷新时间 → 不动', function () {
  const it = { done: true, doneAt: 'x', nextRefreshAt: new Date(Date.now() + 3600e3).toISOString(), cycle: 'daily' };
  const changed = m.normalizeItem(it, new Date());
  assert.strictEqual(changed, false); assert.strictEqual(it.done, true);
});
ok('任务栏：每月顺延 + 自定义天数', function () {
  const a = m.advDate('2026-01-31T09:00:00.000Z', 'monthly');
  assert.ok(a.indexOf('2026-02') === 0 || a.indexOf('2026-03') === 0);
  const b = m.advDate('2026-11-01T00:00:00.000Z', 'custom', 3);
  assert.strictEqual(b, '2026-11-04T00:00:00.000Z');
  assert.strictEqual(m.advDate('2026-11-01T00:00:00.000Z', 'none'), null);
});
ok('时间输入解析：空格格式与 datetime-local', function () {
  assert.ok(m.parseTimeInput('2026-11-03 09:00'));
  assert.ok(m.parseTimeInput('2026-11-03T09:00'));
  assert.strictEqual(m.parseTimeInput(''), null);
  assert.strictEqual(m.parseTimeInput('乱写'), null);
});
ok('billing 接口解析：总额-已用(美分)', function () {
  const r = m.parseBilling({ hard_limit_usd: 10 }, { total_usage: 250 });
  assert.strictEqual(r.remaining, 7.5); assert.strictEqual(r.total, 10); assert.strictEqual(r.used, 2.5);
});
ok('billing 接口解析：超大 hard_limit 视为不限额', function () {
  const r = m.parseBilling({ hard_limit_usd: 100000000 }, { total_usage: 100 });
  assert.strictEqual(r.unlimited, true); assert.strictEqual(r.remaining, null);
});
ok('中转站地址纠正：去尾斜杠与 /v1', function () {
  assert.strictEqual(m.normalizeBase('https://a.com/'), 'https://a.com');
  assert.strictEqual(m.normalizeBase('https://a.com/v1'), 'https://a.com');
  assert.strictEqual(m.normalizeBase('https://a.com/v1/'), 'https://a.com');
  assert.strictEqual(m.normalizeBase('https://a.com'), 'https://a.com');
});
ok('自研网关解析：balance 字段直读', function () {
  const r = m.parseGenericKeyInfo({ balance: 4.25, currency: 'USD' });
  assert.strictEqual(r.remaining, 4.25); assert.strictEqual(r.unit, 'USD');
});
ok('自研网关解析：data 包裹 limit-spend 算剩余', function () {
  const r = m.parseGenericKeyInfo({ data: { limit: 10, spend: 3.5 } });
  assert.strictEqual(r.remaining, 6.5); assert.strictEqual(r.total, 10);
});
ok('自研网关解析：只有已用量时给用量提示', function () {
  const r = m.parseGenericKeyInfo({ total_usage: 1234 });
  assert.strictEqual(r.remaining, null); assert.strictEqual(r.used, 12.34);
});
ok('自研网关解析：未知格式报错带字段名', function () {
  assert.throws(function () { m.parseGenericKeyInfo({ foo: 1, bar: 2 }); }, /foo/);
});
ok('界面为浅色产品风（无深色残留）', function () {
  assert.ok(m.HTML.indexOf('background:#F5F7FA') >= 0);
  assert.ok(m.HTML.indexOf('#0f1115') < 0 && m.HTML.indexOf('#17181e') < 0);
  assert.ok(m.HTML.indexOf('#6366F1') >= 0);
});
ok('发行模式数据路径：TM_DATA_DIR 优先、默认仍在源码旁', function () {
  const path = require('path');
  const old = process.env.TM_DATA_DIR;
  process.env.TM_DATA_DIR = '/tmp/tm-x';
  assert.strictEqual(m.resolveDataFile(), path.join('/tmp/tm-x', 'data.json'));
  delete process.env.TM_DATA_DIR;
  assert.strictEqual(m.resolveDataFile(), path.join(__dirname, 'data.json'));
  if (old) process.env.TM_DATA_DIR = old;
});
ok('智谱 Coding Plan 解析：5h/周窗口百分比', function () {
  const r = m.parseZhipuQuota({ code: 200, success: true, data: { level: 'pro', limits: [
    { type: 'TOKENS_LIMIT', unit: 3, percentage: 12, nextResetTime: 1762000000000 },
    { type: 'TOKENS_LIMIT', unit: 6, percentage: 40 },
    { type: 'TIME_LIMIT', unit: 5, percentage: 3 }
  ] } });
  assert.strictEqual(r.remaining, 88); assert.strictEqual(r.used, 12); assert.strictEqual(r.unit, '%');
  assert.ok(r.detail.indexOf('周窗口已用 40%') >= 0); assert.ok(r.detail.indexOf('PRO') >= 0);
});
ok('智谱解析：无套餐额度时报错说明', function () {
  assert.throws(function () { m.parseZhipuQuota({ code: 200, data: { limits: [] } }); }, /Coding Plan/);
});
ok('前端脚本语法可解析（防引号嵌套写坏整页）', function () {
  const mm = m.HTML.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(mm, '找不到 script 块');
  assert.doesNotThrow(function () { new Function(mm[1]); });
});
ok('渲染出的 Key 眼睛点击目标正确（防 &quot; 假调用）', function () {
  const mm = m.HTML.match(/<script>([\s\S]*)<\/script>/);
  const els = {};
  const doc = { getElementById: function (id) { return els[id] || (els[id] = { innerHTML: '', textContent: '', style: {}, options: [] }); } };
  const fn = new Function('document', 'fetch', 'setInterval', 'confirm', mm[1].replace(/load\(\);(\s*checkUpd\(\);)?\s*$/, '') + '\nreturn { render: render, renderItems: renderItems, setAccounts: function (a) { accounts = a; }, setItems: function (a) { items = a; } };');
  const api = fn(doc, async function () { return { json: async function () { return {}; } }; }, function () {}, function () { return false; });
  api.setAccounts([{ id: 'abc123', label: 'T', providerName: 'P', keyMask: 'sk-****x', snapshot: {}, remainPct: null, daysLeft: null, provider: 'deepseek', jumpUrl: '', rechargeUrl: '' }]);
  api.render();
  assert.ok(els.grid.innerHTML.indexOf('onclick=\'showKey("abc123",this)\'') >= 0, '账户点击目标不对');
  api.setItems([{ id: 'def456', title: 'I', note: '', url: '', keyMask: 'sk-****y', nextRefreshAt: null, cycle: 'none', cycleDays: '', done: false, inMs: null }]);
  api.renderItems();
  assert.ok(els.items.innerHTML.indexOf('onclick=\'showItemKey("def456",this)\'') >= 0, '条目点击目标不对');
  assert.ok(els.items.innerHTML.indexOf('setItemKey') >= 0, '条目缺 Key 按钮');
});
ok('版本号比较（更新检查用）', () => {
  assert.strictEqual(m.cmpVersion('1.0.1', '1.0.0'), 1);
  assert.strictEqual(m.cmpVersion('1.0.0', '1.0.0'), 0);
  assert.strictEqual(m.cmpVersion('0.9.9', '1.0.0'), -1);
  assert.strictEqual(m.cmpVersion('v1.2', '1.1.9'), 1);
});
ok('更新横幅钩子存在（横幅 div + checkUpd 调用）', () => {
  assert.ok(m.HTML.includes('id="updbar"'), '缺更新横幅 div');
  assert.ok(m.HTML.includes('checkUpd();'), '缺 checkUpd 调用');
  assert.ok(m.HTML.includes('dismissUpd'), '缺横幅关闭函数');
});
ok('交互动效已生效（悬停上浮/按压/进度平滑/减少动效兜底）', () => {
  assert.ok(m.HTML.includes('.card:hover{transform:translateY(-3px)'), '缺卡片悬停上浮');
  assert.ok(m.HTML.includes('.btn:active{transform:scale(.96)}'), '缺按钮按压');
  assert.ok(m.HTML.includes('.bar>i{transition:width .6s ease}'), '缺进度条平滑过渡');
  assert.ok(m.HTML.includes('prefers-reduced-motion'), '缺减少动效兜底');
  assert.ok(!m.HTML.includes('riseIn .28s ease both'), '入场动画不得用 forwards 填充（会压住悬停位移）');
});
console.log('\n全部 ' + n + ' 项测试通过');
