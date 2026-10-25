import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { MotionConfig } from 'motion/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import FileMoveResults from '@/components/FileMoveResults';
import ConfirmDialog from '@/desktop/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ItemDragProvider } from '@/composables/useItemDrag';
const ManagerApp = lazy(() => import('@/manager/ManagerApp'));
const DesktopLayer = lazy(() => import('@/desktop/DesktopLayer'));
const SearchWindow = lazy(() => import('@/features/SearchWindow'));
class WindowErrorBoundary extends Component<{children: ReactNode}, {error: string}> {
  state = {error: ''};
  static getDerivedStateFromError(error: Error) { return {error: error.message}; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Nestra UI failed', error, info.componentStack); }
  render() {
    if (this.state.error) return <section className="nestra-hit m-6 max-w-lg rounded-xl border bg-background p-6 text-foreground" role="alert"><h1 className="text-lg font-semibold">界面加载失败</h1><p className="my-3 text-sm text-muted-foreground">{this.state.error}</p><Button onClick={() => location.reload()}>重新加载</Button></section>;
    return this.props.children;
  }
}
export default function App() {
  const label = getCurrentWebviewWindow().label;
  return <WindowErrorBoundary><MotionConfig reducedMotion="user" transition={{duration: .16}}><TooltipProvider><ItemDragProvider><Suspense fallback={label === 'desktop' ? null : <div className="grid h-screen place-items-center text-sm text-muted-foreground" role="status">正在加载工作空间…</div>}>
    {label === 'manager' ? <ManagerApp /> : label === 'search' ? <SearchWindow /> : <DesktopLayer />}
    <FileMoveResults /><ConfirmDialog />
  </Suspense></ItemDragProvider></TooltipProvider></MotionConfig></WindowErrorBoundary>;
}
