import type { Instrument } from "@/types";

export const STATUS_COLORS: Record<Instrument["status"], string> = {
  PROPOSED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  PASSED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  EFFECTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  ENJOINED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  REPEALED: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};
