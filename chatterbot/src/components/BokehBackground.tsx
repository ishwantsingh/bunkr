import { grain } from '../grain'

// Out-of-focus city lights at dusk: sky gradient, blurred skyline, bokeh, film grain.

// [left %, top %, size vh, color, blur px]
const bokeh: [number, number, number, string, number][] = [
  [1, 56, 9, '#ffb15c', 3],
  [3, 63, 8, '#ffd2b0', 4],
  [6, 51, 7, '#2f7dff', 4],
  [9, 52, 10, '#ffb860', 2],
  [10, 59, 8, '#c0399a', 4],
  [14, 60, 9, '#e8336b', 3],
  [16, 47, 8, '#1fc49c', 3],
  [17, 64, 7, '#9b4dff', 5],
  [21, 56, 8, '#ff8a3d', 3],
  [24, 62, 10, '#2a63d9', 6],
  [27, 43, 7, '#2c86ff', 3],
  [29, 59, 8, '#ff7a3a', 3],
  [33, 65, 6, '#1c8cff', 5],
  [36, 52, 7, '#ffc27a', 4],
  [40, 58, 9, '#d43f8c', 5],
  [44, 48, 6, '#3fd6b0', 4],
  [47, 63, 8, '#ff9e57', 4],
  [51, 55, 7, '#2f7dff', 5],
  [55, 61, 9, '#ff5f8f', 4],
  [58, 50, 6, '#ffcc88', 4],
  [62, 57, 9, '#16b8a8', 3],
  [65, 52, 8, '#2b8cff', 3],
  [67, 63, 7, '#2370e8', 5],
  [71, 53, 9, '#ff3b7a', 3],
  [74, 59, 9, '#ffcfa0', 3],
  [77, 54, 8, '#ff4a6e', 3],
  [79, 66, 8, '#1f7bff', 5],
  [82, 49, 7, '#2c86ff', 4],
  [84, 55, 8, '#a35cff', 3],
  [86, 63, 7, '#22e05a', 2],
  [88, 54, 9, '#ff7a4d', 3],
  [92, 58, 9, '#ffad6b', 3],
  [96, 49, 8, '#ff3d66', 3],
]

// Blurred skyline silhouettes: [left %, top %, width %, height %]
const buildings: [number, number, number, number][] = [
  [0, 58, 6, 42],
  [8, 62, 5, 38],
  [27, 55, 4, 45],
  [38, 64, 7, 36],
  [55, 60, 5, 40],
  [70, 66, 9, 34],
  [83, 57, 4, 43],
  [93, 63, 7, 37],
]


export default function BokehBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Sky: bright dusk blue fading to deep blue, then dark ground */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#2f86c8_0%,#5fa3d6_14%,#3f86bf_24%,#1d5f95_36%,#134a78_46%,#103c63_58%,#132a3d_72%,#1d1e20_84%,#1c1c1e_100%)]" />

      {/* Hazy horizon glow */}
      <div className="absolute top-[18%] left-0 h-[22%] w-full bg-[#7fb6de]/30 blur-3xl" />

      {/* Skyline silhouettes */}
      {buildings.map(([left, top, width, height]) => (
        <div
          key={`b-${left}`}
          className="absolute bg-[#0d2236]/70 blur-2xl"
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
        />
      ))}

      {/* Bokeh lights */}
      {bokeh.map(([left, top, size, color, blur]) => (
        <div
          key={`${left}-${top}`}
          className="absolute rounded-full mix-blend-screen"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${size}vh`,
            height: `${size}vh`,
            background: `radial-gradient(circle, ${color} 0%, ${color} 60%, ${color}cc 100%)`,
            filter: `blur(${blur}px)`,
            opacity: 0.85,
          }}
        />
      ))}

      {/* Soft reflections below the lights */}
      <div className="absolute top-[68%] left-0 h-[14%] w-full bg-linear-to-b from-[#1a3a5c]/40 to-transparent blur-2xl" />

      {/* Film grain */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{ backgroundImage: grain }}
      />
    </div>
  )
}
