import type { Metadata } from "next";

import { HowItWorks } from "@/components/story/how-it-works";
import { Proof } from "@/components/proof/proof";
import { WhyNot } from "@/components/whynot/why-not";

// Nothing links here and nothing indexes it. The three middle sections of the
// front page are looked at here first, in the order they will sit in.
export const metadata: Metadata = {
  title: "Lab: the story sections",
  robots: { index: false, follow: false },
};

export default function StoryLabPage() {
  return (
    <div>
      <div className="mx-auto w-full max-w-[1500px] px-[6vw] pt-14">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          Lab: how it works, why not, proof
        </p>
      </div>

      <HowItWorks />
      <WhyNot />
      <Proof />
    </div>
  );
}
