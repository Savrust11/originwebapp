import { Reveal } from "./reveal"
import { ScreenCarousel } from "./screen-carousel"
import { cn } from "@/components/weiku-demo/cn"

const cards = [
  {
    label: "PREDICT",
    title: "次を予測する",
    body: "赤ちゃんの月齢と、これまでの授乳・睡眠記録をAIが分析。次の授乳やねんねのタイミングを予測します。",
    tagline: "迷いを減らし、判断に安心を。",
    accent: "text-grape",
    screens: [{ src: "/weiku-demo/home-mama.png", alt: "担当中 ママのホーム画面（AI予測）" }],
  },
  {
    label: "SHARE",
    title: "家族で共有する",
    body: "育児記録と現在の担当を家族で共有。毎回一から説明しなくても、パートナーが状況を理解できます。",
    tagline: "情報の共有を、行動の共有へ。",
    accent: "text-blue-baby",
    screens: [
      { src: "/weiku-demo/home-papa.png", alt: "担当中 パパのホーム画面" },
    ],
  },
  {
    label: "RECOGNIZE",
    title: "頑張りに気づく",
    body: "授乳やおむつ替えだけでなく、洗濯、哺乳瓶洗い、買い物などの「名もなき育児」も記録。家族の頑張りを感謝とポイントに変えます。",
    tagline: "すべての育児を、見える価値に。",
    accent: "text-pink-soft",
    screens: [
      { src: "/weiku-demo/invisible.png", alt: "名もなき育児を記録する画面" },
      { src: "/weiku-demo/thanks.png", alt: "ありがとうの記録画面" },
      { src: "/weiku-demo/rewards.png", alt: "ご褒美ショップ" },
    ],
  },
]

export function CoreValue() {
  return (
    <section id="about" className="scroll-mt-24 bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            記録するだけで、
            <br className="sm:hidden" />
            終わらない。
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-charcoal/70 sm:text-lg">
            一般的な育児アプリは、起きたことを記録します。We育は、その記録から次を予測し、家族の行動と感謝につなげます。
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {cards.map((card, i) => (
            <Reveal key={card.label} delay={i * 0.1}>
              <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-lavender/70 bg-lavender-pale/60 p-6 transition-shadow hover:shadow-xl hover:shadow-grape/5 sm:p-7">
                <span className={cn("text-xs font-bold uppercase tracking-[0.2em]", card.accent)}>
                  {card.label}
                </span>
                <h3 className="mt-2 text-2xl font-bold text-charcoal">{card.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-charcoal/70">{card.body}</p>
                <p className="mt-4 text-sm font-bold text-grape-deep">{card.tagline}</p>
                <div className="mx-auto mt-7 w-full max-w-[13rem]">
                  <ScreenCarousel screens={card.screens} controls={card.screens.length > 1} interval={3400} />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
