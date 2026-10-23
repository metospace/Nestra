import { reactive } from 'vue';

export interface MoveTask { name: string; path: string; run: () => Promise<unknown> }
export interface MoveResult extends MoveTask { state: 'pending' | 'success' | 'failed'; error: string }
export interface MoveReport { id: number; destination: string; items: MoveResult[]; warning: string; finish: (report: MoveReport) => Promise<void> }
// Session-only results. Closures retain the original source and destination for safe retry.
export const fileMoves = reactive({ reports: [] as MoveReport[], activeId: 0, open: false, busy: false });
let sequence = 0;
export function openMoveResults(): void { fileMoves.open = true; }
async function execute(report: MoveReport, items: MoveResult[]): Promise<void> {
  fileMoves.busy = true;
  try {
    for (const item of items) {
      item.state = 'pending'; item.error = '';
      try { await item.run(); item.state = 'success'; }
      catch (error) { item.state = 'failed'; item.error = String(error); }
    }
    // Refresh failures are separate: a successful native move must never be retried.
    report.warning = '';
    try { await report.finish(report); } catch (error) { report.warning = `文件列表刷新失败：${error}。已成功的移动无需重试。`; }
    // Keep successful moves in history without interrupting the desktop workflow.
    fileMoves.open = report.items.some(item => item.state === 'failed') || Boolean(report.warning);
  } finally { fileMoves.busy = false; }
}
export async function trackFileMoves(destination: string, tasks: MoveTask[], finish: (report: MoveReport) => Promise<void>): Promise<MoveReport | undefined> {
  if (fileMoves.busy || !tasks.length) return;
  const report: MoveReport = { id: ++sequence, destination, items: tasks.map(task => ({ ...task, state: 'pending', error: '' })), warning: '', finish };
  fileMoves.reports.push(report);
  fileMoves.activeId = report.id;
  fileMoves.open = false;
  const tracked = fileMoves.reports.at(-1)!;
  await execute(tracked, tracked.items);
  return tracked;
}
export async function retryFailedMoves(): Promise<void> {
  if (fileMoves.busy) return;
  const report = fileMoves.reports.find(item => item.id === fileMoves.activeId);
  if (report) await execute(report, report.items.filter(item => item.state === 'failed'));
}
