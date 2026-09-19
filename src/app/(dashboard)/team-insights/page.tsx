'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserPlus,
  UserMinus,
  UserCog,
  Clock,
  TrendingUp,
  Building2,
  CalendarDays,
  BarChart3,
  RefreshCw,
  Download,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/dashboard/stat-card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api-client';

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

type Period = 'this_week' | 'this_month' | 'last_month' | 'last_3_months';

interface WorkforceKPIs {
  totalHeadcount: number;
  activeCount: number;
  newJoiners: number;
  attritionRate: number;
  offboardedCount: number;
  pendingOnboarding: number;
}

interface DailyAttendance {
  date: string;
  dayLabel: string;
  count: number;
}

interface DeptAttendance {
  department: string;
  totalEmployees: number;
  avgAttendanceRate: number;
  avgHours: number;
  lateCount: number;
}

interface HeadcountTrend {
  month: string;
  label: string;
  count: number;
}

interface EmployeeInsight {
  name: string;
  department: string;
  avgHours: number;
  attendanceRate: number;
  lateCount: number;
  leavesTaken: number;
  regRequests: number;
}

interface LeaveUtilization {
  typeName: string;
  totalAllocated: number;
  totalUsed: number;
  percentage: number;
}

interface DeptDistribution {
  department: string;
  count: number;
  percentage: number;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function getPeriodDates(period: Period): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (period) {
    case 'this_week': {
      const day = now.getDay();
      const diff = d - day + (day === 0 ? -6 : 1);
      const monday = new Date(y, m, diff);
      return {
        start: fmt(monday),
        end: fmt(now),
      };
    }
    case 'this_month':
      return { start: `${y}-${pad(m + 1)}-01`, end: fmt(now) };
    case 'last_month': {
      const firstLast = new Date(y, m - 1, 1);
      const lastLast = new Date(y, m, 0);
      return { start: fmt(firstLast), end: fmt(lastLast) };
    }
    case 'last_3_months': {
      const threeAgo = new Date(y, m - 3, 1);
      return { start: fmt(threeAgo), end: fmt(now) };
    }
  }
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function getWorkingDays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  let count = 0;
  const iter = new Date(s);
  while (iter <= e) {
    const day = iter.getDay();
    if (day !== 0 && day !== 6) count++;
    iter.setDate(iter.getDate() + 1);
  }
  return count;
}

function getWorkingDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const iter = new Date(start);
  const e = new Date(end);
  while (iter <= e) {
    const day = iter.getDay();
    if (day !== 0 && day !== 6) dates.push(fmt(iter));
    iter.setDate(iter.getDate() + 1);
  }
  return dates;
}

const DEPT_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500',
];

const LEAVE_COLORS = [
  'bg-purple-500', 'bg-red-500', 'bg-blue-500', 'bg-amber-500', 'bg-green-500', 'bg-teal-500',
];

const PERIOD_LABELS: Record<Period, string> = {
  this_week: 'This Week',
  this_month: 'This Month',
  last_month: 'Last Month',
  last_3_months: 'Last 3 Months',
};

/* ================================================================== */
/*  Progress Bar                                                       */
/* ================================================================== */

function ProgressBar({ value, max, color = 'bg-blue-500', trackColor = 'bg-gray-100' }: { value: number; max: number; color?: string; trackColor?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className={`h-2 rounded-full ${trackColor} overflow-hidden`}>
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ================================================================== */
/*  Mini Bar Chart                                                     */
/* ================================================================== */

function BarChart({ data, maxVal, height = 120 }: { data: { label: string; value: number; highlight?: boolean }[]; maxVal: number; height?: number }) {
  return (
    <div className="flex items-end gap-1" style={{ height: `${height}px` }}>
      {data.map((d, i) => {
        const h = maxVal > 0 ? Math.max((d.value / maxVal) * 100, 3) : 3;
        return (
          <div key={i} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-[9px] font-mono text-gray-400 tabular-nums">{d.value}</span>
            <div className="w-full flex items-end justify-center" style={{ height: `${height - 30}px` }}>
              <div
                className={`w-full max-w-[32px] rounded-t-sm transition-all ${d.highlight ? 'bg-blue-500' : 'bg-blue-200'}`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`text-[8px] font-medium ${d.highlight ? 'text-blue-600' : 'text-gray-400'}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/*  Headcount Trend Chart                                              */
/* ================================================================== */

function HeadcountChart({ data }: { data: HeadcountTrend[] }) {
  const maxVal = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-2 h-[140px]">
      {data.map((d, i) => {
        const h = maxVal > 0 ? Math.max((d.count / maxVal) * 100, 5) : 5;
        const isLatest = i === data.length - 1;
        return (
          <div key={d.month} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-[10px] font-mono text-gray-500 tabular-nums font-semibold">{d.count}</span>
            <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
              <div
                className={`w-full max-w-[40px] rounded-t-md transition-all ${isLatest ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`text-[9px] font-medium ${isLatest ? 'text-emerald-600' : 'text-gray-400'}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/*  Loading Skeleton                                                   */
/* ================================================================== */

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-[120px] rounded-lg bg-gray-100" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[350px] rounded-lg bg-gray-100" />
        <div className="h-[350px] rounded-lg bg-gray-100" />
      </div>
      <div className="h-[300px] rounded-lg bg-gray-100" />
    </div>
  );
}

/* ================================================================== */
/*  Main Page Component                                                */
/* ================================================================== */

export default function TeamInsightsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('this_month');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data state
  const [kpis, setKpis] = useState<WorkforceKPIs>({ totalHeadcount: 0, activeCount: 0, newJoiners: 0, attritionRate: 0, offboardedCount: 0, pendingOnboarding: 0 });
  const [dailyAttendance, setDailyAttendance] = useState<DailyAttendance[]>([]);
  const [deptAttendance, setDeptAttendance] = useState<DeptAttendance[]>([]);
  const [headcountTrend, setHeadcountTrend] = useState<HeadcountTrend[]>([]);
  const [employeeInsights, setEmployeeInsights] = useState<EmployeeInsight[]>([]);
  const [leaveUtilization, setLeaveUtilization] = useState<LeaveUtilization[]>([]);
  const [deptDistribution, setDeptDistribution] = useState<DeptDistribution[]>([]);

  /* ---- Redirect if not admin ---- */
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  /* ---- Fetch on period change ---- */
  useEffect(() => {
    if (!isAdmin) return;
    fetchAll();
  }, [period, isAdmin]);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await api.teamInsights.get({ period });
      const { employeeCounts, employees: emps, attendance: attData, leaves: lvData, regularisations: regData, leaveTypes: ltData, dateRange } = res;
      const { start: rangeStart, end: rangeEnd } = dateRange;

      // KPIs
      const offCount = employeeCounts.offboarded;
      const total = employeeCounts.total;
      const attrition = total > 0 ? Math.round((offCount / total) * 100 * 10) / 10 : 0;
      setKpis({
        totalHeadcount: total,
        activeCount: employeeCounts.active,
        newJoiners: employeeCounts.newHires,
        attritionRate: attrition,
        offboardedCount: offCount,
        pendingOnboarding: employeeCounts.pendingOnboarding,
      });

      // Daily attendance chart
      const workingDates = getWorkingDatesInRange(rangeStart, rangeEnd);
      const chartDates = workingDates.slice(-14);
      const attCounts: Record<string, number> = {};
      chartDates.forEach((d) => { attCounts[d] = 0; });
      (attData ?? []).forEach((r: any) => { if (attCounts[r.date] !== undefined && (r.status === 'present' || r.status === 'half')) attCounts[r.date]++; });
      setDailyAttendance(chartDates.map((d) => ({ date: d, dayLabel: d.slice(5), count: attCounts[d] ?? 0 })));

      // Department attendance
      const deptEmpMap: Record<string, string[]> = {};
      (emps ?? []).forEach((e: any) => {
        const dept = e.department?.name || 'Unassigned';
        if (!deptEmpMap[dept]) deptEmpMap[dept] = [];
        deptEmpMap[dept].push(e.id);
      });
      const workingDays = getWorkingDays(rangeStart, rangeEnd);
      const deptResult: DeptAttendance[] = [];
      for (const [dept, empIds] of Object.entries(deptEmpMap)) {
        const deptAtt = (attData ?? []).filter((a: any) => empIds.includes(a.employee_id));
        const presentDays = deptAtt.filter((a: any) => a.status === 'present' || a.status === 'half').length;
        const expectedDays = empIds.length * workingDays;
        const avgRate = expectedDays > 0 ? Math.round((presentDays / expectedDays) * 100) : 0;
        const hoursEntries = deptAtt.filter((a: any) => a.worked_hours != null);
        const totalHours = hoursEntries.reduce((s: number, a: any) => s + (Number(a.worked_hours) || 0), 0);
        const avgHours = hoursEntries.length > 0 ? Math.round((totalHours / hoursEntries.length) * 10) / 10 : 0;
        let lateCount = 0;
        deptAtt.forEach((a: any) => {
          if (!a.punch_in) return;
          const pt = new Date(a.punch_in);
          if (pt.getUTCHours() > 4 || (pt.getUTCHours() === 4 && pt.getUTCMinutes() > 30)) lateCount++;
        });
        deptResult.push({ department: dept, totalEmployees: empIds.length, avgAttendanceRate: avgRate, avgHours, lateCount });
      }
      setDeptAttendance(deptResult.sort((a, b) => b.avgAttendanceRate - a.avgAttendanceRate));

      // Headcount trend (last 6 months)
      const nowDate = new Date();
      const months: { start: string; end: string; label: string; month: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const md = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
        const endD = new Date(nowDate.getFullYear(), nowDate.getMonth() - i + 1, 0);
        months.push({ start: fmt(md), end: fmt(endD), label: md.toLocaleDateString('en-IN', { month: 'short' }), month: fmt(md).slice(0, 7) });
      }
      setHeadcountTrend(months.map((mo) => {
        const count = (emps ?? []).filter((e: any) => e.date_of_joining && e.date_of_joining <= mo.end).length;
        return { month: mo.month, label: mo.label, count };
      }));

      // Employee insights
      const insights: EmployeeInsight[] = (emps ?? []).map((emp: any) => {
        const empAtt = (attData ?? []).filter((a: any) => a.employee_id === emp.id);
        const presentDays = empAtt.filter((a: any) => a.status === 'present' || a.status === 'half').length;
        const hoursEntries = empAtt.filter((a: any) => a.worked_hours != null);
        const totalHours = hoursEntries.reduce((s: number, a: any) => s + (Number(a.worked_hours) || 0), 0);
        const avgHours = hoursEntries.length > 0 ? Math.round((totalHours / hoursEntries.length) * 10) / 10 : 0;
        const attendanceRate = workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 0;
        let lateCount = 0;
        empAtt.forEach((a: any) => {
          if (!a.punch_in) return;
          const pt = new Date(a.punch_in);
          if (pt.getUTCHours() > 4 || (pt.getUTCHours() === 4 && pt.getUTCMinutes() > 30)) lateCount++;
        });
        const leavesTaken = (lvData ?? []).filter((l: any) => l.employee_id === emp.id).reduce((s: number, l: any) => s + Number(l.days), 0);
        const regRequests = (regData ?? []).filter((r: any) => r.employee_id === emp.id).length;
        return { name: emp.name, department: emp.department?.name ?? '', avgHours, attendanceRate, lateCount, leavesTaken, regRequests };
      });
      setEmployeeInsights(insights.sort((a, b) => b.avgHours - a.avgHours));

      // Leave utilization
      const empCount = employeeCounts.active || 1;
      const typeUsed: Record<string, number> = {};
      (lvData ?? []).forEach((r: any) => { typeUsed[r.leave_type_id] = (typeUsed[r.leave_type_id] || 0) + Number(r.days); });
      setLeaveUtilization(
        (ltData ?? []).map((lt: any) => {
          const alloc = (lt.leave_allocations as { annual_days: number }[] | null)?.[0]?.annual_days ?? 0;
          const totalAllocated = alloc * empCount;
          const totalUsed = typeUsed[lt.id] || 0;
          return { typeName: lt.name, totalAllocated, totalUsed, percentage: totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0 };
        }).filter((u: any) => u.totalAllocated > 0)
      );

      // Department distribution
      const deptCounts: Record<string, number> = {};
      (emps ?? []).forEach((r: any) => { const dept = r.department?.name || 'Unassigned'; deptCounts[dept] = (deptCounts[dept] || 0) + 1; });
      const deptTotal = Object.values(deptCounts).reduce((s, c) => s + c, 0);
      setDeptDistribution(
        Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).map(([dept, count]) => ({ department: dept, count, percentage: deptTotal > 0 ? Math.round((count / deptTotal) * 100) : 0 }))
      );
    } catch {
      // API unreachable
    }
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }

  const { start, end } = getPeriodDates(period);

  /* ---- CSV Export ---- */
  function exportCSV() {
    if (employeeInsights.length === 0) return;

    const esc = (v: string | number) => {
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = ['Name', 'Department', 'Avg Hours/Day', 'Attendance Rate %', 'Late Arrivals', 'Leaves Taken', 'Reg Requests'];
    const rows = employeeInsights.map((e) => [esc(e.name), esc(e.department), e.avgHours, e.attendanceRate, e.lateCount, e.leavesTaken, e.regRequests].join(','));
    const csv = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team-insights-${period}-${fmt(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---- Guard ---- */
  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) return null;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const maxDaily = Math.max(...dailyAttendance.map((d) => d.count), 1);
  const todayDate = fmt(new Date());

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 m-0">
              Team Insights
            </h1>
          </div>
          <p className="text-xs text-gray-500">
            Comprehensive workforce analytics and employee performance data.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={employeeInsights.length === 0}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ---- Period Tabs ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {(['this_week', 'this_month', 'last_month', 'last_3_months'] as Period[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? 'default' : 'outline'}
            onClick={() => setPeriod(p)}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
        <span className="text-[10px] text-gray-400 ml-2">
          {start} to {end}
        </span>
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <>
          {/* ---- KPI Row ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Users} label="Total Headcount" value={kpis.totalHeadcount} trend={`${kpis.activeCount} active`} color="blue" />
            <StatCard icon={UserPlus} label="New Joiners" value={kpis.newJoiners} trend={PERIOD_LABELS[period]} trendDirection={kpis.newJoiners > 0 ? 'up' : 'neutral'} color="green" />
            <StatCard icon={UserMinus} label="Attrition Rate" value={`${kpis.attritionRate}%`} trend={`${kpis.offboardedCount} departed`} trendDirection={kpis.attritionRate > 5 ? 'down' : 'neutral'} color="red" />
            <StatCard icon={UserCog} label="Pending Onboarding" value={kpis.pendingOnboarding} trend={kpis.pendingOnboarding > 0 ? 'Needs attention' : 'All clear'} trendDirection={kpis.pendingOnboarding > 0 ? 'down' : 'up'} color="yellow" />
          </div>

          {/* ---- Headcount Trend ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Headcount Trend
              </CardTitle>
              <CardDescription>Employee count over the last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <HeadcountChart data={headcountTrend} />
            </CardContent>
          </Card>

          {/* ---- Attendance + Department Distribution ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Attendance Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  Attendance Trend
                </CardTitle>
                <CardDescription>Daily attendance count in the period</CardDescription>
              </CardHeader>
              <CardContent>
                {dailyAttendance.length > 0 ? (
                  <BarChart
                    data={dailyAttendance.map((d) => ({
                      label: d.dayLabel,
                      value: d.count,
                      highlight: d.date === todayDate,
                    }))}
                    maxVal={maxDaily}
                  />
                ) : (
                  <p className="text-[12px] text-gray-400 text-center py-8">No attendance data for this period</p>
                )}
              </CardContent>
            </Card>

            {/* Department Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-purple-500" />
                  Department Distribution
                </CardTitle>
                <CardDescription>{kpis.activeCount} active employees</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {deptDistribution.map((dept, i) => (
                    <div key={dept.department} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-gray-700">{dept.department}</span>
                        <span className="text-[11px] text-gray-400">{dept.count} ({dept.percentage}%)</span>
                      </div>
                      <ProgressBar value={dept.count} max={deptDistribution[0]?.count ?? 1} color={DEPT_COLORS[i % DEPT_COLORS.length]} trackColor="bg-gray-50" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---- Department-wise Attendance Table ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-indigo-500" />
                Department-wise Attendance Breakdown
              </CardTitle>
              <CardDescription>Attendance metrics per department for {PERIOD_LABELS[period].toLowerCase()}</CardDescription>
            </CardHeader>
            <CardContent>
              {deptAttendance.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-center">Employees</TableHead>
                        <TableHead className="text-center">Attendance Rate</TableHead>
                        <TableHead className="text-center">Avg Hours/Day</TableHead>
                        <TableHead className="text-center">Late Arrivals</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deptAttendance.map((dept) => (
                        <TableRow key={dept.department}>
                          <TableCell className="font-medium">{dept.department}</TableCell>
                          <TableCell className="text-center">{dept.totalEmployees}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={dept.avgAttendanceRate >= 80 ? 'green' : dept.avgAttendanceRate >= 60 ? 'amber' : 'red'}>
                              {dept.avgAttendanceRate}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={dept.avgHours >= 8 ? 'green' : dept.avgHours >= 6 ? 'amber' : 'red'}>
                              {dept.avgHours}h
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {dept.lateCount > 0 ? (
                              <Badge variant="amber">{dept.lateCount}</Badge>
                            ) : (
                              <Badge variant="green">0</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-[12px] text-gray-400 text-center py-6">No department attendance data available</p>
              )}
            </CardContent>
          </Card>

          {/* ---- Leave Utilization ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-green-500" />
                Leave Utilization
              </CardTitle>
              <CardDescription>Organization-wide leave usage for {PERIOD_LABELS[period].toLowerCase()}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {leaveUtilization.map((lu, i) => (
                  <div key={lu.typeName} className="space-y-2 p-3 rounded-lg border border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-gray-700">{lu.typeName}</span>
                      <span className="text-[11px] font-mono text-gray-400">{lu.percentage}%</span>
                    </div>
                    <ProgressBar value={lu.totalUsed} max={lu.totalAllocated} color={LEAVE_COLORS[i % LEAVE_COLORS.length]} trackColor="bg-gray-50" />
                    <p className="text-[10px] text-gray-400">{lu.totalUsed} of {lu.totalAllocated} days used</p>
                  </div>
                ))}
                {leaveUtilization.length === 0 && (
                  <p className="text-[12px] text-gray-400 text-center py-4 col-span-full">No leave data for this period</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ---- Employee Performance Table ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                Employee Performance Overview
              </CardTitle>
              <CardDescription>Individual metrics for {PERIOD_LABELS[period].toLowerCase()} - sorted by avg hours</CardDescription>
            </CardHeader>
            <CardContent>
              {employeeInsights.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-center">Avg Hours/Day</TableHead>
                        <TableHead className="text-center">Attendance %</TableHead>
                        <TableHead className="text-center">Late</TableHead>
                        <TableHead className="text-center">Leaves</TableHead>
                        <TableHead className="text-center">Reg Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeInsights.map((emp) => (
                        <TableRow key={emp.name}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-gray-500 text-[12px]">{emp.department}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={emp.avgHours >= 8 ? 'green' : emp.avgHours >= 6 ? 'amber' : 'red'}>
                              {emp.avgHours}h
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={emp.attendanceRate >= 80 ? 'green' : emp.attendanceRate >= 60 ? 'amber' : 'red'}>
                              {emp.attendanceRate}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {emp.lateCount > 0 ? (
                              <Badge variant="amber">{emp.lateCount}</Badge>
                            ) : (
                              <span className="text-[11px] text-gray-300">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-[12px] text-gray-600">{emp.leavesTaken}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            {emp.regRequests > 0 ? (
                              <Badge variant="amber">{emp.regRequests}</Badge>
                            ) : (
                              <span className="text-[11px] text-gray-300">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-[12px] text-gray-400 text-center py-6">No performance data available for this period</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
