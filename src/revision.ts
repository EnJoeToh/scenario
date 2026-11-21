import { sequenceDiff } from './diff.ts';
import { normalize, parse } from './parser.ts';
import { render } from './render.ts';
import type { Document, ScenarioNode, Scene, RichText, Span, Layout } from './model.ts';

export const revisionHeader = '#!scenario-diff-v1';

// Every source line has a prefix, so arbitrary manuscript markup is lossless.
export function createRevision(old: string, next: string): string {
  return revisionHeader + '\n' + sequenceDiff(normalize(old).split('\n'), normalize(next).split('\n'))
    .map(edit => ({ equal: '  ', delete: '- ', insert: '+ ' })[edit.kind] + edit.text).join('\n');
}

export function readRevision(source: string): { old: string; next: string } {
  const lines = normalize(source).split('\n');
  if (lines.shift() !== revisionHeader) throw new Error('差分ファイルのヘッダーが正しくありません');
  if (lines.at(-1) === '') lines.pop();
  const old: string[] = [], next: string[] = [];
  lines.forEach((line, index) => {
    const prefix = line.slice(0, 2), text = line.slice(2);
    if (!['  ', '- ', '+ '].includes(prefix)) throw new Error(`差分ファイルの${index + 2}行目: 行頭には空白2文字、- 、+ のいずれかが必要です`);
    if (prefix !== '+ ') old.push(text);
    if (prefix !== '- ') next.push(text);
  });
  return { old: old.join('\n'), next: next.join('\n') };
}

type Unit = ScenarioNode;
function units(document: Document): Unit[] {
  return document.nodes.flatMap(node => node.type === 'scene' ? [{ ...node, blocks: [] }, ...node.blocks] : [node]);
}
function key(node: Unit): string {
  const { sourceLine, ...value } = node;
  if (value.type === 'scene') return JSON.stringify({ type: value.type, text: value.text });
  return JSON.stringify(value);
}
function content(node: Unit): RichText {
  if (node.type === 'memo') return node.lines.flatMap((line, index) => index ? [{ kind: 'plain', text: '\n' } as Span, ...line] : line);
  if (node.type === 'separator') return [];
  return node.text;
}
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
function tokens(text: RichText): Span[] {
  return text.flatMap(span => [...segmenter.segment(span.text)].map(({ segment }) => ({ ...span, text: segment })));
}
function mergeText(old: RichText, next: RichText): RichText {
  const a = tokens(old), b = tokens(next);
  let i = 0, j = 0;
  const spans = sequenceDiff(a.map(span => JSON.stringify(span)), b.map(span => JSON.stringify(span))).map(edit => {
    if (edit.kind === 'equal') { i++; return b[j++]; }
    return edit.kind === 'delete' ? { ...a[i++], change: 'deleted' as const } : { ...b[j++], change: 'added' as const };
  });
  const result: RichText = [];
  for (const span of spans) {
    const previous = result.at(-1);
    if (previous && previous.kind === span.kind && previous.target === span.target && previous.change === span.change) previous.text += span.text;
    else result.push({ ...span });
  }
  return result;
}
function similarity(a: Unit, b: Unit): number {
  if (a.type !== b.type || a.type === 'separator') return 0;
  if (a.type === 'conversation' && b.type === 'conversation' && a.speaker !== b.speaker) return 0;
  if (a.type === 'memo' && b.type === 'memo' && (a.color !== b.color || a.lines.length !== b.lines.length)) return 0;
  const left = [...content(a).map(span => span.text).join('')];
  const right = [...content(b).map(span => span.text).join('')];
  if (!left.length && !right.length) return 1;
  // Dice overlap of adjacent characters is cheap enough for block alignment.
  const pairs = (chars: string[]) => chars.length < 2 ? chars : chars.slice(1).map((char, i) => chars[i] + char);
  const x = pairs(left), y = pairs(right), counts = new Map<string, number>();
  x.forEach(pair => counts.set(pair, (counts.get(pair) ?? 0) + 1));
  let common = 0;
  for (const pair of y) if (counts.get(pair)) { common++; counts.set(pair, counts.get(pair)! - 1); }
  let score = x.length + y.length ? 2 * common / (x.length + y.length) : 0;
  if (score < 0.6 && left.length + right.length <= 256) {
    const shared = sequenceDiff(left, right).filter(edit => edit.kind === 'equal').length;
    score = Math.max(score, shared / Math.max(left.length, right.length, 1));
  }
  return a.type === 'scene' ? Math.max(0.6, score) : score;
}
function mergeUnit(a: Unit, b: Unit): Unit {
  if (a.type === 'memo' && b.type === 'memo') return { ...b, lines: b.lines.map((line, i) => mergeText(a.lines[i], line)) };
  if ('text' in a && 'text' in b) return { ...b, text: mergeText(a.text, b.text) };
  return b;
}

function changedUnits(old: Unit[], next: Unit[]): Unit[] {
  // Align similar blocks without making an inserted line shift every later pair.
  if (old.length * next.length > 10000) return [...old.map(node => ({ ...node, change: 'deleted' as const })), ...next.map(node => ({ ...node, change: 'added' as const }))];
  const costs = Array.from({ length: old.length + 1 }, () => new Float64Array(next.length + 1));
  const scores = old.map(a => next.map(b => similarity(a, b)));
  for (let i = 0; i <= old.length; i++) costs[i][0] = i;
  for (let j = 0; j <= next.length; j++) costs[0][j] = j;
  for (let i = 1; i <= old.length; i++) for (let j = 1; j <= next.length; j++) {
    const score = scores[i - 1][j - 1];
    costs[i][j] = Math.min(costs[i - 1][j] + 1, costs[i][j - 1] + 1, score >= 0.6 ? costs[i - 1][j - 1] + 1 - score : Infinity);
  }
  const result: Unit[] = [];
  let i = old.length, j = next.length;
  while (i || j) {
    const score = i && j ? scores[i - 1][j - 1] : 0;
    if (i && j && score >= 0.6 && Math.abs(costs[i][j] - (costs[i - 1][j - 1] + 1 - score)) < 1e-9) {
      try { result.push(mergeUnit(old[i - 1], next[j - 1])); }
      catch { result.push({ ...next[j - 1], change: 'added' }, { ...old[i - 1], change: 'deleted' }); }
      i--; j--;
    } else if (j && (!i || costs[i][j] === costs[i][j - 1] + 1)) result.push({ ...next[--j], change: 'added' });
    else result.push({ ...old[--i], change: 'deleted' });
  }
  return result.reverse();
}

export function revisionDocument(source: string): Document {
  const { old, next } = readRevision(source);
  const before = parse(old), after = parse(next);
  const a = units(before), b = units(after);
  const edits = sequenceDiff(a.map(key), b.map(key));
  const combined: Unit[] = [];
  let i = 0, j = 0, cursor = 0;
  while (cursor < edits.length) {
    if (edits[cursor].kind === 'equal') { combined.push(b[j++]); i++; cursor++; continue; }
    const removed: Unit[] = [], added: Unit[] = [];
    while (cursor < edits.length && edits[cursor].kind !== 'equal') {
      if (edits[cursor++].kind === 'delete') removed.push(a[i++]); else added.push(b[j++]);
    }
    combined.push(...changedUnits(removed, added));
  }
  const nodes: ScenarioNode[] = [];
  let scene: Scene | undefined, number = 0;
  const targets = new Map<string, string>();
  for (const node of combined) {
    if (node.type === 'scene') {
      scene = { ...node, number: String(++number), id: `revision-scene-${number}`, blocks: [] };
      if (node.change !== 'deleted') targets.set(node.number, scene.id);
      nodes.push(scene);
    } else if (node.type === 'title' || node.type === 'part') { scene = undefined; nodes.push(node); }
    else if (scene) scene.blocks.push(node);
    else nodes.push(node);
  }
  // Links retain their original labels while pointing at renumbered new scenes.
  const link = (spans: RichText) => spans.forEach(span => { if (span.kind === 'link') span.href = targets.get(span.target!); });
  for (const node of combined) {
    if (node.type === 'memo') node.lines.forEach(link);
    else if ('text' in node) link(node.text);
  }
  return { nodes, warnings: [...before.warnings, ...after.warnings], revision: true, unchanged: old === next };
}

export function renderRevision(source: string, format: 'vertical' | 'horizontal' = 'vertical', layout?: Layout): string {
  return render(revisionDocument(source), format, layout);
}
