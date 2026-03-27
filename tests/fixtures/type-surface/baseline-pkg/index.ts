// ── Interface ─────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  email?: string;
}

// ── Type alias ────────────────────────────────────────────────────────────────

export type UserId = number | string;

// ── Enum ──────────────────────────────────────────────────────────────────────

export enum Role {
  Admin = "ADMIN",
  Member = "MEMBER",
  Guest = "GUEST",
}

// ── Function declaration ──────────────────────────────────────────────────────

export function greet(user: User): string {
  return `Hello, ${user.name}`;
}

// ── Arrow function const (should resolve to variant=function) ─────────────────

export const double = (n: number): number => n * 2;

// ── Plain const (should resolve to variant=variable) ─────────────────────────

export const API_VERSION = "v1" as const;

// ── Class ─────────────────────────────────────────────────────────────────────

export class UserService {
  private users: User[] = [];

  add(user: User): void {
    this.users.push(user);
  }

  findById(id: number): User | undefined {
    return this.users.find((u) => u.id === id);
  }
}

// ── Private — must NOT appear in the SignatureMap ─────────────────────────────

function _internal(): void {}
const _secret = 42;
