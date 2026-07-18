'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus } from 'lucide-react'

interface DraggableFabProps {
  onAction?: () => void
  icon?: React.ReactNode
  label?: string
}

export function DraggableFab({ onAction, icon, label }: DraggableFabProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [initialized, setInitialized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean }>({
    startX: 0, startY: 0, origX: 0, origY: 0, moved: false,
  })
  const fabRef = useRef<HTMLDivElement>(null)

  // Initialize position to bottom-right corner
  useEffect(() => {
    if (!initialized) {
      setPos({ x: window.innerWidth - 80, y: window.innerHeight - 80 })
      setInitialized(true)
    }
  }, [initialized])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    }
    setIsDragging(false)
  }, [pos.x, pos.y])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true
    }
    setIsDragging(dragRef.current.moved)
    if (dragRef.current.moved) {
      const nx = Math.max(0, Math.min(window.innerWidth - 56, dragRef.current.origX + dx))
      const ny = Math.max(0, Math.min(window.innerHeight - 56, dragRef.current.origY + dy))
      setPos({ x: nx, y: ny })
    }
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (!dragRef.current.moved) {
      onAction?.()
    }
    setTimeout(() => setIsDragging(false), 50)
  }, [onAction])

  return (
    <div
      ref={fabRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[9998] select-none touch-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: 48,
        height: 48,
        transition: isDragging ? 'none' : 'transform 0.15s ease',
      }}
    >
      <div
        className="flex h-full w-full items-center justify-center rounded-full"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.9), rgba(6,95,70,0.95))',
          boxShadow: '0 0 20px rgba(16,185,129,0.4), 0 4px 15px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.2)',
          border: '1.5px solid rgba(16,185,129,0.5)',
          backdropFilter: 'blur(12px)',
          transform: isDragging ? 'scale(1.15)' : 'scale(1)',
        }}
      >
        {icon ?? (
          <Plus className="h-5 w-5 text-white" strokeWidth={2.5} />
        )}
      </div>
      {label && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-[10px] text-zinc-300 backdrop-blur-sm"
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </div>
      )}
    </div>
  )
}
