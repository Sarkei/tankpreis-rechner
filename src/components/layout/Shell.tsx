import React, { type ReactNode } from "react";
import Navbar from "./Navbar.tsx";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}

import { NavLink } from "react-router-dom";
import { LayoutDashboard, Car, Users, MapPin, CreditCard, BarChart3, Settings } from "lucide-react";
import { useAuth } from "../../lib/AuthContext.tsx";
import { clsx } from "clsx";

function MobileNav() {
  const { isDriver } = useAuth();

  const links = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    ...(isDriver
      ? [
          { to: "/vehicles", icon: Car, label: "Fahrzeuge" },
          { to: "/groups", icon: Users, label: "Gruppen" },
          { to: "/trips", icon: MapPin, label: "Fahrten" },
        ]
      : [{ to: "/groups", icon: Users, label: "Gruppen" }]),
    { to: "/payments", icon: CreditCard, label: "Schulden" },
    { to: "/stats", icon: BarChart3, label: "Statistik" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 flex items-stretch justify-around px-1 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.to === "/"}
          className={({ isActive }) =>
            clsx(
              "flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl min-w-0 flex-1 min-h-[3.25rem] transition-colors",
              isActive
                ? "text-blue-400 bg-blue-500/10"
                : "text-zinc-500 active:text-zinc-300"
            )
          }
        >
          <link.icon className="w-6 h-6" />
          <span className="text-[10px] font-medium truncate max-w-full">{link.label}</span>
        </NavLink>
      ))}
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          clsx(
            "flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl min-w-0 flex-1 min-h-[3.25rem] transition-colors",
            isActive ? "text-blue-400 bg-blue-500/10" : "text-zinc-500 active:text-zinc-300"
          )
        }
      >
        <Settings className="w-6 h-6" />
        <span className="text-[10px] font-medium">Mehr</span>
      </NavLink>
    </nav>
  );
}
