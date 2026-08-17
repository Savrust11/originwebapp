import { Check, Repeat, Stethoscope } from "lucide-react"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"
import { PhoneMockup } from "./phone-mockup"

const benefits = [
  { icon: Check, text: "分かりやすいステップ形式" },
  { icon: Repeat, text: "疲れているときでも迷いにくい" },
  { icon: Stethoscope, text: "受診が必要なサインも案内" },
]

export function CryingRescue() {
  return (
    <section className="bg-lavender-pale py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <Reveal className="mx-auto w-full max-w-[16rem]">
          <PhoneMockup>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/weiku-demo/crying-rescue.png" alt="泣き止みレスキューの案内画面" className="h-full w-full object-cover object-top" />
          </PhoneMockup>
        </Reveal>

        <div>
          <Eyebrow>困ったときのサポート</Eyebrow>
          <h2 className="mt-6 text-balance text-3xl font-black leading-tight tracking-tight text-charcoal sm:text-4xl">
            泣き止まないときも、
            <br />
            一つずつ確認。
          </h2>
          <p className="mt-5 max-w-lg text-pretty leading-relaxed text-charcoal/70">
            おむつ、空腹、室温など、赤ちゃんが泣いているときに確認したい項目を7つのステップで案内します。
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {benefits.map((b, i) => (
              <Reveal key={b.text} delay={i * 0.1}>
                <li className="flex items-center gap-3 rounded-2xl border border-lavender/70 bg-white p-4">
                  <span className="flex size-9 items-center justify-center rounded-full bg-mint/40 text-grape-deep">
                    <b.icon className="size-4" />
                  </span>
                  <span className="text-sm font-medium text-charcoal/80">{b.text}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
