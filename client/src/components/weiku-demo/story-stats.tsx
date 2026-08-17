"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"

type Stat = { value: number; suffix: string; label: string }

const stats: Stat[] = [
  { value: 6000, suffix: "組以上", label: "利用した家族" },
  { value: 200, suffix: "人", label: "モニター利用者" },
  { value: 200, suffix: "回以上", label: "改善・アップデート" },
]

function Counter({ target, suffix }: { target: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setN(target)
      return
    }
    const duration = 1400
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, target, reduce])

  return (
    <span ref={ref} className="tabular-nums">
      {n.toLocaleString("ja-JP")}
      <span className="text-2xl sm:text-3xl">{suffix}</span>
    </span>
  )
}

export function StoryStats() {
  return (
    <section id="story" className="scroll-mt-24 bg-grape-deep py-20 text-white lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-black tracking-tight text-white sm:text-4xl">
            産後ケアの現場から生まれました。
          </h2>
          <p className="mt-5 text-pretty leading-relaxed text-white/80">
            We育は、日本最大級の産前産後ケアホテルネットワーク「ぶどうの木」で、数多くの家族と向き合ってきた経験から生まれました。
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-3xl border border-white/15 bg-white/10 p-8 text-center backdrop-blur-sm"
            >
              <div className="text-4xl font-black text-mint sm:text-5xl">
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <p className="mt-3 text-sm font-medium text-white/75">{s.label}</p>
            </motion.div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-white/60">
          現場の専門性。家族の声。AIによる継続的な進化。
        </p>
      </div>
    </section>
  )
}
