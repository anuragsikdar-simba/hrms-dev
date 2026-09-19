'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Employee } from '@/types';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { auth as apiAuth } from '@/lib/api-client';

// -------------------------------------------------------
// Supabase row -> Employee mapper
// -------------------------------------------------------

function mapRowToEmployee(row: Record<string, unknown>): Employee {
  return {
    id: row.id as string,
    employeeId: row.employee_id as string,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string) ?? undefined,
    department: (row.department as { name?: string })?.name ?? '',
    designation: (row.designation as string) ?? '',
    dateOfJoining: row.date_of_joining as never,
    employmentType: 'full_time',
    status: (row.status as Employee['status']) ?? 'active',
    role: (row.role as Employee['role']) ?? 'employee',
    reportingManagerId: (row.reporting_to as string) ?? undefined,
    gender: (row.gender as Employee['gender']) ?? undefined,
    bloodGroup: (row.blood_group as string) ?? undefined,
    personalEmail: (row.personal_email as string) ?? undefined,
    dob: (row.dob as never) ?? undefined,
    permanentAddress: row.permanent_address ? { line1: row.permanent_address as string, city: '', state: '', pincode: '', country: 'India' } : undefined,
    currentAddress: row.current_address ? { line1: row.current_address as string, city: '', state: '', pincode: '', country: 'India' } : undefined,
    emergencyContact: row.emergency_contact_name
      ? {
          name: row.emergency_contact_name as string,
          phone: (row.emergency_contact_phone as string) ?? '',
          relationship: (row.emergency_contact_relation as string) ?? '',
        }
      : undefined,
    pan: (row.pan as string) ?? undefined,
    aadhaar: (row.aadhaar as string) ?? undefined,
    bankDetails: (row.bank_details as Employee['bankDetails']) ?? undefined,
    mustResetPassword: (row.must_reset_password as boolean) ?? false,
    tracksAttendance: (row.tracks_attendance as boolean) ?? true,
    onboardingStatus: (row.onboarding_status as 'pending' | 'in_progress' | 'completed') ?? 'pending',
    profilePictureUrl: (row.avatar_url as string) ?? undefined,
    createdAt: row.created_at as never,
    updatedAt: row.updated_at as never,
    deletedAt: null,
  };
}

// -------------------------------------------------------
// Helper: look up current employee profile via API
// (requires the Supabase session cookie to be present)
// -------------------------------------------------------

async function fetchCurrentEmployee(): Promise<Employee | null> {
  try {
    const { employee } = await apiAuth.me();
    if (!employee) return null;
    return mapRowToEmployee(employee);
  } catch {
    return null;
  }
}

// -------------------------------------------------------
// Context shape
// -------------------------------------------------------

interface AuthContextValue {
  user: SupabaseUser | null;
  userProfile: Employee | null;
  loading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  mustResetPassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Re-fetch the current user's profile (e.g. after clearing must-reset). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// -------------------------------------------------------
// Provider
// -------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseBrowser();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Supabase Auth state listener ----
  useEffect(() => {
    let active = true;

    // Initial session load.
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (data.user) {
        setUser(data.user);
        const profile = await fetchCurrentEmployee();
        if (active) setUserProfile(profile);
      }
      if (active) setLoading(false);
    })();

    // React to sign-in / sign-out / token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;

      if (session?.user) {
        setUser(session.user);
        // Avoid redundant profile refetch on token refresh.
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          const profile = await fetchCurrentEmployee();
          if (active) setUserProfile(profile);
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // ---- Login with email/password ----
  const login = useCallback(
    async (email: string, password: string) => {
      const normalised = email.toLowerCase().trim();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalised,
        password,
      });

      if (error) throw error;

      const profile = await fetchCurrentEmployee();
      if (!profile) {
        await supabase.auth.signOut();
        throw new Error('No employee account found for this email. Contact HR.');
      }

      setUser(data.user);
      setUserProfile(profile);

      // Record the login audit entry (best-effort).
      try { await apiAuth.loginEvent(); } catch { /* non-fatal */ }
    },
    [supabase],
  );

  // ---- Logout ----
  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
  }, [supabase]);

  // ---- Reset password (sends Supabase recovery email) ----
  const resetPassword = useCallback(
    async (email: string) => {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
        redirectTo,
      });
      if (error) throw error;
    },
    [supabase],
  );

  // ---- Refresh the cached profile from the server ----
  const refreshProfile = useCallback(async () => {
    const profile = await fetchCurrentEmployee();
    setUserProfile(profile);
  }, []);

  // ---- Derived state ----
  const isAdmin = userProfile?.role === 'admin';
  const isAuthenticated = userProfile !== null;
  const mustResetPassword = userProfile?.mustResetPassword ?? false;

  const value: AuthContextValue = {
    user,
    userProfile,
    loading,
    isAdmin,
    isAuthenticated,
    mustResetPassword,
    login,
    logout,
    resetPassword,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// -------------------------------------------------------
// Hook
// -------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
