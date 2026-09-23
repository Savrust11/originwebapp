"use client"

import { useEffect, useState } from "react"
import { Grape, Menu, X } from "lucide-react"
import { cn } from "@/components/weiku-demo/cn"

const links = [
  { href: "#about", label: "We育とは" },
  { href: "#features", label: "主な機能" },
  { href: "#team", label: "チーム育児" },
  { href: "#story", label: "生まれた背景" },
]

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-lavender/60 bg-white/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
        <a href="#top" className="flex items-center gap-2.5" aria-label="We-iku ホーム">
          <span className="flex size-9 items-center justify-center rounded-xl bg-grape text-white shadow-sm">
            <Grape className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-grape-deep">
            We-iku<span className="ml-1 text-sm font-medium text-grape-light">We育</span>
          </span>
        </a>

        <ul className="hidden items-center gap-7 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-sm font-medium text-charcoal/75 transition-colors hover:text-grape"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center lg:flex">
          <a href="#cta" className="text-sm font-medium text-charcoal/75 transition-colors hover:text-grape">
            お問い合わせ
          </a>
        </div>

        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-xl border border-lavender bg-white/70 text-grape lg:hidden"
          aria-label={open ? "メニューを閉じる" : "メニューを開く"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-lavender/60 bg-white/95 px-5 pb-6 pt-2 backdrop-blur-xl lg:hidden">
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-lavender/50 py-3 text-base font-medium text-charcoal/80"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <a
            href="#cta"
            onClick={() => setOpen(false)}
            className="mt-4 block py-3 text-base font-medium text-charcoal/80"
          >
            お問い合わせ
          </a>
        </div>
      )}
    </header>
  )
}
