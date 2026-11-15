/**
 * 把 dsh-intel 目录推送到 GitHub（Git Data API，一次提交，不依赖 git 本地凭证）。
 *
 * 2026-11-14 改动：
 *  - 发布分支改成 gh-pages（Pages 源已切过去，main 上杂物太多会让老构建器失败）
 *  - 改成「一次提交」：先传 blob，再建 tree，再建一个 commit，最后 update ref。
 *    以前每个文件一个 commit，1 秒内连开十几个提交，每个都触发一次 Pages 构建，
 *    结果大部分构建被标记 failed，最后一个还要卡几分钟。一次提交只触发一次构建。
 *
 * 用法：token 读同目录 .gh-token，或环境变量 GH_TOKEN
 * 上传范围：index.html、archive/**、www/**、data/**、build.js 等站点文件
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
const BRANCH = process.env.GH_BRANCH || 'gh-pages';
const API = 'https://api.github.com';

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

const HEADERS = {
  Authorization: 'token ' + TOKEN,
  'User-Agent': 'dsh-intel',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function api(path, options = {}) {
  const res = await fetch(API + path, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) throw new Error(`${res.status} ${path} :: ${text.slice(0, 300)}`);
  return json;
}

async function main() {
  const files = walk(ROOT);
  console.log(`本地待上传 ${files.length} 个文件 → ${REPO}@${BRANCH}`);

  // 1. 每个文件建 blob
  const entries = [];
  for (const f of files) {
    const content = readFileSync(f.abs);
    const blob = await api(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    entries.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 2. 建 tree（不带 base_tree，等于只保留这次上传的文件）
  const tree = await api(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: entries }),
  });

  // 3. 找当前分支头作为父提交（分支不存在就建孤儿提交）
  let parentSha = null;
  try {
    const ref = await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    parentSha = ref.object.sha;
  } catch {
    /* 分支还不存在 */
  }

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const commit = await api(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `site update ${stamp} (${files.length} files)`,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });

  // 4. 更新分支
  if (parentSha) {
    await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await api(`/repos/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
    });
  }

  console.log(`完成：一次提交 ${commit.sha.slice(0, 7)}，${files.length} 个文件`);
  console.log(`仓库：https://github.com/${REPO}`);
  console.log('页面：https://lylnpc.github.io/dsh-intel/');
}

main().catch((error) => {
  console.error('上传失败：' + (error?.message ?? error));
  process.exit(1);
});
