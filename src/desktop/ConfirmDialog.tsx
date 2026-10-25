import { useRef } from 'react';
import { useNestra } from '@/stores/state';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export default function ConfirmDialog() {
  const { confirmRequest } = useNestra();
  const cancel = useRef<HTMLButtonElement>(null);
  const answer = (ok: boolean) => confirmRequest?.resolve(ok);
  return <AlertDialog open={Boolean(confirmRequest)} onOpenChange={open => { if (!open) answer(false); }}>
    <AlertDialogContent className="nestra-hit z-[9700]" onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus({ preventScroll: true }); }} onEscapeKeyDown={() => answer(false)}>
      <AlertDialogHeader><AlertDialogTitle>确认操作</AlertDialogTitle><AlertDialogDescription className="whitespace-pre-wrap">{confirmRequest?.message}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel ref={cancel} data-desktop-input onClick={() => answer(false)}>取消</AlertDialogCancel><AlertDialogAction data-desktop-input onClick={() => answer(true)}>确定</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
