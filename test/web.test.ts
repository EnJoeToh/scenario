import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../web/compile.ts';
import { parse } from '../src/parser.ts';
import { render } from '../src/render.ts';
import { readRevision, renderRevision } from '../src/revision.ts';

test('Web normal output matches CLI renderer, preserving escaping and print dimensions', () => {
  const source = '☆ 試作/第一稿\n■ 宿屋\n太郎「<script> & こんにちは」';
  const result = compile({ mode: 'normal', source });
  assert.equal(result.html, render(parse(source), 'vertical'));
  assert.equal(result.basename, '試作_第一稿');
  assert.equal(result.intermediate, null);
  assert.equal(result.pages, 1);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /zoom:/);
});

test('Web diff exports a lossless intermediate and the same HTML as CLI', () => {
  const before = readFileSync(new URL('../examples/diff-before.txt', import.meta.url), 'utf8');
  const after = readFileSync(new URL('../examples/diff-after.txt', import.meta.url), 'utf8');
  const result = compile({ mode: 'diff', before, after });
  assert(result.intermediate);
  assert.deepEqual(readRevision(result.intermediate), { old: before, next: after });
  assert.equal(result.html, renderRevision(result.intermediate, 'vertical'));
  assert(result.pages > 0);
  assert.match(result.basename, /\.diff$/);
  assert.match(result.html, /diff-added/);
  assert.match(result.html, /diff-deleted/);
});

test('Web diff supports unchanged inputs and complete additions or deletions', () => {
  const text = '■ 庭\n花が咲いている。';
  assert.equal(compile({ mode: 'diff', before: text, after: text }).unchanged, true);
  for (const [before, after] of [['', text], [text, '']]) {
    const result = compile({ mode: 'diff', before, after });
    assert.equal(result.unchanged, false);
    assert(result.pages > 0);
    assert(result.intermediate);
    assert.deepEqual(readRevision(result.intermediate), { old: before, next: after });
  }
  assert.throws(() => compile({ mode: 'normal', source: '  \n' }), /原稿を入力/);
  assert.throws(() => compile({ mode: 'diff', before: '', after: '' }), /原稿を入力/);
});

test('Web diff warnings identify the old and new manuscript', () => {
  const result = compile({ mode: 'diff', before: ':::red\n旧メモ', after: ':::blue\n新メモ' });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /^旧原稿 1行目/);
  assert.match(result.warnings[1], /^新原稿 1行目/);
});
