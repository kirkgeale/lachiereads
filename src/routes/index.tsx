import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Public "/" — either send signed-in users to the kid home (authenticated) or to /auth.
export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/_authenticated" as any });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
