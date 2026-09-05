export const numeric = (value: unknown): number =>
  typeof value === "number" ? value : Number(value ?? 0)
export const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : numeric(value)
export const projectLabel = (project: string): string =>
  project.split(/[/\\]/).filter(Boolean).at(-1) || project
