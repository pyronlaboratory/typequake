#!/bin/bash

FIXTURE="./typequake/tests/fixtures/benchmark"

# ── Root ─────────────────────────────────────────────────────────────────────
mkdir -p $FIXTURE/packages

cat > $FIXTURE/package.json << 'EOF'
{
  "name": "benchmark-workspace",
  "private": true,
  "workspaces": ["packages/*"],
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
EOF

cat > $FIXTURE/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true
  }
}
EOF

# ── Package generators ────────────────────────────────────────────────────────
make_pkg() {
  local name=$1       # short name, e.g. shared-core
  local scope="@benchmark"
  local dir="$FIXTURE/packages/$name"
  mkdir -p "$dir/src"

  # tsconfig
  cat > "$dir/tsconfig.json" << EOTSCONFIG
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
EOTSCONFIG

  # package.json (no deps by default – caller writes their own if needed)
  cat > "$dir/package.json" << EOPKG
{
  "name": "$scope/$name",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
EOPKG
}

# ── 1. shared-core ───────────────────────────────────────────────────────────
make_pkg shared-core
cat > $FIXTURE/packages/shared-core/src/index.ts << 'EOF'
// Public type surface for shared-core – this package is "changed" in the benchmark

export type UserId = string;
export type OrgId  = string;

export interface User {
  id:        UserId;
  name:      string;
  email:     string;
  role:      'admin' | 'editor' | 'viewer';
  createdAt: number;
  /** @deprecated use profile.avatarUrl */
  avatarUrl: string;
}

export interface Org {
  id:   OrgId;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
}

export interface Membership {
  userId: UserId;
  orgId:  OrgId;
  role:   'owner' | 'member';
}

export interface ApiResponse<T> {
  data:      T;
  error:     string | null;
  requestId: string;
  ts:        number;
}

export type Paginated<T> = ApiResponse<{ items: T[]; total: number; page: number }>;

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
EOF

# ── 2-5. utils-* (no deps on shared-core) ───────────────────────────────────
make_pkg utils-array
cat > $FIXTURE/packages/utils-array/src/index.ts << 'EOF'
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
export function groupBy<T, K extends string>(arr: T[], key: (item: T) => K): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}
EOF

make_pkg utils-string
cat > $FIXTURE/packages/utils-string/src/index.ts << 'EOF'
export const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
export const truncate = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s;
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
EOF

make_pkg utils-object
cat > $FIXTURE/packages/utils-object/src/index.ts << 'EOF'
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(k => [k, obj[k]])) as Pick<T, K>;
}
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete (out as Partial<T>)[k];
  return out as Omit<T, K>;
}
export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
EOF

make_pkg utils-date
cat > $FIXTURE/packages/utils-date/src/index.ts << 'EOF'
export const now = () => Date.now();
export const toIso = (ts: number) => new Date(ts).toISOString();
export const fromIso = (s: string) => new Date(s).getTime();
export const addDays = (ts: number, days: number) => ts + days * 86_400_000;
EOF

# ── 6-11. feature-* (depend on shared-core) ──────────────────────────────────
deps_on_core() {
  local name=$1
  make_pkg "$name"
  # Rewrite package.json to include shared-core dependency
  cat > $FIXTURE/packages/$name/package.json << EOPKG
{
  "name": "@benchmark/$name",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@benchmark/shared-core": "*" }
}
EOPKG
}

deps_on_core feature-auth
cat > $FIXTURE/packages/feature-auth/src/index.ts << 'EOF'
import type { User, ApiResponse } from '@benchmark/shared-core';

export interface LoginRequest  { email: string; password: string }
export interface LoginResponse { token: string; user: User }

export interface AuthService {
  login(req: LoginRequest): Promise<ApiResponse<LoginResponse>>;
  logout(token: string): Promise<ApiResponse<void>>;
  me(token: string): Promise<ApiResponse<User>>;
}
EOF

deps_on_core feature-users
cat > $FIXTURE/packages/feature-users/src/index.ts << 'EOF'
import type { User, UserId, Paginated, ApiResponse } from '@benchmark/shared-core';

export interface CreateUserDto { name: string; email: string; role: User['role'] }
export interface UpdateUserDto { name?: string; role?: User['role']; avatarUrl?: string }

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findAll(page: number): Promise<Paginated<User>>;
  create(dto: CreateUserDto): Promise<ApiResponse<User>>;
  update(id: UserId, dto: UpdateUserDto): Promise<ApiResponse<User>>;
  remove(id: UserId): Promise<ApiResponse<void>>;
}
EOF

deps_on_core feature-billing
cat > $FIXTURE/packages/feature-billing/src/index.ts << 'EOF'
import type { Org, OrgId, ApiResponse } from '@benchmark/shared-core';

export interface Plan { id: string; name: Org['plan']; priceUsd: number }
export interface Invoice { id: string; orgId: OrgId; amountUsd: number; paidAt: number | null }

export interface BillingService {
  currentPlan(orgId: OrgId): Promise<ApiResponse<Plan>>;
  listInvoices(orgId: OrgId): Promise<ApiResponse<Invoice[]>>;
  upgrade(orgId: OrgId, plan: Org['plan']): Promise<ApiResponse<void>>;
}
EOF

deps_on_core feature-notifications
cat > $FIXTURE/packages/feature-notifications/src/index.ts << 'EOF'
import type { UserId, ApiResponse } from '@benchmark/shared-core';

export type NotifKind = 'info' | 'warning' | 'error';
export interface Notification { id: string; userId: UserId; kind: NotifKind; body: string; readAt: number | null }

export interface NotificationService {
  send(userId: UserId, kind: NotifKind, body: string): Promise<ApiResponse<Notification>>;
  markRead(id: string): Promise<ApiResponse<void>>;
  listUnread(userId: UserId): Promise<ApiResponse<Notification[]>>;
}
EOF

deps_on_core feature-analytics
cat > $FIXTURE/packages/feature-analytics/src/index.ts << 'EOF'
import type { UserId, OrgId, ApiResponse } from '@benchmark/shared-core';

export interface Event { name: string; userId: UserId; orgId: OrgId; props: Record<string, unknown>; ts: number }
export interface MetricSeries { metric: string; points: Array<{ ts: number; value: number }> }

export interface AnalyticsService {
  track(event: Omit<Event, 'ts'>): Promise<void>;
  query(orgId: OrgId, metric: string, from: number, to: number): Promise<ApiResponse<MetricSeries>>;
}
EOF

deps_on_core feature-search
cat > $FIXTURE/packages/feature-search/src/index.ts << 'EOF'
import type { User, Org, ApiResponse } from '@benchmark/shared-core';

export type SearchKind = 'user' | 'org';
export interface SearchHit<T> { score: number; item: T }
export interface SearchResults { users: SearchHit<User>[]; orgs: SearchHit<Org>[] }

export interface SearchService {
  query(q: string, kinds?: SearchKind[]): Promise<ApiResponse<SearchResults>>;
  suggest(prefix: string): Promise<ApiResponse<string[]>>;
}
EOF

# ── 12-15. service-* ──────────────────────────────────────────────────────────
make_service() {
  local name=$1; shift
  make_pkg "$name"
  local deps_json
  deps_json=$(printf '"%s": "*"' "$@" | paste -sd ',' -)
  cat > $FIXTURE/packages/$name/package.json << EOPKG
{
  "name": "@benchmark/$name",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { $deps_json }
}
EOPKG
}

make_service service-api "@benchmark/feature-auth" "@benchmark/feature-users"
cat > $FIXTURE/packages/service-api/src/index.ts << 'EOF'
import type { AuthService } from '@benchmark/feature-auth';
import type { UserRepository } from '@benchmark/feature-users';

export interface ApiContainer {
  auth:  AuthService;
  users: UserRepository;
}

export function createApiContainer(auth: AuthService, users: UserRepository): ApiContainer {
  return { auth, users };
}
EOF

make_service service-data "@benchmark/feature-billing" "@benchmark/utils-array"
cat > $FIXTURE/packages/service-data/src/index.ts << 'EOF'
import type { BillingService, Invoice } from '@benchmark/feature-billing';
import { chunk } from '@benchmark/utils-array';

export async function exportInvoicesCsv(svc: BillingService, orgId: string): Promise<string[][]> {
  const res = await svc.listInvoices(orgId);
  if (res.error) throw new Error(res.error);
  const rows = res.data.map((inv: Invoice) => [inv.id, inv.orgId, String(inv.amountUsd)]);
  return chunk(rows, 100);
}
EOF

make_service service-events "@benchmark/feature-notifications" "@benchmark/utils-date"
cat > $FIXTURE/packages/service-events/src/index.ts << 'EOF'
import type { NotificationService, Notification } from '@benchmark/feature-notifications';
import { toIso } from '@benchmark/utils-date';

export interface FormattedNotif extends Notification { isoTime: string }

export async function fetchFormatted(svc: NotificationService, userId: string): Promise<FormattedNotif[]> {
  const res = await svc.listUnread(userId);
  if (res.error) throw new Error(res.error);
  return res.data.map(n => ({ ...n, isoTime: toIso(n.readAt ?? Date.now()) }));
}
EOF

make_service service-reporting "@benchmark/feature-analytics" "@benchmark/utils-object"
cat > $FIXTURE/packages/service-reporting/src/index.ts << 'EOF'
import type { AnalyticsService, MetricSeries } from '@benchmark/feature-analytics';
import { pick } from '@benchmark/utils-object';

export interface Report { metric: string; points: MetricSeries['points'] }

export async function buildReport(svc: AnalyticsService, orgId: string, metric: string): Promise<Report> {
  const res = await svc.query(orgId, metric, 0, Date.now());
  if (res.error) throw new Error(res.error);
  return pick(res.data, ['metric', 'points']);
}
EOF

# ── 16-20. app-* ──────────────────────────────────────────────────────────────
make_service app-dashboard "@benchmark/service-api" "@benchmark/service-reporting"
cat > $FIXTURE/packages/app-dashboard/src/index.ts << 'EOF'
import type { ApiContainer } from '@benchmark/service-api';
import type { Report } from '@benchmark/service-reporting';

export interface DashboardProps { container: ApiContainer; orgId: string }
export type DashboardReport = { userId: string; report: Report };
EOF

make_service app-admin "@benchmark/service-api" "@benchmark/service-data"
cat > $FIXTURE/packages/app-admin/src/index.ts << 'EOF'
import type { ApiContainer } from '@benchmark/service-api';
export type AdminConfig = { container: ApiContainer; allowedRoles: string[] };
EOF

make_service app-mobile "@benchmark/service-events" "@benchmark/feature-search"
cat > $FIXTURE/packages/app-mobile/src/index.ts << 'EOF'
import type { FormattedNotif } from '@benchmark/service-events';
import type { SearchResults } from '@benchmark/feature-search';
export type MobileState = { notifications: FormattedNotif[]; lastSearch: SearchResults | null };
EOF

make_service app-cli "@benchmark/service-reporting" "@benchmark/utils-string"
cat > $FIXTURE/packages/app-cli/src/index.ts << 'EOF'
import type { Report } from '@benchmark/service-reporting';
import { truncate } from '@benchmark/utils-string';
export const formatReport = (r: Report) => truncate(JSON.stringify(r.points), 120);
EOF

make_service app-webhook "@benchmark/service-events" "@benchmark/service-data"
cat > $FIXTURE/packages/app-webhook/src/index.ts << 'EOF'
import type { FormattedNotif } from '@benchmark/service-events';
export interface WebhookPayload { event: string; data: FormattedNotif }
EOF

echo "Done. Packages created:"
ls $FIXTURE/packages | wc -l
ls $FIXTURE/packages
