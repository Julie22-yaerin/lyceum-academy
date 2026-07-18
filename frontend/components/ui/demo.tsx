'use client'

import { Card } from "@/components/ui/card";
import { Spotlight } from "@/components/ui/spotlight";
import { InteractiveCat } from "@/components/ui/interactive-cat";

export function SplineSceneBasic() {
  return (
    <Card className="w-full h-[500px] bg-black/[0.96] relative overflow-hidden">
      <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" />

      <div className="flex h-full">
        {/* Left content */}
        <div className="flex-1 p-8 relative z-10 flex flex-col justify-center">
          <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400">
            Interactive 3D
          </h1>
          <p className="mt-4 text-neutral-300 max-w-lg">
            Bring your UI to life with beautiful 3D scenes. Create immersive experiences
            that capture attention and enhance your design.
          </p>
        </div>

        {/* Right content - interactive cat (mouse-tilt + idle bob) standing in
            for a full 3D scene until a real rigged model is generated */}
        <div className="flex-1 relative">
          <InteractiveCat src="/chibi_cat_closeup_portrait.webp" alt="Chibi cat portrait" />
        </div>
      </div>
    </Card>
  );
}
