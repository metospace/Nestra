import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OrganizerPages({ title, page, pageCount, count, onChange }: { title: string; page: number; pageCount: number; count: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return <nav data-organizer-pages className="organizer-pages" aria-label={`${title}项目分页`}>
    <Button size="icon-xs" variant="ghost" aria-label="上一页项目" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))}><ChevronLeft/></Button>
    <span>{page + 1} / {pageCount} 页 · {count} 项</span>
    <Button size="icon-xs" variant="ghost" aria-label="下一页项目" disabled={page >= pageCount - 1} onClick={() => onChange(Math.min(pageCount - 1, page + 1))}><ChevronRight/></Button>
  </nav>;
}
