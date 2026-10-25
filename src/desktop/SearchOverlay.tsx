import SearchPanel from '@/features/SearchPanel';
import { closeSearch, useNestra } from '@/stores/state';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function SearchOverlay() {
  const { searchOpen, searchQuery } = useNestra();
  return <Dialog open={searchOpen} onOpenChange={open => { if (!open) closeSearch(); }}>
    <DialogContent className="nestra-hit max-w-[760px] gap-0 overflow-hidden p-0">
      <DialogTitle className="sr-only">搜索文件和应用</DialogTitle><DialogDescription className="sr-only">搜索桌面、应用和已索引的文件夹</DialogDescription>
      <SearchPanel compact initialQuery={searchQuery} onClose={closeSearch} />
    </DialogContent>
  </Dialog>;
}

