'use client'

import React, { type RefObject } from "react"
import { motion, useInView, type Variant } from "framer-motion"
import { cn } from "@/lib/utils"

interface TimelineContentProps {
  children: React.ReactNode
  animationNum: number
  timelineRef: RefObject<HTMLElement | null>
  customVariants?: {
    visible: (i: number) => { y?: number; opacity?: number; filter?: string; transition?: Record<string, unknown> }
    hidden: { filter?: string; y?: number; opacity?: number }
  }
  className?: string
  as?: React.ElementType
  [key: string]: unknown
}

function TimelineContent({
  children,
  animationNum,
  timelineRef,
  customVariants,
  className,
  as: Component = "div",
}: TimelineContentProps) {
  const ref = timelineRef
    ? { current: timelineRef.current }
    : { current: null }

  const isInView = useInView(ref as RefObject<HTMLElement>, {
    once: true,
    amount: 0.1,
  })

  const defaultVariants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.4,
        duration: 0.5,
      },
    }),
    hidden: {
      filter: "blur(10px)",
      y: -20,
      opacity: 0,
    },
  }

  const variants = customVariants || defaultVariants

  return (
    <Component
      ref={ref}
      className={cn(className)}
    >
      <motion.div
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        custom={animationNum}
        variants={variants as Record<string, Variant | ((i: number) => Record<string, unknown>)>}
      >
        {children}
      </motion.div>
    </Component>
  )
}

export { TimelineContent }
