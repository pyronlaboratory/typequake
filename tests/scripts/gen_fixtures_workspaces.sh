#!/bin/bash

BASE_DIR="../../tests/fixtures/workspaces"
mkdir -p "$BASE_DIR"

# 1. PNPM Workspace
mkdir -p "$BASE_DIR/workspace-pnpm/packages/api"
mkdir -p "$BASE_DIR/workspace-pnpm/packages/core"
cat > "$BASE_DIR/workspace-pnpm/package.json" << EOF
{
  "name": "pnpm-workspace",
  "private": true
}
EOF
cat > "$BASE_DIR/workspace-pnpm/pnpm-workspace.yaml" << EOF
packages:
  - 'packages/*'
EOF
cat > "$BASE_DIR/workspace-pnpm/packages/core/package.json" << EOF
{
  "name": "@pkg/core",
  "version": "1.0.0"
}
EOF
cat > "$BASE_DIR/workspace-pnpm/packages/api/package.json" << EOF
{
  "name": "@pkg/api",
  "version": "1.0.0",
  "dependencies": { "@pkg/core": "workspace:*" }
}
EOF

# 2. Bun Workspace
mkdir -p "$BASE_DIR/workspace-bun/packages/ui"
cat > "$BASE_DIR/workspace-bun/package.json" << EOF
{
  "name": "bun-workspace",
  "private": true,
  "workspaces": ["packages/*"]
}
EOF
touch "$BASE_DIR/workspace-bun/bun.lock"
cat > "$BASE_DIR/workspace-bun/packages/ui/package.json" << EOF
{
  "name": "@pkg/ui",
  "version": "1.0.0"
}
EOF

# 3. Yarn Workspace
mkdir -p "$BASE_DIR/workspace-yarn/packages/utils"
cat > "$BASE_DIR/workspace-yarn/package.json" << EOF
{
  "name": "yarn-workspace",
  "private": true,
  "workspaces": ["packages/*"]
}
EOF
touch "$BASE_DIR/workspace-yarn/yarn.lock"
cat > "$BASE_DIR/workspace-yarn/packages/utils/package.json" << EOF
{
  "name": "@pkg/utils",
  "version": "1.0.0"
}
EOF

# 4. Standard (No workspace tool)
mkdir -p "$BASE_DIR/workspace-standard"
cat > "$BASE_DIR/workspace-standard/package.json" << EOF
{
  "name": "standard-pkg",
  "version": "1.0.0"
}
EOF

echo "Workspaces fixtures generated in $BASE_DIR"
