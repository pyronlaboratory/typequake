#!/bin/bash

BASE_DIR="../../tests/fixtures/references"
mkdir -p "$BASE_DIR"

# Helper to create a standard package structure
make_ref_pkg() {
  local name=$1
  local pkg_name=$2
  local dir="$BASE_DIR/$name"
  mkdir -p "$dir/src"

  # package.json
  cat > "$dir/package.json" << EOF
{
  "name": "$pkg_name",
  "version": "1.0.0",
  "main": "src/index.ts"
}
EOF

  # tsconfig.json
  cat > "$dir/tsconfig.json" << EOF
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
EOF
}

# 1. changed-package (used for metadata tests)
make_ref_pkg "changed-package" "@tq/core"
cat > "$BASE_DIR/changed-package/src/index.ts" << EOF
export type User = { id: number; name: string };
export const API_VERSION = '1.0.0';
EOF

# 2. consumer-direct
make_ref_pkg "consumer-direct" "@tq/app"
cat > "$BASE_DIR/consumer-direct/src/index.ts" << EOF
import { User, createUser } from '@tq/core';

const a: User = createUser('alice');
const b: User = createUser('bob');
EOF

# 3. consumer-aliased
make_ref_pkg "consumer-aliased" "@tq/aliased"
cat > "$BASE_DIR/consumer-aliased/src/index.ts" << EOF
import { User as U, Role } from '@tq/core';

const a: U = { id: 1, name: 'x' };
const r: Role = 'admin';
EOF

# 4. consumer-type-import
make_ref_pkg "consumer-type-import" "@tq/type-consumer"
cat > "$BASE_DIR/consumer-type-import/src/index.ts" << EOF
import type { User } from '@tq/core';
import { type Role } from '@tq/core';

function greet(u: User): string {
  return u.name;
}

const r: Role = 'admin';
EOF

# 5. consumer-reexport
make_ref_pkg "consumer-reexport" "@tq/reexporter"
cat > "$BASE_DIR/consumer-reexport/src/index.ts" << EOF
export { User } from '@tq/core';
export type { Role } from '@tq/core';
export { createUser as makeUser } from '@tq/core';
EOF

# 6. consumer-barrel
make_ref_pkg "consumer-barrel" "@tq/barrel"
cat > "$BASE_DIR/consumer-barrel/src/index.ts" << EOF
export * from '@tq/core';
EOF

# 7. consumer-namespace
make_ref_pkg "consumer-namespace" "@tq/ns-consumer"
cat > "$BASE_DIR/consumer-namespace/src/index.ts" << EOF
import * as Core from '@tq/core';

const u: Core.User = Core.createUser('alice');
EOF

# 8. consumer-no-match
make_ref_pkg "consumer-no-match" "@tq/no-match"
cat > "$BASE_DIR/consumer-no-match/src/index.ts" << EOF
import { foo } from '@other/lib';
EOF

echo "References fixtures generated in $BASE_DIR"
