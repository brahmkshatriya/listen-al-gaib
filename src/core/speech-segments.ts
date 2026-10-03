import type { ReadingBlock } from './types';

export interface SpeechSegment { text: string; start: number; end: number }
export const MAX_SPEECH_CHARACTERS = 120;
const cache = new WeakMap<ReadingBlock, SpeechSegment[]>();
let sentenceSegmenter: Intl.Segmenter | undefined;

/** Subdivisions stay attached to their source block; paragraph IDs and saved book positions remain stable. */
export function splitSpeech(text: string): SpeechSegment[] {
  if (!text.trim()) return [];
  let sentences: Array<{ segment: string; index: number }>;
  try {
    sentenceSegmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
    sentences = Array.from(sentenceSegmenter.segment(text));
  } catch {
    sentences = Array.from(text.matchAll(/[^.!?]+(?:[.!?]+["”’']*|$)\s*/g), match => ({ segment: match[0], index: match.index }));
  }
  const merged: Array<{ segment: string; index: number }> = [];
  for (const sentence of sentences) {
    const previous = merged.at(-1);
    if (previous && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|etc|e\.g|i\.e)|\b[A-Z])\.\s*$/i.test(previous.segment)) previous.segment += sentence.segment;
    else merged.push({ ...sentence });
  }
  const segments: SpeechSegment[] = [];
  const add = (start: number, end: number) => {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end > start) segments.push({ text: text.slice(start, end), start, end });
  };
  for (const sentence of merged) {
    let start = sentence.index;
    const end = start + sentence.segment.length;
    while (end - start > MAX_SPEECH_CHARACTERS) {
      const window = text.slice(start, start + MAX_SPEECH_CHARACTERS + 1);
      const clauses = Array.from(window.matchAll(/[,;:—]\s+/g));
      const clause = clauses.filter(match => match.index >= MAX_SPEECH_CHARACTERS / 2).at(-1);
      let boundary = clause ? start + clause.index + clause[0].length : start + window.lastIndexOf(' ');
      // Keep an indivisible word intact rather than dropping or duplicating characters.
      if (boundary <= start) { const space = text.indexOf(' ', start + MAX_SPEECH_CHARACTERS); boundary = space < 0 || space >= end ? end : space; }
      add(start, boundary);
      start = boundary;
      while (start < end && /\s/.test(text[start])) start++;
    }
    add(start, end);
  }
  return segments;
}
export function speechSegments(block: ReadingBlock): SpeechSegment[] {
  let segments = cache.get(block);
  if (!segments) {
    segments = block.kind === 'image' || block.kind === 'separator' ? [] : splitSpeech(block.text);
    cache.set(block, segments);
  }
  return segments;
}
