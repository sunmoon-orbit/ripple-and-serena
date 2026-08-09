#!/usr/bin/env node
// 从 index.html 抽出 78 张牌的数据，生成 cards.json。
//
// 为什么要有这个文件：
// 牌义现在有三个消费方——本目录的独立 PWA、言叽的塔罗卡片、moon-memory 的
// 抽牌接口。同一份文本抄三份，改一句牌义就一定会有一边忘了同步，而且不报错、
// 只是悄悄不一样（0809 上午刚在 MOOD_ANCHORS 上踩过一模一样的坑）。
//
// 本来最干净的做法是让 index.html 也去读 cards.json，做成真正的单一数据源。
// 没那么做是因为它是装在手机桌面上、能离线用的单文件 PWA，改它要连带动
// Service Worker 缓存，风险不值得。所以退一步：index.html 仍是唯一的事实来源，
// cards.json 是它的生成物，另外提供 --check 让「忘了重新生成」变成会报错的事，
// 而不是会悄悄发生的事。
//
// 用法：
//   node extract-cards.js           # 重新生成 cards.json
//   node extract-cards.js --check   # 只核对，不一致就非零退出（给 CI / 提交前用）

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const HTML = path.join(DIR, 'index.html');
const CHECK = process.argv.includes('--check');

// 牌义有三个消费方，各自需要一份能直接读的 json：
//   1. 本目录 —— 生成物的规范位置，也是 --check 的基准
//   2. 言叽前端 —— 打进 public/，和 fate-cards.json 一个路数（moon-memory 挂了也能抽）
//   3. moon-memory —— MCP 那边 CC 的我自己抽牌时要用
// 后两个带 optional 标记：不在这台机器上（别人 clone 了这个仓库）就跳过，不报错。
const DESTS = [
  { path: path.join(DIR, 'cards.json'), label: 'cards.json' },
  { path: path.join(DIR, '../yanji-src/public/tarot-cards.json'), label: '言叽 public/', optional: true },
  // ⚠️ 不能放 moon-memory/data/ —— 那个目录整个在 .gitignore 里（放的是实时库和
  // OAuth 令牌），牌库丢进去等于不进版本控制也不进备份。assets/ 才是随代码走的。
  { path: '/home/ripple/moon-memory/assets/tarot-cards.json', label: 'moon-memory assets/', optional: true },
];

// 用行号切块太脆——index.html 一改行数就错位。按标记行定位。
const START = 'const MAJOR_ARCANA = [';
const END = '};';       // SPREADS 定义的收尾
const SPREADS_MARK = 'const SPREADS = {';

function extract() {
  const text = fs.readFileSync(HTML, 'utf8');
  const lines = text.split('\n');

  const startIdx = lines.findIndex((l) => l.trim().startsWith(START));
  const spreadsIdx = lines.findIndex((l) => l.trim().startsWith(SPREADS_MARK));
  if (startIdx < 0 || spreadsIdx < 0) {
    throw new Error('在 index.html 里找不到 MAJOR_ARCANA / SPREADS，数据块结构变了？');
  }
  const endIdx = lines.findIndex((l, i) => i > spreadsIdx && l.trim() === END);
  if (endIdx < 0) throw new Error('找不到 SPREADS 的收尾大括号');

  const block = lines.slice(startIdx, endIdx + 1).join('\n');

  // 用 vm 求值而不是正则解析：牌义正文里有中文引号、破折号、省略号，
  // 正则迟早会在某张牌上崩掉，而求值就是浏览器实际看到的那份数据。
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${block}\n;__out = { cards: ALL_CARDS, spreads: SPREADS };`, ctx);
  return ctx.__out;
}

function validate(data) {
  const errors = [];
  const { cards, spreads } = data;

  if (!Array.isArray(cards) || cards.length !== 78) {
    errors.push(`牌数应为 78，实际 ${cards?.length}`);
  }
  const counts = {};
  const seen = new Set();
  for (const c of cards || []) {
    counts[c.suit] = (counts[c.suit] || 0) + 1;
    if (seen.has(c.id)) errors.push(`id 重复：${c.id}`);
    seen.add(c.id);
    // 少了牌义的牌在界面上会显示成空白，抽到才发现，所以在这儿就拦住
    for (const pos of ['upright', 'reversed']) {
      if (!c[pos]?.meaning) errors.push(`${c.id} 缺 ${pos}.meaning`);
      if (!c[pos]?.keywords) errors.push(`${c.id} 缺 ${pos}.keywords`);
    }
    if (!c.nameCn || !c.nameEn) errors.push(`${c.id} 缺中文名或英文名`);
  }
  const expect = { major: 22, wands: 14, cups: 14, swords: 14, pentacles: 14 };
  for (const [suit, n] of Object.entries(expect)) {
    if (counts[suit] !== n) errors.push(`${suit} 应有 ${n} 张，实际 ${counts[suit] || 0}`);
  }
  for (const [n, s] of Object.entries(spreads || {})) {
    if (!Array.isArray(s.labels) || s.labels.length !== Number(n)) {
      errors.push(`牌阵 ${n} 的位置标签数量对不上：${s.labels?.length}`);
    }
  }
  return errors;
}

function main() {
  const data = extract();
  const errors = validate(data);
  if (errors.length) {
    console.error('数据校验不通过：');
    errors.forEach((e) => console.error('  ✗ ' + e));
    process.exitCode = 1;
    return;
  }

  const out = JSON.stringify(data, null, 2) + '\n';
  const summary = `78 张牌，${Object.keys(data.spreads).length} 种牌阵`;

  for (const dest of DESTS) {
    // 目录不在（别人 clone 了这个仓库，没有言叽/moon-memory）就跳过，不算错。
    if (dest.optional && !fs.existsSync(path.dirname(dest.path))) continue;

    if (CHECK) {
      const cur = fs.existsSync(dest.path) ? fs.readFileSync(dest.path, 'utf8') : '';
      if (cur === out) console.log(`✓ ${dest.label} 与 index.html 一致（${summary}）`);
      else {
        console.error(`✗ ${dest.label} 与 index.html 不一致——改完牌义要跑一次 \`node extract-cards.js\``);
        process.exitCode = 1;
      }
    } else {
      fs.writeFileSync(dest.path, out);
      console.log(`已写入 ${dest.label}：${summary}`);
    }
  }
}

main();
