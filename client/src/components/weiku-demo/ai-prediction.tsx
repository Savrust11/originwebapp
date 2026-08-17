import { Heart, Clock, Moon, Info } from "lucide-react"
import { Reveal } from "./reveal"
import { Eyebrow } from "./eyebrow"
import { ScreenCarousel } from "./screen-carousel"

const predictCards = [
  { icon: Heart, title: "次の授乳", desc: "前回からの間隔をもとに、次の授乳の目安時刻を提案。", tone: "text-pink-soft", iconBg: "bg-pink-soft/15" },
  { icon: Clock, title: "起きている時間", desc: "月齢に合わせた活動時間を表示し、ぐずりの前にお知らせ。", tone: "text-blue-baby", iconBg: "bg-blue-baby/15" },
  { icon: Moon, title: "次のねんね予想", desc: "睡眠リズムから、次に眠くなりそうな時間帯を予測。", tone: "text-lavender", iconBg: "bg-lavender/25" },
]

export function AiPrediction() {
  return (
    <section id="features" className="wd-ai-section scroll-mt-24 bg-grape-deep py-20 text-white lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <Reveal className="order-2 mx-auto w-full max-w-[17rem] lg:order-1">
          <ScreenCarousel
            screens={[
              { src: "/weiku-demo/home-mama.png", alt: "担当中 ママのホーム画面（AI予測）" },
            ]}
            interval={3600}
          />
        </Reveal>

        <div className="order-1 lg:order-2">
          <Eyebrow tone="light" className="border border-white/25">
            AI PREDICTION
          </Eyebrow>
          <h2 className="mt-6 text-balance text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            赤ちゃんの&ldquo;次&rdquo;が、
            <br />
            見えてくる。
          </h2>
          <p className="mt-5 max-w-lg text-pretty leading-[1.8] text-white/95">
            We育のAIは、月齢と日々の記録から、次の授乳や睡眠のタイミングを予測します。育児の迷いを減らし、家族が先回りして準備できるようにします。
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {predictCards.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.1}>
                <div className="h-full rounded-[24px] border border-white/65 bg-[#FAF7FD] p-5 shadow-[0_12px_35px_rgba(35,16,54,0.16)]">
                  <span className={`inline-flex size-11 items-center justify-center rounded-full ${c.iconBg}`}>
                    <c.icon className={`size-6 ${c.tone}`} />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-[#4A1F68]">{c.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#4B4652]">{c.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="mt-7 flex items-start gap-2.5 rounded-2xl bg-white/10 p-4 text-xs leading-[1.8] text-white/90">
            <Info className="mt-0.5 size-4 shrink-0 text-yellow-soft" />
            AIによる予測は、保護者の判断をサポートするものです。医療的な診断や専門家への相談に代わるものではありません。
          </p>
        </div>
      </div>
    </section>
  )
}
