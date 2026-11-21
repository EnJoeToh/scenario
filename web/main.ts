import type { CompileRequest, CompileResult, WorkerResponse } from './compile.ts';
import sample from '../examples/sample.txt?raw';
import beforeSample from '../examples/diff-before.txt?raw';
import afterSample from '../examples/diff-after.txt?raw';

const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const before = document.querySelector<HTMLTextAreaElement>('#before')!;
const after = document.querySelector<HTMLTextAreaElement>('#after')!;
const preview = document.querySelector<HTMLIFrameElement>('#preview')!;
const status = document.querySelector<HTMLElement>('#status')!;
const warnings = document.querySelector<HTMLElement>('#warnings')!;
const inputPanel = document.querySelector<HTMLElement>('#input-panel')!;
const previewPanel = document.querySelector<HTMLElement>('#preview-panel')!;
const generate = document.querySelector<HTMLButtonElement>('#generate')!;
const back = document.querySelector<HTMLButtonElement>('#back')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const downloadSource = document.querySelector<HTMLButtonElement>('#download-source')!;
const downloadHtml = document.querySelector<HTMLButtonElement>('#download')!;
const saveActions = document.querySelector<HTMLElement>('#save-actions')!;
let mode: 'normal' | 'diff' = 'normal';
let result: CompileResult | null = null;
let worker: Worker | null = null;

function showPreview() {
  if (!result || previewPanel.hidden) return;
  const scale = Math.min(1, Math.max(0.1, (preview.clientWidth - 24) / (297 * 96 / 25.4)));
  // Only the preview is scaled; downloads retain the original print dimensions.
  preview.srcdoc = result.html.replace('</head>', `<style>@media screen { .page { zoom: ${scale}; } }</style></head>`);
}
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(showPreview, 100);
}).observe(preview);

function showPanel(panel: 'input' | 'preview', focus = false) {
  const isPreview = panel === 'preview' && result !== null;
  inputPanel.hidden = isPreview;
  previewPanel.hidden = !isPreview;
  document.body.classList.toggle('previewing', isPreview);
  back.setAttribute('aria-pressed', String(!isPreview));
  generate.setAttribute('aria-pressed', String(isPreview));
  downloadSource.hidden = mode !== 'normal';
  downloadSource.disabled = source.value.length === 0;
  downloadHtml.hidden = !isPreview;
  saveActions.hidden = mode === 'diff' && !isPreview;
  if (isPreview) showPreview();
  if (focus && isPreview) document.querySelector<HTMLElement>('#preview-title')!.focus();
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  generate.disabled = false;
  generate.textContent = mode === 'diff' ? '差分を表示' : 'プレビューを表示';
  cancel.hidden = true;
  inputPanel.removeAttribute('aria-busy');
}

function invalidate() {
  stopWorker();
  result = null;
  preview.removeAttribute('srcdoc');
  warnings.replaceChildren();
  warnings.hidden = true;
  showPanel('input');
  status.textContent = mode === 'diff'
    ? '旧原稿と新原稿を入力して「差分を表示」を押してください。片方を空にすると全文の追加・削除になります。'
    : '原稿を入力して「プレビューを表示」を押してください。';
}

function showWarnings(items: string[]) {
  warnings.replaceChildren();
  warnings.hidden = items.length === 0;
  if (!items.length) return;
  const heading = document.createElement('p');
  heading.textContent = `原稿の確認事項（${items.length}件）`;
  const list = document.createElement('ul');
  for (const warning of items) {
    const item = document.createElement('li');
    item.textContent = warning;
    list.append(item);
  }
  warnings.append(heading, list);
}

generate.addEventListener('click', () => {
  if (result) {
    showPanel('preview', true);
    return;
  }
  invalidate();
  const request: CompileRequest = mode === 'diff'
    ? { mode, before: before.value, after: after.value }
    : { mode, source: source.value };
  if (mode === 'normal' ? !source.value.trim() : !before.value.trim() && !after.value.trim()) {
    status.textContent = '原稿を入力してください。';
    (mode === 'normal' ? source : before).focus();
    return;
  }
  generate.disabled = true;
  generate.textContent = '組版中…';
  cancel.hidden = false;
  inputPanel.setAttribute('aria-busy', 'true');
  status.textContent = mode === 'diff' ? '差分を計算しています…' : '縦書きに組版しています…';
  try {
    const activeWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = activeWorker;
    activeWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (worker !== activeWorker) return;
      stopWorker();
      if ('error' in event.data) {
        status.textContent = `組版できませんでした：${event.data.error}`;
        return;
      }
      result = event.data.result;
      showWarnings(result.warnings);
      status.textContent = `${result.pages}ページ · ${result.unchanged ? '変更はありません。' : mode === 'diff' ? '追加を緑、削除を赤で表示しています。' : '縦書きに組版しました。'}`;
      showPanel('preview', true);
    };
    activeWorker.onerror = () => {
      if (worker !== activeWorker) return;
      stopWorker();
      status.textContent = '組版処理を実行できませんでした。もう一度お試しください。';
    };
    activeWorker.postMessage(request);
  } catch (error) {
    stopWorker();
    status.textContent = `組版できませんでした：${error instanceof Error ? error.message : String(error)}`;
  }
});
cancel.addEventListener('click', () => {
  stopWorker();
  status.textContent = '計算を中止しました。入力した原稿は保持しています。';
  generate.focus();
});

for (const field of [source, before, after]) field.addEventListener('input', invalidate);
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    const nextMode = button.dataset.mode === 'diff' ? 'diff' : 'normal';
    if (mode === nextMode) return;
    mode = nextMode;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(option => {
      option.setAttribute('aria-pressed', String(option.dataset.mode === mode));
    });
    document.querySelector<HTMLElement>('#normal-input')!.hidden = mode !== 'normal';
    document.querySelector<HTMLElement>('#diff-input')!.hidden = mode !== 'diff';
    document.querySelector('#input-title')!.textContent = mode === 'diff' ? '新旧の原稿を入力' : '原稿を入力';
    document.querySelector('#source-help')!.textContent = mode === 'diff'
      ? '旧原稿と新原稿を並べて貼り付けてください。入力内容はモードを切り替えても保持します。'
      : 'シナリオのテキストを貼り付けてください。';
    invalidate();
  });
});
document.querySelector('#sample')!.addEventListener('click', () => {
  const hasInput = mode === 'normal' ? source.value.trim() : before.value.trim() || after.value.trim();
  if (hasInput && !window.confirm('入力中の原稿をサンプルに置き換えますか？')) return;
  if (mode === 'normal') source.value = sample;
  else { before.value = beforeSample; after.value = afterSample; }
  invalidate();
  (mode === 'normal' ? source : before).focus();
});
back.addEventListener('click', () => {
  if (worker) {
    stopWorker();
    status.textContent = '計算を中止しました。入力した原稿は保持しています。';
  }
  showPanel('input');
  (mode === 'normal' ? source : before).focus();
});
function save(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
downloadHtml.addEventListener('click', () => {
  if (result) save(result.html, result.basename + '.html', 'text/html;charset=utf-8');
});
downloadSource.addEventListener('click', () => {
  if (mode === 'normal' && source.value.length) {
    save(source.value, (result?.basename ?? 'scenario') + '.txt', 'text/plain;charset=utf-8');
  }
});
invalidate();
