import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { X, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dismissStatus, setLauncherVisible, useNestra } from '@/stores/state';
import { cn } from '@/lib/utils';
import { desktopNoticePosition } from '@/domain/presentation';
export default function StatusNotice({inline = false, desktop = false}: {inline?: boolean; desktop?: boolean}) {
  const state = useNestra();
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => { if (!desktop || inline) return; const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [desktop, inline]);
  return <AnimatePresence>{state.statusMessage && <motion.div key="status" initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0}} style={desktop && !inline ? desktopNoticePosition(state.displays, viewport) : undefined} className={cn('status-notice nestra-hit', inline ? 'status-notice-inline' : desktop ? 'status-toast' : 'manager-toast')} role="status">
    <Info className="size-4 shrink-0 text-primary"/><span>{state.statusMessage}</span>
    {state.statusAction === 'show-launcher' && <Button size="xs" variant="secondary" onClick={() => void setLauncherVisible(true)}>显示桌面启动栏</Button>}
    <Button size="icon-xs" variant="ghost" aria-label="关闭提示" onClick={dismissStatus}><X /></Button>
  </motion.div>}</AnimatePresence>;
}
