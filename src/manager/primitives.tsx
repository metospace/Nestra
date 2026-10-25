import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function PageHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{children}</div></header>;
}

export function Section({ title, description, action, children, className = '' }: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`manager-card ${className}`}>{title && <div className="card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>;
}

export function FormSelect({ value, onValueChange, options, label, placeholder = '请选择', disabled, className = '' }: { value?: string; onValueChange: (value: string) => void; options: readonly { label: string; value: string }[]; label: string; placeholder?: string; disabled?: boolean; className?: string }) {
  return <Select value={value ?? ''} onValueChange={onValueChange} disabled={disabled}><SelectTrigger aria-label={label} className={className}><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent>{options.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="form-field"><span className="field-label">{label}</span>{children}{hint && <p className="field-hint">{hint}</p>}</div>;
}

export function Modal({ open, onOpenChange, title, description, busy, children, footer, wide }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; busy?: boolean; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent showCloseButton={!busy} className={wide ? 'manager-dialog sm:max-w-2xl' : 'manager-dialog sm:max-w-lg'}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="dialog-scroll">{children}</div>{footer && <DialogFooter>{footer}</DialogFooter>}</DialogContent></Dialog>;
}

export function EmptyState({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children?: ReactNode }) {
  return <div className="manager-empty"><Icon size={28} strokeWidth={1.5}/><h3>{title}</h3><p>{description}</p>{children}</div>;
}

/** Keep a local text draft so a refresh cannot replace text while typing. */
export function EditableName({ value, onCommit, label, className }: { value: string; onCommit: (value: string) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const id = useId();
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => { setEditing(false); if (cancelled.current) { cancelled.current = false; setDraft(value); return; } const name = draft.trim(); if (name && name !== value) onCommit(name); else setDraft(value); };
  return <Input id={id} className={className} value={draft} aria-label={label} onFocus={() => { cancelled.current = false; setEditing(true); }} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(value); event.currentTarget.blur(); } }}/>;
}

export function CheckLabel({ children, label }: { children: ReactNode; label: string }) { return <label className="check-label">{children}<span>{label}</span></label>; }
export function CancelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) { return <Button variant="outline" disabled={disabled} onClick={onClick}>取消</Button>; }
