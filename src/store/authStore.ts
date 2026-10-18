import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, LoginResponse } from "@/types/auth";


interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  register: (userData: { username: string; email: string; password: string; role?: string }) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const clearAuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  error: null,
};

const getApiBaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  return url.replace(/\/$/, "");
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...clearAuthState,
      isLoading: false,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: true,
        }),

      setTokens: (accessToken, refreshToken) =>
        set({
          accessToken,
          refreshToken,
          isAuthenticated: true,
        }),

      register: async (userData) => {
        set({
          isLoading: true,
          error: null,
        });

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/auth/register`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(userData),
            }
          );

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Registration failed");
          }

          const data: LoginResponse = await response.json();

          set({
            user: data.user,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            isAuthenticated: true,
            error: null,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Registration failed",
          });
          throw error;
        } finally {
          set({
            isLoading: false,
          });
        }
      },

      login: async (username: string, password: string) => {
        set({
          isLoading: true,
          error: null,
        });

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/auth/login`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                username,
                password,
              }),
            }
          );

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Login failed");
          }

          const data: LoginResponse = await response.json();

          set({
            user: data.user,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            isAuthenticated: true,
            error: null,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Login failed",
          });

          throw error;
        } finally {
          set({
            isLoading: false,
          });
        }
      },

      logout: () => set(clearAuthState),

      clearAuth: () => set(clearAuthState),

      setLoading: (loading) =>
        set({
          isLoading: loading,
        }),

      setError: (error) =>
        set({
          error,
        }),
    }),
    {
      name: "auth-store",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);