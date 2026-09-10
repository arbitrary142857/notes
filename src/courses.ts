import { join } from "node:path";

export interface Course {
  id: string;
  title: string;
  subtitle: string;
  semester: string;
  summary: string;
}

export const COURSES: Course[] = [
  {
    id: "18.701",
    title: "18.701",
    subtitle: "Algebra I",
    semester: "🍂 Fall 2025",
    summary: `
      A demanding introduction to abstract algebra and linear algebra,
      dedicating roughly equal time to each.
      Begins with group and vector space definitions,
      and covers topics such as Jordan Normal Form,
      the Crystallographic Restriction, Sylow's Theorems,
      Sylvester's Law of Inertia, the Spectral Theorem,
      and matrix groups.
    `,
  },
  {
    id: "6.1220",
    title: "6.1220",
    subtitle: "Design and Analysis of Algorithms",
    semester: "🌸 Spring 2026",
    summary: `
      A survey of classic algorithms and data structures
      (e.g., Union-Find, MST, Max Flow, MCMC, and FFT),
      fundamental elements of algorithmic design
      (e.g., amortized analysis, hash functions, linear programming),
      and specialized models of computation
      (e.g., approximation, streaming, and sublinear algorithms).
    `,
  },
  {
    id: "6.300",
    title: "6.300",
    subtitle: "Signal Processing",
    semester: "☀️ Summer 2026",
    summary: `
      An introduction to Fourier analysis
      and its applications to audio and images.
      Topics include Fourier series and transforms,
      the Discrete Fourier Transform, sampling, convolution,
      filtering, and noise reduction.
      Notes taken through Lecture 18 of 22.
    `,
  },
  {
    id: "18.650",
    title: "18.650",
    subtitle: "Fundamentals of Statistics",
    semester: "☀️ Summer 2026",
    summary: `
      A fast-paced introduction to
      foundational statistical concepts and methods
      from a mathematical perspective.
      The original course occasionally handwaves
      the mathematical detail;
      these notes fill in some of those gaps.
      Notes taken through Lecture 25 of 32.
    `,
  },
  {
    id: "6.790",
    title: "6.790",
    subtitle: "Machine Learning",
    semester: "☀️ Summer 2026",
    summary: `
      Notes taken through Lecture 16 of 24.
    `,
  },
  {
    id: "6.4210",
    title: "6.4210",
    subtitle: "Robotic Manipulation",
    semester: "🍂 Fall 2026",
    summary: `
      Notes taken through Lecture 1 of ??.
    `,
  },
  {
    id: "6.1810",
    title: "6.1810",
    subtitle: "Operating Systems Engineering",
    semester: "🍂 Fall 2026",
    summary: `
      Notes taken through Lecture 1 of ??.
    `,
  },
  {
    id: "6.7960",
    title: "6.7960",
    subtitle: "Deep Learning",
    semester: "🍂 Fall 2026",
    summary: `
      Notes taken through Lecture 1 of ??.
    `,
  },
  {
    id: "18.404",
    title: "18.404",
    subtitle: "Theory of Computation",
    semester: "🍂 Fall 2026",
    summary: `
      Notes taken through Lecture 1 of ??.
    `,
  },
];

export function courseDir(root: string, courseId: string): string {
  return join(root, "courses", courseId);
}

export function courseNotesDir(root: string, courseId: string): string {
  return join(courseDir(root, courseId), "notes");
}

export function coursePreamblePath(root: string, courseId: string): string {
  return join(courseDir(root, courseId), "preamble.tex");
}

export function courseImagesDir(root: string, courseId: string): string {
  return join(courseDir(root, courseId), "images");
}

export function courseAudioDir(root: string, courseId: string): string {
  return join(courseDir(root, courseId), "audio");
}

/** Published location of a course, under the generated `dist/` tree. */
export function courseSiteDir(root: string, courseId: string): string {
  return join(root, "dist", courseId);
}

export function findCourse(courseId: string): Course {
  const course = COURSES.find((entry) => entry.id === courseId);
  if (!course) throw new Error(`Unknown course: ${courseId}`);
  return course;
}
