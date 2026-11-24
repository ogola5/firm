import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./button";

/** Client-side paging for long lists. Resets to the first page when `resetKey` changes. */
export function usePagination<T>(rows: T[], pageSize: number, resetKey: unknown) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  return {
    page: current,
    pageCount,
    setPage,
    visible: rows.slice(current * pageSize, current * pageSize + pageSize),
    total: rows.length,
    pageSize,
  };
}

export function Pagination({ page, pageCount, setPage, total, pageSize }: {
  page: number; pageCount: number; setPage: (page: number) => void; total: number; pageSize: number;
}) {
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm text-muted-foreground" aria-label="Pagination">
      <span>{from}–{to} of {total}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
        <span className="grid place-items-center px-2">Page {page + 1} of {pageCount}</span>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
      </div>
    </nav>
  );
}
