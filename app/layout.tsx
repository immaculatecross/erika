import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Erika",
  description: "Master the language you already speak.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// The document shell, and nothing else. The two-tab chrome and the first-run gate
// both moved down one level, into `app/(app)/layout.tsx` (E-46 criterion 1).
//
// WHY THE GATE IS NOT HERE, measured rather than assumed. A redirect in the ROOT
// layout gates every document request, and it was verified doing so — but the
// App Router keeps the root layout in its client-side cache, so a `<Link>`
// navigation asks the server only for the segments below the first one that
// changed. Probed against the built server: `curl -H "RSC: 1" /practice` from a
// client sitting on `/welcome` returned **200 and the practice page**, with the
// root layout never re-rendered. That is the whole hole: the gate held for typed
// URLs and held for deep links and would have leaked on exactly the navigation a
// learner performs by clicking.
//
// `app/(app)/` is a route group, so `/welcome` sits OUTSIDE it and every path
// inside it does not. Entering the group is always a change at this level, so its
// layout is always rendered, so the gate always runs. Moving between two paths
// inside the group reuses it — which is correct and not a hole, because reaching
// the inside of the group at all requires having passed the gate.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
