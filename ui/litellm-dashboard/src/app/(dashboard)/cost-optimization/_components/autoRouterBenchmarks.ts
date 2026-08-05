import type { components } from "@/lib/http/schema";

export type AutoRouterBenchmarksResponse = components["schemas"]["AutoRouterBenchmarksResponse"];
export type AutoRouterBenchmarkTotals = components["schemas"]["AutoRouterBenchmarkTotals"];
export type AutoRouterBenchmarkGroup = components["schemas"]["AutoRouterBenchmarkGroup"];
export type AutoRouterCacheStats = components["schemas"]["AutoRouterCacheStats"];

export const ALL_ROUTERS = "__all__";

export interface BenchmarkView {
  label: string;
  routers: number;
  stats: AutoRouterBenchmarkTotals;
}

export const groupKey = (group: AutoRouterBenchmarkGroup): string => `${group.router_name} ${group.router_type}`;

export const groupLabel = (group: AutoRouterBenchmarkGroup, groups: readonly AutoRouterBenchmarkGroup[]): string => {
  const duplicated = groups.some((g) => g !== group && g.router_name === group.router_name);
  return duplicated ? `${group.router_name} (${group.router_type})` : group.router_name;
};

export const viewFor = (data: AutoRouterBenchmarksResponse, selectedKey: string): BenchmarkView => {
  const group = data.groups.find((g) => groupKey(g) === selectedKey);
  if (selectedKey === ALL_ROUTERS || !group) {
    return { label: "All auto-routers", routers: data.routers_in_scope, stats: data.totals };
  }
  return { label: groupLabel(group, data.groups), routers: 1, stats: group };
};

export interface BucketRow {
  key: "same_model" | "first_visit" | "return_to_tier";
  label: string;
  sublabel: string;
  turns: number;
  hitRatePct: number;
  fill: string;
}

export const bucketRows = (cache: AutoRouterCacheStats): BucketRow[] => [
  {
    key: "same_model",
    label: "Same model",
    sublabel: "stayed on the same tier",
    turns: cache.same_model.turns,
    hitRatePct: cache.same_model.hit_rate_pct,
    fill: "bg-foreground",
  },
  {
    key: "first_visit",
    label: "First visit",
    sublabel: "cold by design",
    turns: cache.first_visit.turns,
    hitRatePct: cache.first_visit.hit_rate_pct,
    fill: "bg-foreground/30",
  },
  {
    key: "return_to_tier",
    label: "Return to tier",
    sublabel: "came back to a tier already used",
    turns: cache.return_to_tier.turns,
    hitRatePct: cache.return_to_tier.hit_rate_pct,
    fill: "bg-foreground/60",
  },
];

export const bucketTurnsTotal = (cache: AutoRouterCacheStats): number =>
  cache.same_model.turns + cache.first_visit.turns + cache.return_to_tier.turns;

export interface ReturnMissShare {
  expiredPct: number;
  restReason: string | null;
}

export const returnMissShare = (cache: AutoRouterCacheStats): ReturnMissShare | null => {
  const misses = cache.return_to_tier.turns - cache.return_to_tier.hits;
  if (misses <= 0) return null;
  const expiredPct = (100 * cache.return_misses_expired) / misses;
  const withinTtl = cache.return_misses_within_ttl > 0;
  const unknown = cache.return_misses_unknown > 0;
  if (!withinTtl && !unknown) return { expiredPct, restReason: null };
  if (withinTtl && !unknown) return { expiredPct, restReason: "the rest missed because the prefix changed" };
  if (!withinTtl && unknown) return { expiredPct, restReason: "the rest carried no TTL telemetry to attribute" };
  return { expiredPct, restReason: "the rest missed because the prefix changed or carried no TTL telemetry" };
};

export const ttlChip = (cache: AutoRouterCacheStats): string | null => {
  if (cache.ttl_5m_turns > 0 && cache.ttl_1h_turns > 0) return "mixed TTLs";
  if (cache.ttl_1h_turns > 0) return "1h TTL";
  if (cache.ttl_5m_turns > 0) return "5m TTL";
  return null;
};

export const pctLabel = (value: number, digits: number = 1): string => `${value.toFixed(digits)}%`;

export const durationLabel = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
};
