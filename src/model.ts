export interface Warning { line: number; message: string }
export interface ChangeInfo { change?: 'added' | 'deleted' }
export interface Span extends ChangeInfo {
  kind: 'plain' | 'speaker' | 'bold' | 'strike' | 'red' | 'blue' | 'link';
  text: string;
  target?: string;
  href?: string;
}
export type RichText = Span[];
export interface TextBlock extends ChangeInfo {
  type: 'text' | 'stage'; text: RichText; alignment: 'start' | 'end'; sourceLine: number;
}
export interface Conversation extends ChangeInfo {
  type: 'conversation'; speaker: string; text: RichText; sourceLine: number;
}
export const memoColors = {
  red: '#e53935', blue: '#174fc4', green: '#278347',
  orange: '#d06b16', purple: '#8548b8', gray: '#707070',
} as const;
export type MemoColor = keyof typeof memoColors;
export function isMemoColor(value: string): value is MemoColor {
  return Object.hasOwn(memoColors, value);
}
export interface MemoBlock extends ChangeInfo {
  type: 'memo'; color: MemoColor; lines: RichText[]; sourceLine: number;
}
export interface Separator extends ChangeInfo { type: 'separator'; sourceLine: number }
export type Block = TextBlock | Conversation | MemoBlock | Separator;
export interface Heading extends ChangeInfo {
  type: 'title' | 'part'; text: RichText; sourceLine: number;
}
export interface Scene extends ChangeInfo {
  type: 'scene'; number: string; id: string; text: RichText; blocks: Block[]; sourceLine: number;
}
export type ScenarioNode = Heading | Scene | Block;
export interface Document { nodes: ScenarioNode[]; warnings: Warning[]; revision?: boolean; unchanged?: boolean }
export interface Layout {
  title: number; part: number; scene: number; stage: number;
  text: number; dialogueFirst: number; dialogueContinuation: number;
}
export const defaultLayout: Layout = {
  title: 0, part: 1, scene: 0, stage: 2, text: 0,
  dialogueFirst: 0, dialogueContinuation: 1,
};
export function validateLayout(value: unknown): { layout: Layout; warnings: Warning[] } {
  const layout = { ...defaultLayout };
  const warnings: Warning[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { layout, warnings: [{ line: 0, message: 'レイアウト設定はJSONオブジェクトで指定してください。デフォルトを使用します。' }] };
  }
  for (const [key, number] of Object.entries(value)) {
    if (!Object.hasOwn(defaultLayout, key)) {
      warnings.push({ line: 0, message: `未知のレイアウト設定: ${key}` });
    } else if (!Number.isInteger(number) || Number(number) < 0 || Number(number) > 19) {
      warnings.push({ line: 0, message: `${key}: 0〜19の整数が必要です。デフォルトを使用します。` });
    } else layout[key as keyof Layout] = number as number;
  }
  return { layout, warnings };
}
