export interface User {
  id: number;
  name: string;
}

export type Role = "admin" | "viewer";

export function createUser(name: string): User {
  return { id: 1, name };
}

export class AdminUser implements User {
  id = 0;
  name = "admin";
}
