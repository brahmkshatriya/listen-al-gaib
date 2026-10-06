export type BlockKind = 'heading' | 'paragraph' | 'quote' | 'image' | 'separator';
export interface ReadingBlock {
  id: string; kind: BlockKind; spineIndex: number; documentHref: string;
  html: string; text: string; anchors: string[];
  imageHref?: string; src?: string; alt?: string; caption?: string;
  meaningful?: boolean; intrinsicWidth?: number; intrinsicHeight?: number;
  level?: number; semanticValue?: 'emdash' | 'pause' | 'scene-break';
}
export interface ReaderLocation { spineIndex: number; blockIndex: number; documentHref: string; segmentIndex?: number; anchor?: string }
export interface TocEntry { id: string; label: string; href: string; depth: number; blockIndex: number }
export interface Book {
  id: string; title: string; author: string; language: string; blocks: ReadingBlock[];
  toc: TocEntry[]; spine: string[]; images: ReadingBlock[]; urls: string[];
  imageAssetCount: number; warnings: string[]; cover?: string; landmarks?: TocEntry[];
}
export interface Settings {
  theme: 'light' | 'dark' | 'amoled'; accentColor: string; fontSize: number; lineHeight: number;
  width: number; paragraphSpacing: number; fontFamily: 'serif' | 'sans' | 'mono';
  alignment: 'left' | 'justify'; voice: string; speed: number; voiceMode: VoiceMode; serverUrl: string;
  imageCue: 'off' | 'simple' | 'descriptive'; readingMode: 'scroll';
}
export type VoiceMode = 'standard' | 'native' | 'server';
export interface SavedState { location: ReaderLocation; chapter: string; settings: Settings }
export const DEFAULT_SETTINGS: Settings = {
  theme: 'amoled', accentColor: '#f8d948', fontSize: 20, lineHeight: 1.8, width: 720, paragraphSpacing: 24,
  fontFamily: 'serif', alignment: 'left', voice: 'af_heart', speed: 1, voiceMode: 'standard', serverUrl: '',
  imageCue: 'descriptive', readingMode: 'scroll',
};
export function locationAt(book: Book, index: number, segmentIndex?: number): ReaderLocation {
  const blockIndex = Math.min(Math.max(index, 0), book.blocks.length - 1);
  const block = book.blocks[blockIndex];
  return { blockIndex, spineIndex: block.spineIndex, documentHref: block.documentHref, ...(segmentIndex !== undefined ? { segmentIndex } : {}) };
}
export function imageAnnouncement(block: ReadingBlock, cue: Settings['imageCue']): string {
  if (block.kind !== 'image' || !block.meaningful || cue === 'off') return '';
  if (cue === 'simple') return 'Image here.';
  const label = (block.caption || block.alt || '').trim();
  if (!label || /^(image|img|illustration|picture|photo|graphic)(\s*\d*)?[.!]?$/i.test(label)) return 'Image here.';
  if (/^(cover|title page)[.!]?$/i.test(label)) return `${label.replace(/[.!]$/, '')}.`;
  return `Image here. ${label}.`;
}
export function currentChapter(book: Book, index: number): TocEntry | undefined {
  return [...book.toc].filter(t => t.blockIndex <= index).sort((a,b) => b.blockIndex - a.blockIndex)[0];
}
export function resolveLocation(book: Pick<Book, 'blocks' | 'spine'>, target: string, base = ''): number {
  const [href, rawFragment] = target.split('#');
  const path = resolveArchivePath(base, href || base.split('/').at(-1) || '');
  let fragment = rawFragment || '';
  try { fragment = decodeURIComponent(fragment); } catch { /* preserve invalid percent literal */ }
  const exact = book.blocks.findIndex(b => b.documentHref === path && fragment && b.anchors.includes(fragment));
  if (exact >= 0) return exact;
  return book.blocks.findIndex(b => b.documentHref === path);
}
export function resolveArchivePath(base: string, href: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) throw new Error('External archive resource blocked.');
  let decoded = href.split(/[?#]/)[0];
  try { decoded = decodeURIComponent(decoded); } catch { /* keep literal */ }
  const parts = (decoded.startsWith('/') ? decoded : `${base.slice(0, base.lastIndexOf('/') + 1)}${decoded}`).split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!result.length) throw new Error('Archive path escapes the book.'); result.pop(); }
    else result.push(part);
  }
  return result.join('/');
}
