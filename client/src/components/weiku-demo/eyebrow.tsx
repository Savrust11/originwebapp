import type { ReactNode } from "react"
import { cn } from "@/components/weiku-demo/cn"

export function Eyebrow({
  children,
  className,
  tone = "grape",
}: {
  children: ReactNode
  className?: string
  tone?: "grape" | "light"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em]",
        tone === "grape" && "bg-lavender-pale text-grape",
        tone === "light" && "bg-white/15 text-white",
        className,
      )}
    >
      {children}
    </span>
  )
}
