import type { BenchCraftId, CraftBench } from '../core';
import { puukkoBench } from './puukko';

const BENCHES: Record<BenchCraftId, () => CraftBench> = {
  puukko: () => puukkoBench,
};

export const BENCH_IDS = Object.keys(BENCHES) as BenchCraftId[];
export const isBenchCraft = (id: string): id is BenchCraftId => id in BENCHES;

/** The bench for a craft. */
export function benchFor(id: BenchCraftId): CraftBench {
  return BENCHES[id]();
}
