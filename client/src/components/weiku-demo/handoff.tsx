"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Crown, User } from "lucide-react"
import { Reveal } from "./reveal"
import { PhoneMockup } from "./phone-mockup"
import { cn } from "@/components/weiku-demo/cn"

const holders = [
  { key: "mama", label: "ママ", src: "/weiku-demo/home-mama.png", icon: Crown, tone: "bg-pink-soft/30 text-grape-deep" },
  { key: "papa", label: "パパ", src: "/weiku-demo/home-papa.png", icon: User, tone: "bg-blue-baby/40 text-grape-deep" },
]

export function Handoff() {
  const [i, setI] = useState(0)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setI((v) => (v + 1) % holders.length), 3600)
    return () => clearInterval(id)
  }, [reduce])

  const active = holders[i]

  return (
    <section id="team" className="scroll-mt-24 bg-lavender-pale py-20 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="order-2 lg:order-1">
          <h2 className="text-balance text-3xl font-black leading-tight tracking-tight text-charcoal sm:text-4xl">
            &ldquo;手伝って&rdquo;を、
            <br />
            具体的な交代へ。
          </h2>
          <p className="mt-5 max-w-lg text-pretty leading-relaxed text-charcoal/70">
            今、誰が赤ちゃんを担当しているのかを家族で共有。パートナーが同じ情報を見ながら、育児を引き継げます。
          </p>

          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-lavender bg-white p-1.5">
            {holders.map((h, idx) => (
              <button
                key={h.key}
                type="button"
                onClick={() => setI(idx)}
                aria-pressed={idx === i}
                className={cn(
                  "flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors",
                  idx === i ? h.tone : "text-charcoal/50 hover:text-charcoal/80",
                )}
              >
                <h.icon className="size-4" />
                担当中 {h.label}
              </button>
            ))}
          </div>

          <p className="mt-8 text-pretty text-base font-bold text-grape-deep">
            毎回一から説明しなくても、家族は同じ状況から動き出せる。
          </p>
        </div>

        <Reveal className="order-1 mx-auto w-full max-w-[16rem] lg:order-2">
          <PhoneMockup>
            <AnimatePresence mode="wait">
              <motion.img
                key={active.key}
                src={active.src}
                alt={`担当中 ${active.label}のホーム画面`}
                initial={{ opacity: 0, x: reduce ? 0 : 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduce ? 0 : -30 }}
                transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="h-full w-full object-cover object-top"
              />
            </AnimatePresence>
          </PhoneMockup>
        </Reveal>
      </div>
    </section>
  )
}
