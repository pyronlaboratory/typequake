#!/bin/bash

BASE_DIR="../../tests/fixtures/definitions"
mkdir -p "$BASE_DIR"

# Helper to create a standard package structure
make_def_pkg() {
  local name=$1
  local main_file=${2:-index.ts}
  local dir="$BASE_DIR/pkg-$name"
  mkdir -p "$dir"

  # package.json
  cat > "$dir/package.json" << EOF
{
  "name": "@fixture/$name",
  "version": "1.0.0",
  "main": "$main_file"
}
EOF

  # tsconfig.json (unless it's the configless case)
  if [ "$name" != "configless" ]; then
    cat > "$dir/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": true,
    "noEmit": true
  }
}
EOF
  fi
}

# 1. Baseline Surface
make_def_pkg "baseline"
cat > "$BASE_DIR/pkg-baseline/index.ts" << EOF
export type ID = string | number;

export interface User {
  id: ID;
  username: string;
  email: string;
}

export function getUser(id: ID): User {
  return { id, username: 'test', email: 'test@example.com' };
}
EOF

# 2. Comprehensive Surface (Generics, Namespaces, Classes, Unions)
make_def_pkg "comprehensive"
cat > "$BASE_DIR/pkg-comprehensive/index.ts" << EOF
export namespace API {
  export type Response<T> = { data: T; error?: string };
  export interface Meta { timestamp: number }
}

export abstract class BaseService {
  protected abstract id: string;
  public abstract connect(): void;
}

export class UserService extends BaseService {
  protected id = 'user-service';
  public connect() {}
  public findUser<T extends { id: string }>(query: T): API.Response<T> {
    return { data: query };
  }
}

export type Status = 'idle' | 'loading' | 'success' | 'error';
export type DeepReadonly<T> = { readonly [P in keyof T]: DeepReadonly<T[P]> };
EOF

# 3. Untyped (Main entry point is JavaScript)
make_def_pkg "untyped" "index.js"
cat > "$BASE_DIR/pkg-untyped/index.js" << EOF
export const version = '1.0.0';
export function init(config) {
  return config;
}
EOF

# 4. Configless (No TSConfig)
make_def_pkg "configless"
cat > "$BASE_DIR/pkg-configless/index.ts" << EOF
export const standalone = true;
export type Simple = { a: number };
EOF

echo "Definitions fixtures generated in $BASE_DIR"
