/**
 * F6: run due monitors with bounded concurrency across devices, while keeping
 * same-device rules serial so we do not stampede one LAN endpoint.
 */

/** Max device groups polled at once (multi-device rooms); same-device stays serial. */
export const MONITOR_DEVICE_CONCURRENCY = 4;

export function monitorDeviceKey(rule: { device: string; id: string; interfaceId?: string | null }): string {
  if (rule.device) return rule.device;
  if (rule.interfaceId) return `iface:${rule.interfaceId}`;
  return `id:${rule.id}`;
}

/** Preserve rule order within each device group (config order). */
export function groupMonitorRulesByDevice<T extends { device: string; id: string; interfaceId?: string | null }>(
  rules: T[],
): T[][] {
  const map = new Map<string, T[]>();
  for (const rule of rules) {
    const key = monitorDeviceKey(rule);
    const list = map.get(key);
    if (list) list.push(rule);
    else map.set(key, [rule]);
  }
  return [...map.values()];
}

/** Bounded worker pool; results align with input order. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const n = items.length;
  if (!n) return [];
  const out = new Array<R>(n);
  const workers = Math.min(Math.max(1, limit), n);
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++;
        if (i >= n) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
