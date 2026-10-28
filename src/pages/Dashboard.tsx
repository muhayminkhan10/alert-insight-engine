import { AppShell } from "@/components/AppShell";
import { StoreProvider } from "@/lib/store";

/**
 * Authenticated application shell. Routes for each view are declared in
 * main.tsx and rendered through the shell's <Outlet />.
 */
export default function Dashboard() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
