import type { Block, Document, RichText, Scene, Span, Warning } from './model.ts';
import { isMemoColor } from './model.ts';

export const normalize = (source: string) => source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
export const canonicalNumber = (number: string) => {
  const [main, ...branches] = number.split('.');
  return [BigInt(main).toString(), ...branches].join('.');
};
export const sceneId = (number: string) => `scene-${canonicalNumber(number).replaceAll('.', '-')}`;
export const displayNumber = (number: string) => {
  const [first, ...rest] = number.split('.');
  return [first.padStart(3, '0'), ...rest].join('.');
};

export function parseInline(text: string): RichText {
  const result: RichText = [];
  const expression = /\[([+\-*#])[^\S\n]*([^\[\]\n]*)\]|>>[^\S\n]*(\d+(?:\.\d+)*)(?![\d.])/g;
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index! > cursor) result.push({ kind: 'plain', text: text.slice(cursor, match.index) });
    if (match[3]) result.push({ kind: 'link', text: match[0], target: canonicalNumber(match[3]) });
    else {
      const kind = ({ '+': 'bold', '-': 'strike', '*': 'red', '#': 'blue' } as const)[match[1]]!;
      result.push({ kind, text: match[2] });
    }
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) result.push({ kind: 'plain', text: text.slice(cursor) });
  return result;
}

export function parse(source: string): Document {
  const nodes: Document['nodes'] = [];
  const warnings: Warning[] = [];
  const lines = normalize(source).split('\n');
  let current: Scene | undefined;
  const scenes: Scene[] = [];
  const add = (block: Block) => current ? current.blocks.push(block) : nodes.push(block);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sourceLine = i + 1;
    if (!line.trim()) continue;
    if (/^:::[\t ]*\S/.test(line)) {
      const color = line.slice(3).trim().replace(/^memo(?:\s+|$)/, '');
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== ':::') end++;
      if (end === lines.length) warnings.push({ line: sourceLine, message: '閉じられていないメモブロック' });
      if (isMemoColor(color)) {
        add({ type: 'memo', color, lines: lines.slice(i + 1, end).map(parseInline), sourceLine });
      } else {
        warnings.push({ line: sourceLine, message: `未知のメモ色: ${color}` });
        for (let j = i; j < Math.min(end + 1, lines.length); j++) {
          add({ type: 'text', text: [{ kind: 'plain', text: lines[j] }], alignment: 'start', sourceLine: j + 1 });
        }
      }
      i = Math.min(end, lines.length - 1);
      continue;
    }
    if (line.startsWith('☆') || line.startsWith('★')) {
      current = undefined;
      nodes.push({ type: line[0] === '☆' ? 'title' : 'part', text: parseInline(line.slice(1).trimStart()), sourceLine });
      continue;
    }
    if (line.startsWith('■')) {
      const content = line.slice(1).trim();
      const numbered = /^(\d+(?:\.\d+)*)(?:\s+(.*))?$/.exec(content);
      const title = numbered ? numbered[2]?.trim() : content;
      if (!title) warnings.push({ line: sourceLine, message: 'タイトルのない■を通常本文として保持しました' });
      else {
        current = { type: 'scene', number: numbered ? canonicalNumber(numbered[1]) : '', id: '', text: parseInline(title), blocks: [], sourceLine };
        nodes.push(current);
        scenes.push(current);
        continue;
      }
    }
    if (line.trim() === '＊') {
      add({ type: 'separator', sourceLine });
    } else if (line.startsWith('＠')) {
      add({ type: 'stage', text: parseInline(line.slice(1).trimStart()), alignment: 'start', sourceLine });
    } else if (line.startsWith('→')) {
      add({ type: 'text', text: parseInline(line.slice(1).trimStart()), alignment: 'end', sourceLine });
    } else {
      const conversation = /^([^「（]+)([「（])(.*)([」）])$/.exec(line);
      if (conversation && ((conversation[2] === '「' && conversation[4] === '」') || (conversation[2] === '（' && conversation[4] === '）'))) {
        add({ type: 'conversation', speaker: conversation[1].trim(), text: parseInline(conversation[2] + conversation[3] + conversation[4]), sourceLine });
      } else add({ type: 'text', text: parseInline(line.startsWith('\\→') ? line.slice(1) : line), alignment: 'start', sourceLine });
    }
  }
  const used = new Set(scenes.map(s => s.number).filter(Boolean));
  const counts = new Map<string, number>();
  let next = 1;
  for (const scene of scenes) {
    if (!scene.number) {
      while (used.has(String(next))) next++;
      scene.number = String(next++);
      used.add(scene.number);
    }
    const count = (counts.get(scene.number) ?? 0) + 1;
    counts.set(scene.number, count);
    scene.id = sceneId(scene.number) + (count > 1 ? `--${count}` : '');
    if (count > 1) warnings.push({ line: scene.sourceLine, message: `シーン番号の重複: ${scene.number}` });
  }
  function check(spans: Span[], line: number) {
    for (const span of spans) {
      if (span.kind !== 'link') continue;
      const count = counts.get(span.target!);
      if (!count) warnings.push({ line, message: `存在しないシーン番号へのリンク: ${span.target}` });
      else if (count > 1) warnings.push({ line, message: `重複番号への曖昧なリンク: ${span.target}（最初のシーンを参照）` });
    }
  }
  function checkBlock(block: Block) {
    if (block.type === 'separator') return;
    if (block.type === 'memo') block.lines.forEach((line, index) => check(line, block.sourceLine + index + 1));
    else check(block.text, block.sourceLine);
  }
  for (const node of nodes) {
    if (node.type === 'scene') {
      check(node.text, node.sourceLine);
      node.blocks.forEach(checkBlock);
    } else if (node.type === 'title' || node.type === 'part') check(node.text, node.sourceLine);
    else checkBlock(node as Block);
  }
  return { nodes, warnings };
}
