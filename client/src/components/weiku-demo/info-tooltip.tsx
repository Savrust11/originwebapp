"use client"

import { useEffect, useRef, useState } from "react"
import { Info } from "lucide-react"

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${label}についての説明`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-4 items-center justify-center rounded-full text-charcoal/40 transition-colors hover:text-grape focus:outline-none focus-visible:ring-2 focus-visible:ring-grape/40"
      >
        <Info className="size-4" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-2xl border border-grape/15 bg-white p-3.5 text-left text-xs font-normal leading-relaxed text-charcoal/75 shadow-[0_12px_40px_-12px_rgba(124,77,166,0.35)]"
        >
          {text}
        </span>
      )}
    </span>
  )
}
