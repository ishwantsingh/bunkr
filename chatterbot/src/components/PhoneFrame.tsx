import type { ReactNode } from 'react'

// iPhone 18 Pro logical resolution: 402 × 874 pt, in a 426 × 898 outer frame with a thin bezel.
// The frame scales with its height; inner sizes use cqw (1cqw = 1% of frame width).
export default function PhoneFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="@container aspect-[426/898] h-[90%] shrink-0">
      <div className="h-full w-full rounded-[14cqw] bg-neutral-900 p-[1.4cqw] shadow-xl">
        <div className="relative h-full w-full overflow-hidden rounded-[12.6cqw] bg-white">
          <div className="absolute top-[2.8cqw] left-1/2 z-50 h-[8cqw] w-[28cqw] -translate-x-1/2 rounded-full bg-black" />
          {children}
        </div>
      </div>
    </div>
  )
}
