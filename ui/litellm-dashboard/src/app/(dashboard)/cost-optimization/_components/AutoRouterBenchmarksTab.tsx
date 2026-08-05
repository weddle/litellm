"use client";

import React, { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/http/client";
import { formatNumberWithCommas } from "@/utils/dataUtils";

import {
  ALL_ROUTERS,
  bucketRows,
  bucketTurnsTotal,
  durationLabel,
  groupKey,
  groupLabel,
  pctLabel,
  returnMissShare,
  ttlChip,
  viewFor,
  type AutoRouterCacheStats,
  type BenchmarkView,
  type BucketRow,
} from "./autoRouterBenchmarks";
import { usd } from "./costOptimizationUtils";
import { useAutoRouterBenchmarks } from "./useAutoRouterBenchmarks";

const Message: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
);

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-3xl font-semibold text-foreground">{value}</p>
    </CardContent>
  </Card>
);

const HeroCard: React.FC<{ view: BenchmarkView }> = ({ view }) => {
  const stats = view.stats;
  const cheaper = stats.saved_spend >= 0;
  return (
    <Card className="overflow-hidden py-0">
      <div className="grid md:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3 p-6">
          <p className="text-sm text-muted-foreground">Total estimated savings</p>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-5xl font-semibold tracking-tight text-foreground">{usd(stats.saved_spend)}</p>
            <Badge variant="secondary" className={cheaper ? "text-muted-foreground" : "text-destructive"}>
              {cheaper ? "-" : "+"}
              {Math.abs(stats.saved_pct).toFixed(0)}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {usd(stats.spend)} routed
            <span className="mx-2 text-muted-foreground/50">/</span>
            {usd(stats.baseline_spend)} if routed to most expensive model
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t bg-muted/40 p-6 md:border-t-0 md:border-l">
          <p className="text-sm text-muted-foreground">Sessions on auto-router</p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-semibold text-foreground">{stats.sessions.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{stats.turns.toLocaleString()} turns</p>
          </div>
          <Separator />
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">Saved per session</dt>
              <dd className="font-medium tabular-nums text-foreground">{usd(stats.saved_per_session)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">Auto-routers in scope</dt>
              <dd className="font-medium tabular-nums text-foreground">{view.routers}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
  );
};

const StackedTurnBar: React.FC<{ buckets: BucketRow[]; total: number }> = ({ buckets, total }) => (
  <div
    className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm"
    role="img"
    aria-label="Share of turns by bucket"
  >
    {buckets
      .filter((b) => b.turns > 0)
      .map((b) => (
        <div
          key={b.key}
          className={`${b.fill} first:rounded-l-sm last:rounded-r-sm`}
          style={{ width: `${total > 0 ? (100 * b.turns) / total : 0}%` }}
          title={`${b.label}: ${b.turns.toLocaleString()} turns`}
        />
      ))}
  </div>
);

const BucketTable: React.FC<{ buckets: BucketRow[] }> = ({ buckets }) => (
  <Table>
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="text-[11px] uppercase tracking-wide">Bucket</TableHead>
        <TableHead className="text-right text-[11px] uppercase tracking-wide">Turns</TableHead>
        <TableHead className="w-1/2" />
        <TableHead className="text-right text-[11px] uppercase tracking-wide">Hit rate</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {buckets.map((b) => (
        <TableRow key={b.key} className="hover:bg-transparent">
          <TableCell className="text-foreground">
            <span className="flex items-center gap-2">
              <span className={`inline-block size-2 shrink-0 rounded-sm ${b.fill}`} aria-hidden />
              <span>
                {b.label}
                <span className="block text-xs font-normal text-muted-foreground">{b.sublabel}</span>
              </span>
            </span>
          </TableCell>
          <TableCell className="text-right align-top tabular-nums text-muted-foreground">
            {b.turns.toLocaleString()}
          </TableCell>
          <TableCell className="align-top">
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground" style={{ width: `${b.hitRatePct}%` }} aria-hidden />
            </div>
          </TableCell>
          <TableCell className="text-right align-top font-medium tabular-nums text-foreground">
            {pctLabel(b.hitRatePct)}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const CachingCard: React.FC<{ cache: AutoRouterCacheStats }> = ({ cache }) => {
  const buckets = bucketRows(cache);
  const total = bucketTurnsTotal(cache);
  const miss = returnMissShare(cache);
  const ttl = ttlChip(cache);
  return (
    <Card className="overflow-hidden py-0">
      <div className="grid lg:grid-cols-[16rem_1fr]">
        <div className="flex flex-col justify-center gap-3 border-b p-6 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">Cache hit rate</p>
            <Badge variant="secondary" className="text-muted-foreground">
              {pctLabel(cache.coverage_pct)} coverage
            </Badge>
          </div>
          <p className="text-5xl font-semibold tracking-tight text-foreground">{pctLabel(cache.hit_rate_pct)}</p>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} turns
            {ttl === null ? null : <span className="ml-2 border-l pl-2">{ttl}</span>}
          </p>
        </div>

        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Share of turns</p>
            <p className="text-[11px] text-muted-foreground">{total.toLocaleString()} total</p>
          </div>
          <StackedTurnBar buckets={buckets} total={total} />
          <BucketTable buckets={buckets} />
          {miss === null ? null : (
            <>
              <Separator />
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-muted-foreground">
                  {pctLabel(miss.expiredPct)}
                </Badge>
                <span>
                  of return-to-tier misses expired past the TTL
                  {miss.restReason === null ? "" : `; ${miss.restReason}`}
                </span>
              </p>
            </>
          )}
          {cache.unordered_turns > 0 && (
            <p className="text-xs text-muted-foreground">
              {cache.unordered_turns.toLocaleString()} turns arrived out of order across pods and are not bucketed
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};

interface AutoRouterBenchmarksTabProps {
  accessToken: string | null;
}

const AutoRouterBenchmarksTab: React.FC<AutoRouterBenchmarksTabProps> = ({ accessToken }) => {
  const { data, isPending, error } = useAutoRouterBenchmarks(accessToken);
  const [selectedKey, setSelectedKey] = useState<string>(ALL_ROUTERS);

  if (isPending) return <Message>Loading auto-router benchmarks...</Message>;
  if (error instanceof ApiError && error.status === 403) {
    return <Message>Auto-router benchmarks are visible to proxy admin roles only</Message>;
  }
  if (error || !data) return <Message>Auto-router benchmarks are unavailable right now</Message>;
  if (data.groups.length === 0) return <Message>No auto-router sessions in the last 30 days yet</Message>;

  const view = viewFor(data, selectedKey);
  const stats = view.stats;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Auto-router benchmarks</h2>
          <p className="mt-1 text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <div className="w-full sm:w-64">
          <Select value={selectedKey} onValueChange={(value: string | null) => setSelectedKey(value ?? ALL_ROUTERS)}>
            <SelectTrigger className="w-full">
              <SelectValue>{view.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ROUTERS}>All auto-routers</SelectItem>
              {data.groups.map((g) => (
                <SelectItem key={groupKey(g)} value={groupKey(g)}>
                  {groupLabel(g, data.groups)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <HeroCard view={view} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric label="Avg turns per session" value={stats.avg_turns_per_session.toFixed(1)} />
        <Metric label="Avg session length" value={durationLabel(stats.avg_session_seconds)} />
        <Metric label="Avg tokens per session" value={formatNumberWithCommas(stats.avg_tokens_per_session, 1, true)} />
      </div>

      <p className="text-xs text-muted-foreground">
        Compares the routed model mix against sending every request to the most expensive model in the ladder at list
        prices. It does not model the caching a single-model baseline would have had.
      </p>

      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Auto-router prompt caching</h3>
          <p className="text-xs text-muted-foreground">
            every turn falls in exactly one bucket, by what the router did
          </p>
        </div>
        <CachingCard cache={stats.cache} />
      </div>
    </div>
  );
};

export default AutoRouterBenchmarksTab;
