/**
 * PhilosophySection — "Method x Mind." Video is a placeholder asset (see
 * LandingPage.tsx VIDEO_SRC block comment) — swap for real Lyceum footage
 * before shipping to production.
 */
import { motion } from 'motion/react';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4';

export default function PhilosophySection() {
  return (
    <section className="relative bg-black py-28 md:py-40 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8 }}
          className="text-5xl md:text-7xl lg:text-8xl text-white tracking-tight mb-16 md:mb-24"
        >
          Method <em className="font-instrument italic text-white/40">x</em> Mind
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.8 }}
            className="rounded-3xl overflow-hidden aspect-[4/3]"
          >
            <video
              className="w-full h-full object-cover"
              src={VIDEO_SRC}
              muted
              autoPlay
              loop
              playsInline
              preload="auto"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.8 }}
            className="flex flex-col gap-8 justify-center"
          >
            <div>
              <p className="text-white/40 text-xs tracking-widest uppercase mb-4">The Discipline</p>
              <p className="text-white/70 text-base md:text-lg leading-relaxed">
                Every real breakthrough starts at the edge of what you don't yet understand.
                Our Socratic method holds you there — one precise question at a time — until
                you build the answer yourself, not borrow it.
              </p>
            </div>
            <div className="w-full h-px bg-white/10" />
            <div>
              <p className="text-white/40 text-xs tracking-widest uppercase mb-4">The Standard</p>
              <p className="text-white/70 text-base md:text-lg leading-relaxed">
                We accept only what can be derived, proven, or replicated. Rigor is not an
                obstacle to understanding — it is the only path that leads there.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
