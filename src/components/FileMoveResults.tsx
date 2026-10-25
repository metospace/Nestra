import { CheckCircle2, CircleAlert, RotateCcw } from 'lucide-react';
import { useFileMoves, retryFailedMoves, setMoveResultsOpen, selectMoveReport } from '@/composables/fileMoveReports';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
export default function FileMoveResults() {
  const fileMoves = useFileMoves();
  const report = fileMoves.reports.find(item => item.id === fileMoves.activeId);
  const failed = report?.items.filter(item => item.state === 'failed').length ?? 0;
  return <Dialog open={fileMoves.open && Boolean(report)} onOpenChange={setMoveResultsOpen}><DialogContent className="sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-move-close]')?.focus()); }}>
    <DialogHeader><DialogTitle>本次整理结果</DialogTitle><DialogDescription>目标：{report?.destination} · 仅失败或刷新异常时自动显示</DialogDescription></DialogHeader>
    <Select value={String(fileMoves.activeId)} onValueChange={value => selectMoveReport(Number(value))} disabled={fileMoves.busy}><SelectTrigger aria-label="选择整理记录"><SelectValue/></SelectTrigger><SelectContent>{fileMoves.reports.map(item => <SelectItem key={item.id} value={String(item.id)}>第 {item.id} 次 · {item.destination} · {item.items.length} 项</SelectItem>)}</SelectContent></Select>
    <p role="status" className="text-sm text-muted-foreground">{fileMoves.busy ? '正在处理…' : `成功 ${report?.items.filter(item=>item.state==='success').length ?? 0} 项，失败 ${failed} 项`}</p>
    {report?.warning && <p role="alert" className="text-sm text-destructive">{report.warning}</p>}
    <ul className="max-h-[40vh] overflow-y-auto divide-y">{report?.items.map((item, index) => <li key={index} className="flex items-start gap-3 py-3">{item.state === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600"/> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive"/>}<div className="min-w-0"><strong className="text-sm font-medium">{item.name} · {item.state === 'success' ? '成功' : item.state === 'failed' ? '失败' : '等待处理'}</strong><p className="break-all text-xs text-muted-foreground">{item.path}</p>{item.error && <p className="mt-1 break-all text-xs text-destructive">{item.error}</p>}</div></li>)}</ul>
    <p className="text-xs text-muted-foreground">记录保留到关闭本窗口或退出程序。重试只处理失败项。</p>
    <DialogFooter><Button data-desktop-input data-move-close variant="outline" onClick={() => setMoveResultsOpen(false)}>关闭</Button><Button data-desktop-input disabled={fileMoves.busy || !failed} onClick={() => void retryFailedMoves()}><RotateCcw />仅重试失败项（{failed}）</Button></DialogFooter>
  </DialogContent></Dialog>;
}
