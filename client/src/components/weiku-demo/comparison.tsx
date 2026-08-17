import { Check, Minus } from "lucide-react"
import { Reveal } from "./reveal"

const rows = [
  { generic: "過去の出来事を記録", weiku: "AIが次の授乳・睡眠を予測" },
  { generic: "記録する人が中心", weiku: "家族で同じ情報を共有" },
  { generic: "担当の切り替えができない", weiku: "育児担当を切り替え" },
  { generic: "名もなき育児は見えない", weiku: "名もなき育児を可視化" },
  { generic: "感謝・承認の仕組みがない", weiku: "感謝・ポイント・ご褒美" },
  { generic: "実際のケア現場との接点がない", weiku: "産後ケアの現場から誕生" },
]

export function Comparison() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            育児記録の、その先へ。
          </h2>
        </Reveal>

        <Reveal className="mt-12 overflow-hidden rounded-3xl border border-lavender/70">
          <div className="grid grid-cols-2">
            <div className="bg-lavender-pale/60 p-5 text-center text-sm font-bold text-charcoal/55 sm:p-6 sm:text-base">
              一般的な育児記録アプリ
            </div>
            <div className="bg-grape p-5 text-center text-sm font-bold text-white sm:p-6 sm:text-base">
              We育
            </div>
          </div>

          {rows.map((row, i) => (
            <div key={row.weiku} className={`grid grid-cols-2 ${i % 2 === 0 ? "bg-white" : "bg-lavender-pale/30"}`}>
              <div className="flex items-start gap-2.5 border-t border-lavender/60 p-4 sm:p-5">
                <Minus className="mt-0.5 size-4 shrink-0 text-charcoal/30" />
                <span className="text-sm leading-relaxed text-charcoal/55">{row.generic}</span>
              </div>
              <div className="flex items-start gap-2.5 border-l border-t border-lavender/60 bg-grape/5 p-4 sm:p-5">
                <Check className="mt-0.5 size-4 shrink-0 text-grape" />
                <span className="text-sm font-medium leading-relaxed text-charcoal/85">{row.weiku}</span>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
