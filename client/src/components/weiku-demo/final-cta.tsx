import { Reveal } from "./reveal"
import { PhoneMockup } from "./phone-mockup"
import { StoreBadges } from "./store-badges"

const stack = [
  { src: "/weiku-demo/ai-predict.png", alt: "AI予測画面", className: "left-0 top-6 z-10 rotate-[-8deg]" },
  { src: "/weiku-demo/dashboard.png", alt: "貢献度ダッシュボード", className: "left-1/2 top-0 z-30 -translate-x-1/2" },
  { src: "/weiku-demo/thanks.png", alt: "ありがとうの記録", className: "right-0 top-6 z-10 rotate-[8deg]" },
]

export function FinalCta() {
  return (
    <section
      id="cta"
      className="relative overflow-hidden bg-gradient-to-br from-grape-deep via-grape to-grape-light py-20 text-white lg:py-28"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-10 size-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -right-10 bottom-0 size-72 rounded-full bg-mint/20 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-5 lg:grid-cols-2 lg:px-8">
        <div>
          <Reveal>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-white/70">
              家族で育てるという、新しい選択。
            </p>
            <h2 className="mt-5 text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              子育てを、ひとりの頑張りから、チームの力へ。
            </h2>
            <p className="mt-6 max-w-lg text-pretty leading-relaxed text-white/80">
              記録、AI予測、共有、行動、感謝。育児に必要なものを、一つの場所に。
            </p>

            <div className="mt-9">
              <StoreBadges />
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="relative mx-auto hidden h-[26rem] w-full max-w-md sm:block">
          {stack.map((s) => (
            <div key={s.src} className={`absolute w-[44%] ${s.className}`}>
              <PhoneMockup>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} className="h-full w-full object-cover object-top" />
              </PhoneMockup>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
