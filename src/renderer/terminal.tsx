import { render, Box, Text } from "ink";
import path from "path";

import type { AnalyzeResult } from "../commands/analyze";
import type {
  ImpactReport,
  ImportSite,
  TypeMutationClass,
} from "../types/index";

const SEVERITY_ORDER: TypeMutationClass[] = [
  "BREAKING",
  "REMOVED",
  "NARROWING",
  "WIDENING",
  "ADDITIVE",
];

type InkColor = "red" | "yellow" | "cyan" | "green" | "magenta";

const SEVERITY_COLOR: Record<TypeMutationClass, InkColor> = {
  BREAKING: "red",
  REMOVED: "magenta",
  NARROWING: "yellow",
  WIDENING: "cyan",
  ADDITIVE: "green",
};

// OSC 8 clickable hyperlinks
function fileLink(absolutePath: string, label: string): string {
  return `\x1b]8;;file://${absolutePath}\x07${label}\x1b]8;;\x07`;
}

function SiteRow({ site }: { site: ImportSite }) {
  const abs = path.resolve(site.filePath);
  const rel = path.relative(process.cwd(), abs);
  const location = `${rel}:${site.line}:${site.column}`;
  const alias =
    site.localAlias && site.localAlias !== site.symbolName
      ? ` as ${site.localAlias}`
      : "";
  const typeOnly = site.isTypeOnly ? " [type]" : "";
  const uses = site.usageCount > 1 ? ` ×${site.usageCount}` : "";

  return (
    <Box paddingLeft={4}>
      <Text dimColor>{"↳ "}</Text>
      <Text>{fileLink(abs, location)}</Text>
      <Text dimColor>{`${alias}${typeOnly}${uses}`}</Text>
    </Box>
  );
}

function ReportRow({
  report,
  isLast,
}: {
  report: ImpactReport;
  isLast: boolean;
}) {
  return (
    <Box flexDirection="column" marginBottom={isLast ? 1.2 : 1}>
      <Box>
        <Box width={24} paddingLeft={2}>
          <Text bold>{report.symbol}</Text>
        </Box>

        <Text dimColor>{report.detail}</Text>
      </Box>
      {report.sites.map((site, i) => (
        <SiteRow key={i} site={site} />
      ))}
    </Box>
  );
}

function SeverityGroup({
  cls,
  reports,
}: {
  cls: TypeMutationClass;
  reports: ImpactReport[];
}) {
  const color = SEVERITY_COLOR[cls];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color={color}>{`${cls}`}</Text>
        <Text dimColor>{`  (${reports.length})`}</Text>
      </Box>

      <Box height={1} overflow="hidden">
        <Text color="gray">
          {"".repeat(1) +
            "─".repeat(process.stdout.columns || 60) +
            " ".repeat(2)}
        </Text>
      </Box>
      {reports.map((r, i) => (
        <ReportRow key={i} report={r} isLast={i === reports.length - 1} />
      ))}
    </Box>
  );
}

function ReportHeader({ result }: { result: AnalyzeResult }) {
  const cols = process.stdout.columns || 80;
  const left = "IMPACT REPORT";
  const right = `ref ${result.baseRef}`;
  const gap = cols - left.length - right.length;

  return (
    <Box
      flexDirection="column"
      marginBottom={result.reports.length ? 1 : 0}
      marginTop={1}
    >
      <Box>
        <Text bold>{left}</Text>
        <Text dimColor>{" ".repeat(Math.max(1, gap))}</Text>
        <Text dimColor>{`ref `}</Text>
        <Text color="cyan">{result.baseRef}</Text>
      </Box>
      <Box>
        <Text dimColor>{"─".repeat(cols)}</Text>
      </Box>
    </Box>
  );
}

function PackageSection({
  name,
  reports,
}: {
  name: string;
  reports: ImpactReport[];
}) {
  const cols = process.stdout.columns || 80;
  const bySeverity = new Map<TypeMutationClass, ImpactReport[]>();
  for (const r of reports) {
    const bucket = bySeverity.get(r.mutationClass);
    if (bucket) bucket.push(r);
    else bySeverity.set(r.mutationClass, [r]);
  }

  const right = `${reports.length} mutation${reports.length !== 1 ? "s" : ""}`;

  return (
    <Box flexDirection="column" marginBottom={1} marginTop={-1}>
      <Box>
        <Text bold>{`📦 ${name}`}</Text>
        <Text dimColor>{" | "}</Text>
        <Text dimColor>{right}</Text>
      </Box>
      {SEVERITY_ORDER.filter((cls) => bySeverity.has(cls)).map((cls) => (
        <SeverityGroup key={cls} cls={cls} reports={bySeverity.get(cls)!} />
      ))}
    </Box>
  );
}

function SummaryLine({ result }: { result: AnalyzeResult }) {
  const counts: Partial<Record<TypeMutationClass, number>> = {};
  for (const r of result.reports) {
    counts[r.mutationClass] = (counts[r.mutationClass] ?? 0) + 1;
  }

  const packages = new Set(result.reports.map((r) => r.consumerPackage)).size;
  const parts = SEVERITY_ORDER.filter((cls) => counts[cls]);

  if (parts.length === 0) {
    return (
      <Box marginTop={0} marginBottom={1}>
        <Text color="green" bold>
          {" ✔ No type mutations detected."}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={-1} marginBottom={0}>
      <Box height={1} overflow="hidden">
        <Text color="gray">
          {"".repeat(1) +
            "─".repeat(process.stdout.columns || 60) +
            " ".repeat(2)}
        </Text>
      </Box>
      <Box>
        <Text bold>{"Summary  "}</Text>
        {parts.map((cls, i) => (
          <Box key={cls}>
            {i > 0 && <Text dimColor>{"  "}</Text>}
            <Text bold color={SEVERITY_COLOR[cls]}>
              {counts[cls]}
            </Text>
            <Text dimColor>{" " + cls.toLowerCase()}</Text>
          </Box>
        ))}
        <Text dimColor>{"  across "}</Text>
        <Text bold>{packages}</Text>
        <Text dimColor>{" package" + (packages !== 1 ? "s" : "")}</Text>
      </Box>
    </Box>
  );
}

function Report({ result }: { result: AnalyzeResult }) {
  const byPackage = new Map<string, ImpactReport[]>();
  for (const r of result.reports) {
    const existing = byPackage.get(r.consumerPackage);
    if (existing) existing.push(r);
    else byPackage.set(r.consumerPackage, [r]);
  }

  return (
    <Box flexDirection="column" paddingY={0}>
      <ReportHeader result={result} />

      {byPackage.size === 0 ? (
        <Text color="green" bold>
          {" ✔ No consumer impact detected."}
        </Text>
      ) : (
        Array.from(byPackage.entries()).map(([pkg, reports]) => (
          <PackageSection key={pkg} name={pkg} reports={reports} />
        ))
      )}

      <SummaryLine result={result} />
    </Box>
  );
}

export async function renderTerminal(result: AnalyzeResult): Promise<void> {
  const { waitUntilExit } = render(<Report result={result} />, {
    exitOnCtrlC: false,
  });
  await waitUntilExit();
}
