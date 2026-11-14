/**
 * 生成单文件 standalone.html：把 www/style.css 内联进 index.html。
 * 这样发出去的就是一个能直接双击打开、也能作为附件发送的自包含网页。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const indexPath = join(ROOT, 'index.html');
const cssPath = join(ROOT, 'www', 'style.css');
const outPath = join(ROOT, 'standalone.html');

if (!existsSync(indexPath) || !existsSync(cssPath)) {
  console.error('缺 index.html 或 www/style.css，先跑 node build.js');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

const linkRe = /<link\s+rel="stylesheet"\s+href="[^"]*style\.css"\s*>/i;
if (!linkRe.test(html)) {
  console.error('index.html 里没找到 style.css 的 link 标签');
  process.exit(1);
}

const out = html.replace(linkRe, `<style>\n${css}\n</style>`);
writeFileSync(outPath, out, 'utf8');

console.log(`standalone.html 已生成：${out.length} 字节`);
console.log('可直接双击打开，也可作为附件发出。');
