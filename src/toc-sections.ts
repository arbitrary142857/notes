import { TOC_PARTS as TOC_PARTS_18701 } from "../courses/18.701/toc-sections.js";
import { TOC_PARTS as TOC_PARTS_18650 } from "../courses/18.650/toc-sections.js";
import { TOC_PARTS as TOC_PARTS_6300 } from "../courses/6.300/toc-sections.js";
import { TOC_PARTS as TOC_PARTS_6790 } from "../courses/6.790/toc-sections.js";
import { TOC_PARTS as TOC_PARTS_18404 } from "../courses/18.404/toc-sections.js";
import type { Note } from "./notes.js";

export interface TocPart {
  title: string;
  from: number;
  to: number;
}

const TOC_PARTS_BY_COURSE: Record<string, TocPart[] | undefined> = {
  "18.701": TOC_PARTS_18701,
  "18.650": TOC_PARTS_18650,
  "6.300": TOC_PARTS_6300,
  "6.790": TOC_PARTS_6790,
  "18.404": TOC_PARTS_18404
};

export function getTocParts(courseId: string): TocPart[] | undefined {
  return TOC_PARTS_BY_COURSE[courseId];
}

export function noteInTocPart(note: Note, part: TocPart): boolean {
  const start = note.lectures[0];
  const end = note.lectures[note.lectures.length - 1];
  return start >= part.from && end <= part.to;
}

export function groupNotesByTocParts(
  notes: Note[],
  parts: TocPart[],
): { part: TocPart; notes: Note[] }[] {
  return parts.map((part) => ({
    part,
    notes: notes.filter((note) => noteInTocPart(note, part)),
  }));
}
