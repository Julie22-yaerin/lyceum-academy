'use client'

import { useEffect, useRef, useCallback } from 'react'

export function MetalLiquidCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -100, y: -100 })
  const trailRef = useRef<{ x: number; y: number; age: number }[]>([])
  const rafRef = useRef<number>(0)

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    resize()
    window.addEventListener('resize', resize)

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
      trailRef.current.push({ x: e.clientX, y: e.clientY, age: 0 })
      if (trailRef.current.length > 18) trailRef.current.shift()
    }
    window.addEventListener('mousemove', onMouseMove)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const { x: mx, y: my } = mouseRef.current

      // Update trail ages
      for (const p of trailRef.current) p.age += 1
      trailRef.current = trailRef.current.filter((p) => p.age < 20)

      // Draw liquid trail blobs
      for (let i = 0; i < trailRef.current.length; i++) {
        const p = trailRef.current[i]
        const life = 1 - p.age / 20
        const radius = 8 + life * 14

        // Outer glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2)
        grd.addColorStop(0, `rgba(180, 210, 230, ${life * 0.15})`)
        grd.addColorStop(0.5, `rgba(120, 170, 200, ${life * 0.08})`)
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius * 2, 0, Math.PI * 2)
        ctx.fill()

        // Metal core blob
        const coreGrd = ctx.createRadialGradient(
          p.x - radius * 0.2, p.y - radius * 0.2, 0,
          p.x, p.y, radius
        )
        coreGrd.addColorStop(0, `rgba(230, 240, 255, ${life * 0.9})`)
        coreGrd.addColorStop(0.3, `rgba(160, 195, 220, ${life * 0.7})`)
        coreGrd.addColorStop(0.7, `rgba(100, 140, 170, ${life * 0.4})`)
        coreGrd.addColorStop(1, `rgba(40, 60, 80, ${life * 0.1})`)
        ctx.fillStyle = coreGrd
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // Draw main cursor orb
      const orbRadius = 14
      // Outer liquid shell
      const shellGrd = ctx.createRadialGradient(
        mx - 3, my - 3, 0,
        mx, my, orbRadius * 2.5
      )
      shellGrd.addColorStop(0, 'rgba(210, 230, 255, 0.25)')
      shellGrd.addColorStop(0.4, 'rgba(140, 180, 210, 0.12)')
      shellGrd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = shellGrd
      ctx.beginPath()
      ctx.arc(mx, my, orbRadius * 2.5, 0, Math.PI * 2)
      ctx.fill()

      // Main metal orb
      const mainGrd = ctx.createRadialGradient(
        mx - orbRadius * 0.3, my - orbRadius * 0.3, 0,
        mx, my, orbRadius
      )
      mainGrd.addColorStop(0, '#e8f0ff')
      mainGrd.addColorStop(0.25, '#b0ccdf')
      mainGrd.addColorStop(0.55, '#6a9ab8')
      mainGrd.addColorStop(0.8, '#3a6a88')
      mainGrd.addColorStop(1, '#1a3a50')
      ctx.fillStyle = mainGrd
      ctx.beginPath()
      ctx.arc(mx, my, orbRadius, 0, Math.PI * 2)
      ctx.fill()

      // Specular highlight
      const specGrd = ctx.createRadialGradient(
        mx - orbRadius * 0.35, my - orbRadius * 0.35, 0,
        mx - orbRadius * 0.2, my - orbRadius * 0.2, orbRadius * 0.6
      )
      specGrd.addColorStop(0, 'rgba(255,255,255,0.85)')
      specGrd.addColorStop(0.5, 'rgba(255,255,255,0.2)')
      specGrd.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = specGrd
      ctx.beginPath()
      ctx.arc(mx - orbRadius * 0.25, my - orbRadius * 0.25, orbRadius * 0.5, 0, Math.PI * 2)
      ctx.fill()

      // Inner dark pupil
      const pupilGrd = ctx.createRadialGradient(mx, my, 0, mx, my, orbRadius * 0.3)
      pupilGrd.addColorStop(0, 'rgba(10, 20, 40, 0.9)')
      pupilGrd.addColorStop(1, 'rgba(20, 40, 60, 0)')
      ctx.fillStyle = pupilGrd
      ctx.beginPath()
      ctx.arc(mx, my, orbRadius * 0.3, 0, Math.PI * 2)
      ctx.fill()

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [resize])

  return (
    <>
      {/* Hide default cursor globally */}
      <style>{`
        *, *::before, *::after { cursor: none !important; }
      `}</style>
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[9999]"
        style={{ mixBlendMode: 'screen' }}
      />
    </>
  )
}
