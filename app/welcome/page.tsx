import { getDb } from "@/lib/db";
import { buildOnboardingView } from "@/lib/onboarding/requirements";
import { WelcomeFlow } from "@/components/onboarding/welcome-flow";

// First run (E-46). A SERVER component on purpose: what Erika needs — and in
// particular whether an API key is actually present — is a fact about this machine,
// so it is rendered into the first paint rather than fetched afterwards. The very
// first screen a person ever sees should not be the word "Loading…".
//
// This page sits OUTSIDE `app/(app)/`, which is what makes it reachable while the
// gate is on and what makes the gate fire when anything else is asked for.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function WelcomePage() {
  return <WelcomeFlow view={buildOnboardingView(getDb())} />;
}
