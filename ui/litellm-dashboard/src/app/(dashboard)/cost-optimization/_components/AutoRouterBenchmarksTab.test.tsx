import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/http/client";

vi.mock("./useAutoRouterBenchmarks", () => ({ useAutoRouterBenchmarks: vi.fn() }));

import AutoRouterBenchmarksTab from "./AutoRouterBenchmarksTab";
import type {
  AutoRouterBenchmarkGroup,
  AutoRouterBenchmarksResponse,
  AutoRouterCacheStats,
} from "./autoRouterBenchmarks";
import { useAutoRouterBenchmarks } from "./useAutoRouterBenchmarks";

type HookResult = ReturnType<typeof useAutoRouterBenchmarks>;

const mockHook = (result: { data?: AutoRouterBenchmarksResponse; isPending?: boolean; error?: Error }) => {
  vi.mocked(useAutoRouterBenchmarks).mockReturnValue({
    data: result.data,
    isPending: result.isPending ?? false,
    error: result.error ?? null,
  } as unknown as HookResult);
};

const cache = (overrides: Partial<AutoRouterCacheStats> = {}): AutoRouterCacheStats => ({
  coverage_pct: 99.6,
  hit_rate_pct: 93.3,
  same_model: { turns: 400, hits: 391, hit_rate_pct: 97.7 },
  first_visit: { turns: 37, hits: 9, hit_rate_pct: 24.3 },
  return_to_tier: { turns: 381, hits: 311, hit_rate_pct: 81.6 },
  unordered_turns: 0,
  return_misses_expired: 19,
  return_misses_within_ttl: 51,
  return_misses_unknown: 0,
  ttl_5m_turns: 0,
  ttl_1h_turns: 818,
  ...overrides,
});

type Totals = AutoRouterBenchmarksResponse["totals"];

const totals = (overrides: Partial<Totals> = {}): Totals => ({
  sessions: 94,
  turns: 3073,
  avg_turns_per_session: 32.7,
  avg_session_seconds: 7560,
  avg_tokens_per_session: 5_300_000,
  spend: 359.86,
  saved_spend: 2174.59,
  baseline_spend: 2534.45,
  saved_pct: 85.8,
  saved_per_session: 23.13,
  cache: cache(),
  ...overrides,
});

const group = (overrides: Partial<AutoRouterBenchmarkGroup> = {}): AutoRouterBenchmarkGroup => ({
  router_name: "claude-auto",
  router_type: "complexity",
  ...totals(),
  ...overrides,
});

const response = (groups: AutoRouterBenchmarkGroup[], shared: Totals = totals()): AutoRouterBenchmarksResponse => ({
  start_date: "2026-07-06",
  end_date: "2026-08-05",
  routers_in_scope: groups.length,
  totals: shared,
  groups,
});

const renderTab = () => render(<AutoRouterBenchmarksTab accessToken="sk-test" />);

describe("AutoRouterBenchmarksTab", () => {
  it("leads with total estimated savings, before the three session-shape metrics", () => {
    mockHook({ data: response([group(), group({ router_name: "gpt-auto" })]) });
    renderTab();

    const labels = screen
      .getAllByText(/Total estimated savings|Avg turns per session|Avg session length|Avg tokens per session/)
      .map((node) => node.textContent);
    expect(labels).toEqual([
      "Total estimated savings",
      "Avg turns per session",
      "Avg session length",
      "Avg tokens per session",
    ]);
  });

  it("renders the headline numbers the tiles exist for", () => {
    mockHook({ data: response([group(), group({ router_name: "gpt-auto" })]) });
    renderTab();

    expect(screen.getByText("$2,174.59")).toBeInTheDocument();
    expect(screen.getByText("-86%")).toBeInTheDocument();
    expect(screen.getByText(/\$359\.86 routed/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,534\.45 if routed to most expensive model/)).toBeInTheDocument();
    expect(screen.getByText("32.7")).toBeInTheDocument();
    expect(screen.getByText("2.1h")).toBeInTheDocument();
    expect(screen.getByText("5.3M")).toBeInTheDocument();
  });

  it("pairs the savings with the session count it was earned over", () => {
    mockHook({ data: response([group(), group({ router_name: "gpt-auto" })]) });
    renderTab();

    expect(screen.getByText("Sessions on auto-router")).toBeInTheDocument();
    expect(screen.getByText("94")).toBeInTheDocument();
    expect(screen.getByText("3,073 turns")).toBeInTheDocument();
    expect(screen.getByText("Saved per session")).toBeInTheDocument();
    expect(screen.getByText("$23.13")).toBeInTheDocument();
    expect(screen.getByText("Auto-routers in scope")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a cost increase as a positive delta rather than a saving", () => {
    const overBaseline = { spend: 120, baseline_spend: 100, saved_spend: -20, saved_pct: -20 };
    const dearer = totals(overBaseline);
    mockHook({ data: response([group(dearer)], dearer) });
    renderTab();

    expect(screen.getByText("+20%")).toBeInTheDocument();
  });

  it("renders all three cache buckets with their turn counts and hit rates", () => {
    mockHook({ data: response([group()]) });
    renderTab();

    expect(screen.getByText("Same model")).toBeInTheDocument();
    expect(screen.getByText("stayed on the same tier")).toBeInTheDocument();
    expect(screen.getByText("First visit")).toBeInTheDocument();
    expect(screen.getByText("cold by design")).toBeInTheDocument();
    expect(screen.getByText("Return to tier")).toBeInTheDocument();
    expect(screen.getByText("came back to a tier already used")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByText("381")).toBeInTheDocument();
    expect(screen.getByText("97.7%")).toBeInTheDocument();
    expect(screen.getByText("24.3%")).toBeInTheDocument();
    expect(screen.getByText("81.6%")).toBeInTheDocument();
  });

  it("summarizes the cache column from the bucketed turns, not the session turns", () => {
    mockHook({ data: response([group()]) });
    renderTab();

    expect(screen.getByText("93.3%")).toBeInTheDocument();
    expect(screen.getByText("99.6% coverage")).toBeInTheDocument();
    expect(screen.getByText("818 total")).toBeInTheDocument();
    expect(screen.getByText(/818 turns/)).toBeInTheDocument();
    expect(screen.getByText("1h TTL")).toBeInTheDocument();
  });

  it("recomputes the expired-miss share and names the remaining cause", () => {
    mockHook({ data: response([group()]) });
    renderTab();

    expect(screen.getByText("27.1%")).toBeInTheDocument();
    expect(
      screen.getByText(/of return-to-tier misses expired past the TTL; the rest missed because the prefix changed/),
    ).toBeInTheDocument();
  });

  it("ends the miss sentence at the TTL when every miss expired", () => {
    const allExpired = totals({ cache: cache({ return_misses_expired: 70, return_misses_within_ttl: 0 }) });
    mockHook({ data: response([group(allExpired)], allExpired) });
    renderTab();

    expect(screen.getByText(/of return-to-tier misses expired past the TTL$/)).toBeInTheDocument();
  });

  it("mentions out-of-order turns only when there are any", () => {
    const unordered = totals({ cache: cache({ unordered_turns: 12 }) });
    mockHook({ data: response([group(unordered)], unordered) });
    renderTab();

    expect(screen.getByText(/12 turns arrived out of order across pods and are not bucketed/)).toBeInTheDocument();
  });

  it("labels the default selection instead of leaking the __all__ sentinel", () => {
    mockHook({ data: response([group()]) });
    renderTab();

    expect(screen.getByText("All auto-routers")).toBeInTheDocument();
    expect(screen.queryByText("__all__")).not.toBeInTheDocument();
  });

  it("says so while the benchmarks are loading", () => {
    mockHook({ isPending: true });
    renderTab();

    expect(screen.getByText("Loading auto-router benchmarks...")).toBeInTheDocument();
  });

  it("names the admin requirement when the proxy answers 403", () => {
    mockHook({ error: new ApiError("forbidden", 403, {}) });
    renderTab();

    expect(screen.getByText("Auto-router benchmarks are visible to proxy admin roles only")).toBeInTheDocument();
  });

  it("degrades to a message when the endpoint is unavailable", () => {
    mockHook({ error: new ApiError("boom", 500, {}) });
    renderTab();

    expect(screen.getByText("Auto-router benchmarks are unavailable right now")).toBeInTheDocument();
  });

  it("says so when there are no auto-router sessions at all", () => {
    mockHook({ data: response([]) });
    renderTab();

    expect(screen.getByText("No auto-router sessions in the last 30 days yet")).toBeInTheDocument();
  });
});
