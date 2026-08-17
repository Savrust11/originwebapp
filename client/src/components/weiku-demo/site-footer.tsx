import { Grape } from "lucide-react"

// Demo is a single self-contained page, so every link points to an in-page
// anchor. This keeps the demo framework-agnostic (no next/link dependency) and
// avoids any broken/404 navigation when embedded on its own.
const cols = [
  {
    heading: "プロダクト",
    links: [
      { label: "We育とは", href: "#about" },
      { label: "主な機能", href: "#features" },
      { label: "チーム育児", href: "#team" },
    ],
  },
  {
    heading: "会社情報",
    links: [
      { label: "会社概要", href: "#story" },
      { label: "生まれた背景", href: "#story" },
      { label: "お問い合わせ", href: "#cta" },
    ],
  },
  {
    heading: "規約",
    links: [
      { label: "プライバシーポリシー", href: "#" },
      { label: "利用規約", href: "#" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer id="contact" className="scroll-mt-24 bg-charcoal text-white">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-grape text-white">
                <Grape className="size-5" />
              </span>
              <span className="text-lg font-bold">
                We-iku<span className="ml-1 text-sm font-medium text-lavender">We育</span>
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Produced by 産前産後ケアホテル ぶどうの木
            </p>
            <p className="mt-1 text-sm text-white/50">株式会社Grape</p>
            <p className="text-sm text-white/50">京都、日本</p>
          </div>

          {cols.map((col) => (
            <div key={col.heading}>
              <h3 className="text-sm font-bold text-white/90">{col.heading}</h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-white/60 transition-colors hover:text-white">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-white/10 pt-8">
          <p className="text-balance text-lg font-bold text-lavender">
            育児を、ひとりの負担から、チームの営みへ。
          </p>
          <p className="mt-4 text-xs text-white/40">
            &copy; {new Date().getFullYear()} 株式会社Grape / We-iku. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
