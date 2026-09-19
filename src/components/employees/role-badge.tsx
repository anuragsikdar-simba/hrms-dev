import { ShieldCheck, User } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Role badge (Admin / Employee)                                      */
/* ------------------------------------------------------------------ */

export function RoleBadge({ role }: { role: "admin" | "employee" }) {
  const isAdmin = role === "admin";
  const Icon = isAdmin ? ShieldCheck : User;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium " +
        (isAdmin
          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
          : "border-gray-300 bg-gray-50 text-gray-600")
      }
    >
      <Icon className="h-3 w-3" />
      {isAdmin ? "Admin" : "Employee"}
    </span>
  );
}
