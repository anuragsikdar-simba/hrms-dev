# August HRMS

Modern Human Resource Management System built with Next.js 14, React 18, Tailwind CSS, and Supabase.

## Features

- **Attendance & Time Tracking**: Shift management, punch in/out, break derivation, auto-punch out cap, and geofencing with approved locations.
- **Leave Management**: Leave requests, multi-type allocations, team calendar, and approval workflows.
- **Payroll & Payslips**: Effective-dated salary structures, automatic loss-of-pay (LOP) calculations, statutory deductions (PF, ESI, PT), immutable payslip snapshots, and server-generated PDF payslips.
- **Employee Directory**: Profile management, custom fields, department assignment, and reporting lines.
- **Approvals Workflow**: Triage queue for leave requests, regularisations, WFH, and location violations.
- **Team Insights**: Real-time workforce analytics, attendance trends, and headcount distribution.
- **Skeleton Loading**: Seamless transitions with content-matched skeleton placeholders across all routes.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Frontend**: React 18, Tailwind CSS, Lucide Icons
- **Backend & Auth**: Supabase (PostgreSQL, Row Level Security, Storage, Auth)
- **PDF Generation**: pdf-lib
- **Language**: TypeScript

## Getting Started

1. Copy `.env.example` to `.env.local` and configure your Supabase project credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   # or for LAN phone access:
   npm run dev:network
   ```
4. Open [http://localhost:3000](http://localhost:3000).

## License

Private & Proprietary.
