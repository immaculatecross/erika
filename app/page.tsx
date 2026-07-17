import { EmptyState } from "@/components/empty-state";

export default function SessionsPage() {
  return (
    <EmptyState
      title="Sessions"
      line="No sessions yet. Record a take or drop in a day's audio to begin."
      action="New session"
    />
  );
}
