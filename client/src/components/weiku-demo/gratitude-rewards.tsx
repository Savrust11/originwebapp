import { Heart, Sparkles, HeartHandshake, Gift, Moon, ArrowRight } from "lucide-react"
import { Reveal } from "./reveal"
import { PhoneMockup } from "./phone-mockup"

const flow = [
  { label: "育児", icon: Heart },
  { label: "気づく", icon: Sparkles },
  { label: "ありがとう", icon: HeartHandshake },
  { label: "ポイント", icon: Gift },
  { label: "休息", icon: Moon },
]

const rewards = ["30分のマッサージ券", "1時間の一人お風呂券", "好きなランチ出前券", "朝までぐっすり睡眠券"]

export function GratitudeRewards() {
  return (
    <section className="bg-gradient-to-br from-pink-soft/25 via-lavender-pale to-lavender/40 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            感謝を、休める時間に変える。
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-charcoal/70 sm:text-lg">
            パートナーの頑張りに気づいたら、「ありがとう」を記録。日々の育児で貯まったポイントは、それぞれの家庭に合ったご褒美と交換できます。
          </p>
        </Reveal>

        {/* flow */}
        <Reveal className="mt-12">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:gap-3">
            {flow.map((f, i) => (
              <div key={f.label} className="flex items-center gap-2 sm:gap-3">
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/80 px-4 py-3 shadow-sm backdrop-blur-sm">
                  <f.icon className="size-5 text-grape" />
                  <span className="text-xs font-bold text-charcoal/80">{f.label}</span>
                </div>
                {i < flow.length - 1 && <ArrowRight className="size-4 shrink-0 text-grape-light" />}
              </div>
            ))}
          </div>
        </Reveal>

        {/* two phones */}
        <div className="mt-14 grid items-center gap-10 sm:grid-cols-2 lg:gap-16">
          <Reveal className="flex flex-col items-center gap-5">
            <PhoneMockup className="w-full max-w-[15rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/weiku-demo/thanks.png" alt="ありがとうの記録画面" className="h-full w-full object-cover object-top" />
            </PhoneMockup>
            <p className="text-sm font-bold text-grape-deep">ありがとうの記録</p>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col items-center gap-5">
            <PhoneMockup className="w-full max-w-[15rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/weiku-demo/rewards.png" alt="ご褒美ショップ" className="h-full w-full object-cover object-top" />
            </PhoneMockup>
            <ul className="flex flex-wrap justify-center gap-2">
              {rewards.map((r) => (
                <li key={r} className="rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-medium text-charcoal/75 shadow-sm">
                  {r}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
