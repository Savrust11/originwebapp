import { Baby, Milk, Sparkles, Moon } from "lucide-react"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"

const testimonials = [
  {
    title: "赤ちゃんが泣く理由を理解しやすくなりました",
    body: "次の授乳や睡眠までの時間が文字だけでなくグラフでも表示されるので、子どもの生活リズムを直感的に把握できます。なぜ泣いているのかを理解しやすくなり、その後の行動計画も立てやすくなりました。育児がしやすくなったと感じています。",
    attribute: "乳児を育てるご家族",
    icon: Milk,
  },
  {
    title: "日々の成長をまとめて振り返れます",
    body: "1歳頃までは手書きの育児ダイアリーを使っていました。We育なら、授乳・食事・睡眠に加えて、日々の遊びや園での出来事なども一緒に記録できます。子どもの成長をまとめて残し、後から見返しやすい点がとても良いと思います。",
    attribute: "1歳児を育てるご家族",
    icon: Baby,
  },
  {
    title: "分かりやすく、すぐに使えました",
    body: "分かりやすくて、使いやすいです。まだ生後間もないため、現在使用している機能は限られていますが、成長に合わせて少しずつ活用していきたいと思います。これからが楽しみです。",
    attribute: "新生児を育てるご家族",
    icon: Sparkles,
  },
  {
    title: "寝ぐずりだと分かり、対応しやすくなりました",
    body: "睡眠タイミングの予測がとても役立っています。赤ちゃんの機嫌が悪くなってきたときに「そろそろ眠いのかもしれない」と分かるため、落ち着いて対応しやすくなりました。",
    attribute: "乳児を育てるご家族",
    icon: Moon,
  },
]

export function Testimonials() {
  return (
    <section className="bg-lavender-pale/50 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Voices</Eyebrow>
          <h2 className="mt-5 text-balance text-3xl font-black tracking-tight text-charcoal sm:text-4xl">
            お客様の声
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-charcoal/65">
            We育を体験したご家族から、育児の変化について伺いました。
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {testimonials.map((t, i) => (
            <Reveal key={t.title} delay={i * 0.08} className="h-full">
              <figure className="relative flex h-full flex-col rounded-3xl border border-grape/15 bg-white p-7 shadow-[0_8px_30px_-12px_rgba(124,77,166,0.18)] lg:p-8">
                <span
                  aria-hidden="true"
                  className="font-serif text-6xl leading-none text-grape/20"
                >
                  &ldquo;
                </span>
                <figcaption className="-mt-3">
                  <h3 className="text-balance text-lg font-bold leading-snug text-grape-deep">{t.title}</h3>
                </figcaption>
                <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-charcoal/70">
                  {t.body}
                </blockquote>
                <div className="mt-6 flex items-center gap-3 border-t border-grape/10 pt-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lavender-pale text-grape">
                    <t.icon className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-charcoal/75">{t.attribute}</span>
                </div>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal className="mx-auto mt-10 max-w-3xl">
          <p className="text-center text-xs leading-relaxed text-charcoal/45">
            ※モニター利用者へのアンケート回答を、趣旨を変えない範囲で読みやすく編集しています。
          </p>
        </Reveal>
      </div>
    </section>
  )
}
