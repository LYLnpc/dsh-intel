/**
 * 把 dsh-intel 目录推送到 GitHub（Contents API，不依赖 git 本地凭证）。
 *
 * 用法：token 读同目录 .gh-token，或环境变量 GH_TOKEN
 * 上传范围：index.html、archive/**、www/**、data/**、build.js、standalone.html
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  const p = join(ROOT, '.gh-token');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const TOKEN = readToken();
const REPO = process.env.GH_REPO || 'LYLnpc/dsh-intel';
const BRANCH = process.env.GH_BRANCH || 'main';
const API = `https://api.github.com/repos/${REPO}/contents/`;

if (!TOKEN) {
  console.error('缺少 token：环境变量 GH_TOKEN 或 .gh-token 文件');
  process.exit(1);
}

const INCLUDE = [
  /^index\.html$/,
  /^standalone\.html$/,
  /^archive\//,
  /^www\//,
  /^data\//,
  /^build\.js$/,
  /^standalone\.js$/,
  /^upload\.js$/,
  /^upload-gh\.js$/,
  /^package\.json$/,
];
const SKIP = [/\.bak$/, /~$/, /\.token$/, /\.gh-token$/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (SKIP.some((r) => r.test(rel))) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (INCLUDE.some((r) => r.test(rel))) out.push({ abs, rel });
  }
  return out;
}

const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

const HEADERS = {
  Authorization: 'token ' + TOKEN,
  'User-Agent': 'dsh-intel',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function getSha(rel) {
  const url = `${API}${encodePath(rel)}?ref=${BRANCH}`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${rel} -> ${r.status}`);
  const j = await r.json();
  return j.sha || null;
}

async function putFile(rel, contentBase64, sha) {
  const body = {
    message: `update ${rel}`,
    content: contentBase64,
    branch: BRANCH,
  };
  if (sha) body.sha = sha;

  const r = await fetch(API + encodePath(rel), {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${rel} -> ${r.status} ${t.slice(0, 180)}`);
  }
  return true;
}

async function main() {
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error('index.html 不存在，先跑 node build.js');
    process.exit(1);
  }

  const files = walk(ROOT).sort((a, b) => a.rel.localeCompare(b.rel));
  if (!files.length) {
    console.error('没有可上传文件');
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  for (const f of files) {
    try {
      const b64 = readFileSync(f.abs).toString('base64');
      const sha = await getSha(f.rel);
      await putFile(f.rel, b64, sha);
      console.log(`ok   ${f.rel}`);
      ok++;
    } catch (e) {
      console.error(`FAIL ${f.rel}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n完成：成功 ${ok}，失败 ${fail}`);
  console.log(`仓库：https://github.com/${REPO}`);
  console.log(`页面：https://${REPO.split('/')[0].toLowerCase()}.github.io/${REPO.split('/')[1]}/`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('异常：', e.message);
  process.exit(1);
});
