import { Milk, Heart, Baby, Moon, Bath, Blocks, Pill, Thermometer, Stethoscope, HeartHandshake } from "lucide-react"
import { Reveal } from "./reveal"
import { PhoneMockup } from "./phone-mockup"

const logItems = [
  { icon: Milk, label: "ミルク", tone: "text-blue-baby" },
  { icon: Heart, label: "授乳", tone: "text-pink-soft" },
  { icon: Baby, label: "おむつ", tone: "text-yellow-soft" },
  { icon: Moon, label: "ねんね", tone: "text-grape-light" },
  { icon: Bath, label: "お風呂", tone: "text-blue-baby" },
  { icon: Blocks, label: "あそび", tone: "text-mint" },
  { icon: Pill, label: "お薬", tone: "text-pink-soft" },
  { icon: Thermometer, label: "体温", tone: "text-pink-soft" },
  { icon: Stethoscope, label: "通院", tone: "text-mint" },
  { icon: HeartHandshake, label: "ありがとう", tone: "text-grape" },
]

export function QuickLog() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            忙しい育児を、数秒で記録。
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-charcoal/70 sm:text-lg">
            疲れているときも、赤ちゃんを抱いているときも。迷わず使えるシンプルな記録画面です。
          </p>
        </Reveal>

        <div className="mt-14 flex flex-col items-center gap-12 lg:flex-row lg:justify-center lg:gap-16">
          <Reveal className="w-full max-w-[16rem] shrink-0">
            <PhoneMockup>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/weiku-demo/quicklog.png" alt="クイックログの記録画面" className="h-full w-full object-cover object-top" />
            </PhoneMockup>
          </Reveal>

          <div className="w-full max-w-lg">
            <Reveal>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-5">
                {logItems.map((item, i) => (
                  <Reveal
                    key={item.label}
                    delay={i * 0.04}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-lavender/60 bg-lavender-pale/50 p-4 text-center transition-transform hover:-translate-y-1"
                  >
                    <span className="flex size-11 items-center justify-center rounded-full bg-white shadow-sm">
                      <item.icon className={`size-5 ${item.tone}`} />
                    </span>
                    <span className="text-xs font-medium text-charcoal/80">{item.label}</span>
                  </Reveal>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.2}>
              <p className="mt-8 text-pretty text-center text-base font-bold text-grape-deep lg:text-left">
                ワンタップの記録が、家族共通の育児情報になります。
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
