/**
 * AboutSection — the landing page's mission statement, rebuilt in the
 * liquid-glass register (see index.css .liquid-glass) alongside the new
 * video hero. Kept purely typographic — no card, no icon — so the claim
 * carries the section on its own.
 */
import { motion } from 'motion/react';

export default function AboutSection() {
  return (
    <section className="relative bg-black pt-32 md:pt-44 pb-10 md:pb-14 px-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />
      <div className="relative max-w-5xl mx-auto">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="text-white/40 text-sm tracking-widest uppercase mb-6"
        >
          About The Lyceum
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-4xl md:text-6xl lg:text-7xl text-white leading-[1.1] tracking-tight"
        >
          Questioning then{' '}
          <em className="font-instrument italic text-white/60">everything</em> for
          <br className="hidden md:block" />
          {' '}minds that{' '}
          <em className="font-instrument italic text-white/60">derive</em>,{' '}
          <em className="font-instrument italic text-white/60">prove</em>, and{' '}
          <em className="font-instrument italic text-white/60">remember</em>.
        </motion.h2>
      </div>
    </section>
  );
}
