'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, X, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import api from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Password requirements
// ---------------------------------------------------------------------------

interface PasswordRequirement {
  label: string;
  test: (value: string) => boolean;
}

const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'Contains an uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'Contains a lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'Contains a number', test: (v) => /\d/.test(v) },
  { label: 'Contains a special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/\d/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// Requirement indicator component
// ---------------------------------------------------------------------------

function RequirementIndicator({
  met,
  label,
}: {
  met: boolean;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {met ? (
        <Check className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <X className="h-4 w-4 shrink-0 text-gray-400" />
      )}
      <span className={met ? 'text-green-700' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ResetPasswordPage() {
  const { refreshProfile } = useAuth();
  const supabase = getSupabaseBrowser();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const watchedPassword = watch('newPassword', '');

  // Shared "finish up" path: clear the forced-reset flag, refresh the cached
  // profile so the layout stops redirecting back here, then go to the dashboard.
  const finishAndContinue = async (description: string) => {
    try {
      await api.auth.clearResetFlag();
    } catch {
      /* non-fatal: worst case the user is asked to reset again */
    }
    await refreshProfile().catch(() => {});
    toast({ variant: 'success', title: 'Password updated', description });
    router.replace('/dashboard');
  };

  const onSubmit = async (data: ResetPasswordFormValues) => {
    setIsSubmitting(true);

    try {
      // Update the password via Supabase Auth. Works both for a logged-in
      // user changing their password and for a recovery-link session.
      const { error } = await supabase.auth.updateUser({ password: data.newPassword });
      if (error) throw error;

      await finishAndContinue('Your password has been changed successfully.');
    } catch (err) {
      let message = 'Failed to update password. Please try again.';
      if (err instanceof Error) {
        if (/should be different|same as the old/i.test(err.message)) {
          // The new password equals the current one. This almost always means
          // a previous attempt actually succeeded but we never cleared the
          // forced-reset flag, leaving the user stuck on this screen. Treat it
          // as done: clear the flag and let them through.
          setIsSubmitting(false);
          await finishAndContinue('Your password is already set. You are all set.');
          return;
        } else if (/session|jwt|expired/i.test(err.message)) {
          message =
            'Your session has expired. Please sign in again before changing your password.';
        } else {
          message = err.message;
        }
      }

      toast({ variant: 'error', title: 'Update failed', description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Heading */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <ShieldCheck className="h-6 w-6 text-gray-700" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">
          Set a new password
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Create a secure password for your account
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Input
          label="New password"
          type="password"
          placeholder="Enter a new password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />

        {/* Password strength requirements */}
        <ul className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
          {PASSWORD_REQUIREMENTS.map((req) => (
            <RequirementIndicator
              key={req.label}
              met={req.test(watchedPassword)}
              label={req.label}
            />
          ))}
        </ul>

        <Input
          label="Confirm password"
          type="password"
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" loading={isSubmitting} className="w-full">
          Update Password
        </Button>
      </form>
    </>
  );
}
