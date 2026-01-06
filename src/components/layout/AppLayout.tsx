import { ReactNode } from "react";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";

interface AppLayoutProps {
  children: ReactNode;
  showNav?: boolean;
}

export function AppLayout({ children, showNav = true }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className={`flex-1 ${showNav ? "pb-20" : ""}`}>
        {children}
      </main>
      {showNav && <BottomNav />}
    </div>
  );
}
