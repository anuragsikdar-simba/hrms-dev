'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsSubmitting(true);

    try {
      await login(data.email, data.password);
      toast({
        variant: 'success',
        title: 'Welcome back!',
        description: 'Signed in successfully.',
      });
      router.push('/dashboard');
    } catch (err: unknown) {
      let message = 'An unexpected error occurred. Please try again.';

      if (err instanceof Error) {
        // Supabase Auth returns generic messages; map the common ones.
        if (/invalid login credentials/i.test(err.message)) {
          message = 'Incorrect email or password. Please try again.';
        } else if (/email not confirmed/i.test(err.message)) {
          message = 'Your email is not confirmed yet. Contact HR.';
        } else {
          message = err.message;
        }
      }

      toast({ variant: 'error', title: 'Sign-in failed', description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-gray-900">
          Welcome back
        </h2>
        <p className="mt-1 text-[13px] text-gray-500">
          Sign in with your company credentials
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input
          label="Email address"
          type="email"
          placeholder="you@august.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          placeholder="Enter your password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        {/* Forgot password link */}
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-[12px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          loading={isSubmitting}
          size="lg"
          className="w-full"
        >
          Sign in
        </Button>
      </form>

      <p className="text-center text-[11px] text-gray-400">
        Credentials are provided by your company. Contact HR if you need access.
      </p>
    </div>
  );
}
