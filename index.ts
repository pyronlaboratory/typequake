export function getChangeType(oldType: string | null, newType: string | null) {
  if (!oldType && newType) return "ADDITIVE";
  if (oldType && !newType) return "REMOVED";
  if (oldType !== newType) return "BREAKING";
  return "UNCHANGED";
}
