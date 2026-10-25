import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listFileMoves, type FileMove } from '@/lib/tauri';
import { confirmDialog, undoRecordedMove } from '@/stores/state';
import { Section } from './primitives';

export default function FileMoveHistory() {
  const [moves, setMoves] = useState<FileMove[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setMoves(await listFileMoves()); setError(''); } catch (error) { setError(String(error)); } };
  const undo = async (move: FileMove) => {
    if (busy || !await confirmDialog(`将「${move.name}」放回原位置？\n${move.fromPath}\n原位置被占用或文件已修改时会停止。`)) return;
    setBusy(true); setError('');
    try { await undoRecordedMove(move.id); await refresh(); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <Section title="本次运行的文件移动" description="最近 50 次成功移动，退出后清空。撤销不覆盖同名项目；文件已修改、被替换或再次移动时需手动处理。" action={<Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>刷新记录</Button>}>
    {error && <p className="error-text" role="alert">{error}</p>}{moves.map(move => <div className="source-row" key={move.id}><div className="row-content"><strong>{move.name} · {move.undone ? '已撤销' : new Date(move.createdAt).toLocaleTimeString()}</strong><small>原位置：{move.fromPath}</small><small>移动到：{move.toPath}</small></div><Button variant="outline" size="sm" disabled={busy || move.undone} onClick={() => void undo(move)}><RotateCcw/>{move.undone ? '已撤销' : '撤销移动'}</Button></div>)}{!moves.length && <p className="card-note">拖入收纳区、放回桌面或执行整理后，移动记录会显示在这里。</p>}
  </Section>;
}
