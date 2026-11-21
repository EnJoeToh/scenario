import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { Stats } from 'node:fs';
import { parse } from './parser.ts';
import { render, escapeHtml } from './render.ts';
import { renderDiff } from './diff.ts';
import { createRevision, revisionDocument, revisionHeader } from './revision.ts';
import { defaultLayout, validateLayout } from './model.ts';
import type { Layout, Warning } from './model.ts';

const help = `Scenario v0.1 — シナリオ原稿をHTMLへ変換

使い方:
  scenario build <原稿.txt> [--format vertical|horizontal] [-o 出力.html] [--layout 設定.json]
  scenario preview <原稿.txt> [--format vertical|horizontal] [-o 出力.html] [--layout 設定.json] [--port 3000]
  scenario diff <旧.txt> <新.txt> [-o 差分.html|差分.diff.txt] [--format vertical|horizontal] [--layout 設定.json]
  scenario diff <旧.txt> <新.txt> --comparison [-o 差分.html] [--context 3]

デフォルト: 縦書き。buildは原稿と同じ場所の<原稿名>.htmlへ保存。
diffは<新原稿名>.diff.htmlと、再編集・build・previewできる.diff.txtを保存。
--comparisonは従来の左右比較。-oに.txtを指定すると中間ファイルだけを保存。
previewは127.0.0.1で公開し、原稿・設定ファイルの保存時に再読み込み。
previewに-oを指定すると、起動時と更新時にHTMLも保存。
Node.js 22.18以上が必要です。
`;
interface Options { command: string; files: string[]; format: 'vertical' | 'horizontal'; output?: string; layout?: string; port: number; context: number; comparison: boolean }
type CompileOptions = Pick<Options, 'files' | 'format' | 'output' | 'layout'>;
function options(args: string[]): Options {
  const result: Options = { command: args[0], files: [], format: 'vertical', port: 3000, context: 3, comparison: false };
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { result.files.push(...args.slice(i + 1)); break; }
    if (!arg.startsWith('-')) { result.files.push(arg); continue; }
    const name = arg === '-o' ? '--output' : arg;
    if (name === '--comparison') {
      if (seen.has(name)) throw new Error('オプションが重複しています: --comparison');
      seen.add(name); result.comparison = true; continue;
    }
    if (!['--format', '--output', '--layout', '--port', '--context'].includes(name)) throw new Error(`未知のオプション: ${arg}`);
    if (seen.has(name)) throw new Error(`オプションが重複しています: ${name}`);
    seen.add(name);
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg}の値が必要です`);
    if (name === '--format') {
      if (value !== 'vertical' && value !== 'horizontal') throw new Error('--formatはverticalまたはhorizontalを指定してください');
      result.format = value;
    } else if (name === '--output') result.output = value;
    else if (name === '--layout') result.layout = resolve(value);
    else {
      if (!/^\d+$/.test(value)) throw new Error(`${arg}は非負の整数で指定してください`);
      const number = Number(value);
      if (!Number.isSafeInteger(number) || (name === '--port' && number > 65535) || (name === '--context' && number > 10000)) throw new Error(`${arg}が範囲外です`);
      if (name === '--port') result.port = number;
      else result.context = number;
    }
  }
  if (!['build', 'preview', 'diff'].includes(result.command)) throw new Error(`未知のコマンド: ${result.command}\n${help}`);
  if (result.files.length !== (result.command === 'diff' ? 2 : 1)) throw new Error(`入力ファイル数が正しくありません\n${help}`);
  for (const key of seen) {
    if ((result.command !== 'diff' && key === '--comparison') ||
        (key === '--context' && !result.comparison) ||
        (result.comparison && ['--format', '--layout'].includes(key)) ||
        (result.command !== 'diff' && key === '--context') ||
        (result.command !== 'preview' && key === '--port')) throw new Error(`${result.command}では${key}を使用できません`);
  }
  result.files = result.files.map(file => resolve(file));
  return result;
}
function printWarnings(warnings: Warning[], input: string) {
  for (const warning of warnings) console.error(`${input}${warning.line ? `:${warning.line}` : ''}: 警告: ${warning.message}`);
}
async function loadLayout(opts: CompileOptions): Promise<{ layout: Layout; warnings: Warning[] }> {
  if (opts.format === 'horizontal') return { layout: { ...defaultLayout }, warnings: [] };
  const path = opts.layout ?? resolve(dirname(opts.files[0]), 'scenario.layout.json');
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if (!opts.layout && (error as NodeJS.ErrnoException).code === 'ENOENT') return { layout: { ...defaultLayout }, warnings: [] };
    throw error;
  }
  try { return validateLayout(JSON.parse(raw)); }
  catch { return { layout: { ...defaultLayout }, warnings: [{ line: 0, message: `${path}: JSONを解析できません。デフォルトを使用します。` }] }; }
}
async function compile(opts: CompileOptions) {
  const source = await readFile(opts.files[0], 'utf8');
  const document = source.replace(/^\uFEFF/, '').startsWith(revisionHeader) || opts.files[0].endsWith('.diff.txt') ? revisionDocument(source) : parse(source);
  const settings = await loadLayout(opts);
  return { html: render(document, opts.format, settings.layout), warnings: [...settings.warnings, ...document.warnings] };
}
async function protectOutput(output: string, inputs: string[]) {
  // Resolve existing symlinks as well as ordinary paths before writing.
  const identity = async (path: string) => { try { return await realpath(path); } catch { return resolve(path); } };
  const target = await identity(output);
  for (const input of inputs) if (target === await identity(input)) throw new Error('入力ファイルを出力先には指定できません');
}
async function save(output: string, inputs: string[], html: string) {
  await protectOutput(output, inputs);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, 'utf8');
  console.log(`保存: ${output}`);
}
export async function compilePreview(opts: CompileOptions) {
  const compiled = await compile(opts);
  if (opts.output !== undefined) {
    await save(resolve(opts.output), [...opts.files, opts.layout ?? resolve(dirname(opts.files[0]), 'scenario.layout.json')], compiled.html);
  }
  return compiled;
}
export function watchFiles(paths: string[], update: () => Promise<void>, onError: (error: Error) => void) {
  const targets = new Set(paths.map(path => resolve(path)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, dirty = false, closed = false;
  async function rebuild() {
    if (running) { dirty = true; return; }
    running = true;
    do {
      dirty = false;
      try { await update(); } catch (error) { onError(error as Error); }
    } while (dirty && !closed);
    running = false;
  }
  const watchers: { path: string; listener: (current: Stats, previous: Stats) => void }[] = [];
  try {
    for (const path of targets) {
      const listener = (current: Stats, previous: Stats) => {
        if (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs && current.ino === previous.ino && current.size === previous.size && current.nlink === previous.nlink) return;
        clearTimeout(timer);
        timer = setTimeout(() => { if (!closed) void rebuild(); }, 100);
      };
      watchFile(path, { interval: 200 }, listener);
      watchers.push({ path, listener });
    }
  } catch (error) {
    watchers.forEach(({ path, listener }) => unwatchFile(path, listener));
    throw error;
  }
  return () => { closed = true; clearTimeout(timer); watchers.forEach(({ path, listener }) => unwatchFile(path, listener)); };
}
async function preview(opts: Options) {
  let compiled = await compilePreview(opts);
  printWarnings(compiled.warnings, opts.files[0]);
  const clients = new Set<ServerResponse>();
  let revision = 0;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      response.write(`data: ${revision}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      const warnings = compiled.warnings.length ? `<aside class="preview-warnings">${compiled.warnings.map(w => `<div>${w.line ? `${w.line}行: ` : ''}${escapeHtml(w.message)}</div>`).join('')}</aside>` : '';
      const script = `<style>.preview-warnings{padding:12px;background:#fff3cd;font:14px sans-serif;white-space:normal}@media print{.preview-warnings{display:none}}</style>${warnings}<script>const revision=${revision};const events=new EventSource('/events');events.onmessage=e=>{if(Number(e.data)!==revision)location.reload()};</script>`;
      response.end(compiled.html.replace('</body>', `${script}</body>`));
    } else { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(opts.port, '127.0.0.1', done); });
  const address = server.address();
  console.log(`プレビュー: http://127.0.0.1:${typeof address === 'object' && address ? address.port : opts.port}/\n終了: Ctrl+C`);
  async function rebuild() {
      try {
        compiled = await compilePreview(opts);
        printWarnings(compiled.warnings, opts.files[0]);
        console.log(`更新: ${new Date().toLocaleTimeString('ja-JP')}`);
      } catch (error) {
        const message = (error as Error).message;
        console.error(`scenario: ${message}`);
        compiled = { html: compiled.html, warnings: [{ line: 0, message: `更新失敗: ${message}。直前のプレビューを表示しています。` }] };
      }
      revision++;
      for (const client of clients) client.write(`data: ${revision}\n\n`);
  }
  let closeWatch: () => void;
  try {
    closeWatch = watchFiles([opts.files[0], opts.layout ?? resolve(dirname(opts.files[0]), 'scenario.layout.json')], rebuild, error => console.error(`ファイル監視エラー: ${error.message}`));
  } catch (error) {
    clients.forEach(client => client.end());
    server.close();
    server.closeAllConnections();
    throw error;
  }
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  const stop = () => {
    clearInterval(heartbeat);
    closeWatch();
    clients.forEach(client => client.end());
    server.close();
    server.closeAllConnections();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
export async function main(args: string[]) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.1.0'); return; }
  const opts = options(args);
  if (opts.command === 'preview') return preview(opts);
  const input = opts.files.at(-1)!;
  const stem = basename(input, extname(input));
  const output = resolve(opts.output ?? resolve(dirname(input), `${stem}${opts.command === 'diff' ? '.diff' : ''}.html`));
  if (opts.command === 'diff') {
    const [old, next] = await Promise.all(opts.files.map(file => readFile(file, 'utf8')));
    if (opts.comparison) return save(output, opts.files, renderDiff(old, next, opts.context));
    const markup = createRevision(old, next);
    const textOnly = extname(output) === '.txt';
    const intermediate = textOnly ? output : output.replace(/\.html$/i, '') + '.txt';
    const settings = await loadLayout({ ...opts, files: [opts.files[1]] });
    const document = revisionDocument(markup);
    const html = render(document, opts.format, settings.layout);
    const inputs = [...opts.files, opts.layout ?? resolve(dirname(opts.files[1]), 'scenario.layout.json')];
    await protectOutput(intermediate, inputs);
    if (!textOnly) await protectOutput(output, [...inputs, intermediate]);
    printWarnings([...settings.warnings, ...document.warnings], opts.files[1]);
    await save(intermediate, inputs, markup);
    if (!textOnly) await save(output, inputs, html);
  } else {
    const compiled = await compile(opts);
    printWarnings(compiled.warnings, opts.files[0]);
    await save(output, [...opts.files, opts.layout ?? resolve(dirname(opts.files[0]), 'scenario.layout.json')], compiled.html);
  }
}
