'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import Image from 'next/image';

/**
 * Free, no-3D-asset stand-in for an interactive hero character: mouse-driven
 * parallax tilt + a continuous idle bob, so the cat visibly reacts and moves
 * instead of sitting as a flat static image.
 */
export function InteractiveCat({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { stiffness: 150, damping: 15 };
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [12, -12]), springConfig);
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-12, 12]), springConfig);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="w-full h-full [perspective:800px]"
    >
      <motion.div
        style={{ rotateX, rotateY }}
        animate={{ y: [0, -10, 0] }}
        transition={{ y: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
        whileHover={{ scale: 1.06 }}
        className="relative w-full h-full [transform-style:preserve-3d]"
      >
        <Image src={src} alt={alt} fill className="object-contain drop-shadow-2xl" priority />
      </motion.div>
    </div>
  );
}
