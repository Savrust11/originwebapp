import { Check, Circle } from "lucide-react"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"
import { InfoTooltip } from "./info-tooltip"

const SPONSOR_TEXT =
  "スポンサーコンテンツとは、お子さまの月齢や育児フェーズなどに応じて、ご褒美ショップやアプリ内で紹介される企業・ブランドの情報です。バナー広告とは異なり、プレミアムプランでも表示されます。"

const AI_SOUDAN_TEXT =
  "育児記録やお子さまの月齢などを踏まえ、24時間いつでもAIに相談できる機能を予定しています。"

type Group = { heading: string; tone: "check" | "neutral"; items: { label: string; info?: boolean }[] }

const basicGroups: Group[] = [
  {
    heading: "コア機能",
    tone: "check",
    items: [
      { label: "育児記録" },
      { label: "タイムライン" },
      { label: "貢献度ダッシュボード" },
      { label: "チームパワー指数" },
      { label: "ご褒美ショップ" },
      { label: "ネントレ支援" },
      { label: "健康・成長記録" },
      { label: "チーム育児スキル" },
    ],
  },
  {
    heading: "AI機能",
    tone: "check",
    items: [
      { label: "入眠タイミング予測" },
      { label: "予防接種リマインド" },
      { label: "アレルギーアラート" },
      { label: "ネントレ分析" },
    ],
  },
]

type PremiumItem = { label: string; info?: boolean; upcoming?: boolean; note?: string }

const premiumItems: PremiumItem[] = [
  { label: "振り返り：期間無制限" },
  { label: "お子さま登録：4人まで" },
  { label: "思い出PDF：無制限" },
  { label: "バナー広告：非表示" },
  { label: "AI相談", upcoming: true, note: AI_SOUDAN_TEXT },
  { label: "スポンサーコンテンツ：引き続き表示あり", info: true },
]

const comparisonRows = [
  { item: "月額料金", basic: "無料", premium: "500円（税込）" },
  { item: "お子さま登録", basic: "2人まで", premium: "4人まで" },
  { item: "振り返り", basic: "直近30日間", premium: "期間無制限" },
  { item: "思い出PDF", basic: "回数制限あり", premium: "無制限" },
  { item: "バナー広告", basic: "あり", premium: "なし" },
  { item: "スポンサーコンテンツ", basic: "あり", premium: "あり" },
  { item: "AI相談", basic: "―", premium: "搭載予定" },
]

const notes = [
  "※AI相談機能は現在開発中です。提供開始時期および機能内容は変更される場合があります。",
  "※AIによる予測・分析・相談は、医療上の診断、治療または指示を行うものではありません。",
  "※表示されるスポンサーコンテンツには、広告・PRであることを明示します。",
  "※プラン内容および料金は変更される場合があります。",
]

function CheckIcon() {
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-lavender-pale text-grape">
      <Check className="size-3.5" strokeWidth={3} />
    </span>
  )
}

function NeutralIcon() {
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-charcoal/30">
      <Circle className="size-2.5 fill-current" />
    </span>
  )
}

export function Pricing() {
  return (
    <section id="pricing" className="bg-lavender-pale/40 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-5 text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            料金プラン
          </h2>
          <p className="mt-4 text-balance text-lg font-bold text-grape-deep">
            家族に必要な育児支援を、すべての人へ
          </p>
          <p className="mt-4 text-pretty text-base leading-relaxed text-charcoal/65">
            We育は、育児記録や家族共有に加え、4つのAI機能を無料で提供します。プレミアムでは、記録の保存・振り返りや思い出PDFを制限なく活用できます。
          </p>
        </Reveal>

        {/* Plan cards */}
        <div className="mt-14 grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
          {/* Basic */}
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-[28px] border border-grape/20 bg-white p-7 shadow-[0_8px_30px_-12px_rgba(124,77,166,0.15)] lg:p-9">
              <h3 className="text-lg font-bold text-charcoal">基本プラン</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/60">
                育児に必要なコア機能とAI機能を、無料で利用できます。
              </p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="text-5xl font-black tracking-tight text-charcoal">無料</span>
              </div>
              <a
                href="#cta"
                className="mt-7 inline-flex w-full items-center justify-center rounded-full border-2 border-grape/25 bg-white px-6 py-3.5 text-base font-bold text-grape transition-colors hover:bg-lavender-pale/60"
              >
                無料ではじめる
              </a>
              <div className="mt-8 flex flex-col gap-6">
                {basicGroups.map((group) => (
                  <div key={group.heading}>
                    <p className="text-xs font-bold uppercase tracking-wide text-grape/70">{group.heading}</p>
                    <ul className="mt-3 flex flex-col gap-3">
                      {group.items.map((item) => (
                        <li key={item.label} className="flex items-start gap-3">
                          {group.tone === "check" ? <CheckIcon /> : <NeutralIcon />}
                          <span className="flex items-center gap-1.5 text-[15px] leading-relaxed text-charcoal/80">
                            {item.label}
                            {item.info && <InfoTooltip label="スポンサーコンテンツ" text={SPONSOR_TEXT} />}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Premium */}
          <Reveal delay={0.08} className="h-full">
            <div className="relative flex h-full flex-col rounded-[28px] border-2 border-grape bg-white p-7 shadow-[0_16px_50px_-16px_rgba(124,77,166,0.4)] lg:p-9">
              <h3 className="text-lg font-bold text-grape-deep">プレミアム</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/60">
                記録と思い出を制限なく活用し、必要なときにAIへ相談できるプランです。
              </p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="text-5xl font-black tracking-tight text-grape">500</span>
                <span className="text-lg font-bold text-grape">円</span>
                <span className="text-sm font-medium text-charcoal/55">/ 月（税込）</span>
              </div>
              <div className="mt-7 rounded-2xl bg-lavender-pale/50 p-4">
                <p className="text-sm font-bold text-grape-deep">基本プランのすべてに加えて</p>
              </div>
              <ul className="mt-6 flex flex-col gap-3.5">
                {premiumItems.map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <CheckIcon />
                    <span className="text-[15px] leading-relaxed text-charcoal/80">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {item.label}
                        {item.upcoming && (
                          <span className="inline-flex items-center rounded-full bg-grape/10 px-2 py-0.5 text-xs font-bold text-grape">
                            搭載予定
                          </span>
                        )}
                        {item.info && <InfoTooltip label="スポンサーコンテンツ" text={SPONSOR_TEXT} />}
                      </span>
                      {item.note && (
                        <span className="mt-1 block text-[13px] leading-relaxed text-charcoal/55">{item.note}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Comparison */}
        <Reveal className="mt-16">
          <h3 className="text-center text-xl font-bold text-charcoal">プラン比較表</h3>

          {/* Desktop table */}
          <div className="mt-8 hidden overflow-hidden rounded-3xl border border-grape/15 bg-white shadow-[0_8px_30px_-12px_rgba(124,77,166,0.15)] lg:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-lavender-pale/60">
                  <th className="w-1/3 px-6 py-4 text-sm font-bold text-charcoal">項目</th>
                  <th className="px-6 py-4 text-sm font-bold text-charcoal">基本プラン</th>
                  <th className="px-6 py-4 text-sm font-bold text-grape">プレミアム</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr key={row.item} className={i % 2 === 1 ? "bg-lavender-pale/20" : "bg-white"}>
                    <th scope="row" className="px-6 py-4 text-sm font-semibold text-charcoal/75">
                      {row.item}
                    </th>
                    <td className="px-6 py-4 text-sm text-charcoal/80">{row.basic}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-grape-deep">{row.premium}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="mt-8 flex flex-col gap-4 lg:hidden">
            {comparisonRows.map((row) => (
              <div
                key={row.item}
                className="rounded-2xl border border-grape/15 bg-white p-5 shadow-[0_6px_20px_-12px_rgba(124,77,166,0.2)]"
              >
                <p className="text-sm font-bold text-charcoal">{row.item}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-lavender-pale/40 p-3">
                    <p className="text-xs font-semibold text-charcoal/55">基本プラン</p>
                    <p className="mt-1 text-sm text-charcoal/85">{row.basic}</p>
                  </div>
                  <div className="rounded-xl bg-grape/10 p-3">
                    <p className="text-xs font-semibold text-grape">プレミアム</p>
                    <p className="mt-1 text-sm font-semibold text-grape-deep">{row.premium}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Notes */}
        <Reveal className="mx-auto mt-10 max-w-3xl">
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-charcoal/45">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
