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
  { title: "Prerequisites", from: 1, to: 3 },
  { title: "Regression", from: 4, to: 8 },
  { title: "Optimization and Learnability", from: 9, to: 11 },
  { title: "Neural Networks", from: 12, to: 14 },
  { title: "Learning and Models", from: 15, to: 16 },
];
