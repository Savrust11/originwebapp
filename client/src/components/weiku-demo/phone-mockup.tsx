import type { ReactNode } from "react"
import { cn } from "@/components/weiku-demo/cn"

type PhoneMockupProps = {
  children: ReactNode
  className?: string
  /** width of the phone frame in px on large screens */
}

/**
 * A realistic iPhone-style frame. Screens (images) are placed inside via children.
 * The frame keeps a fixed 9:19.5 aspect ratio so screenshots never distort.
 */
export function PhoneMockup({ children, className }: PhoneMockupProps) {
  return (
    <div
      className={cn(
        "relative aspect-[9/19.5] w-full rounded-[2.75rem] border border-white/60 bg-charcoal p-2.5 shadow-[0_40px_80px_-30px_rgba(91,42,134,0.55)] ring-1 ring-black/5",
        className,
      )}
    >
      {/* screen */}
      <div className="relative h-full w-full overflow-hidden rounded-[2.15rem] bg-white">
        {children}
      </div>
      {/* dynamic island / notch */}
      <div className="pointer-events-none absolute left-1/2 top-4 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-charcoal" />
      {/* side buttons */}
      <div className="absolute -left-[3px] top-28 h-14 w-[3px] rounded-l bg-charcoal/70" />
      <div className="absolute -left-[3px] top-44 h-10 w-[3px] rounded-l bg-charcoal/70" />
      <div className="absolute -right-[3px] top-36 h-20 w-[3px] rounded-r bg-charcoal/70" />
    </div>
  )
}
