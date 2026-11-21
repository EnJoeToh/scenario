import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, parseInline } from '../src/parser.ts';
import { defaultLayout, memoColors, validateLayout } from '../src/model.ts';
import { paginate, render, wrap } from '../src/render.ts';
import { sequenceDiff, renderDiff } from '../src/diff.ts';

test('JSON fixture: document model, source lines, reserved numbering', async () => {
  const fixture = JSON.parse(await readFile(new URL('fixtures/basic.json', import.meta.url), 'utf8'));
  assert.deepEqual(parse(fixture.source), fixture.expected);
});
test('duplicates, branch numbers, unresolved and ambiguous links', () => {
  const document = parse('>> 1 >> 9\n■ 001 導入\n■ 1 重複\n■ 100.01 枝番');
  assert.equal(document.warnings.length, 3);
  assert.equal(document.nodes[2].type, 'scene');
  assert.equal((document.nodes[2] as any).id, 'scene-1--2');
  assert.equal((document.nodes[3] as any).number, '100.01');
});
test('memo consumes structure literally; preserves blank lines and source locations', () => {
  const document = parse('::: blue\n■ 本文\n\n>> 9\n:::');
  assert.equal(document.nodes.length, 1);
  assert.equal((document.nodes[0] as any).lines.length, 3);
  assert.equal(document.warnings[0].line, 4);
  const invalid = parse('::: unknown\n■ 原文\n:::');
  assert.equal(invalid.nodes.length, 3);
  assert.equal(invalid.warnings.length, 1);
  assert.equal(parse('::: red\nメモ').warnings.length, 1);
});
test('color blocks support six colors, legacy syntax, empty blocks, and rich text', () => {
  for (const color of Object.keys(memoColors)) {
    const source = `■ 1 場面\n::: ${color}\n[+ 注意] >> 1\n<script>\n:::\n太郎「台詞」`;
    const document = parse(source);
    assert.deepEqual(document.warnings, []);
    const scene = document.nodes[0] as any;
    assert.equal(scene.blocks[0].type, 'memo');
    assert.equal(scene.blocks[0].color, color);
    assert.equal(scene.blocks[0].sourceLine, 2);
    assert.equal(scene.blocks[1].type, 'conversation');
    assert.deepEqual(document, parse(source.replace(`::: ${color}`, `::: memo ${color}`)));
    assert.deepEqual(document, parse(source.replace(`::: ${color}`, `:::${color}`)));
    for (const format of ['horizontal', 'vertical'] as const) {
      const html = render(document, format);
      assert.ok(html.includes(`memo ${color}`));
      assert.ok(html.includes('<strong>注意</strong>'));
      assert.ok(html.includes('href="#scene-1"'));
      assert.ok(!html.includes('<script>'));
    }
  }
  const empty = parse('::: blue\n:::');
  assert.deepEqual((empty.nodes[0] as any).lines, []);
  assert.deepEqual(empty.warnings, []);
  assert.ok(!parse('::: __proto__\n本文\n:::').nodes.some(node => node.type === 'memo'));
});
test('empty scene heading, escaped arrow, unmatched dialogue', () => {
  const document = parse('■ 1\n\\→本文\n太郎「途中');
  assert.equal(document.warnings.length, 1);
  assert.equal(document.nodes.length, 3);
  assert.equal((document.nodes[1] as any).text[0].text, '→本文');
});
test('standalone fullwidth asterisk becomes a centered separator with one blank line on each side', () => {
  const document = parse('前文\n ＊ \n後文\n■ 1 場面\n＊\n太郎「台詞」\n＊を含む本文\n*\n::: red\n＊\n:::');
  assert.deepEqual(document.nodes[1], { type: 'separator', sourceLine: 2 });
  assert.deepEqual(document.warnings, []);
  const pages = paginate(document, { ...defaultLayout, text: 19 });
  const first = pages[0];
  const separatorIndex = first.findIndex(column => column.className === 'separator');
  assert.equal(first[separatorIndex].html, '×　　×　　×');
  assert.equal(first[separatorIndex].indent, 4.5);
  assert.equal(first[separatorIndex - 1].className, 'blank');
  assert.equal(first[separatorIndex + 1].className, 'blank');
  const sceneColumns = first.filter(column => column.scene);
  assert.equal(sceneColumns[0].className, 'scene-title');
  assert.equal(sceneColumns[1].className, 'blank');
  assert.equal(sceneColumns[2].className, 'separator');
  assert.equal(sceneColumns[3].className, 'blank');
  const horizontal = render(document, 'horizontal');
  assert.match(horizontal, /class="separator" data-source-line="2">×　　×　　×<\/div>/);
  assert.match(horizontal, /class="speaker">1: 太郎/);
  assert.match(horizontal, /＊を含む本文/);
  assert.match(horizontal, /<p class="text start"[^>]*>\*<\/p>/);
  assert.match(horizontal, /<div class="memo red"[^>]*><p>＊<\/p>/);
  assert.equal([...render(document).matchAll(/class="vertical-scene"/g)].length, 1);
});
test('separator spacing respects page boundaries and merges between consecutive separators', () => {
  const pages = paginate(parse(Array(39).fill('本文').join('\n') + '\n＊\n後文'));
  assert.deepEqual(pages.map(page => page.length), [39, 3]);
  assert.equal(pages[1][0].className, 'separator');
  assert.equal(pages[1][1].className, 'blank');
  assert.deepEqual(paginate(parse('＊\n＊'))[0].map(column => column.className), ['separator', 'blank', 'separator']);
});
test('memo rules keep text positions, separate adjacent blocks, and follow page splits', () => {
  const document = parse('::: blue\n短文\n:::\n::: blue\n' + 'あ'.repeat(20 * 81) + '\n:::');
  const pages = paginate(document);
  assert.deepEqual(pages.map(page => page.length), [1, 40, 40, 10]);
  assert.ok(pages.flat().every(column => column.indent === 0));
  const html = render(document, 'vertical');
  assert.equal([...html.matchAll(/data-memo-id="memo-1"/g)].length, 1);
  assert.equal([...html.matchAll(/data-memo-id="memo-4"/g)].length, 3);
  assert.match(html, /data-memo-id="memo-1"[^>]*width:20pt;top:9pt;height:30pt/);
  assert.match(html, /class="column memo blue"[^>]*padding-inline-start:12pt/);
  assert.ok(pages.flat().every(column => (column.extent ?? 0) <= 18));
  const punctuation = paginate(parse('::: blue\n' + 'あ'.repeat(18) + '。」\n:::')).flat();
  assert.equal(punctuation.map(column => column.html).join(''), 'あ'.repeat(18) + '。」');
  assert.ok(punctuation.every(column => (column.extent ?? 0) <= 18 && !column.hanging));
});
test('markup and HTML escaping in both renderers', () => {
  const document = parse('☆ <script>alert(1)</script>\n■ 1 テスト\n＠ [+ 太字] [- 消す] [* 赤] [# 青]\n>> 1\n<img src=x onerror=alert(1)>');
  for (const format of ['vertical', 'horizontal'] as const) {
    const html = render(document, format);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;'));
    assert.ok(html.includes('href="#scene-1"'));
    assert.ok(html.includes('<strong>太字</strong>'));
    assert.ok(html.includes('<s>消す</s>'));
  }
});
test('decorations accept optional spaces as used in actual manuscripts', () => {
  assert.deepEqual(parseInline('[*赤字] [# 青字]'), [
    { kind: 'red', text: '赤字' }, { kind: 'plain', text: ' ' }, { kind: 'blue', text: '青字' },
  ]);
});
test('layout validation replaces invalid values and reports unknown settings', () => {
  const result = validateLayout({ stage: 19, text: 20, dialogueFirst: -1, surprise: 4 });
  assert.equal(result.layout.stage, 19);
  assert.equal(result.layout.text, 0);
  assert.equal(result.warnings.length, 3);
  assert.equal(validateLayout(null).warnings.length, 1);
});
test('fixed grid: 20 fullwidth / 40 ASCII glyphs; graphemes stay intact', () => {
  assert.equal(wrap(parseInline('あ'.repeat(41)), 0, 0, 'text', 1).length, 3);
  assert.equal(wrap(parseInline('a'.repeat(41)), 0, 0, 'text', 1).length, 2);
  assert.equal(wrap(parseInline('👨‍👩‍👧‍👦'.repeat(21)), 0, 0, 'text', 1).length, 2);
  const columns = wrap(parseInline('あ'.repeat(20) + '。'), 0, 0, 'text', 1);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].html, 'あ'.repeat(20) + '。');
  assert.equal(columns[0].hanging, 1);
});
test('hanging punctuation keeps pairs and markup; kana and opening brackets keep normal restrictions', () => {
  const pair = wrap(parseInline('あ'.repeat(20) + '[* 。」]次'), 0, 0, 'text', 1);
  assert.equal(pair[0].html, 'あ'.repeat(20) + '<span class="red">。」</span>');
  assert.equal(pair[0].hanging, 2);
  assert.equal(pair[1].html, '次');
  const indented = wrap(parseInline('あ'.repeat(18) + '。次'), 2, 2, 'stage', 1);
  assert.equal(indented[0].hanging, 1);
  assert.equal(indented[0].indent, 2);
  const kana = wrap(parseInline('あ'.repeat(20) + 'っ次'), 0, 0, 'text', 1);
  assert.equal(kana[0].html, 'あ'.repeat(19));
  assert.equal(kana[1].html, 'あっ次');
  const opening = wrap(parseInline('あ'.repeat(19) + '「次'), 0, 0, 'text', 1);
  assert.equal(opening[0].html, 'あ'.repeat(19));
  assert.equal(opening[1].html, '「次');
  const long = 'あ'.repeat(20) + '。』」次';
  const columns = wrap(parseInline(long), 0, 0, 'text', 1);
  assert.equal(columns.map(column => column.html).join(''), long);
  assert.ok(columns.every(column => (column.hanging ?? 0) <= 2));
  const html = render(parse('■ 1 場面\n' + 'あ'.repeat(20) + '。」'), 'vertical');
  assert.match(html, /bottom:-8pt/);
});
test('pagination: 40 columns, block protection, long blocks, heading with content', () => {
  const pages = paginate(parse(Array(39).fill('短文').join('\n') + '\n■ 1 場面\n本文'));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 39);
  assert.equal(pages[1][0].id, 'scene-1');
  assert.equal(pages[1][1].html, '本文');
  const long = paginate(parse('あ'.repeat(20 * 81)));
  assert.deepEqual(long.map(page => page.length), [40, 40, 1]);
  const indented = paginate(parse('＠ ' + 'あ'.repeat(19)), defaultLayout);
  assert.equal(indented[0].length, 2);
  assert.equal(indented[0][0].indent, 2);
});
test('larger vertical headings wrap within the 240pt body height', () => {
  for (const [marker, size] of [['☆', 19.2], ['★', 14.4]] as const) {
    const text = '題'.repeat(50);
    const columns = paginate(parse(`${marker} ${text}`)).flat().filter(column => column.className !== 'blank');
    assert.equal(columns.map(column => column.html).join(''), text);
    for (const column of columns) assert.ok(column.indent * 12 + [...column.html].length * size <= 240 + 1e-9);
    const extreme = paginate(parse(`${marker} ${text}`), { ...defaultLayout, title: 19, part: 19 }).flat();
    for (const column of extreme) assert.ok(column.indent * 12 + [...column.html].length * size <= 240 + 1e-9);
  }
});
test('vertical scene frames follow page fragments and repeat padded horizontal labels', () => {
  const document = parse('☆ 作品\nシーン外\n■ 1 長い場面\n' + 'あ'.repeat(20 * 81) + '\n■ 100.2 枝番\n本文\n■ 1 重複\n本文');
  const pages = paginate(document);
  assert.ok(pages.length >= 3);
  for (const page of pages) assert.ok(page.reduce((sum, column) => sum + (column.width ?? 20), 0) <= 800);
  assert.ok(pages[0].filter(c => c.className.startsWith('title') || c.sourceLine === 2).every(c => !c.scene));
  const html = render(document, 'vertical');
  for (const [id, number] of [['scene-1', '001'], ['scene-100-2', '100.2'], ['scene-1--2', '001']]) {
    const fragments = pages.filter(page => page.some(column => column.scene?.id === id)).length;
    const frames = [...html.matchAll(new RegExp(`class="vertical-scene[^\"]*" data-scene-id="${id}"[^>]*><span class="vertical-scene-number">([^<]+)</span>`, 'g'))];
    assert.equal(frames.length, fragments);
    assert.ok(frames.every(frame => frame[1] === number));
  }
  assert.equal([...html.matchAll(/ id="scene-1"/g)].length, 1);
  assert.ok(!render(document, 'horizontal').includes('<section class="vertical-scene"'));
});
test('continued vertical scenes open the left edge before a break and right edge after it', () => {
  const html = render(parse('■ 1 長い場面\n' + 'あ'.repeat(20 * 81) + '\n■ 1 別シーン\n本文'), 'vertical');
  const frames = [...html.matchAll(/class="(vertical-scene[^\"]*)" data-scene-id="([^\"]+)"/g)];
  assert.deepEqual(frames.map(frame => [frame[1], frame[2]]), [
    ['vertical-scene continues-after', 'scene-1'],
    ['vertical-scene continues-before continues-after', 'scene-1'],
    ['vertical-scene continues-before', 'scene-1'],
    ['vertical-scene', 'scene-1--2'],
  ]);
});
test('Myers diff reconstructs both inputs and finds a minimal edit script', () => {
  let seed = 19;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let iteration = 0; iteration < 200; iteration++) {
    const a = Array.from({ length: random() % 12 }, () => String(random() % 4));
    const b = Array.from({ length: random() % 12 }, () => String(random() % 4));
    const changes = sequenceDiff(a, b);
    assert.deepEqual(changes.filter(c => c.kind !== 'insert').map(c => c.text), a);
    assert.deepEqual(changes.filter(c => c.kind !== 'delete').map(c => c.text), b);
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    assert.equal(changes.filter(c => c.kind !== 'equal').length, a.length + b.length - 2 * dp[a.length][b.length]);
  }
});
test('diff output escapes input and compares raw markup, not the document model', () => {
  const html = renderDiff('■ 1 <script>\r\n古い文', '■ 1 <script>\n新しい文');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<mark>'));
  assert.ok(renderDiff('同じ', '同じ').includes('変更はありません'));
});
