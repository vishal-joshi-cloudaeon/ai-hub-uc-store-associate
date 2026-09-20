import { useEffect, useRef, useState } from 'react'

type ToastProps = {
  message: string
  /** How long the message stays on screen before it fades out. */
  durationMs?: number
  /** Fired once the fade-out has finished, so the owner can drop the toast. */
  onDone?: () => void
}

/** A single transient confirmation, bottom-centre. Purely informational —
 * nothing is clickable, so it never gets in the way of the composer. */
export default function Toast({ message, durationMs = 3000, onDone }: ToastProps) {
  const [visible, setVisible] = useState(false)

  // Held in a ref so an inline arrow from the parent doesn't restart the
  // timers on every render.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // Hidden on the first paint and shown on the next one, so the transition
    // actually runs instead of the toast simply appearing.
    const enter = window.setTimeout(() => setVisible(true), 10)
    const leave = window.setTimeout(() => setVisible(false), durationMs)
    const done = window.setTimeout(() => onDoneRef.current?.(), durationMs + 250)
    return () => {
      window.clearTimeout(enter)
      window.clearTimeout(leave)
      window.clearTimeout(done)
    }
  }, [durationMs])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div
        className={`flex items-center gap-2 rounded-card bg-text-primary px-4 py-2.5 text-sm text-white shadow-lg transition duration-200 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        <svg
          className="h-4 w-4 flex-shrink-0 text-brand-green"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {message}
      </div>
    </div>
  )
}
