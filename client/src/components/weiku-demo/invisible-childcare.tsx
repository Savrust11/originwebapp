import { Shirt, Milk, ShoppingCart, Utensils, Trash2 } from "lucide-react"
import { Reveal } from "./reveal"
import { ScreenCarousel } from "./screen-carousel"

const chores = [
  { icon: Shirt, label: "洗濯" },
  { icon: Milk, label: "哺乳瓶洗い" },
  { icon: ShoppingCart, label: "買い物" },
  { icon: Utensils, label: "食事の準備" },
  { icon: Trash2, label: "ゴミ出し" },
]

export function InvisibleChildcare() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-balance text-3xl font-black leading-tight tracking-tight text-charcoal sm:text-4xl">
              見えない育児を、
              <br />
              見えるように。
            </h2>
            <p className="mt-5 max-w-lg text-pretty leading-relaxed text-charcoal/70">
              子育ては、授乳やおむつ替えだけではありません。洗濯、哺乳瓶洗い、買い物、食事の準備、ゴミ出し。これまで見落とされてきた仕事も、We育なら記録できます。
            </p>

            <div className="mt-7 flex flex-wrap gap-2.5">
              {chores.map((c, i) => (
                <Reveal
                  key={c.label}
                  delay={i * 0.06}
                  className="flex items-center gap-2 rounded-full border border-lavender/70 bg-lavender-pale/60 px-4 py-2"
                >
                  <c.icon className="size-4 text-grape" />
                  <span className="text-sm font-medium text-charcoal/80">{c.label}</span>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.2}>
              <p className="mt-9 text-balance text-2xl font-black text-grape-deep sm:text-3xl">
                比べるためではなく、気づくために。
              </p>
              <p className="mt-3 text-sm leading-relaxed text-charcoal/60">
                負担の可視化が、お互いの理解と感謝につながります。
              </p>
            </Reveal>
          </div>

          <Reveal className="mx-auto w-full max-w-[15rem]">
            <ScreenCarousel
              screens={[
                { src: "/weiku-demo/invisible.png", alt: "名もなき育児の入力画面" },
                { src: "/weiku-demo/dashboard.png", alt: "貢献度ダッシュボード" },
              ]}
              interval={3600}
            />
          </Reveal>
        </div>
      </div>
    </section>
  )
}
