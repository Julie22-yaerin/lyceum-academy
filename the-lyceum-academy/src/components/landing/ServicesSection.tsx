/**
 * ServicesSection — "What we teach." Card videos are placeholder assets
 * (see LandingPage.tsx VIDEO_SRC block comment) — swap for real Lyceum
 * footage before shipping to production.
 */
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';

const CARDS = [
  {
    video: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4',
    tag: 'Method',
    title: 'The Socratic Method',
    description: 'Every question returns a question. Faculty personas — Socrat, Coach, Leo, The Peer, The Grader — never hand over an answer; they narrow the gap until you close it yourself.',
  },
  {
    video: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4',
    tag: 'Curriculum',
    title: 'Math & Science, Nothing Else',
    description: 'Grade 10 through first-year university. IGCSE, GCSE, A-Level, IB and AP mapped into one Second Brain. No filler subjects, no shortcuts.',
  },
];

export default function ServicesSection() {
  return (
    <section className="relative bg-black py-28 md:py-40 px-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.02)_0%,_transparent_60%)]" />
      <div className="relative max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7 }}
          className="flex items-end justify-between mb-12"
        >
          <h2 className="text-3xl md:text-5xl text-white tracking-tight">What we teach</h2>
          <p className="hidden md:block text-white/40 text-sm">Our approach</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.8, delay: i * 0.15 }}
              className="liquid-glass rounded-3xl overflow-hidden group"
            >
              <div className="relative aspect-video overflow-hidden">
                <video
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  src={card.video}
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="auto"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </div>
              <div className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white/40 text-xs tracking-widest uppercase">{card.tag}</span>
                  <span className="liquid-glass rounded-full p-2">
                    <ArrowUpRight className="w-4 h-4 text-white" />
                  </span>
                </div>
                <h3 className="text-white text-xl md:text-2xl mb-3 tracking-tight">{card.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{card.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
