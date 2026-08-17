import "./weiku-demo.css"

import { SiteNav } from "@/components/weiku-demo/site-nav"
import { Hero } from "@/components/weiku-demo/hero"
import { CoreValue } from "@/components/weiku-demo/core-value"
import { AiPrediction } from "@/components/weiku-demo/ai-prediction"
import { QuickLog } from "@/components/weiku-demo/quick-log"
import { CryingRescue } from "@/components/weiku-demo/crying-rescue"
import { Handoff } from "@/components/weiku-demo/handoff"
import { InvisibleChildcare } from "@/components/weiku-demo/invisible-childcare"
import { GratitudeRewards } from "@/components/weiku-demo/gratitude-rewards"
import { TeamSkills } from "@/components/weiku-demo/team-skills"
import { HowItWorks } from "@/components/weiku-demo/how-it-works"
import { Testimonials } from "@/components/weiku-demo/testimonials"
import { StoryStats } from "@/components/weiku-demo/story-stats"
import { Comparison } from "@/components/weiku-demo/comparison"
import { Pricing } from "@/components/weiku-demo/pricing"
import { FinalCta } from "@/components/weiku-demo/final-cta"
import { SiteFooter } from "@/components/weiku-demo/site-footer"

/**
 * WeIkuDemoPage — self-contained We育 service demo.
 *
 * - Renders entirely on the front end (screen switching uses local React state,
 *   no backend, database, or auth).
 * - All styles live under the `.weiku-demo` wrapper via weiku-demo.css, so this
 *   component never overrides the host project's global CSS.
 * - All images are served from /weiku-demo/<filename>.
 */
export function WeIkuDemoPage() {
  return (
    <div className="weiku-demo">
      <main className="min-h-screen">
        <SiteNav />
        <Hero />
        <CoreValue />
        <AiPrediction />
        <QuickLog />
        <CryingRescue />
        <Handoff />
        <InvisibleChildcare />
        <GratitudeRewards />
        <TeamSkills />
        <HowItWorks />
        <Testimonials />
        <StoryStats />
        <Comparison />
        <Pricing />
        <FinalCta />
        <SiteFooter />
      </main>
    </div>
  )
}

export default WeIkuDemoPage
