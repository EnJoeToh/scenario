import { normalize } from './parser.ts';
import { escapeHtml, htmlDocument } from './render.ts';

export interface Edit { kind: 'equal' | 'delete' | 'insert'; text: string }
// Myers shortest edit script. Bound trace storage to avoid exhausting memory.
export function sequenceDiff(old: string[], next: string[]): Edit[] {
  const trace: Map<number, number>[] = [];
  const frontier = new Map<number, number>([[1, 0]]);
  for (let depth = 0; depth <= old.length + next.length; depth++) {
    if (depth * depth > 4_000_000) throw new Error('差分が大きすぎます。比較する原稿の範囲を小さくしてください。');
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = diagonal === -depth || (diagonal !== depth && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < old.length && y < next.length && old[x] === next[y]) { x++; y++; }
      frontier.set(diagonal, x);
      if (x < old.length || y < next.length) continue;
      const edits: Edit[] = [];
      for (let d = depth; d >= 0; d--) {
        const previous = trace[d];
        const k = x - y;
        const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) { edits.push({ kind: 'equal', text: old[--x] }); y--; }
        if (d > 0) {
          if (x === previousX) edits.push({ kind: 'insert', text: next[--y] });
          else edits.push({ kind: 'delete', text: old[--x] });
        }
      }
      return edits.reverse();
    }
  }
  return [];
}
const graphemes = (text: string) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
function inline(old: string, next: string): [string, string] {
  let changes: Edit[];
  try { changes = sequenceDiff(graphemes(old), graphemes(next)); }
  catch { return [`<mark>${escapeHtml(old)}</mark>`, `<mark>${escapeHtml(next)}</mark>`]; }
  return [
    changes.filter(c => c.kind !== 'insert').map(c => c.kind === 'delete' ? `<mark>${escapeHtml(c.text)}</mark>` : escapeHtml(c.text)).join(''),
    changes.filter(c => c.kind !== 'delete').map(c => c.kind === 'insert' ? `<mark>${escapeHtml(c.text)}</mark>` : escapeHtml(c.text)).join(''),
  ];
}
export function renderDiff(old: string, next: string, context = 3): string {
  const edits = sequenceDiff(normalize(old).split('\n'), normalize(next).split('\n'));
  const visible = new Set<number>();
  edits.forEach((edit, index) => {
    if (edit.kind !== 'equal') for (let i = Math.max(0, index - context); i <= Math.min(edits.length - 1, index + context); i++) visible.add(i);
  });
  let oldLine = 1, newLine = 1, omitted = false;
  const rows: string[] = [];
  const row = (a: number | '', b: number | '', left: string, right: string, kind: string) => `<tr class="${kind}"><td class="number">${a}</td><td class="old">${left}</td><td class="number">${b}</td><td class="new">${right}</td></tr>`;
  for (let i = 0; i < edits.length;) {
    const edit = edits[i];
    if (!visible.has(i)) {
      if (!omitted) rows.push('<tr><td colspan="4" class="omitted">… 変更のない行を省略 …</td></tr>');
      omitted = true;
      if (edit.kind !== 'insert') oldLine++;
      if (edit.kind !== 'delete') newLine++;
      i++;
      continue;
    }
    omitted = false;
    if (edit.kind === 'equal') { rows.push(row(oldLine++, newLine++, escapeHtml(edit.text), escapeHtml(edit.text), 'equal')); i++; continue; }
    const removed: string[] = [], added: string[] = [];
    while (i < edits.length && edits[i].kind !== 'equal') {
      (edits[i].kind === 'delete' ? removed : added).push(edits[i].text);
      i++;
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) {
      const a = removed[j], b = added[j];
      const [left, right] = a !== undefined && b !== undefined ? inline(a, b) : [escapeHtml(a ?? ''), escapeHtml(b ?? '')];
      rows.push(row(a === undefined ? '' : oldLine++, b === undefined ? '' : newLine++, left, right, a === undefined ? 'insert' : b === undefined ? 'delete' : 'change'));
    }
  }
  const body = `<main class="diff"><h1>原稿の差分</h1><p>左：変更前 ／ 右：変更後。変更行は出現順に対応付けます。</p>${edits.every(e => e.kind === 'equal') ? '<p>変更はありません。</p>' : ''}<table><thead><tr><th>旧行</th><th>変更前</th><th>新行</th><th>変更後</th></tr></thead><tbody>${rows.join('')}</tbody></table></main>`;
  return htmlDocument(body, 'Scenario diff', 'horizontal', '.diff{margin:20px;padding:20px;background:white;font:14px/1.6 monospace}.diff table{border-collapse:collapse;width:100%;table-layout:fixed}.diff td,.diff th{border:1px solid #ccc;padding:4px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}.diff .number{width:4em;color:#666}.diff th:nth-child(1),.diff th:nth-child(3){width:4em}.insert .new,.change .new{background:#e5f8e8}.delete .old,.change .old{background:#ffe8e8}.delete .old{text-decoration:line-through}.old mark{background:#f7b4b4}.new mark{background:#a8e9b2}.omitted{text-align:center!important;color:#666}@media print{.diff{margin:0;padding:0}}');
}
