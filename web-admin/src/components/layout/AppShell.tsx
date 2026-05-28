import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface Props {
  onSignOut: () => void;
}

export function AppShell({ onSignOut }: Props) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar onSignOut={onSignOut} />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="container max-w-screen-2xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
