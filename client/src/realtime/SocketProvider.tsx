/**
 * Socket.io connection + live query invalidations.
 *
 * Establishes a JWT-authenticated socket once the user has a token, listens
 * for the server's typed events, and invalidates the matching TanStack
 * Query caches so views refresh in place without polling.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider.js";

interface SocketContextValue {
  connected: boolean;
  socket: Socket | null;
}

const SocketContext = createContext<SocketContextValue>({ connected: false, socket: null });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token || !user) return;
    const s = io({ auth: { token }, transports: ["websocket", "polling"] });

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    s.on("ticket:created", () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    });
    s.on("ticket:updated", (p: { ticketId: string }) => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket", p.ticketId] });
      qc.invalidateQueries({ queryKey: ["comments", p.ticketId] });
      qc.invalidateQueries({ queryKey: ["attachments", p.ticketId] });
    });
    s.on("device:updated", () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    });
    s.on("session:event", (p: { sessionId: string }) => {
      qc.invalidateQueries({ queryKey: ["session", p.sessionId] });
    });
    s.on("sla:breach", () => {
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    });
    s.on("incident:updated", () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    });
    s.on("analytics:updated", () => {
      qc.invalidateQueries({ queryKey: ["analytics"] });
    });

    setSocket(s);
    return () => { s.disconnect(); setSocket(null); setConnected(false); };
  }, [token, user, qc]);

  const value = useMemo<SocketContextValue>(() => ({ connected, socket }), [connected, socket]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
