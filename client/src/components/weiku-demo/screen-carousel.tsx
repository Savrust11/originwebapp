"use client"

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { PhoneMockup } from "./phone-mockup"
import { cn } from "@/components/weiku-demo/cn"

export type Screen = {
  src: string
  alt: string
  caption?: string
}

type ScreenCarouselProps = {
  screens: Screen[]
  interval?: number
  className?: string
  phoneClassName?: string
  /** show the animated caption line under the phone */
  showCaption?: boolean
  controls?: boolean
}

export function ScreenCarousel({
  screens,
  interval = 3800,
  className,
  phoneClassName,
  showCaption = false,
  controls = true,
}: ScreenCarouselProps) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [paused, setPaused] = useState(false)
  const reduce = useReducedMotion()

  const go = useCallback(
    (dir: number) => {
      setDirection(dir)
      setIndex((prev) => (prev + dir + screens.length) % screens.length)
    },
    [screens.length],
  )

  useEffect(() => {
    if (paused || reduce || screens.length <= 1) return
    const id = setInterval(() => go(1), interval)
    return () => clearInterval(id)
  }, [paused, reduce, interval, go, screens.length])

  const current = screens[index]

  const variants = {
    enter: (dir: number) => ({
      opacity: 0,
      x: reduce ? 0 : dir * 48,
      scale: reduce ? 1 : 1.04,
    }),
    center: { opacity: 1, x: 0, scale: 1 },
    exit: (dir: number) => ({
      opacity: 0,
      x: reduce ? 0 : dir * -48,
      scale: reduce ? 1 : 0.98,
    }),
  }

  return (
    <div className={cn("flex flex-col items-center gap-6", className)}>
      <div
        className="relative w-full"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <PhoneMockup className={phoneClassName}>
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={index}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
              drag={screens.length > 1 ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_, info) => {
                if (info.offset.x < -60) go(1)
                else if (info.offset.x > 60) go(-1)
              }}
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.src || "/placeholder.svg"}
                alt={current.alt}
                className="h-full w-full select-none object-cover object-top"
                draggable={false}
              />
            </motion.div>
          </AnimatePresence>
        </PhoneMockup>

        {controls && screens.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="前の画面へ"
              className="absolute -left-3 top-1/2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-lavender bg-white/90 text-grape shadow-lg backdrop-blur transition hover:bg-white hover:text-grape-deep sm:-left-5"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="次の画面へ"
              className="absolute -right-3 top-1/2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-lavender bg-white/90 text-grape shadow-lg backdrop-blur transition hover:bg-white hover:text-grape-deep sm:-right-5"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>

      {showCaption && current.caption && (
        <div className="min-h-[1.75rem]">
          <AnimatePresence mode="wait">
            <motion.p
              key={current.caption}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -6 }}
              transition={{ duration: 0.4 }}
              className="text-center text-base font-medium text-grape-deep"
            >
              {current.caption}
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      {screens.length > 1 && (
        <div className="flex items-center gap-2" role="tablist" aria-label="アプリ画面の切り替え">
          {screens.map((s, i) => (
            <button
              key={s.src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}番目の画面`}
              onClick={() => {
                setDirection(i > index ? 1 : -1)
                setIndex(i)
              }}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index ? "w-7 bg-grape" : "w-2 bg-lavender hover:bg-grape-light",
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
