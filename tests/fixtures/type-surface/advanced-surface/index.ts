// Re-export from a sub-module — tests that ExportSpecifier aliasing works
export type { Product, Status } from "./models";

// Generic interface
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}

// Overloaded function — tests that multiple call signatures are captured
export function parse(value: string): number;
export function parse(value: number): string;
export function parse(value: string | number): string | number {
  if (typeof value === "string") return parseInt(value, 10);
  return String(value);
}

// Union type alias
export type MaybeError<T> = T | Error | null;
