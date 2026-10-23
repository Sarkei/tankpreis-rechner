import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { Notification } from "../../types.ts";
import { Bell, CheckCheck } from "lucide-react";
import { clsx } from "clsx";
import { formatDate } from "../ui/index.tsx";

const TYPE_ICONS: Record<string, string> = {
  TRIP_CREATED: "🚗",
  PAYMENT_REPORTED: "💸",
  PAYMENT_CONFIRMED: "✅",
  GROUP_JOIN: "👥",
  FUEL_PRICE_REMINDER: "⛽",
};

export default function NotificationDropdown({
  onClose,
  onCountChange,
}: {
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api<Notification[]>("/api/notifications?unreadOnly=false");
        setNotifications(data);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  async function markAllRead() {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      onCountChange(0);
    } catch {}
  }

  async function markRead(id: number) {
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      const unread = notifications.filter((n) => !n.isRead && n.id !== id).length;
      onCountChange(unread);
    } catch {}
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Benachrichtigungen</span>
        </div>
        <button
          onClick={markAllRead}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          Alle lesen
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-zinc-500 text-sm">Lädt…</div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center">
            <Bell className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">Keine Benachrichtigungen</p>
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => { if (!n.isRead) markRead(n.id); }}
              className={clsx(
                "w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-0",
                !n.isRead && "bg-zinc-800/30"
              )}
            >
              <span className="text-xl shrink-0">{TYPE_ICONS[n.type] ?? "🔔"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={clsx("text-sm font-medium truncate", n.isRead ? "text-zinc-400" : "text-zinc-100")}>
                    {n.title}
                  </p>
                  {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1" />}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{n.message}</p>
                <p className="text-xs text-zinc-600 mt-1">{formatDate(n.createdAt)}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
