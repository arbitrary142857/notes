/**
 * Table-of-contents parts for this course. Each part covers a contiguous run of
 * lectures (by lecture number). Edit titles and ranges here.
 */
export interface TocPart {
  title: string;
  from: number;
  to: number;
}

export const TOC_PARTS: TocPart[] = [
  { title: "Models of Computation", from: 1, to: 6 },
  { title: "Decision Problems", from: 7, to: 10 },
];
