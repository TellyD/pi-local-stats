import { useEffect, useRef, useState } from "react"

import { useI18n } from "@/lib/i18n"
import { scrollTraceMarkIntoView, type TraceScale } from "@/lib/session-trace"

export function TraceOffscreenActivity({ scale }: { scale: TraceScale }) {
  const { messages: t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [targets, setTargets] = useState<{
    left: HTMLElement | null
    right: HTMLElement | null
  }>({ left: null, right: null })

  useEffect(() => {
    const label = ref.current?.parentElement
    const track = label?.nextElementSibling
    const viewport = label?.closest<HTMLElement>("[data-trace-viewport]")
    if (!label || !track || !viewport) return
    const update = () => {
      const left = label.getBoundingClientRect().right
      const right = viewport.getBoundingClientRect().left + viewport.clientWidth
      let before: HTMLElement | null = null
      let after: HTMLElement | null = null
      let nearestLeft = -Infinity
      let nearestRight = Infinity
      if (viewport.clientWidth > label.clientWidth) {
        for (const mark of track.querySelectorAll<HTMLElement>(
          "[data-trace-mark]"
        )) {
          const rect = mark.getBoundingClientRect()
          if (rect.right <= left && rect.right > nearestLeft) {
            before = mark
            nearestLeft = rect.right
          }
          if (rect.left >= right && rect.left < nearestRight) {
            after = mark
            nearestRight = rect.left
          }
        }
      }
      setTargets((current) =>
        current.left === before && current.right === after
          ? current
          : { left: before, right: after }
      )
    }
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    observer.observe(track)
    viewport.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", update)
    }
  }, [scale])

  return (
    <div ref={ref} className="flex flex-wrap gap-x-2 empty:hidden">
      {(["left", "right"] as const).map((direction) => {
        const target = targets[direction]
        if (!target) return null
        const label =
          direction === "left" ? t.traceActivityLeft : t.traceActivityRight
        return (
          <button
            key={direction}
            type="button"
            title={label}
            className="cursor-pointer text-left text-[0.625rem] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              const viewport = target.closest<HTMLElement>(
                "[data-trace-viewport]"
              )
              if (!viewport) return
              scrollTraceMarkIntoView(viewport, target)
              target.focus({ preventScroll: true })
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
