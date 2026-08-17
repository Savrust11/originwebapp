import { NotebookPen, Sparkles, Share2, HeartHandshake } from "lucide-react"
import { Reveal } from "./reveal"

const steps = [
  { n: "1", title: "記録する", body: "授乳、睡眠、健康、あそび、名もなき育児を記録。", icon: NotebookPen },
  { n: "2", title: "予測する", body: "AIが次の授乳・睡眠タイミングを予測。", icon: Sparkles },
  { n: "3", title: "共有する", body: "家族が同じ情報を確認し、育児を交代。", icon: Share2 },
  { n: "4", title: "認め合う", body: "頑張りを感謝、ポイント、ご褒美につなげる。", icon: HeartHandshake },
]

export function HowItWorks() {
  return (
    <section className="bg-lavender-pale py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            記録から、チーム育児へ。
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1} className="h-full">
              <div className="relative flex h-full flex-col rounded-3xl border border-lavender/70 bg-white p-6">
                <div className="flex items-center justify-between">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-grape text-lg font-black text-white">
                    {s.n}
                  </span>
                  <s.icon className="size-6 text-grape-light" />
                </div>
                <h3 className="mt-5 text-lg font-bold text-charcoal">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
