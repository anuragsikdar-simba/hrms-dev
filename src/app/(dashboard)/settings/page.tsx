"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Calendar,
  CalendarDays,
  Shield,
  ClipboardList,
  Mail,
  MapPin,
  ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Settings cards config
// ---------------------------------------------------------------------------

const SETTING_CARDS = [
  {
    title: "Departments",
    description: "Manage company departments",
    icon: Building2,
    href: "/settings/departments",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    title: "Holiday Calendar",
    description: "Configure holidays per financial year",
    icon: Calendar,
    href: "/settings/holidays",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
  },
  {
    title: "Leave Allocation",
    description: "Set annual leave allocations",
    icon: CalendarDays,
    href: "/settings/leave-allocation",
    color: "text-purple-600",
    bgColor: "bg-purple-50",
  },
  {
    title: "IP Allowlist",
    description: "Manage office IPs and access control",
    icon: Shield,
    href: "/settings/ip-allowlist",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
  },
  {
    title: "Punch Locations",
    description: "Geofence where employees can punch in",
    icon: MapPin,
    href: "/settings/punch-locations",
    color: "text-teal-600",
    bgColor: "bg-teal-50",
  },
  {
    title: "Onboarding Form",
    description: "Customize onboarding form fields",
    icon: ClipboardList,
    href: "/settings/onboarding-form",
    color: "text-pink-600",
    bgColor: "bg-pink-50",
  },
  {
    title: "Email Notifications",
    description: "Configure notification preferences",
    icon: Mail,
    href: "/settings/email-notifications",
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
  },
] as const;

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900">
            Access Restricted
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Only administrators can access settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">Settings</h1>
          <p className="text-xs text-gray-500">
            Configure and manage your HRMS system preferences.
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SETTING_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.title} href={card.href}>
              <Card className="group cursor-pointer transition-all hover:border-gray-300 hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${card.bgColor}`}
                    >
                      <Icon className={`h-6 w-6 ${card.color}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 group-hover:text-blue-600">
                        {card.title}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {card.description}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-blue-500" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
