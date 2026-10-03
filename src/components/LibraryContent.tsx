import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, Clock, Search, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { getProgress, type LibraryBook } from '../core/storage';
import type { SavedState } from '../core/types';

function Cover({ book }: { book: LibraryBook }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => { if (!book.cover) return; const url = URL.createObjectURL(book.cover); setSrc(url); return () => URL.revokeObjectURL(url); }, [book.cover]);
  return <span className="library-cover">{src ? <img src={src} alt=""/> : <BookOpen size={28}/>}</span>;
}
export default function LibraryContent({ books, currentId, busy, onImport, onOpen, onRemove, onSample }: {
  books: LibraryBook[]; currentId?: string; busy: boolean; onImport: () => void;
  onOpen: (book: LibraryBook) => void; onRemove: (id: string) => Promise<void>; onSample: () => void;
}) {
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('recent');
  const [progress, setProgress] = useState<Record<string, SavedState | undefined>>({});
  const [removing, setRemoving] = useState<string>(); const [deleting, setDeleting] = useState(false);
  const [removeError, setRemoveError] = useState('');
  useEffect(() => { let active = true; void Promise.all(books.map(async book => [book.id, await getProgress(book.id).catch(() => undefined)] as const)).then(entries => { if (active) setProgress(Object.fromEntries(entries)); }); return () => { active = false; }; }, [books]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return books.filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(needle)).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'author' ? a.author.localeCompare(b.author) || a.title.localeCompare(b.title) : b.lastOpened - a.lastOpened);
  }, [books, query, sort]);
  return <div className="library-content">
    <div className="library-summary"><span>{books.length} {books.length === 1 ? 'book' : 'books'} on this device</span><button className="primary-button" onClick={onImport} disabled={busy}><Upload size={18}/>Import EPUB</button></div>
    <div className="library-tools"><label className="search-field"><Search size={18}/><input aria-label="Search library" placeholder="Search title or author" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="Clear library search" onClick={() => setQuery('')}><X size={16}/></button>}</label><select aria-label="Sort library" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently read</option><option value="title">Title A–Z</option><option value="author">Author A–Z</option></select></div>
    <div className="library-list">
      {matches.map(item => {
        const state = progress[item.id]; const percent = state && item.blockCount ? Math.round(state.location.blockIndex / Math.max(1, item.blockCount - 1) * 100) : undefined;
        const current = item.id === currentId;
        return <div className={`library-row ${current ? 'is-current' : ''}`} key={item.id}>
          <a className="library-open" href={`/books/${encodeURIComponent(item.id)}`} aria-label={`${state ? 'Continue reading' : 'Read'} ${item.title}`} aria-disabled={busy} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); if (!busy) onOpen(item); }}>
            <Cover book={item}/><span className="library-book-details"><span className="library-book-heading"><strong>{item.title}</strong>{current && <span className="library-current"><Check size={12}/>Reading now</span>}</span><span className="library-author">{item.author}</span><span className="library-book-progress">{state ? <>{percent !== undefined ? `${percent}% · ` : ''}{state.chapter || 'Saved reading position'}</> : 'Ready to start'}</span><span className="library-read-action">{state ? 'Continue reading' : 'Start reading'}</span></span>
          </a>
          {removing === item.id ? <div className="library-remove-confirm"><span>Remove book and saved progress?</span><div><button onClick={() => { setRemoving(undefined); setRemoveError(''); }} disabled={deleting}>Keep</button><button className="remove-confirm" onClick={async () => { setDeleting(true); setRemoveError(''); try { await onRemove(item.id); setRemoving(undefined); } catch { setRemoveError('Could not remove the book. Try again.'); } finally { setDeleting(false); } }} disabled={deleting}>Remove</button></div>{removeError && <span role="alert">{removeError}</span>}</div> : <button className="icon-button library-remove" aria-label={`Remove ${item.title} from library`} title="Remove from library" onClick={() => setRemoving(item.id)} disabled={busy}><Trash2 size={18}/></button>}
        </div>;
      })}
      {!matches.length && <div className="library-empty"><BookOpen size={36}/><h3>{books.length ? 'No matching books' : 'Your next read starts here'}</h3><p>{books.length ? 'Try another title or author.' : 'Import an EPUB to keep your books and reading progress together.'}</p>{books.length ? <button className="library-clear" onClick={() => setQuery('')}>Clear search</button> : <button className="primary-button" onClick={onImport} disabled={busy}><Upload size={18}/>Choose an EPUB</button>}</div>}
    </div>
    <div className="library-footer"><span><ShieldCheck size={16}/>Stored on this device</span><button onClick={onSample} disabled={busy}><Clock size={16}/>Read the Alice sample</button></div>
  </div>;
}
