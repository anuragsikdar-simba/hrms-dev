'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  UserPlus,
  UserMinus,
  UserCog,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileCheck2,
  FileX2,
  Building2,
  CalendarDays,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/stat-card';
import api from '@/lib/api-client';

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface WorkforceKPIs {
  totalHeadcount: number;
  activeCount: number;
  newJoinersThisMonth: number;
  attritionRate: number;
  offboardedCount: number;
  pendingOnboarding: number;
}

interface DailyAttendance {
  date: string;
  dayLabel: string;
  count: number;
}

interface LateArrival {
  name: string;
  department: string;
  lateCount: number;
}

interface DeptDistribution {
  department: string;
  count: number;
  percentage: number;
}

interface LeaveUtilization {
  typeName: string;
  totalAllocated: number;
  totalUsed: number;
  percentage: number;
}

interface LowLeaveEmployee {
  name: string;
  department: string;
  remainingDays: number;
  totalDays: number;
}

interface WorkHoursEmployee {
  name: string;
  department: string;
  avgHours: number;
  totalDays: number;
}

interface RegRequestEmployee {
  name: string;
  department: string;
  requestCount: number;
}

interface DocCompliance {
  totalEmployees: number;
  fullyVerified: number;
  pendingDocs: number;
  noDocs: number;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLast7WorkingDays(): string[] {
  const dates: string[] = [];
  const d = new Date();
  while (dates.length < 7) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      dates.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
}

const DEPT_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-pink-500',
];

const LEAVE_COLORS = [
  'bg-purple-500',
  'bg-red-500',
  'bg-blue-500',
  'bg-amber-500',
  'bg-green-500',
  'bg-teal-500',
];

/* ================================================================== */
/*  Mini Bar Chart (CSS only)                                          */
/* ================================================================== */

function MiniBarChart({ data, maxVal }: { data: DailyAttendance[]; maxVal: number }) {
  const today = todayStr();
  return (
    <div className="flex items-end gap-1.5 h-[80px]">
      {data.map((d) => {
        const height = maxVal > 0 ? Math.max((d.count / maxVal) * 100, 4) : 4;
        const isToday = d.date === today;
        return (
          <div key={d.date} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-[9px] font-mono text-gray-400 tabular-nums">{d.count}</span>
            <div className="w-full flex items-end justify-center" style={{ height: '60px' }}>
              <div
                className={`w-full max-w-[28px] rounded-t-sm transition-all ${isToday ? 'bg-blue-500' : 'bg-blue-200'}`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className={`text-[9px] font-medium ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>{d.dayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}

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
/*  Skeleton loader                                                    */
/* ================================================================== */

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[120px] rounded-lg bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[300px] rounded-lg bg-gray-100" />
        <div className="h-[300px] rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export function HRAnalytics() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<WorkforceKPIs>({
    totalHeadcount: 0,
    activeCount: 0,
    newJoinersThisMonth: 0,
    attritionRate: 0,
    offboardedCount: 0,
    pendingOnboarding: 0,
  });
  const [dailyAttendance, setDailyAttendance] = useState<DailyAttendance[]>([]);
  const [avgWorkHoursWeek, setAvgWorkHoursWeek] = useState(0);
  const [attendanceRateMonth, setAttendanceRateMonth] = useState(0);
  const [lateArrivals, setLateArrivals] = useState<LateArrival[]>([]);
  const [deptDistribution, setDeptDistribution] = useState<DeptDistribution[]>([]);
  const [leaveUtilization, setLeaveUtilization] = useState<LeaveUtilization[]>([]);
  const [lowLeaveEmployees, setLowLeaveEmployees] = useState<LowLeaveEmployee[]>([]);
  const [topPerformers, setTopPerformers] = useState<WorkHoursEmployee[]>([]);
  const [bottomPerformers, setBottomPerformers] = useState<WorkHoursEmployee[]>([]);
  const [regRequests, setRegRequests] = useState<RegRequestEmployee[]>([]);
  const [docCompliance, setDocCompliance] = useState<DocCompliance>({
    totalEmployees: 0,
    fullyVerified: 0,
    pendingDocs: 0,
    noDocs: 0,
  });

  useEffect(() => {
    fetchAllAnalytics();
  }, []);

  async function fetchAllAnalytics() {
    setLoading(true);
    try {
      await Promise.all([
        fetchWorkforceKPIs(),
        fetchAttendanceInsights(),
        fetchDeptDistribution(),
        fetchLeaveAnalytics(),
        fetchPerformanceSnapshot(),
        fetchDocCompliance(),
      ]);
    } catch {
      // Supabase unreachable - keep empty state
    }
    setLoading(false);
  }

  /* ---- Workforce KPIs ---- */
  async function fetchWorkforceKPIs() {
    try {
      const monthStart = getMonthStart();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);

      const { employees } = await api.employees.list();

      const notOffboarded = employees.filter((e: any) => e.status !== 'offboarded');
      const activeCount = notOffboarded.filter((e: any) => e.status === 'active').length;
      const totalCount = notOffboarded.length;

      const newJoinersCount = employees.filter(
        (e: any) => e.status === 'active' && e.date_of_joining >= monthStart
      ).length;

      const offCount = employees.filter(
        (e: any) => e.status === 'offboarded' && e.updated_at?.slice(0, 10) >= thirtyDaysAgoStr
      ).length;

      const pendingOnboardCount = employees.filter(
        (e: any) => e.onboarding_status !== 'completed' && e.status !== 'offboarded'
      ).length;

      const attrition = totalCount > 0 ? Math.round((offCount / totalCount) * 100 * 10) / 10 : 0;

      setKpis({
        totalHeadcount: totalCount,
        activeCount,
        newJoinersThisMonth: newJoinersCount,
        attritionRate: attrition,
        offboardedCount: offCount,
        pendingOnboarding: pendingOnboardCount,
      });
    } catch {
      // API unreachable - keep empty state
    }
  }

  /* ---- Attendance Insights ---- */
  async function fetchAttendanceInsights() {
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    const today = todayStr();
    const last7Days = getLast7WorkingDays();

    // Fetch all attendance and employees via API
    const [attResult, empResult] = await Promise.all([
      api.attendance.list(),
      api.employees.list(),
    ]);
    const allAtt = attResult.records ?? [];
    const allEmps = empResult.employees ?? [];
    // Observers (tracks_attendance === false) never punch in, so exclude them
    // from the attendance-rate denominator to avoid skewing the percentage.
    const activeEmpCount = allEmps.filter(
      (e: any) => e.status === 'active' && e.tracks_attendance !== false
    ).length;

    // Daily attendance for last 7 working days
    const dailyData = allAtt.filter((r: any) => last7Days.includes(r.date) && (r.status === 'present' || r.status === 'half'));
    const dailyCounts: Record<string, number> = {};
    last7Days.forEach((d) => { dailyCounts[d] = 0; });
    dailyData.forEach((r: any) => {
      if (dailyCounts[r.date] !== undefined) dailyCounts[r.date]++;
    });

    setDailyAttendance(last7Days.map((d) => ({
      date: d,
      dayLabel: shortDay(d),
      count: dailyCounts[d] ?? 0,
    })));

    // Average working hours this week
    const weekHours = allAtt.filter((r: any) => r.date >= weekStart && r.date <= today && r.worked_hours != null);
    if (weekHours.length > 0) {
      const total = weekHours.reduce((s: number, r: any) => s + (Number(r.worked_hours) || 0), 0);
      setAvgWorkHoursWeek(Math.round((total / weekHours.length) * 10) / 10);
    }

    // Attendance rate this month
    const monthAtt = allAtt.filter((r: any) => r.date >= monthStart && r.date <= today && (r.status === 'present' || r.status === 'half'));

    // Calculate working days this month (excluding weekends)
    const mStart = new Date(monthStart);
    const tDate = new Date(today);
    let workingDays = 0;
    const iter = new Date(mStart);
    while (iter <= tDate) {
      const day = iter.getDay();
      if (day !== 0 && day !== 6) workingDays++;
      iter.setDate(iter.getDate() + 1);
    }

    const expectedAttendances = workingDays * (activeEmpCount || 1);
    const actualAttendances = monthAtt.length;
    setAttendanceRateMonth(expectedAttendances > 0 ? Math.round((actualAttendances / expectedAttendances) * 100) : 0);

    // Late arrivals (punch_in after 10:00 AM IST = 04:30 UTC)
    const monthAttWithPunch = allAtt.filter((r: any) => r.date >= monthStart && r.date <= today && r.punch_in);
    const lateCounts: Record<string, { name: string; department: string; count: number }> = {};
    // Build emp lookup
    const empLookup: Record<string, { name: string; department: string }> = {};
    allEmps.forEach((e: any) => { empLookup[e.id] = { name: e.name, department: e.department?.name ?? '' }; });

    monthAttWithPunch.forEach((r: any) => {
      const punchTime = new Date(r.punch_in);
      const hours = punchTime.getUTCHours();
      const minutes = punchTime.getUTCMinutes();
      const isLate = hours > 4 || (hours === 4 && minutes > 30);
      if (isLate) {
        const emp = empLookup[r.employee_id];
        if (!lateCounts[r.employee_id]) {
          lateCounts[r.employee_id] = { name: emp?.name ?? 'Unknown', department: emp?.department ?? '', count: 0 };
        }
        lateCounts[r.employee_id].count++;
      }
    });

    setLateArrivals(
      Object.values(lateCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((v) => ({ name: v.name, department: v.department, lateCount: v.count }))
    );
  }

  /* ---- Department Distribution ---- */
  async function fetchDeptDistribution() {
    const { employees } = await api.employees.list();

    const counts: Record<string, number> = {};
    (employees ?? []).filter((e: any) => e.status === 'active').forEach((r: any) => {
      const dept = r.department?.name || 'Unassigned';
      counts[dept] = (counts[dept] || 0) + 1;
    });

    const total = Object.values(counts).reduce((s, c) => s + c, 0);
    setDeptDistribution(
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([dept, count]) => ({
          department: dept,
          count,
          percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        }))
    );
  }

  /* ---- Leave Analytics ---- */
  async function fetchLeaveAnalytics() {
    const [leavesResult, empResult] = await Promise.all([
      api.leaves.list(),
      api.employees.list(),
    ]);

    const leaveTypes = leavesResult.leaveTypes ?? [];
    const leaveAllocations = leavesResult.leaveAllocations ?? [];
    const leaveReqs = (leavesResult.requests ?? []).filter((r: any) => r.status === 'approved');
    const activeEmps = (empResult.employees ?? []).filter((e: any) => e.status === 'active');
    const empCount = activeEmps.length || 1;

    // Build allocation map
    const allocMap: Record<string, number> = {};
    leaveAllocations.forEach((a: any) => { allocMap[a.leave_type_id] = a.annual_days; });

    // Calculate utilization per type
    const typeUsed: Record<string, number> = {};
    leaveReqs.forEach((r: any) => {
      typeUsed[r.leave_type_id] = (typeUsed[r.leave_type_id] || 0) + Number(r.days);
    });

    const utilization: LeaveUtilization[] = leaveTypes.map((lt: any) => {
      const alloc = allocMap[lt.id] ?? 0;
      const totalAllocated = alloc * empCount;
      const totalUsed = typeUsed[lt.id] || 0;
      return {
        typeName: lt.name,
        totalAllocated,
        totalUsed,
        percentage: totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0,
      };
    });

    setLeaveUtilization(utilization.filter((u) => u.totalAllocated > 0));

    // Employees with lowest remaining leave
    const totalAllocPerPerson = leaveTypes.reduce((s: number, lt: any) => s + (allocMap[lt.id] ?? 0), 0);

    const employeeUsage: Record<string, { name: string; department: string; totalUsed: number; totalAlloc: number }> = {};
    activeEmps.forEach((e: any) => {
      employeeUsage[e.id] = { name: e.name, department: e.department?.name ?? '', totalUsed: 0, totalAlloc: totalAllocPerPerson };
    });

    leaveReqs.forEach((r: any) => {
      if (employeeUsage[r.employee_id]) {
        employeeUsage[r.employee_id].totalUsed += Number(r.days);
      }
    });

    const lowLeave = Object.values(employeeUsage)
      .map((e) => ({
        name: e.name,
        department: e.department || 'Unassigned',
        remainingDays: e.totalAlloc - e.totalUsed,
        totalDays: e.totalAlloc,
      }))
      .sort((a, b) => a.remainingDays - b.remainingDays)
      .slice(0, 5);

    setLowLeaveEmployees(lowLeave);
  }

  /* ---- Performance Snapshot ---- */
  async function fetchPerformanceSnapshot() {
    const monthStart = getMonthStart();
    const today = todayStr();

    const [attResult, empResult, regResult] = await Promise.all([
      api.attendance.list(),
      api.employees.list(),
      api.approvalRequests.list({ type: 'regularisation' }),
    ]);

    const allAtt = (attResult.records ?? []).filter((r: any) => r.date >= monthStart && r.date <= today && r.worked_hours != null);
    const allEmps = empResult.employees ?? [];
    const empLookup: Record<string, { name: string; department: string }> = {};
    allEmps.forEach((e: any) => { empLookup[e.id] = { name: e.name, department: e.department?.name ?? '' }; });

    // Avg working hours per employee this month
    const empHours: Record<string, { name: string; department: string; totalHours: number; days: number }> = {};
    allAtt.forEach((r: any) => {
      const emp = empLookup[r.employee_id];
      if (!empHours[r.employee_id]) {
        empHours[r.employee_id] = { name: emp?.name ?? 'Unknown', department: emp?.department ?? '', totalHours: 0, days: 0 };
      }
      empHours[r.employee_id].totalHours += Number(r.worked_hours) || 0;
      empHours[r.employee_id].days++;
    });

    const sorted = Object.values(empHours)
      .map((e) => ({
        name: e.name,
        department: e.department || 'Unassigned',
        avgHours: e.days > 0 ? Math.round((e.totalHours / e.days) * 10) / 10 : 0,
        totalDays: e.days,
      }))
      .filter((e) => e.totalDays >= 3) // Minimum 3 days for meaningful average
      .sort((a, b) => b.avgHours - a.avgHours);

    setTopPerformers(sorted.slice(0, 5));
    setBottomPerformers([...sorted].reverse().slice(0, 5));

    // Regularisation requests
    const regData = regResult.requests ?? [];
    const regCounts: Record<string, { name: string; department: string; count: number }> = {};
    regData.forEach((r: any) => {
      const emp = empLookup[r.employee_id];
      if (!regCounts[r.employee_id]) {
        regCounts[r.employee_id] = { name: emp?.name ?? 'Unknown', department: emp?.department ?? '', count: 0 };
      }
      regCounts[r.employee_id].count++;
    });

    setRegRequests(
      Object.values(regCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((v) => ({ name: v.name, department: v.department, requestCount: v.count }))
    );
  }

  /* ---- Document Compliance ---- */
  async function fetchDocCompliance() {
    const [empResult, docResult] = await Promise.all([
      api.employees.list(),
      api.documents.list(),
    ]);

    const empIds = (empResult.employees ?? []).filter((e: any) => e.status === 'active').map((e: any) => e.id);
    const totalEmployees = empIds.length;

    if (totalEmployees === 0) {
      setDocCompliance({ totalEmployees: 0, fullyVerified: 0, pendingDocs: 0, noDocs: 0 });
      return;
    }

    const docs = (docResult.documents ?? []).filter((d: any) => empIds.includes(d.employee_id));

    const empDocStatus: Record<string, { total: number; verified: number }> = {};
    empIds.forEach((id: string) => { empDocStatus[id] = { total: 0, verified: 0 }; });

    docs.forEach((d: any) => {
      if (empDocStatus[d.employee_id]) {
        empDocStatus[d.employee_id].total++;
        if (d.verified) empDocStatus[d.employee_id].verified++;
      }
    });

    let fullyVerified = 0;
    let pendingDocs = 0;
    let noDocs = 0;

    Object.values(empDocStatus).forEach((s) => {
      if (s.total === 0) noDocs++;
      else if (s.verified === s.total) fullyVerified++;
      else pendingDocs++;
    });

    setDocCompliance({ totalEmployees, fullyVerified, pendingDocs, noDocs });
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (loading) return <AnalyticsSkeleton />;

  const maxDaily = Math.max(...dailyAttendance.map((d) => d.count), 1);
  const compliancePct = docCompliance.totalEmployees > 0
    ? Math.round((docCompliance.fullyVerified / docCompliance.totalEmployees) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* ---- Section Header ---- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-gray-400" />
          <h2 className="text-[15px] font-semibold text-gray-900">Team Insights</h2>
        </div>
        <Link
          href="/team-insights"
          className="flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          View detailed analytics
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* ---- KPI Row ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="Total Headcount"
          value={kpis.totalHeadcount}
          trend={`${kpis.activeCount} active`}
          trendDirection="neutral"
          color="blue"
        />
        <StatCard
          icon={UserPlus}
          label="New Joiners"
          value={kpis.newJoinersThisMonth}
          trend="This month"
          trendDirection={kpis.newJoinersThisMonth > 0 ? 'up' : 'neutral'}
          color="green"
        />
        <StatCard
          icon={UserMinus}
          label="Attrition Rate"
          value={`${kpis.attritionRate}%`}
          trend={`${kpis.offboardedCount} in last 30 days`}
          trendDirection={kpis.attritionRate > 5 ? 'down' : 'neutral'}
          color="red"
        />
        <StatCard
          icon={UserCog}
          label="Pending Onboarding"
          value={kpis.pendingOnboarding}
          trend={kpis.pendingOnboarding > 0 ? 'Needs attention' : 'All clear'}
          trendDirection={kpis.pendingOnboarding > 0 ? 'down' : 'up'}
          color="yellow"
        />
      </div>

      {/* ---- Row 2: Attendance + Department ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attendance Insights */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  Attendance Insights
                </CardTitle>
                <CardDescription className="mt-0.5">This month's attendance overview</CardDescription>
              </div>
              <div className="flex gap-2">
                <div className="text-center">
                  <p className="text-[20px] font-bold text-gray-900">{avgWorkHoursWeek}h</p>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wider">Avg/day (week)</p>
                </div>
                <div className="text-center">
                  <p className="text-[20px] font-bold text-gray-900">{attendanceRateMonth}%</p>
                  <p className="text-[9px] text-gray-400 uppercase tracking-wider">Rate (month)</p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Daily bar chart */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Daily Attendance (Last 7 working days)</p>
                <MiniBarChart data={dailyAttendance} maxVal={maxDaily} />
              </div>

              {/* Late arrivals */}
              {lateArrivals.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    Frequent Late Arrivals (after 10 AM)
                  </p>
                  <div className="space-y-1.5">
                    {lateArrivals.map((la) => (
                      <div key={la.name} className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-semibold text-amber-600">
                            {la.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <span className="flex-1 text-[11px] text-gray-700 truncate">{la.name}</span>
                        <span className="text-[10px] text-gray-400">{la.department}</span>
                        <Badge variant="amber">{la.lateCount}x</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Department Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-500" />
              Department Distribution
            </CardTitle>
            <CardDescription className="mt-0.5">{kpis.activeCount} active employees across departments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {deptDistribution.map((dept, i) => (
                <div key={dept.department} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-gray-700">{dept.department}</span>
                    <span className="text-[11px] text-gray-400">
                      {dept.count} ({dept.percentage}%)
                    </span>
                  </div>
                  <ProgressBar
                    value={dept.count}
                    max={deptDistribution[0]?.count ?? 1}
                    color={DEPT_COLORS[i % DEPT_COLORS.length]}
                    trackColor="bg-gray-50"
                  />
                </div>
              ))}
              {deptDistribution.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-4">No department data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Row 3: Leave Analytics + Performance ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leave Analytics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-green-500" />
              Leave Utilization
            </CardTitle>
            <CardDescription className="mt-0.5">Organization-wide leave usage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {leaveUtilization.map((lu, i) => (
                <div key={lu.typeName} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-gray-700">{lu.typeName}</span>
                    <span className="text-[11px] text-gray-400">
                      {lu.totalUsed}/{lu.totalAllocated} days ({lu.percentage}%)
                    </span>
                  </div>
                  <ProgressBar
                    value={lu.totalUsed}
                    max={lu.totalAllocated}
                    color={LEAVE_COLORS[i % LEAVE_COLORS.length]}
                    trackColor="bg-gray-50"
                  />
                </div>
              ))}
              {leaveUtilization.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-4">No leave data available</p>
              )}

              {/* Low balance employees */}
              {lowLeaveEmployees.length > 0 && lowLeaveEmployees.some((e) => e.remainingDays < e.totalDays * 0.2) && (
                <div className="border-t border-gray-100 pt-3 mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                    Low Leave Balance
                  </p>
                  <div className="space-y-1.5">
                    {lowLeaveEmployees
                      .filter((e) => e.remainingDays < e.totalDays * 0.2)
                      .map((e) => (
                        <div key={e.name} className="flex items-center gap-2">
                          <span className="flex-1 text-[11px] text-gray-700 truncate">{e.name}</span>
                          <Badge variant="red">{e.remainingDays} days left</Badge>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance Snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Work Hours Snapshot
            </CardTitle>
            <CardDescription className="mt-0.5">Average daily hours this month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Top performers */}
              {topPerformers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    Highest Avg Hours
                  </p>
                  <div className="space-y-1.5">
                    {topPerformers.map((e, i) => (
                      <div key={e.name} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-300 w-4 shrink-0">#{i + 1}</span>
                        <span className="flex-1 text-[11px] text-gray-700 truncate">{e.name}</span>
                        <span className="text-[10px] text-gray-400">{e.department}</span>
                        <Badge variant="green">{e.avgHours}h</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom performers */}
              {bottomPerformers.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                    <TrendingDown className="h-3 w-3 text-red-500" />
                    Lowest Avg Hours
                  </p>
                  <div className="space-y-1.5">
                    {bottomPerformers.map((e, i) => (
                      <div key={e.name} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-300 w-4 shrink-0">#{i + 1}</span>
                        <span className="flex-1 text-[11px] text-gray-700 truncate">{e.name}</span>
                        <span className="text-[10px] text-gray-400">{e.department}</span>
                        <Badge variant="red">{e.avgHours}h</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Regularisation requests */}
              {regRequests.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    Most Regularisation Requests
                  </p>
                  <div className="space-y-1.5">
                    {regRequests.map((e) => (
                      <div key={e.name} className="flex items-center gap-2">
                        <span className="flex-1 text-[11px] text-gray-700 truncate">{e.name}</span>
                        <span className="text-[10px] text-gray-400">{e.department}</span>
                        <Badge variant="amber">{e.requestCount}x</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {topPerformers.length === 0 && bottomPerformers.length === 0 && (
                <p className="text-[12px] text-gray-400 text-center py-4">Not enough attendance data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Row 4: Document Compliance ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-teal-500" />
            Document Compliance
          </CardTitle>
          <CardDescription className="mt-0.5">Employee document verification status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-green-50">
              <FileCheck2 className="h-5 w-5 text-green-600 mx-auto mb-1" />
              <p className="text-[22px] font-bold text-green-700">{docCompliance.fullyVerified}</p>
              <p className="text-[10px] text-green-600 uppercase tracking-wider font-medium">Fully Verified</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600 mx-auto mb-1" />
              <p className="text-[22px] font-bold text-amber-700">{docCompliance.pendingDocs}</p>
              <p className="text-[10px] text-amber-600 uppercase tracking-wider font-medium">Pending Verification</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50">
              <FileX2 className="h-5 w-5 text-red-600 mx-auto mb-1" />
              <p className="text-[22px] font-bold text-red-700">{docCompliance.noDocs}</p>
              <p className="text-[10px] text-red-600 uppercase tracking-wider font-medium">No Documents</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-gray-500">Overall compliance</span>
              <span className="text-[11px] font-semibold text-gray-700">{compliancePct}%</span>
            </div>
            <ProgressBar
              value={docCompliance.fullyVerified}
              max={docCompliance.totalEmployees}
              color="bg-teal-500"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
