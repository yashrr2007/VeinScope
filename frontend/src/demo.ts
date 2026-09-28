import type { InputFrame } from './types'

function seededNoise(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function makeSyntheticFrames(): InputFrame[] {
  const width = 960
  const height = 540
  const count = 24
  const frames: InputFrame[] = []
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const t = frameIndex / (count - 1)
    const noise = seededNoise(1729 + frameIndex)
    const shade = ctx.createLinearGradient(0, 0, width, height)
    shade.addColorStop(0, '#e0e4df')
    shade.addColorStop(0.53, '#c9d0ca')
    shade.addColorStop(1, '#aeb8b1')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, width, height)

    // Subtle grain makes the generated texture look like a camera frame. It is synthetic.
    for (let i = 0; i < 3800; i += 1) {
      const v = noise() > 0.5 ? 255 : 0
      ctx.fillStyle = `rgba(${v},${v},${v},${0.018 + noise() * 0.025})`
      ctx.fillRect(noise() * width, noise() * height, 1.3, 1.3)
    }

    const pulse = Math.sin(t * Math.PI * 2) * 1.2
    const paths = [
      { points: [[72, 425], [230, 372], [342, 317], [455, 306], [602, 231], [850, 172]], base: 9, color: '#35403b' },
      { points: [[116, 92], [232, 149], [353, 212], [491, 237], [610, 320], [784, 389]], base: 6, color: '#46514b' },
      { points: [[407, 500], [453, 411], [489, 336], [540, 259], [582, 156], [635, 56]], base: 4, color: '#515b56' },
    ]
    paths.forEach((path, pathIndex) => {
      const [start, ...rest] = path.points
      ctx.beginPath()
      ctx.moveTo(start[0], start[1])
      for (let index = 0; index < rest.length; index += 1) {
        const current = rest[index]
        const next = rest[index + 1] || current
        const midX = (current[0] + next[0]) / 2
        const midY = (current[1] + next[1]) / 2
        ctx.quadraticCurveTo(current[0], current[1], midX, midY)
      }
      const widthChange = pathIndex === 0 ? pulse : (pathIndex === 1 ? -pulse * 0.45 : pulse * 0.2)
      ctx.strokeStyle = path.color
      ctx.lineWidth = path.base + widthChange
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(28, 37, 32, .17)'
      ctx.shadowBlur = 7
      ctx.stroke()
      ctx.shadowBlur = 0
      // Faint adjacent tributary, also synthetic and not physiologic data.
      if (pathIndex === 0) {
        ctx.beginPath()
        ctx.moveTo(333, 322)
        ctx.quadraticCurveTo(298, 264, 249, 242)
        ctx.strokeStyle = 'rgba(59, 69, 63, .55)'
        ctx.lineWidth = 3
        ctx.stroke()
      }
    })
    frames.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.9), time_s: frameIndex * 0.4 })
  }
  return frames
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'))
    reader.onerror = () => reject(new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}
