import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { compilePreview, watchFiles } from '../src/cli.ts';
const bin = resolve('bin/scenario.js');
const run = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('CLI builds both formats, loads layout, warns without failure, and rejects overwrite', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'scenario-cli-'));
  try {
    const input = resolve(directory, 'input.txt');
    const output = resolve(directory, 'out.html');
    await writeFile(input, '■ 1 導入\n＠ 本文\n>> 99');
    await writeFile(resolve(directory, 'scenario.layout.json'), JSON.stringify({ stage: 4 }));
    const vertical = run('build', input, '-o', output);
    assert.equal(vertical.status, 0, vertical.stderr);
    assert.match(vertical.stderr, /存在しない/);
    assert.match(await readFile(output, 'utf8'), /padding-inline-start:48pt/);
    assert.equal(run('build', input, '--format', 'horizontal', '-o', output).status, 0);
    assert.match(await readFile(output, 'utf8'), /class="horizontal-document"/);
    assert.equal(run('build', input, '-o', input).status, 1);
    const alias = resolve(directory, 'alias.html');
    await symlink(input, alias);
    assert.equal(run('build', input, '-o', alias).status, 1);
    assert.equal(await readFile(input, 'utf8'), '■ 1 導入\n＠ 本文\n>> 99');
    assert.equal(run('build', input, '--format', 'invalid').status, 1);
    assert.equal(run('build', resolve(directory, 'missing.txt')).status, 1);
    assert.equal(run('diff', input, input, '-o', output).status, 0);
    assert.match(await readFile(output, 'utf8'), /変更はありません/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI revision creates editable intermediate, rebuilds both formats, and protects both outputs', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'scenario-revision-'));
  try {
    const old = resolve(directory, 'old.txt'), next = resolve(directory, 'new.txt');
    const html = resolve(directory, 'changes.html'), markup = resolve(directory, 'changes.txt');
    await writeFile(old, '■ 100 宿屋\n太郎「明日、出発つする」\n:::red\n注意\n:::');
    await writeFile(next, '■ 200 宿屋\n太郎「明日、出発する」\n:::red\n注意\n:::');
    const result = run('diff', old, next, '-o', html);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(markup, 'utf8'), /^#!scenario-diff-v1\n/);
    const firstHtml = await readFile(html, 'utf8');
    assert.match(firstHtml, /class="page"/);
    assert.equal(run('build', markup, '-o', html).status, 0);
    assert.equal(await readFile(html, 'utf8'), firstHtml);
    const preview = await compilePreview({ files: [markup], format: 'horizontal' });
    assert.match(preview.html, /horizontal-document/);
    assert.match(preview.html, /memo red/);
    assert.equal(run('diff', old, next, '--format', 'horizontal', '-o', html).status, 0);
    assert.equal(await readFile(html, 'utf8'), preview.html);
    assert.equal(run('diff', old, next, '--comparison', '--context', '1', '-o', html).status, 0);
    assert.match(await readFile(html, 'utf8'), /<table>/);
    assert.equal(run('diff', old, next, '--context', '1').status, 1);
    const original = await readFile(next, 'utf8');
    assert.equal(run('diff', old, next, '-o', next).status, 1);
    assert.equal(await readFile(next, 'utf8'), original);
    // The HTML would be safe, but its automatic text companion aliases an input.
    assert.equal(run('diff', old, next, '-o', resolve(directory, 'new.html')).status, 1);
    await assert.rejects(readFile(resolve(directory, 'new.html')), /ENOENT/);
    const textOnly = resolve(directory, 'only.diff.txt');
    assert.equal(run('diff', old, next, '-o', textOnly).status, 0);
    assert.match(await readFile(textOnly, 'utf8'), /^#!scenario-diff-v1/);
    await assert.rejects(readFile(resolve(directory, 'only.diff.html')), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('file watcher handles atomic saves, layout creation, read failures, and recovery', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'scenario-watch-'));
  const input = resolve(directory, 'input.txt');
  const layout = resolve(directory, 'scenario.layout.json');
  await writeFile(input, '最初');
  let notify: (value: string) => void = () => {};
  const close = watchFiles([input, layout], async () => { notify(await readFile(input, 'utf8')); }, error => notify(`error:${error.message}`));
  const changed = (action: () => Promise<unknown>) => new Promise<string>((done, reject) => {
    notify = done;
    action().catch(reject);
  });
  try {
    assert.equal(await changed(async () => {
      const temporary = resolve(directory, 'temporary.txt');
      await writeFile(temporary, '更新');
      await rename(temporary, input);
    }), '更新');
    assert.equal(await changed(() => writeFile(layout, '{"text":3}')), '更新');
    assert.match(await changed(() => rm(input)), /^error:/);
    assert.equal(await changed(() => writeFile(input, '復旧')), '復旧');
  } finally { close(); await rm(directory, { recursive: true, force: true }); }
});

test('preview saves standalone HTML on compilation, updates settings, and protects inputs', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'scenario-preview-output-'));
  try {
    const input = resolve(directory, 'input.txt');
    const layout = resolve(directory, 'scenario.layout.json');
    const output = resolve(directory, 'nested', 'preview.html');
    const opts = { files: [input], format: 'vertical' as const, output };
    await writeFile(input, '＠ 最初');
    const initial = await compilePreview(opts);
    assert.equal(await readFile(output, 'utf8'), initial.html);
    assert.ok(!initial.html.includes('EventSource'));
    assert.ok(!initial.html.includes('preview-warnings'));
    await writeFile(input, '＠ 保存後');
    await writeFile(layout, '{"stage":4}');
    await compilePreview(opts);
    const latest = await readFile(output, 'utf8');
    assert.match(latest, /保存後/);
    assert.match(latest, /padding-inline-start:48pt/);
    await rm(input);
    await assert.rejects(compilePreview(opts), /ENOENT/);
    assert.equal(await readFile(output, 'utf8'), latest);
    await writeFile(input, '＠ 復旧');
    await compilePreview(opts);
    assert.match(await readFile(output, 'utf8'), /復旧/);
    for (const protectedFile of [input, layout]) {
      const before = await readFile(protectedFile, 'utf8');
      await assert.rejects(compilePreview({ ...opts, output: protectedFile }), /入力ファイル/);
      assert.equal(await readFile(protectedFile, 'utf8'), before);
    }
    const alias = resolve(directory, 'alias.html');
    await symlink(input, alias);
    await assert.rejects(compilePreview({ ...opts, output: alias }), /入力ファイル/);
    const blocker = resolve(directory, 'file');
    await writeFile(blocker, 'file');
    await assert.rejects(compilePreview({ ...opts, output: resolve(blocker, 'out.html') }));
    await rm(output);
    await compilePreview({ ...opts, output: undefined });
    await assert.rejects(readFile(output), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preview serves HTML, sends SSE updates, and survives atomic saves and read errors', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'scenario-preview-'));
  const input = resolve(directory, 'input.txt');
  const output = resolve(directory, 'saved.html');
  await writeFile(input, '最初の原稿');
  const child = spawn(process.execPath, [bin, 'preview', 'input.txt', '-o', 'saved.html', '--port', '0'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const controller = new AbortController();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const url = await new Promise<string>((done, reject) => {
      let stdout = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
        const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout);
        if (match) done(match[0]);
      });
      child.once('exit', code => reject(new Error(`preview exited ${code}: ${stderr}`)));
      child.once('error', reject);
    });
    assert.match(await (await fetch(url)).text(), /最初の原稿/);
    assert.match(await readFile(output, 'utf8'), /最初の原稿/);
    assert.ok(!(await readFile(output, 'utf8')).includes('EventSource'));
    assert.equal((await fetch(url + 'other')).status, 404);
    const response = await fetch(url + 'events', { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /data: 0/);
    const update = reader.read();
    await writeFile(resolve(directory, 'temporary.txt'), '保存後の原稿');
    await rename(resolve(directory, 'temporary.txt'), input);
    assert.match(decoder.decode((await update).value), /data: 1/);
    assert.match(await (await fetch(url)).text(), /保存後の原稿/);
    assert.match(await readFile(output, 'utf8'), /保存後の原稿/);
    const layoutUpdate = reader.read();
    await writeFile(resolve(directory, 'scenario.layout.json'), '{"text":3}');
    assert.match(decoder.decode((await layoutUpdate).value), /data: 2/);
    assert.match(await (await fetch(url)).text(), /padding-inline-start:36pt/);
    const lastSaved = await readFile(output, 'utf8');
    assert.match(lastSaved, /padding-inline-start:36pt/);
    const failureUpdate = reader.read();
    await rm(input);
    await failureUpdate;
    assert.match(await (await fetch(url)).text(), /更新失敗/);
    assert.equal(await readFile(output, 'utf8'), lastSaved);
    const recovery = reader.read();
    await writeFile(input, '復旧');
    await recovery;
    assert.match(await (await fetch(url)).text(), /復旧/);
    assert.match(await readFile(output, 'utf8'), /復旧/);
  } catch (error) {
    if (/listen EPERM/.test(stderr)) {
      assert.match(await readFile(output, 'utf8'), /最初の原稿/);
      t.skip('実行環境がローカルポートの待ち受けを許可していません');
    }
    else throw error;
  } finally {
    controller.abort();
    const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
