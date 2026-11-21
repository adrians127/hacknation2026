import { FeatureStrip } from "@/features/landing/components/feature-strip";
import { Hero } from "@/features/landing/components/hero";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { WaveBackground } from "@/features/landing/components/wave-background";

export function LandingRoute() {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden text-white">
      <WaveBackground />
      <LandingHeader signInHref="/login" ctaHref="/app" />
      <main className="relative z-10 flex flex-1 flex-col justify-center gap-14 py-10">
        <Hero ctaHref="/app" />
        <FeatureStrip />
      </main>
    </div>
  );
}
