"use client"

import { motion, useReducedMotion } from "framer-motion"
import { Sparkles } from "lucide-react"
import { Eyebrow } from "./eyebrow"
import { ScreenCarousel } from "./screen-carousel"
import { tourScreens } from "./screens-data"
import { StoreBadges } from "./store-badges"

const floatingLabels = [
  { text: "AI予測", className: "left-0 top-16 bg-white text-grape", delay: 0.2 },
  { text: "育児を共有", className: "right-0 top-40 bg-grape text-white", delay: 0.4 },
  { text: "頑張りを見える化", className: "left-2 bottom-24 bg-mint text-grape-deep", delay: 0.6 },
]

export function Hero() {
  const reduce = useReducedMotion()
  return (
    <section id="top" className="relative overflow-hidden bg-lavender-pale pt-28 lg:pt-36">
      {/* soft background blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-10 size-96 rounded-full bg-grape-light/25 blur-3xl" />
        <div className="absolute -right-16 top-40 size-80 rounded-full bg-mint/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 size-72 rounded-full bg-pink-soft/25 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 lg:grid-cols-2 lg:items-start lg:gap-8 lg:px-8 lg:pb-20">
        {/* left */}
        <div className="max-w-xl">
          <Eyebrow>
            <Sparkles className="size-3.5" />
            AI × チーム育児
          </Eyebrow>

          <h1 className="mt-6 text-pretty text-4xl font-black leading-[1.15] tracking-tight text-charcoal sm:text-5xl lg:text-[3.4rem]">
            子育ては、
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-grape-deep via-grape to-mint bg-clip-text text-transparent">
              チーム
            </span>
            でもっとよくなる。
          </h1>

          <p className="mt-6 text-pretty text-base leading-relaxed text-charcoal/70 sm:text-lg">
            We育は、赤ちゃんの次の授乳・睡眠タイミングをAIで予測し、日々の育児を家族で共有。これまで見えなかった頑張りを、行動・感謝・休息につなげるチーム育児アプリです。
          </p>

          <div className="mt-8">
            <StoreBadges />
          </div>
          <div className="mt-5">
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-full px-2 py-2 text-sm font-bold text-grape underline decoration-grape/30 underline-offset-4 transition-colors hover:text-grape-deep hover:decoration-grape"
            >
              機能を見る
            </a>
          </div>

          <p className="mt-8 flex items-center gap-2 text-sm text-charcoal/55">
            <span className="inline-block size-1.5 rounded-full bg-mint" />
            日本最大級の産前産後ケアホテルネットワーク「ぶどうの木」から誕生。
          </p>
        </div>

        {/* right: phone carousel with floating labels */}
        <div className="relative mx-auto w-full max-w-[19rem] sm:max-w-sm lg:max-w-[18rem]">
          {/* stacked ghost phones for depth */}
          <div
            aria-hidden
            className="absolute -right-6 top-8 hidden aspect-[9/19.5] w-[80%] rounded-[2.75rem] bg-grape-light/20 blur-[2px] sm:block"
          />
          <div
            aria-hidden
            className="absolute -left-8 top-12 hidden aspect-[9/19.5] w-[80%] rounded-[2.75rem] bg-white/60 sm:block"
          />

          <div className="relative">
            <ScreenCarousel screens={tourScreens} showCaption />
            {floatingLabels.map((l) => (
              <motion.span
                key={l.text}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.8, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.5, delay: reduce ? 0 : l.delay }}
                className={`pointer-events-none absolute z-40 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg ${l.className}`}
              >
                {l.text}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
