#!/usr/bin/env node
/**
 * 把 dsh-intel 目录推送到 Gitee 仓库（走 API，不依赖 git 本地凭证）。
 *
 * 用法：
 *   $env:GITEE_TOKEN="xxx"; node upload.js
 *   （可选）$env:GITEE_REPO="truly-believing/dsh-intel"
 *
 * 会上传：index.html、archive/**、www/**、data/**、build.js
 * 逻辑：先查目录已有文件与 sha，存在则更新（PUT 带 sha），不存在则新建（POST）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** token 优先读环境变量，其次读同目录的 .token（方便定时任务免配置）。 */
function readToken() {
  if (process.env.GITEE_TOKEN) return process.env.GITEE_TOKEN.trim();
  const p = join(ROOT, '.token');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const TOKEN = readToken();
const REPO = process.env.GITEE_REPO || 'truly-believing/dsh-intel';
const API = 'https://gitee.com/api/v5/repos/' + REPO + '/contents/';

if (!TOKEN) {
  console.error('缺少 token：设置环境变量 GITEE_TOKEN，或在 dsh-intel/.token 里写一行');
  process.exit(1);
}

const INCLUDE = [/^index\.html$/, /^archive\//, /^www\//, /^data\//, /^build\.js$/];
const SKIP = [/\.bak$/, /~$/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (SKIP.some((r) => r.test(rel))) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (INCLUDE.some((r) => r.test(rel))) {
      out.push({ abs, rel });
    }
  }
  return out;
}

const isText = (rel) => /\.(html|css|js|json|md|txt)$/.test(rel);

/** Gitee 的 contents 接口不认 %2F，路径分隔符必须原样保留，只逐段编码。 */
const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

async function apiGet(rel) {
  const url = API + encodePath(rel) + '?access_token=' + encodeURIComponent(TOKEN);
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${rel} -> ${r.status}`);
  const j = await r.json();
  // 空仓库里不存在的路径会返回 200 + []（空数组），不能当成目录。
  if (Array.isArray(j)) return j.length > 0 ? { dir: true } : null;
  return { sha: j.sha };
}

async function putFile(rel, contentBase64, existingSha) {
  const body = {
    access_token: TOKEN,
    content: contentBase64,
    message: `update ${rel}`,
  };
  if (existingSha) body.sha = existingSha;

  const r = await fetch(API + encodePath(rel), {
    method: existingSha ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${existingSha ? 'PUT' : 'POST'} ${rel} -> ${r.status} ${t.slice(0, 200)}`);
  }
  return true;
}

async function main() {
  const files = walk(ROOT).sort((a, b) => a.rel.localeCompare(b.rel));
  if (!files.length) {
    console.error('没有可上传的文件');
    process.exit(1);
  }

  // 缺 index.html 说明还没 build
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error('index.html 不存在，先跑 node build.js');
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;

  for (const f of files) {
    const buf = readFileSync(f.abs);
    const b64 = buf.toString('base64');
    try {
      const meta = await apiGet(f.rel);
      if (meta?.dir) continue;
      await putFile(f.rel, b64, meta?.sha);
      console.log(`ok   ${f.rel} (${buf.length}B)`);
      ok++;
    } catch (e) {
      console.error(`FAIL ${f.rel}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n完成：成功 ${ok}，失败 ${failed}`);
  console.log(`仓库：https://gitee.com/${REPO}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('异常：', e.message);
  process.exit(1);
});
