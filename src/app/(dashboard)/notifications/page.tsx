'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Bell,
  CalendarDays,
  Users,
  Clock,
  Shield,
  User,
  CheckCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/toast';
import api from '@/lib/api-client';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type NotificationType =
  | 'general'
  | 'leave'
  | 'onboarding'
  | 'attendance'
  | 'ip'
  | 'profile';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionable: boolean;
  /** Track whether an action has been taken (approved/rejected). */
  actionTaken?: 'approved' | 'rejected';
  /** Which role should see this notification. 'all' = everyone. */
  forRole: 'admin' | 'employee' | 'all';
}

/* ------------------------------------------------------------------ */
/*  Icon mapping                                                       */
/* ------------------------------------------------------------------ */

const iconMap: Record<NotificationType, LucideIcon> = {
  general: Bell,
  leave: CalendarDays,
  onboarding: Users,
  attendance: Clock,
  ip: Shield,
  profile: User,
};

const iconColorMap: Record<NotificationType, string> = {
  general: 'text-blue-600 bg-blue-100',
  leave: 'text-orange-600 bg-orange-100',
  onboarding: 'text-emerald-600 bg-emerald-100',
  attendance: 'text-violet-600 bg-violet-100',
  ip: 'text-red-600 bg-red-100',
  profile: 'text-cyan-600 bg-cyan-100',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/*  Initial state (populated via Supabase)                             */
/* ------------------------------------------------------------------ */

const initialNotifications: Notification[] = [];

/* ------------------------------------------------------------------ */
/*  Filter type                                                        */
/* ------------------------------------------------------------------ */

type FilterTab = 'all' | 'unread' | 'actionable';

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function NotificationsPage() {
  const { isAdmin, userProfile } = useAuth();
  const { toast } = useToast();
  const [allNotifications, setAllNotifications] =
    useState<Notification[]>(initialNotifications);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);

  // Fetch from Supabase
  useEffect(() => {
    if (!userProfile?.id) return;

    async function fetchNotifications() {
      try {
        setLoading(true);
        const { notifications: data } = await api.notifications.list();
        const mapped: Notification[] = (data ?? []).map((n: Record<string, unknown>) => ({
            id: n.id as string,
            type: (n.type as NotificationType) ?? 'general',
            title: n.title as string,
            message: (n.message as string) ?? '',
            timestamp: new Date(n.created_at as string),
            read: (n.read as boolean) ?? false,
            actionable: (n.actionable as boolean) ?? false,
            forRole: 'all' as const,
          }));
          setAllNotifications(mapped);
      } catch (err) {
        console.error('[Notifications] fetch error:', err);
        toast({ variant: 'error', title: 'Failed to load notifications', description: 'Please try refreshing the page.' });
      } finally {
        setLoading(false);
      }
    }
    fetchNotifications();
  }, [userProfile]);

  // ---- Role-filtered notifications ----
  const notifications = useMemo(
    () =>
      allNotifications.filter(
        (n) => n.forRole === 'all' || (isAdmin ? n.forRole === 'admin' : n.forRole === 'employee'),
      ),
    [allNotifications, isAdmin],
  );

  // ---- Derived state ----
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const filtered = useMemo(() => {
    switch (activeTab) {
      case 'unread':
        return notifications.filter((n) => !n.read);
      case 'actionable':
        return notifications.filter((n) => n.actionable && !n.actionTaken);
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  // ---- Handlers ----
  const markAsRead = useCallback((id: string) => {
    api.notifications.markRead(id);
    setAllNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    if (userProfile?.id) {
      api.notifications.markAllRead();
    }
    setAllNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [userProfile]);

  const handleAction = useCallback(
    (id: string, action: 'approved' | 'rejected') => {
      setAllNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, actionTaken: action, read: true } : n,
        ),
      );
    },
    [],
  );

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">Notifications</h1>
          <p className="text-xs text-gray-500">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}.`
              : 'You are all caught up!'}
          </p>
        </div>

        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            Mark All as Read
          </Button>
        )}
      </div>

      {/* Tabs + list */}
      <Card>
        <CardHeader className="pb-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as FilterTab)}
          >
            <TabsList>
              <TabsTrigger value="all">
                All
                <Badge variant="secondary" className="ml-1.5">
                  {notifications.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="unread">
                Unread
                {unreadCount > 0 && (
                  <Badge className="ml-1.5">{unreadCount}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="actionable">
                Actionable
                <Badge variant="warning" className="ml-1.5">
                  {
                    notifications.filter(
                      (n) => n.actionable && !n.actionTaken,
                    ).length
                  }
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* All three tabs share the same content renderer */}
            {(['all', 'unread', 'actionable'] as FilterTab[]).map((tab) => (
              <TabsContent key={tab} value={tab}>
                {/* Rendered via filtered below */}
              </TabsContent>
            ))}
          </Tabs>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
              <span className="ml-3 text-sm text-gray-500">Loading notifications...</span>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description={
                activeTab === 'unread'
                  ? 'You have read all your notifications.'
                  : activeTab === 'actionable'
                    ? 'No pending actions right now.'
                    : 'Your notification inbox is empty.'
              }
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((n) => {
                const Icon = iconMap[n.type];
                const colorClass = iconColorMap[n.type];

                return (
                  <li
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => markAsRead(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') markAsRead(n.id);
                    }}
                    className={`flex gap-3 px-2 py-4 transition-colors sm:gap-4 sm:px-4 ${
                      n.read
                        ? 'bg-white'
                        : 'bg-blue-50/40 hover:bg-blue-50/60'
                    } cursor-pointer rounded-lg`}
                  >
                    {/* Icon */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Body */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* Unread dot */}
                          {!n.read && (
                            <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                          )}
                          <p
                            className={`text-sm ${n.read ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}
                          >
                            {n.title}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {relativeTime(n.timestamp)}
                        </span>
                      </div>

                      <p className="mt-0.5 text-sm text-gray-500">
                        {n.message}
                      </p>

                      {/* Actionable buttons */}
                      {n.actionable && !n.actionTaken && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(n.id, 'approved');
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(n.id, 'rejected');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}

                      {/* Action taken badge */}
                      {n.actionTaken && (
                        <Badge
                          variant={
                            n.actionTaken === 'approved'
                              ? 'success'
                              : 'destructive'
                          }
                          className="mt-2"
                        >
                          {n.actionTaken === 'approved'
                            ? 'Approved'
                            : 'Rejected'}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
