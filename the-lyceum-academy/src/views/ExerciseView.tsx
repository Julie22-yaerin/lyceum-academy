import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

export default function ExerciseView() {
  const symbols = [
    'α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ',
    'ν','ξ','ο','π','ρ','σ','τ','υ','φ','χ','ψ','ω',
    'Δ','Ω','Σ','Π','√','∫','∂','∇','∞','≈','≠','≤',
    '≥','±','×','÷','∈','∉','⊂','⊃','∪','∩','∧','∨',
    '¬','∀','∃','⇒','⇔','∝','∠','⊥','∥','≡','≅','≃'
  ];
  
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] py-12 px-4 relative overflow-hidden bg-surface">
      <div className="absolute left-0 bottom-0 opacity-[0.03] pointer-events-none select-none hidden lg:block transform -translate-x-1/4 grayscale">
        <img className="w-[600px]" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8y6w93hY05oH-ZzjgyizzN7Ixj_rftc99NXm_ThToG-FDPyniX535eekvTgFipT0ra_UDOGPgqQXg8k7-nHspE3BS_X3PdPgEBlgXQlzQXDYh8YHfG7-Pj0ujgAbjQD5sURwa8VheJ5leVTAJhl87m9M6j8rv17QXo9GisUgovInIcJVvtCnVWGT60mo2Q5lLgdD3cwXPy55KvUIFahrlq5fG3KipbGQFjr08PJWr1umGbODetmXSvlJW1doNY1lxXS0zHPckTGzF" alt="Bust" />
      </div>
      
      <div className="w-full max-w-3xl bg-surface border border-outline/10 shadow-sm flex flex-col z-10 p-10">
        
        <div className="flex justify-between items-start border-b border-outline/10 pb-6 mb-10">
          <div className="flex flex-col gap-2">
            <span className="font-sans text-[10px] font-semibold text-on-surface opacity-50 tracking-[2px] uppercase">Question 04</span>
            <h2 className="font-serif text-2xl text-on-surface">The Geometry of Ethics</h2>
          </div>
          <div className="px-4 py-2 bg-surface-container-highest text-on-surface text-[10px] uppercase tracking-[1px]">
            Moral Philosophy
          </div>
        </div>
        
        <div className="space-y-10 mb-12">
          <div className="font-serif text-2xl leading-relaxed text-on-surface italic">
            "If the sum of internal angles in a triangle is constant, can we argue that the definition of <strong>Virtue</strong> must likewise remain invariant across cultural contexts?"
          </div>
          <div className="font-sans text-sm text-on-surface opacity-80 leading-loose border-l border-on-surface/30 pl-6 py-2">
            Consider the Pythagorean perspective on harmony and proportion. If A + B + C = 180°, then the truth is structural, not subjective. Does Justice possess a similar structural necessity?
          </div>
        </div>
        
        <div className="space-y-8">
          <div className="relative">
            <label className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 mb-4 block">Your Discourse</label>
            <textarea className="w-full bg-transparent border-t-0 border-x-0 border-b border-outline/30 p-0 font-sans text-sm text-on-surface placeholder:text-on-surface/30 focus:border-on-surface transition-colors resize-none outline-none py-2" placeholder="Begin your inquiry here..." rows={3}></textarea>
            
            <div className="mt-8 p-6 bg-surface border border-outline/10">
              <div className="flex justify-between items-center mb-4">
                <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Scholarly Symbols</span>
                <span className="material-symbols-outlined text-on-surface opacity-50 cursor-pointer hover:opacity-100 transition-opacity text-[18px]">keyboard_command_key</span>
              </div>
              <div className="grid grid-cols-12 gap-[1px] bg-outline/10 border border-outline/10">
                {symbols.map((sym, i) => (
                  <button key={i} className="h-10 w-full flex items-center justify-center bg-surface font-serif text-base text-on-surface hover:bg-on-surface hover:text-surface transition-colors">{sym}</button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 pt-6">
            <LiquidMetalButton
              label="Submit Response"
              fullWidth
            />
            <button className="flex-1 border border-on-surface/30 text-on-surface font-sans text-[10px] font-semibold py-4 px-8 uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors flex items-center justify-center gap-3">
              <span className="material-symbols-outlined text-[16px]">psychology</span>
              Request Hint
            </button>
          </div>
        </div>
        
        <div className="mt-12 pt-6 border-t border-outline/10 flex justify-center items-center gap-8">
          <div className="flex gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface/20"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-on-surface/20"></div>
          </div>
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">4 of 12</span>
        </div>
      </div>
    </div>
  );
}
