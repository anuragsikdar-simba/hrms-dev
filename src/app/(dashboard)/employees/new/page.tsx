"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { ShieldAlert, ArrowLeft, Copy, Check, UserPlus } from "lucide-react";
import { useDepartments } from "@/hooks/use-departments";
import { employees as employeesApi } from "@/lib/api-client";
import { isValidEmployeeId, EMPLOYEE_ID_HELP } from "@/lib/employee-id";

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const newEmployeeSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().min(1, "Work email is required").email("Invalid email format"),
  employeeId: z
    .string()
    .optional()
    .refine((v) => !v || v.trim() === "" || isValidEmployeeId(v), {
      message:
        "Invalid format. Leave blank to auto-generate, or use uppercase letters/digits/dashes (start with a letter, include a number).",
    }),
  department_id: z.string().min(1, "Department is required"),
  designation: z.string().min(1, "Designation is required"),
  role: z.enum(["employee", "admin"]),
  observer: z.enum(["no", "yes"]),
  dateOfJoining: z.string().min(1, "Date of joining is required"),
  employmentType: z.string().min(1, "Employment type is required"),
  shiftStart: z.string().optional(),
  shiftEnd: z.string().optional(),
});

type NewEmployeeFormData = z.infer<typeof newEmployeeSchema>;

/* ------------------------------------------------------------------ */
/*  Static options                                                     */
/* ------------------------------------------------------------------ */

const EMPLOYMENT_TYPE_OPTIONS = [
  { label: "Full-time", value: "full_time" },
  { label: "Part-time", value: "part_time" },
  { label: "Contract", value: "contract" },
  { label: "Intern", value: "intern" },
];

const ROLE_OPTIONS = [
  { label: "Employee", value: "employee" },
  { label: "Admin", value: "admin" },
];

const OBSERVER_OPTIONS = [
  { label: "No - tracks attendance (punch in/out)", value: "no" },
  { label: "Yes - observer (no punch, excluded from reports)", value: "yes" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function NewEmployeePage() {
  const router = useRouter();
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [created, setCreated] = React.useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [nextIdPreview, setNextIdPreview] = React.useState<string | null>(null);

  // Preview the auto-generated ID so the admin sees what blank will produce.
  React.useEffect(() => {
    let active = true;
    employeesApi
      .previewNextId()
      .then((res) => {
        if (active) setNextIdPreview(res.nextId);
      })
      .catch(() => {
        /* non-fatal: the server still auto-generates on submit */
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch departments from API
  const { data: deptData } = useDepartments();
  const departmentOptions = React.useMemo(
    () => (deptData?.departments ?? []).map((d) => ({ label: d.name, value: d.id })),
    [deptData],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewEmployeeFormData>({
    resolver: zodResolver(newEmployeeSchema),
    defaultValues: {
      name: "",
      email: "",
      employeeId: "",
      department_id: "",
      designation: "",
      role: "employee",
      observer: "no",
      dateOfJoining: "",
      employmentType: "",
      shiftStart: "",
      shiftEnd: "",
    },
  });

  /* ---- Auth guard ---- */
  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldAlert className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
        <p className="max-w-md text-sm text-gray-500">
          Only administrators can create new employee accounts.
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  /* ---- Submit handler ---- */
  const onSubmit = async (data: NewEmployeeFormData) => {
    setSubmitting(true);
    try {
      const { tempPassword } = await employeesApi.create({
        employee_id: data.employeeId?.trim() || undefined,
        name: data.name,
        email: data.email,
        department_id: data.department_id,
        designation: data.designation,
        role: data.role,
        tracks_attendance: data.observer === "no",
        date_of_joining: data.dateOfJoining,
        shift_start: data.shiftStart || null,
        shift_end: data.shiftEnd || null,
      });

      // Show the credentials so the admin can hand them to the new hire.
      setCreated({ name: data.name, email: data.email, tempPassword });

      toast({
        variant: "success",
        title: "Employee Created",
        description: "Login account created. Share the temporary password below.",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to create employee",
        description: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const copyCredentials = async () => {
    if (!created) return;
    const text = `Login: ${created.email}\nTemporary password: ${created.tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "error", title: "Copy failed", description: "Copy the values manually." });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Back link */}
      <Link
        href="/employees"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Employee Directory
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Create New Employee</CardTitle>
          <CardDescription>
            Fill in the details below to create a new employee account. A
            temporary password will be generated for their first login.
          </CardDescription>
        </CardHeader>

        {created ? (
          <>
            <CardContent className="space-y-5">
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <UserPlus className="h-7 w-7 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {created.name} created
                </h3>
                <p className="max-w-md text-sm text-gray-500">
                  Share these credentials with the employee. They will be
                  required to set a new password on first login.
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">Login email</span>
                  <span className="font-mono font-medium text-gray-900">{created.email}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 py-1 pt-3">
                  <span className="text-gray-500">Temporary password</span>
                  <span className="font-mono font-medium text-gray-900">{created.tempPassword}</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={copyCredentials}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4 text-green-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Copy credentials
                  </>
                )}
              </Button>
            </CardContent>

            <CardFooter className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreated(null);
                  reset();
                }}
              >
                Add Another
              </Button>
              <Button type="button" onClick={() => router.push("/employees")}>
                Done
              </Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-5">
            {/* Full Name */}
            <Input
              label="Full Name"
              placeholder="e.g. Arjun Mehta"
              error={errors.name?.message}
              {...register("name")}
            />

            {/* Work Email */}
            <Input
              label="Work Email"
              type="email"
              placeholder="e.g. arjun.mehta@august.com"
              error={errors.email?.message}
              {...register("email")}
            />

            {/* Employee ID */}
            <Input
              label="Employee ID (optional)"
              placeholder={nextIdPreview ? `Auto: ${nextIdPreview}` : "Auto-generated"}
              helperText={
                nextIdPreview
                  ? `Leave blank to assign ${nextIdPreview}. ${EMPLOYEE_ID_HELP}`
                  : EMPLOYEE_ID_HELP
              }
              error={errors.employeeId?.message}
              {...register("employeeId")}
            />

            {/* Department */}
            <Select
              label="Department"
              placeholder="Select department"
              options={departmentOptions}
              error={errors.department_id?.message}
              {...register("department_id")}
            />

            {/* Designation */}
            <Input
              label="Designation"
              placeholder="e.g. Software Engineer"
              error={errors.designation?.message}
              {...register("designation")}
            />

            {/* Date of Joining */}
            <Input
              label="Date of Joining"
              type="date"
              error={errors.dateOfJoining?.message}
              {...register("dateOfJoining")}
            />

            {/* Employment Type */}
            <Select
              label="Employment Type"
              placeholder="Select employment type"
              options={EMPLOYMENT_TYPE_OPTIONS}
              error={errors.employmentType?.message}
              {...register("employmentType")}
            />

            {/* Shift timings */}
            <Input
              label="Shift Start"
              type="time"
              helperText="Local (IST) shift start. Leave blank if no fixed shift."
              error={errors.shiftStart?.message}
              {...register("shiftStart")}
            />
            <Input
              label="Shift End"
              type="time"
              helperText="If end is the same or earlier than start, the shift is treated as overnight (ends next day)."
              error={errors.shiftEnd?.message}
              {...register("shiftEnd")}
            />

            {/* Role */}
            <Select
              label="Role"
              options={ROLE_OPTIONS}
              error={errors.role?.message}
              {...register("role")}
            />

            {/* Observer (attendance tracking) */}
            <Select
              label="Observer"
              helperText="Observers (e.g. authority figures) don't punch in/out and are excluded from attendance reports & analytics."
              options={OBSERVER_OPTIONS}
              error={errors.observer?.message}
              {...register("observer")}
            />
          </CardContent>

          <CardFooter className="flex justify-end gap-3">
            <Link href="/employees">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" loading={submitting}>
              {submitting ? "Creating..." : "Create Employee"}
            </Button>
          </CardFooter>
        </form>
        )}
      </Card>
    </div>
  );
}
