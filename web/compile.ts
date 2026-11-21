import { parse } from '../src/parser.ts';
import { render } from '../src/render.ts';
import { createRevision, revisionDocument } from '../src/revision.ts';

export type CompileRequest = { mode: 'normal'; source: string } | { mode: 'diff'; before: string; after: string };
export interface CompileResult {
  html: string;
  basename: string;
  intermediate: string | null;
  warnings: string[];
  pages: number;
  unchanged: boolean;
}
export type WorkerResponse = { result: CompileResult } | { error: string };

export function compile(request: CompileRequest): CompileResult {
  if (request.mode === 'normal' ? !request.source.trim() : !request.before.trim() && !request.after.trim()) {
    throw new Error('原稿を入力してください。');
  }
  const intermediate = request.mode === 'diff' ? createRevision(request.before, request.after) : null;
  const model = intermediate !== null ? revisionDocument(intermediate) : parse(request.mode === 'normal' ? request.source : '');
  const titleModel = request.mode === 'diff' ? parse(request.after) : model;
  const title = titleModel.nodes.find(node => node.type === 'title');
  const name = title?.type === 'title' ? title.text.map(span => span.text).join('') : 'scenario';
  const basename = (name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'scenario') + (request.mode === 'diff' ? '.diff' : '');
  const warnings = request.mode === 'normal'
    ? model.warnings.map(w => `${w.line}行目：${w.message}`)
    : [...parse(request.before).warnings.map(w => `旧原稿 ${w.line}行目：${w.message}`), ...titleModel.warnings.map(w => `新原稿 ${w.line}行目：${w.message}`)];
  const html = render(model, 'vertical');
  return { html, basename, intermediate, warnings, pages: (html.match(/class="page"/g) ?? []).length, unchanged: model.unchanged === true };
}
