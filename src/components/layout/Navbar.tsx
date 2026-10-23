import React, { useState, useEffect, useRef } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { Car, Bell, Settings, LogOut, LayoutDashboard, Users, MapPin, CreditCard, BarChart3, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "../../lib/AuthContext.tsx";
import { api } from "../../lib/api.ts";
import { Avatar } from "../ui/index.tsx";
import NotificationDropdown from "./NotificationDropdown.tsx";

export default function Navbar() {
  const { user, logout, isDriver } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchCount() {
      try {
        const data = await api<{ unread: number }>("/api/notifications/count");
        setUnreadCount(data.unread);
      } catch {}
    }
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const navLinks = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
    ...(isDriver
      ? [
          { to: "/vehicles", icon: Car, label: "Fahrzeuge", end: false },
          { to: "/trips", icon: MapPin, label: "Fahrten", end: false },
        ]
      : []),
    { to: "/groups", icon: Users, label: "Gruppen", end: false },
    { to: "/payments", icon: CreditCard, label: "Schulden", end: false },
    { to: "/stats", icon: BarChart3, label: "Statistik", end: false },
  ];

  return (
    <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-bold text-zinc-100 shrink-0">
          <Car className="w-5 h-5 text-blue-400" />
          <span className="hidden sm:block">MitFahr.io</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                )
              }
            >
              <link.icon className="w-4 h-4" />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setShowNotifications((v) => !v)}
              className="relative p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 bg-blue-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <NotificationDropdown
                onClose={() => setShowNotifications(false)}
                onCountChange={setUnreadCount}
              />
            )}
          </div>

          {/* User Menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className="flex items-center gap-2 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <Avatar
                src={user?.avatarUrl}
                name={`${user?.firstName} ${user?.lastName}`}
                size="sm"
              />
              <span className="hidden sm:block text-sm text-zinc-300 max-w-[120px] truncate">
                {user?.firstName}
              </span>
              <ChevronDown className="w-4 h-4 text-zinc-500 hidden sm:block" />
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl overflow-hidden">
                <div className="p-3 border-b border-zinc-800">
                  <p className="text-sm font-medium text-zinc-200">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
                </div>
                <Link
                  to="/settings"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Einstellungen
                </Link>
                <button
                  onClick={() => { logout(); navigate("/login"); }}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors w-full"
                >
                  <LogOut className="w-4 h-4" />
                  Abmelden
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
