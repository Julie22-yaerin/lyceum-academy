/**
 * TermsModal — shown once per account, the very first time a user enters the
 * workspace. Blocks until "I agree" is clicked. Never shown again afterwards
 * (localStorage 'lyceum_terms_accepted').
 */
export default function TermsModal({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="glass-strong rounded-2xl p-8 max-w-lg w-full flex flex-col gap-5"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div>
          <h2 className="font-serif text-white text-xl font-semibold mb-1">Terms of Use</h2>
          <p className="text-white/40 text-xs font-sans uppercase tracking-[2px]">Please read before you begin</p>
        </div>

        <div className="max-h-64 overflow-y-auto pr-2 flex flex-col gap-3 font-sans text-sm text-white/70 leading-relaxed">
          <p>
            Lyceum uses several AI models (Gemini, Groq, NVIDIA, OpenRouter, Ollama...) to support your studies:
            Socratic dialogue, grading your work, generating knowledge maps, and the ARI voice assistant.
          </p>
          <p>
            Content you upload (notes, assignments, images, voice recordings) may be sent to the AI providers
            listed above for processing. Don't upload sensitive personal information or material you don't have
            the right to share.
          </p>
          <p>
            ARI (the voice assistant) may listen in the background while your mic is on to help you instantly —
            you can mute the mic or pause it at any time using the buttons next to the ARI icon.
          </p>
          <p>
            Study data (notes, mistakes, progress) is stored in your browser to personalize your experience.
            Lyceum does not guarantee the absolute accuracy of AI-generated content — always double-check
            anything important.
          </p>
        </div>

        <button
          onClick={onAgree}
          className="glass-btn rounded-xl py-3 font-sans text-xs uppercase tracking-[2px] font-semibold"
        >
          I agree, continue
        </button>
      </div>
    </div>
  );
}
