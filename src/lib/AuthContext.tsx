import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, setToken, clearToken, getToken } from "./api.ts";
import type { User } from "../types.ts";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<{ passwordWasSet?: boolean }>;
  logout: () => void;
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    iban?: string;
    fuelPricePlz?: string;
  }) => Promise<void>;
  refreshUser: () => Promise<void>;
  isDriver: boolean;
  isPassenger: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const data = await api<User>("/api/auth/me");
      setUser(data);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      const res = await api<{ token: string; user: User; passwordWasSet?: boolean }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password, rememberMe }),
        }
      );
      setToken(res.token);
      setUser(res.user);
      return { passwordWasSet: res.passwordWasSet };
    },
    []
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: string;
      iban?: string;
      fuelPricePlz?: string;
    }) => {
      const res = await api<{ token: string; user: User }>(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      setToken(res.token);
      setUser(res.user);
    },
    []
  );

  const isDriver = user?.roles?.includes("FAHRER") ?? false;
  const isPassenger = user?.roles?.includes("MITFAHRER") ?? false;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        register,
        refreshUser,
        isDriver,
        isPassenger,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
