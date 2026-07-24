/**
 * FeaturedVideoSection — full-bleed footage with a liquid-glass overlay
 * card. Video is a placeholder asset (see LandingPage.tsx VIDEO_SRC block
 * comment) — swap for real Lyceum footage before shipping to production.
 */
import { motion } from 'motion/react';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260402_054547_9875cfc5-155a-4229-8ec8-b7ba7125cbf8.mp4';

export default function FeaturedVideoSection() {
  return (
    <section className="relative bg-black pt-6 md:pt-10 pb-20 md:pb-32 px-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.9 }}
        className="relative max-w-6xl mx-auto rounded-3xl overflow-hidden aspect-video"
      >
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src={VIDEO_SRC}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
          <div className="liquid-glass rounded-2xl p-6 md:p-8 max-w-md">
            <p className="text-white/50 text-xs tracking-widest uppercase mb-3">Our Approach</p>
            <p className="text-white text-sm md:text-base leading-relaxed">
              We believe in the discipline of the unanswered question. Every session starts
              with what you don't yet understand, and ends only where you can prove it yourself.
            </p>
          </div>
          <motion.a
            href="#method"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium shrink-0"
          >
            See the Method
          </motion.a>
        </div>
      </motion.div>
    </section>
  );
}
