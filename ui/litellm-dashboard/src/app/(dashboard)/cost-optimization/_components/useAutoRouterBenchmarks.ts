import { $api } from "@/lib/http/api";

export const useAutoRouterBenchmarks = (accessToken: string | null) =>
  $api.useQuery("get", "/auto_router/benchmarks", {}, { enabled: Boolean(accessToken), retry: false });
