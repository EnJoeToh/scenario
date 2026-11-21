import type { Block, Document, Layout, RichText, Span } from './model.ts';
import { defaultLayout, memoColors } from './model.ts';
import { displayNumber, sceneId } from './parser.ts';

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function plainSpanHtml(span: Span, content: string): string {
  if (span.kind === 'speaker') return `<span class="speaker">${content}</span>`;
  if (span.kind === 'link') return `<a href="#${escapeHtml(span.href ?? sceneId(span.target!))}">${content}</a>`;
  if (span.kind === 'bold') return `<strong>${content}</strong>`;
  if (span.kind === 'strike') return `<s>${content}</s>`;
  if (span.kind === 'red' || span.kind === 'blue') return `<span class="${span.kind}">${content}</span>`;
  return content;
}
function spanHtml(span: Span, content = escapeHtml(span.text)): string {
  const html = plainSpanHtml(span, content);
  return span.change ? `<span class="diff-${span.change}" aria-label="${span.change === 'added' ? '追加' : '削除'}">${html}</span>` : html;
}
export const richHtml = (text: RichText) => text.map(span => spanHtml(span)).join('');
const separatorText = '×\u3000\u3000×\u3000\u3000×';
const css = `
:root {
  --font-mincho: "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif;
  --font-gothic: "Yu Gothic", "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: #222;
  background: #e9e9e9;
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; text-decoration: none; }
${Object.entries(memoColors).map(([color, value]) => `.${color} { color: ${value}; --memo-background: ${value}12; }`).join('\n')}
h1, h2, h3, .stage, .speaker, footer { font-family: var(--font-gothic); }
h1, h2, h3, p { margin: 0; }
h1, h2, h3 { font-size: inherit; }
.memo { break-inside: avoid; }
.diff-added { --diff-color: #278347; --diff-background: #27834712; }
.diff-deleted { --diff-color: #c33; --diff-background: #cc333312; }
.diff-deleted, .diff-deleted .speech, .diff-deleted .speaker { text-decoration-line: line-through; text-decoration-color: #555; text-decoration-thickness: 2px; }
span.diff-added { background: #a8e9b2; }
span.diff-deleted { background: #f7b4b4; }
.horizontal-document .diff-added:not(span), .horizontal-document .diff-deleted:not(span) { position: relative; background: var(--diff-background); }
.horizontal-document .diff-added:not(span)::before, .horizontal-document .diff-deleted:not(span)::before { content: ""; position: absolute; inset: 0 auto 0 -6pt; border-left: 4px solid var(--diff-color); pointer-events: none; }
.horizontal-document .scene.diff-added::before, .horizontal-document .scene.diff-deleted::before, .horizontal-document .diff-group.diff-added::before, .horizontal-document .diff-group.diff-deleted::before { left: 0; }
.vertical-diff { position: absolute; top: -4pt; bottom: -8pt; border-top: 4px solid #278347; background: #27834712; pointer-events: none; }
.vertical-diff.deleted { border-color: #c33; background: #cc333312; }
.revision-legend { padding: 8px 16px; font: 14px/1.5 var(--font-gothic); background: white; }
@media print { .revision-legend { display: none; } }

/* Horizontal: follow legacy/horizontal.html. */
.horizontal-view { background: #fff; color: #111; }
.horizontal-document {
  width: min(170mm, 100%);
  margin: 0 auto;
  font: 12pt/1.5 var(--font-mincho);
  overflow-wrap: anywhere;
}
.horizontal-document h1 {
  font-size: 20pt;
  font-weight: 400;
  border-left: 6px solid #555;
  padding-left: 10px;
  margin: 10mm 0 8mm;
}
.horizontal-document h2 {
  font-size: 20pt;
  font-weight: 400;
  margin: 8mm 0;
  padding: 1mm 2mm;
  border: 1px solid #ddd;
  background: #999;
  color: #fff;
}
.horizontal-document .scene {
  position: relative;
  border: 1px solid #ccc;
  border-radius: 10px 0 10px 10px;
  padding: 2mm 3mm 1mm;
  margin-bottom: 8mm;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.horizontal-document .scene-number {
  position: absolute;
  top: 0;
  right: 0;
  max-width: 100%;
  padding: 0.1em 1em;
  font: 600 10pt/1.5 var(--font-gothic);
  color: #fff;
  background: #aaa;
  border-left: 1px solid #ccc;
  border-bottom: 1px solid #ccc;
}
.horizontal-document .scene-title {
  width: 100%;
  padding-right: 4em;
  text-align: left;
  font-weight: 600;
  margin-bottom: 2mm;
}
.horizontal-document p {
  width: 100%;
  font-family: var(--font-gothic);
  margin-bottom: 1mm;
  white-space: pre-wrap;
  text-align: left;
}
.horizontal-document .stage { padding-left: 2em; margin: 0; }
.horizontal-document .stage-end { margin-bottom: 1.5em; }
.horizontal-document .conversation { width: 100%; text-align: center; margin-bottom: 4mm; }
.speaker { text-align: center; }
.horizontal-document .speaker { font-weight: 400; margin-bottom: 1mm; }
.horizontal-document .speech {
  display: inline-block;
  max-width: min(120mm, 100%);
  text-align: left;
  padding-left: 1em;
  text-indent: -1em;
  white-space: pre-wrap;
}
.horizontal-document .memo { position: relative; width: 100%; margin: 0; padding: 0; text-indent: 0; background: var(--memo-background); border-radius: 6px; }
.horizontal-document .memo::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid currentColor;
  border-radius: 6px;
  pointer-events: none;
}
.horizontal-document .memo p { margin: 0; padding: 0; text-indent: 0; }
.horizontal-document .scene > .memo { width: calc(100% + 6mm); padding-inline: 3mm; }
.horizontal-document .scene > .memo::before { left: 0; }
.horizontal-document .diff-group { width: 100%; display: flex; flex-direction: column; align-items: center; }
.horizontal-document .scene > .diff-group { width: calc(100% + 6mm); padding-inline: 3mm; }
.horizontal-document .scene > .diff-group > .memo { width: calc(100% + 6mm); padding-inline: 3mm; }
.horizontal-document .scene > .diff-group > .memo::before { left: 0; }
.horizontal-document a { font-family: var(--font-gothic); color: #55f; text-decoration: none; }
.horizontal-document .end { text-align: end; }
.horizontal-document .separator {
  width: 100%;
  margin: 1.5em 0;
  text-align: center;
  white-space: pre;
}

/* Vertical: 20 cells by 40 columns. */
.page { position: relative; width: 297mm; height: 210mm; background: white; margin: 8mm auto; box-shadow: 0 2px 12px #aaa; overflow: hidden; }
.page-body { position: absolute; top: calc((210mm - 240pt)/2); right: calc((297mm - 800pt)/2); width: 800pt; height: 240pt; display: flex; flex-direction: row-reverse; }
.column { flex: 0 0 20pt; width: 20pt; height: 240pt; writing-mode: vertical-rl; text-orientation: mixed; font: 12pt/20pt var(--font-mincho); white-space: pre; overflow: visible; letter-spacing: 0; }
.column.title, .column.scene-title, .column.stage { font-family: var(--font-gothic); }
.column.title, .column.scene-title { font-weight: bold; }
.column.title { font-size: 19.2pt; }
.column.title.title-border { border-left: 6px solid #555; }
.column.part { font-size: 14.4pt; font-weight: 400; }
.vertical-scene {
  position: absolute;
  top: -4pt;
  border: 1px solid #ccc;
  pointer-events: none;
}
.vertical-scene.continues-before { border-right: none; }
.vertical-scene.continues-after { border-left: none; }
.vertical-memo {
  position: absolute;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: var(--memo-background);
  pointer-events: none;
}
.vertical-scene-number {
  position: absolute;
  right: -1px;
  top: 100%;
  padding: 0.1em 1em;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  white-space: nowrap;
  font: 600 10pt/1.5 var(--font-gothic);
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: #aaa;
  border: 1px solid #ccc;
  border-top: none;
}
.page-number { position: absolute; bottom: 8mm; width: 100%; text-align: center; font: 10pt var(--font-gothic); }
@media print {
  :root { background: white; }
  .page { margin: 0; box-shadow: none; break-after: page; }
  .page:last-child { break-after: auto; }
  .horizontal-document { width: auto; max-width: 170mm; margin: 0 auto; }
  .horizontal-document .scene { break-inside: auto; }
  .horizontal-document .scene-title { break-after: avoid; }
  a { color: inherit; }
}
`;

export function htmlDocument(body: string, title: string, format: 'vertical' | 'horizontal', extraCss = ''): string {
  return `<!doctype html>\n<html lang="ja" class="${format}-view"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}\n@media print{@page{size:A4 ${format === 'vertical' ? 'landscape' : 'portrait'};margin:${format === 'vertical' ? '0' : '18mm 18mm 20mm'}}}\n${extraCss}</style></head><body class="${format}-view">${body}</body></html>\n`;
}
function plainHorizontalBlock(block: Block, stageEnd = false, dialogueNumber?: number): string {
  const source = `data-source-line="${block.sourceLine}"`;
  if (block.type === 'separator') return `<div class="separator" ${source}>${separatorText}</div>`;
  if (block.type === 'memo') return `<div class="memo ${block.color}" ${source}>${block.lines.map(line => `<p>${richHtml(line) || '<br>'}</p>`).join('')}</div>`;
  if (block.type === 'conversation') return `<div class="conversation" ${source}><div class="speaker">${dialogueNumber}: ${escapeHtml(block.speaker)}</div><div class="speech">${richHtml(block.text)}</div></div>`;
  return `<p class="${block.type} ${block.alignment}${stageEnd ? ' stage-end' : ''}" ${source}>${richHtml(block.text)}</p>`;
}
function horizontalBlock(block: Block, stageEnd = false, dialogueNumber?: number): string {
  const html = plainHorizontalBlock(block, stageEnd, dialogueNumber);
  return block.change ? html.replace('class="', `class="diff-${block.change} `) : html;
}

interface Glyph { span: Span; text: string; width: number }
export interface Column {
  html: string; className: string; indent: number; sourceLine: number; id?: string; width?: number;
  hanging?: number;
  extent?: number;
  memo?: { id: string; color: string };
  scene?: { id: string; number: string };
  revision?: { id: number; change: 'added' | 'deleted' };
}
interface Group { columns: Column[]; before: number; after: number; sceneHeading?: boolean }
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const noStart = new Set(Array.from('、。，．・：；？！ー〜…‥）〕］｝〉》」』】〙〗〟’”»ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々ゝゞヽヾ'));
const noEnd = new Set(Array.from('（〔［｛〈《「『【〘〖〝‘“«'));
const hangable = new Set(Array.from('、。，．？！）〕］｝〉》」』】〙〗〟’”»'));
function glyphs(text: RichText): Glyph[] {
  return text.flatMap(span => [...segmenter.segment(span.text)].map(({ segment }) => ({
    span, text: segment, width: /^[\x20-\x7e\uff61-\uff9f]+$/.test(segment) ? 0.5 : 1,
  })));
}
function renderGlyphs(glyphs: Glyph[]): string {
  let html = '';
  for (let start = 0; start < glyphs.length;) {
    let end = start + 1;
    while (end < glyphs.length && glyphs[end].span === glyphs[start].span) end++;
    html += spanHtml(glyphs[start].span, escapeHtml(glyphs.slice(start, end).map(g => g.text).join('')));
    start = end;
  }
  return html;
}
export function wrap(text: RichText, first: number, continuation: number, className: string, sourceLine: number, end = false, options: { cells?: number; hanging?: boolean } = {}): Column[] {
  const remaining = glyphs(text);
  const cells = options.cells ?? 20;
  const scale = className === 'title' ? 1.6 : className === 'part' ? 1.2 : 1;
  const columns: Column[] = [];
  do {
    const indent = Math.min(columns.length ? continuation : first, cells - scale);
    const capacity = cells - indent;
    let width = 0;
    let count = 0;
    while (count < remaining.length && width + remaining[count].width * scale <= capacity + 1e-9) width += remaining[count++].width * scale;
    // Hang punctuation/closing brackets by up to two em beyond the column end.
    let hangingWidth = 0;
    while (options.hanging !== false && count < remaining.length && hangable.has(remaining[count].text) &&
      hangingWidth + remaining[count].width * scale <= 2 * scale + 1e-9) {
      hangingWidth += remaining[count++].width * scale;
    }
    // Other prohibited starts (and overlong punctuation runs) still wrap earlier.
    if (count < remaining.length) {
      let legal = count;
      while (legal > 0 && (noStart.has(remaining[legal]?.text) || noEnd.has(remaining[legal - 1].text))) legal--;
      if (legal > 0) count = legal;
    }
    const selected = remaining.splice(0, Math.max(count, remaining.length ? 1 : 0));
    const used = selected.reduce((sum, glyph) => sum + glyph.width * scale, 0);
    columns.push({
      html: renderGlyphs(selected), className, sourceLine,
      indent: end ? Math.max(indent, cells - used) : indent,
      ...(used > capacity + 1e-9 ? { hanging: used - capacity } : {}),
      ...(className.startsWith('memo ') ? { extent: indent + used } : {}),
    });
  } while (remaining.length);
  return columns;
}
function plainBlockColumns(block: Block, layout: Layout): Column[] {
  if (block.type === 'separator') return [{ html: separatorText, className: 'separator', indent: 4.5, sourceLine: block.sourceLine }];
  if (block.type === 'memo') return block.lines.flatMap((text, index) =>
    wrap(text, 0, 0, `memo ${block.color}`, block.sourceLine + index + 1, false, { cells: 18, hanging: false })
      .map(column => ({ ...column, memo: { id: `memo-${block.sourceLine}`, color: block.color } })));
  if (block.type === 'conversation') return wrap([
    { kind: 'speaker', text: block.speaker } as Span,
    ...block.text,
  ], layout.dialogueFirst, layout.dialogueContinuation, 'conversation', block.sourceLine);
  const indent = block.type === 'stage' ? layout.stage : layout.text;
  return wrap(block.text, indent, indent, block.type, block.sourceLine, block.alignment === 'end');
}
function blockColumns(block: Block, layout: Layout): Column[] {
  return plainBlockColumns(block, layout).map(column => block.change ? { ...column, className: `${column.className} diff-${block.change}`, revision: { id: block.sourceLine, change: block.change } } : column);
}

export function paginate(document: Document, layout: Layout = defaultLayout): Column[][] {
  const groups: Group[] = [];
  const blockGroup = (block: Block): Group => ({
    columns: blockColumns(block, layout),
    before: block.type === 'separator' ? 1 : 0,
    after: block.type === 'separator' ? 1 : 0,
  });
  let previousScene = false;
  for (const node of document.nodes) {
    if (node.type === 'title' || node.type === 'part') {
      const scale = node.type === 'title' ? 1.6 : 1.2;
      const indent = layout[node.type] * scale;
      const columns = wrap(node.text, indent, indent, node.type, node.sourceLine);
      if (node.change) columns.forEach(column => { column.className += ` diff-${node.change}`; column.revision = { id: node.sourceLine, change: node.change! }; });
      if (node.type === 'title') {
        const last = columns.at(-1)!;
        last.className += ' title-border';
        last.width = 24.5; // 20pt text column plus the legacy 6px (4.5pt) rule.
      }
      groups.push({ columns, before: node.type === 'part' ? 1 : 0, after: node.type === 'part' ? 24 / 20 : 0 });
      previousScene = false;
    } else if (node.type === 'scene') {
      const firstGroup = groups.length;
      const columns = wrap([{ kind: 'plain', text: '○' }, ...node.text], layout.scene, layout.scene, 'scene-title', node.sourceLine);
      if (node.change) columns.forEach(column => { column.className += ` diff-${node.change}`; column.revision = { id: node.sourceLine, change: node.change! }; });
      columns[0].id = node.id;
      const firstBlock = node.blocks[0] ? blockGroup(node.blocks[0]) : undefined;
      if (firstBlock) {
        if (firstBlock.before) columns.push({ html: '', className: 'blank', indent: 0, sourceLine: 0 });
        columns.push(...firstBlock.columns);
      }
      groups.push({ columns, before: previousScene ? 1 : 0, after: firstBlock?.after ?? 0, sceneHeading: true });
      for (const block of node.blocks.slice(1)) groups.push(blockGroup(block));
      for (const group of groups.slice(firstGroup)) {
        for (const column of group.columns) column.scene = { id: node.id, number: displayNumber(node.number) };
      }
      previousScene = true;
    } else {
      groups.push(blockGroup(node as Block));
      previousScene = false;
    }
  }
  const columnWidth = (column: Column) => column.width ?? 20;
  const totalWidth = (columns: Column[]) => columns.reduce((sum, column) => sum + columnWidth(column), 0);
  const pages: Column[][] = [[]];
  let pending = 0;
  const blank: Column = { html: '', className: 'blank', indent: 0, sourceLine: 0 };
  for (const group of groups) {
    let page = pages.at(-1)!;
    const gap = page.length ? Math.max(pending, group.before) * 20 : 0;
    if (page.length && (totalWidth(page) + gap + Math.min(totalWidth(group.columns), 800) > 800 + 1e-9)) {
      pages.push([]);
      page = pages.at(-1)!;
    } else if (page.length && gap) {
      const scene = page.at(-1)?.scene;
      const sameScene = scene?.id === group.columns[0]?.scene?.id;
      const revision = page.at(-1)?.revision;
      page.push({ ...blank, width: gap, ...(scene && sameScene ? { scene } : {}),
        ...(sameScene && revision && revision.change === group.columns[0]?.revision?.change ? { revision } : {}) });
    }
    for (const column of group.columns) {
      if (totalWidth(page) + columnWidth(column) > 800 + 1e-9) { pages.push([]); page = pages.at(-1)!; }
      page.push(column);
    }
    pending = group.after;
  }
  return pages;
}
function verticalPage(columns: Column[], previous: Column[] = [], next: Column[] = []): string {
  const frames: string[] = [];
  const memoOffsets = new Map<number, number>();
  for (let start = 0; start < columns.length;) {
    const scene = columns[start].scene;
    if (!scene) { start++; continue; }
    let end = start + 1;
    while (end < columns.length && columns[end].scene?.id === scene.id) end++;
    const right = columns.slice(0, start).reduce((sum, column) => sum + (column.width ?? 20), 0);
    const width = columns.slice(start, end).reduce((sum, column) => sum + (column.width ?? 20), 0);
    // The number hangs outside the frame; keep the lower border close to the text.
    const footer = 8;
    const continuesBefore = start === 0 && previous.at(-1)?.scene?.id === scene.id;
    const continuesAfter = end === columns.length && next[0]?.scene?.id === scene.id;
    const className = `vertical-scene${continuesBefore ? ' continues-before' : ''}${continuesAfter ? ' continues-after' : ''}`;
    frames.push(`<section class="${className}" data-scene-id="${scene.id}" aria-label="シーン ${scene.number}" style="right:${right}pt;width:${width}pt;bottom:-${footer}pt"><span class="vertical-scene-number">${scene.number}</span></section>`);
    start = end;
  }
  for (let start = 0; start < columns.length;) {
    const memo = columns[start].memo;
    if (!memo) { start++; continue; }
    let end = start + 1;
    while (end < columns.length && columns[end].memo?.id === memo.id) end++;
    const fragment = columns.slice(start, end);
    const right = columns.slice(0, start).reduce((sum, column) => sum + (column.width ?? 20), 0);
    const width = fragment.reduce((sum, column) => sum + (column.width ?? 20), 0);
    const textHeight = Math.max(0, ...fragment.map(column => column.extent ?? 0)) * 12;
    const offset = 12;
    for (let index = start; index < end; index++) memoOffsets.set(index, offset);
    frames.push(`<div class="vertical-memo ${memo.color}" data-memo-id="${memo.id}" aria-hidden="true" style="right:${right}pt;width:${width}pt;top:${offset - 3}pt;height:${textHeight + 6}pt"></div>`);
    start = end;
  }
  for (let start = 0; start < columns.length;) {
    const revision = columns[start].revision;
    if (!revision) { start++; continue; }
    let end = start + 1;
    while (end < columns.length && columns[end].revision?.change === revision.change && columns[end].scene?.id === columns[start].scene?.id) end++;
    const right = columns.slice(0, start).reduce((sum, column) => sum + (column.width ?? 20), 0);
    const width = columns.slice(start, end).reduce((sum, column) => sum + (column.width ?? 20), 0);
    frames.push(`<div class="vertical-diff ${revision.change}" aria-hidden="true" style="right:${right}pt;width:${width}pt"></div>`);
    start = end;
  }
  return frames.join('') + columns.map((column, index) => `<div class="column ${column.className}" data-source-line="${column.sourceLine}"${column.id ? ` id="${column.id}"` : ''} style="padding-inline-start:${column.indent * 12 + (memoOffsets.get(index) ?? 0)}pt${column.width ? `;flex-basis:${column.width}pt;width:${column.width}pt` : ''}">${column.html}</div>`).join('');
}
export function render(document: Document, format: 'vertical' | 'horizontal' = 'vertical', layout: Layout = defaultLayout): string {
  const heading = document.nodes.find(n => n.type === 'title');
  const title = heading && 'text' in heading ? heading.text.map(span => span.text).join('') : 'Scenario';
  let body: string;
  if (format === 'horizontal') {
    let dialogueNumber = 0;
    const renderBlock = (block: Block, stageEnd: boolean) => horizontalBlock(block, stageEnd, block.type === 'conversation' ? ++dialogueNumber : undefined);
    const renderRuns = (nodes: Document['nodes'], draw: (node: Document['nodes'][number], index: number) => string) => {
      const result: string[] = [];
      for (let start = 0; start < nodes.length;) {
        const node = nodes[start];
        if (!node.change || node.type === 'scene' || node.type === 'title' || node.type === 'part') {
          result.push(draw(node, start++)); continue;
        }
        let end = start + 1;
        while (end < nodes.length && nodes[end].change === node.change && !['scene', 'title', 'part'].includes(nodes[end].type)) end++;
        const members = nodes.slice(start, end).map((member, index) => draw({ ...member, change: undefined }, start + index)).join('');
        result.push(`<div class="diff-group diff-${node.change}">${members}</div>`);
        start = end;
      }
      return result.join('');
    };
    body = '<main class="horizontal-document">' + renderRuns(document.nodes, (node, index) => {
      if (node.type === 'title' || node.type === 'part') return `<${node.type === 'title' ? 'h1' : 'h2'}${node.change ? ` class="diff-${node.change}"` : ''} data-source-line="${node.sourceLine}">${richHtml(node.text)}</${node.type === 'title' ? 'h1' : 'h2'}>`;
      if (node.type === 'scene') {
        const blocks = node.blocks.map(block => block.change && block.change === node.change ? { ...block, change: undefined } : block);
        return `<section class="scene${node.change ? ` diff-${node.change}` : ''}" id="${node.id}"><div class="scene-number">${displayNumber(node.number)}</div><h3 class="scene-title">○${richHtml(node.text)}</h3>${renderRuns(blocks, (block, i) => renderBlock(block as Block, block.type === 'stage' && blocks[i + 1]?.type !== 'stage'))}</section>`;
      }
      return renderBlock(node as Block, node.type === 'stage' && document.nodes[index + 1]?.type !== 'stage');
    }) + '</main>';
  } else {
    const pages = paginate(document, layout);
    body = pages.map((columns, index) => `<section class="page"><main class="page-body">${verticalPage(columns, pages[index - 1], pages[index + 1])}</main><footer class="page-number">${index + 1}</footer></section>`).join('');
  }
  if (document.revision) body = `<aside class="revision-legend"><span class="diff-added">追加</span> ／ <span class="diff-deleted">削除</span> — シーン番号は差分内で振り直しています。${document.unchanged ? '変更はありません。' : ''}</aside>` + body;
  return htmlDocument(body, document.revision ? `diff — ${title}` : title, format);
}
