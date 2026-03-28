import type { User } from "@tq/core";
import { type Role } from "@tq/core";

function greet(u: User): string {
  return u.name;
}

const r: Role = "admin";
