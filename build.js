#!/usr/bin/env node
/**
 * dsh-intel 静态站生成器
 *
 * 数据源：data/YYYY-MM-DD.json
 * 产物：archive/YYYY-MM-DD.html、index.html（最新一期）、archive/index.html（历史列表）
 *
 * 数据格式：
 * {
 *   "date": "2026-11-12",
 *   "groups": [
 *     { "key": "opportunity", "title": "接单与机会", "items": [
 *       { "title": "...", "url": "...", "desc": "...", "deadline": "2026-11-20", "source": "B站" }
 *     ]}
 *   ]
 * }
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const ARCHIVE = join(ROOT, 'archive');

const GROUP_ORDER = ['opportunity', 'creation', 'tools', 'industry'];
const GROUP_CLASS = { opportunity: 'g1', creation: 'g2', tools: 'g3', industry: 'g4' };

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderItem(it) {
  const title = esc(it.title || '(无标题)');
  const titleHtml = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;

  const parts = [];
  if (it.deadline) {
    const dl = esc(it.deadline);
    parts.push(`<span class="tag deadline">截止 ${dl}</span>`);
  }
  if (it.tag) parts.push(`<span class="tag cat">${esc(it.tag)}</span>`);
  if (it.source) parts.push(`<span class="tag src">${esc(it.source)}</span>`);

  return `      <li>
        <div class="title">${titleHtml}</div>
        ${it.desc ? `<div class="desc">${esc(it.desc)}</div>` : ''}
        ${parts.length ? `<div class="foot">${parts.join('')}</div>` : ''}
      </li>`;
}

function renderGroup(g) {
  const cls = GROUP_CLASS[g.key] || 'g1';
  const items = g.items || [];
  const body = items.length
    ? `    <ul class="items">\n${items.map(renderItem).join('\n')}\n    </ul>`
    : `    <p class="empty">这一轮没有新的内容。</p>`;
  return `  <section class="group ${cls}">
    <h2><span class="dot"></span>${esc(g.title)}<span class="count">${items.length} 条</span></h2>
${body}
  </section>`;
}

function page({ date, groups, isLatest, archiveDates }) {
  const total = groups.reduce((n, g) => n + (g.items?.length || 0), 0);
  const ordered = [
    ...GROUP_ORDER.map((k) => groups.find((g) => g.key === k)).filter(Boolean),
    ...groups.filter((g) => !GROUP_ORDER.includes(g.key)),
  ];

  const heading = isLatest ? '今日情报' : date;
  const nav = archiveDates.length
    ? `<nav class="archive">${archiveDates
        .slice(0, 30)
        .map((d) =>
          d === date
            ? `<span class="pill current">${esc(d)}</span>`
            : `<a class="pill" href="${isLatest ? 'archive/' : ''}${esc(d)}.html">${esc(d)}</a>`
        )
        .join('')}</nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} · 情报日报</title>
<link rel="stylesheet" href="${isLatest ? 'www/style.css' : '../www/style.css'}">
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>${isLatest ? '今日情报' : esc(date)}</h1>
    <div class="sub">PV / 手书 / 剪辑 —— 机会、工具与动态</div>
    <div class="meta">
      <span class="stat"><b>${total}</b> 条</span>
      ${isLatest ? '<a class="pill" href="archive/index.html">历史归档</a>' : '<a class="pill" href="../index.html">回到最新</a>'}
    </div>
    ${nav}
  </header>
  <main>
${ordered.map(renderGroup).join('\n')}
  </main>
  <footer class="end">
    <div>由本地 DSH 会话自动搜集与生成，仅作个人参考。</div>
    <div>内容来自公开搜索结果，链接指向原始出处。</div>
  </footer>
</div>
</body>
</html>
`;
}

function archiveIndex(archiveDates) {
  const list = archiveDates.length
    ? `<ul class="items">${archiveDates
        .map(
          (d) => `<li><div class="title"><a href="${esc(d)}.html">${esc(d)}</a></div></li>`
        )
        .join('')}</ul>`
    : '<p class="empty">还没有归档。</p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>历史归档 · 情报日报</title>
<link rel="stylesheet" href="../www/style.css">
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>历史归档</h1>
    <div class="sub">按日期倒序</div>
    <div class="meta"><a class="pill link" href="../index.html">回到最新</a></div>
  </header>
  <main>${list}</main>
  <footer class="end"><div>共 ${archiveDates.length} 期</div></footer>
</div>
</body>
</html>
`;
}

function main() {
  if (!existsSync(ARCHIVE)) {
    console.error('missing archive dir');
    process.exit(1);
  }
  const files = existsSync(DATA)
    ? readdirSync(DATA).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    : [];
  if (!files.length) {
    console.error('no data files in data/');
    process.exit(1);
  }

  const dates = files.map((f) => f.slice(0, 10)).sort().reverse();
  const payloads = new Map();

  for (const d of dates) {
    const raw = readFileSync(join(DATA, `${d}.json`), 'utf8');
    const json = JSON.parse(raw);
    payloads.set(d, json);
  }

  for (const d of dates) {
    const json = payloads.get(d);
    const html = page({
      date: d,
      groups: json.groups || [],
      isLatest: false,
      archiveDates: dates,
    });
    writeFileSync(join(ARCHIVE, `${d}.html`), html, 'utf8');
  }

  const latest = dates[0];
  const latestHtml = page({
    date: latest,
    groups: payloads.get(latest).groups || [],
    isLatest: true,
    archiveDates: dates,
  });
  writeFileSync(join(ROOT, 'index.html'), latestHtml, 'utf8');
  writeFileSync(join(ARCHIVE, 'index.html'), archiveIndex(dates), 'utf8');

  console.log(`built ${dates.length} day(s); latest = ${latest}`);
}

main();
