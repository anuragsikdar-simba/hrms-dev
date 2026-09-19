'use client';

import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ActionType =
  | 'Login'
  | 'Logout'
  | 'Employee Created'
  | 'Leave Approved'
  | 'Leave Rejected'
  | 'Leave Requested'
  | 'Profile Updated'
  | 'Offboarding'
  | 'Force Logout'
  | 'Role Changed'
  | 'Password Reset'
  | 'Document Uploaded'
  | 'IP Whitelisted'
  | 'Attendance Regularised'
  | 'Policy Updated';

interface AuditEntry {
  id: string;
  timestamp: Date;
  performedBy: string;
  action: ActionType;
  targetEmployee: string;
  details: string;
  ipAddress: string;
  before?: Record<string, string>;
  after?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Badge variant for action types                                     */
/* ------------------------------------------------------------------ */

const actionBadgeVariant: Record<
  ActionType,
  'default' | 'success' | 'destructive' | 'warning' | 'secondary' | 'outline'
> = {
  Login: 'default',
  Logout: 'secondary',
  'Employee Created': 'success',
  'Leave Approved': 'success',
  'Leave Rejected': 'destructive',
  'Leave Requested': 'warning',
  'Profile Updated': 'default',
  Offboarding: 'destructive',
  'Force Logout': 'destructive',
  'Role Changed': 'warning',
  'Password Reset': 'outline',
  'Document Uploaded': 'secondary',
  'IP Whitelisted': 'warning',
  'Attendance Regularised': 'default',
  'Policy Updated': 'outline',
};

/* ------------------------------------------------------------------ */
/*  Initial data (fetched from Supabase)                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Filter options                                                     */
/* ------------------------------------------------------------------ */

const actionTypeOptions = [
  { label: 'All Actions', value: '' },
  { label: 'Login', value: 'Login' },
  { label: 'Logout', value: 'Logout' },
  { label: 'Employee Created', value: 'Employee Created' },
  { label: 'Leave Approved', value: 'Leave Approved' },
  { label: 'Leave Rejected', value: 'Leave Rejected' },
  { label: 'Leave Requested', value: 'Leave Requested' },
  { label: 'Profile Updated', value: 'Profile Updated' },
  { label: 'Offboarding', value: 'Offboarding' },
  { label: 'Force Logout', value: 'Force Logout' },
  { label: 'Role Changed', value: 'Role Changed' },
  { label: 'Password Reset', value: 'Password Reset' },
  { label: 'Document Uploaded', value: 'Document Uploaded' },
  { label: 'IP Whitelisted', value: 'IP Whitelisted' },
  { label: 'Attendance Regularised', value: 'Attendance Regularised' },
  { label: 'Policy Updated', value: 'Policy Updated' },
];

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function AuditLogPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  // Data
  const [auditData, setAuditData] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch from Supabase
  useEffect(() => {
    async function fetchAuditLog() {
      try {
        const { auditLogs: data } = await api.audit.list({ limit: 500 });

        if (data && data.length > 0) {
          const mapped: AuditEntry[] = data.map((r: Record<string, unknown>) => {
            const performer = r.performer as { name: string } | null;
            const target = r.target as { name: string } | null;
            return {
              id: r.id as string,
              timestamp: new Date(r.created_at as string),
              performedBy: performer?.name ?? 'System',
              action: (r.action as ActionType) ?? 'Login',
              targetEmployee: target?.name ?? '-',
              details: (r.details as string) ?? '',
              ipAddress: (r.ip_address as string) ?? '',
              before: r.before_data as Record<string, string> | undefined,
              after: r.after_data as Record<string, string> | undefined,
            };
          });
          setAuditData(mapped);
        }
      } catch (err) {
        toast({ variant: "error", title: "Failed to load audit log", description: String(err) });
      }
      setLoading(false);
    }
    fetchAuditLog();
  }, []);

  // ---- Admin gate ----
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-32">
        <EmptyState
          icon={ShieldAlert}
          title="Access Denied"
          description="You do not have permission to view the audit log. Please contact an administrator."
        />
      </div>
    );
  }

  // ---- Filtering ----
  const filtered = useMemo(() => {
    let data = auditData;

    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(
        (e) =>
          e.performedBy.toLowerCase().includes(q) ||
          e.targetEmployee.toLowerCase().includes(q),
      );
    }

    if (actionFilter) {
      data = data.filter((e) => e.action === actionFilter);
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      data = data.filter((e) => e.timestamp >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      data = data.filter((e) => e.timestamp <= to);
    }

    return data;
  }, [search, actionFilter, dateFrom, dateTo, auditData]);

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  // Reset to page 1 when filters change
  const handleSearch = (v: string) => {
    setSearch(v);
    setCurrentPage(1);
  };
  const handleActionFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setActionFilter(e.target.value);
    setCurrentPage(1);
  };
  const handleDateFrom = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
    setCurrentPage(1);
  };
  const handleDateTo = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">Audit Log</h1>
          <p className="text-xs text-gray-500">
            Review all administrative actions performed across the system.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_140px_140px] items-end">
            <SearchInput
              placeholder="Search by employee name..."
              value={search}
              onChange={handleSearch}
            />
            <Select
              options={actionTypeOptions}
              value={actionFilter}
              onChange={handleActionFilter}
            />
            <Input
              type="date"
              label="From"
              value={dateFrom}
              onChange={handleDateFrom}
            />
            <Input
              type="date"
              label="To"
              value={dateTo}
              onChange={handleDateTo}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {paginated.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No audit entries found"
                description="Try adjusting your filters to find what you are looking for."
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Performed By</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target Employee</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((entry) => {
                    const isExpanded = expandedId === entry.id;
                    const hasExpandable = entry.before || entry.after;

                    return (
                      <Fragment key={entry.id}>
                        <TableRow
                          className={hasExpandable ? 'cursor-pointer' : ''}
                          onClick={() => {
                            if (hasExpandable) {
                              setExpandedId(isExpanded ? null : entry.id);
                            }
                          }}
                        >
                          <TableCell className="whitespace-nowrap font-mono text-xs text-gray-500">
                            {formatTimestamp(entry.timestamp)}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {entry.performedBy}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                actionBadgeVariant[entry.action] ?? 'secondary'
                              }
                            >
                              {entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{entry.targetEmployee}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <span className="max-w-[260px] truncate text-xs">
                                {entry.details}
                              </span>
                              {hasExpandable && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedId(
                                      isExpanded ? null : entry.id,
                                    );
                                  }}
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">
                            {entry.ipAddress}
                          </TableCell>
                        </TableRow>

                        {/* Expanded before/after */}
                        {isExpanded && hasExpandable && (
                          <TableRow key={`${entry.id}-expanded`}>
                            <TableCell colSpan={6}>
                              <div className="grid gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-2">
                                {/* Before */}
                                {entry.before &&
                                  Object.keys(entry.before).length > 0 && (
                                    <div>
                                      <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                                        Before
                                      </p>
                                      <dl className="space-y-1">
                                        {Object.entries(entry.before).map(
                                          ([key, val]) => (
                                            <div
                                              key={key}
                                              className="flex gap-2 text-sm"
                                            >
                                              <dt className="font-medium text-gray-600">
                                                {key}:
                                              </dt>
                                              <dd className="text-gray-500">
                                                {val}
                                              </dd>
                                            </div>
                                          ),
                                        )}
                                      </dl>
                                    </div>
                                  )}

                                {/* After */}
                                {entry.after &&
                                  Object.keys(entry.after).length > 0 && (
                                    <div>
                                      <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                                        After
                                      </p>
                                      <dl className="space-y-1">
                                        {Object.entries(entry.after).map(
                                          ([key, val]) => (
                                            <div
                                              key={key}
                                              className="flex gap-2 text-sm"
                                            >
                                              <dt className="font-medium text-gray-600">
                                                {key}:
                                              </dt>
                                              <dd className="text-green-700">
                                                {val}
                                              </dd>
                                            </div>
                                          ),
                                        )}
                                      </dl>
                                    </div>
                                  )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-gray-100 p-4">
                  <Pagination
                    currentPage={safePage}
                    totalPages={totalPages}
                    totalItems={filtered.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setCurrentPage}
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
