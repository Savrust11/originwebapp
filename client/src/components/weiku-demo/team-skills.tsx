import { Award } from "lucide-react"
import { Reveal } from "./reveal"
import { ScreenCarousel } from "./screen-carousel"

const skills = [
  "爆速おむつ替え",
  "ゲップの魔術師",
  "沐浴・バスタイム連携",
  "ギャン泣き鎮火リレー",
  "トイトレ・ナビゲート",
  "ねんねルーティン構築",
]

export function TeamSkills() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div>
          <h2 className="text-balance text-3xl font-black leading-tight tracking-tight text-charcoal sm:text-4xl">
            家族の経験が、
            <br />
            チームの力になる。
          </h2>
          <p className="mt-5 max-w-lg text-pretty leading-relaxed text-charcoal/70">
            赤ちゃんのお世話から、成長後の生活習慣まで。家族で協力した経験を、チーム育児スキルとして積み重ねます。
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {skills.map((s, i) => (
              <Reveal key={s} delay={i * 0.06}>
                <li className="flex items-center gap-3 rounded-2xl border border-lavender/70 bg-lavender-pale/50 p-3.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-grape text-white">
                    <Award className="size-4" />
                  </span>
                  <span className="text-sm font-bold text-charcoal/80">{s}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal className="mx-auto w-full max-w-[16rem]">
          <ScreenCarousel
            screens={[
              { src: "/weiku-demo/skills-lv1.png", alt: "チーム育児スキル Lv.1" },
              { src: "/weiku-demo/skills-lv2.png", alt: "チーム育児スキル Lv.2" },
            ]}
            interval={3800}
          />
        </Reveal>
      </div>
    </section>
  )
}
