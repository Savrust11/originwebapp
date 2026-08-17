import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Self-contained class-name helper for the We育 demo bundle.
// Bundled here so the demo has no dependency on the host project's lib/utils.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
