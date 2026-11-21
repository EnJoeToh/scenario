import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevision, readRevision, revisionDocument, renderRevision } from '../src/revision.ts';
import { paginate } from '../src/render.ts';

test('intermediate format round trips arbitrary markup, prefixes, Unicode, and final newlines', () => {
  for (const [old, next] of [
    ['', ''], ['前\r\n後\r\n', '前\n変更\n'],
    [':::red\n> >> 100\n- 本文\n:::', ':::blue\n#!scenario-diff-v1\n+ 本文\n:::'],
    ['👨‍👩‍👧‍👦「が」\n', '👨‍👩‍👧‍👦「が」'],
  ]) {
    const markup = createRevision(old, next);
    assert.deepEqual(readRevision(markup), { old: old.replace(/\r\n/g, '\n'), next });
    assert.deepEqual(readRevision(markup + '\n'), readRevision(markup));
  }
  assert.throws(() => readRevision('本文'), /ヘッダー/);
  assert.throws(() => readRevision('#!scenario-diff-v1\n不正'), /2行目/);
});

test('typo is merged into one conversation, keeping inline decoration and escaping', () => {
  const old = '■ 100 宿屋\n太郎「[+ 明日]、出発つする」\n<script>';
  const next = '■ 200 宿屋\n太郎「[+ 明日]、出発する」\n<script>';
  const source = createRevision(old, next);
  const document = revisionDocument(source);
  const scene = document.nodes[0] as any;
  assert.equal(scene.number, '1');
  assert.equal(scene.blocks.filter((block: any) => block.type === 'conversation').length, 1);
  assert.equal(scene.blocks[0].text.filter((span: any) => span.change === 'deleted').map((span: any) => span.text).join(''), 'つ');
  for (const format of ['horizontal', 'vertical'] as const) {
    const html = renderRevision(source, format);
    assert.match(html, /<strong>/);
    assert.match(html, /diff-deleted/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('出発つする</'));
  }
});

test('inserted line does not shift typo pairing and whole replacements stay as blocks', () => {
  const document = revisionDocument(createRevision('■ 部屋\n太郎「明日、出発する」\n＠ 古い部屋。', '■ 部屋\n花子「待って」\n太郎「今夜、出発する」\n＠ 森の奥で雨が降る。'));
  const blocks = (document.nodes[0] as any).blocks;
  assert.equal(blocks[0].speaker, '花子');
  assert.equal(blocks[0].change, 'added');
  assert.equal(blocks[1].speaker, '太郎');
  assert.equal(blocks[1].change, undefined);
  assert.ok(blocks[1].text.some((span: any) => span.change === 'added'));
  assert.deepEqual(blocks.slice(2).map((block: any) => block.change), ['deleted', 'added']);
});

test('memo markup and original color survive edits, additions, and deletions', () => {
  const old = '■ 宿屋\n:::red\n[+ 確認]して下さぃ。\n:::\n:::blue\n古いメモ\n:::';
  const next = '■ 宿屋\n:::red\n[+ 確認]して下さい。\n:::\n:::green\n新しいメモ\n:::';
  const document = revisionDocument(createRevision(old, next));
  const memos = (document.nodes[0] as any).blocks;
  assert.deepEqual(memos.map((block: any) => block.color), ['red', 'blue', 'green']);
  assert.ok(memos[0].lines[0].some((span: any) => span.change === 'deleted'));
  assert.equal(memos[1].change, 'deleted');
  assert.equal(memos[2].change, 'added');
  for (const format of ['horizontal', 'vertical'] as const) {
    const html = renderRevision(createRevision(old, next), format);
    assert.match(html, /memo red/);
    if (format === 'horizontal') {
      assert.match(html, /class="diff-group diff-deleted"><div class="memo blue"/);
      assert.match(html, /class="diff-group diff-added"><div class="memo green"/);
    } else {
      assert.match(html, /memo blue diff-deleted/);
      assert.match(html, /memo green diff-added/);
    }
    assert.ok(!html.includes(':::'));
  }
});

test('renamed scene uses one frame; deleted and added scenes keep their contents', () => {
  const renamed = revisionDocument(createRevision('■ 100 宿屋\n本文', '■ 200 街道\n本文'));
  assert.equal(renamed.nodes.length, 1);
  assert.equal((renamed.nodes[0] as any).blocks.length, 1);
  assert.ok((renamed.nodes[0] as any).text.some((span: any) => span.change));
  const removed = revisionDocument(createRevision('■ 宿屋\n本文\n■ 森\n太郎「帰ろう」', '■ 宿屋\n本文'));
  assert.equal(removed.nodes[1].change, 'deleted');
  assert.equal((removed.nodes[1] as any).blocks[0].change, 'deleted');
  const html = renderRevision(createRevision('■ 100 宿屋\n>> 200\n■ 200 森\n本文', '■ 100 宿屋\n>> 200\n■ 200 森\n追記'));
  assert.match(html, /href="#revision-scene-2"/);
  assert.match(html, /id="revision-scene-2"/);
});

test('diff pagination keeps column limits and unchanged revisions remain readable', () => {
  const document = revisionDocument(createRevision('■ 宿屋\n' + 'あ'.repeat(1600), '■ 宿屋\n' + 'い'.repeat(1600)));
  assert.ok(paginate(document).length >= 4);
  assert.ok(paginate(document).every(page => page.reduce((sum, column) => sum + (column.width ?? 20), 0) <= 800));
  assert.match(renderRevision(createRevision('同じ', '同じ')), /変更はありません/);
});

test('consecutive block changes share a frame, with boundaries at unchanged blocks and scenes', () => {
  const source = createRevision('■ 1 部屋\n残す本文\n■ 2 庭\n後の本文', '■ 1 部屋\n＠ 追加のト書き\n花子「追加の台詞」\n:::blue\n追加の注記\n:::\n残す本文\n＠ 次の追加\n■ 2 庭\n＠ 別シーンの追加\n後の本文');
  const vertical = renderRevision(source);
  assert.equal([...vertical.matchAll(/class="vertical-diff added"/g)].length, 3);
  const horizontal = renderRevision(source, 'horizontal');
  assert.equal([...horizontal.matchAll(/class="diff-group diff-added"/g)].length, 3);
  assert.match(horizontal, /class="diff-group diff-added">[\s\S]*?class="stage start[\s\S]*?class="conversation"[\s\S]*?class="memo blue"/);
  const deletedScene = renderRevision(createRevision('■ 宿屋\n本文\n■ 森\n＠ 木漏れ日\n太郎「休もう」', '■ 宿屋\n本文'), 'horizontal');
  assert.equal([...deletedScene.matchAll(/class="scene diff-deleted"/g)].length, 1);
  assert.equal([...deletedScene.matchAll(/class="diff-group diff-deleted"/g)].length, 0);
});
