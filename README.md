# HRMS Frontend

Modern Human Resource Management System (HRMS) frontend built with Next.js 15, React 18, TypeScript, and Tailwind CSS. Featuring AI facial recognition attendance tracking, role-based dashboards, leave management, audit logs, and payroll analytics.

## 🚀 Features

- **Authentication**: JWT-based auth with role-based routing (Admin, Manager, Employee), OTP password reset.
- **Attendance & Face Recognition**: Live webcam capture integration for AI-powered facial attendance marking.
- **Role-based Dashboards**:
  - **Admin Dashboard**: System-wide statistics, audit logs, employee directory, and payroll management.
  - **Employee Portal**: Personal profile, attendance records, leave applications, and salary slips.
- **Leave Management**: Leave application workflow, approval system, balance counters.
- **Audit Logs & Notifications**: Real-time event tracking and notifications.
- **Theme Support**: Dark mode / Light mode support with Tailwind CSS.

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **UI & Styling**: React 18, [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), Lucide Icons
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Forms & Validation**: React Hook Form, Zod
- **Charts**: Recharts
- **HTTP Client**: Axios

## 📋 Prerequisites

- **Node.js**: v18.17.0 or higher
- **npm** or **yarn** or **pnpm**

## ⚙️ Getting Started

### 1. Installation

```bash
cd hrms-frontend
npm install
```

### 2. Environment Configuration

Copy the sample environment file:

```bash
cp .env.local.example .env.local
```

Configure your backend API URL in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production

```bash
npm run build
npm start
```

## 🐳 Docker Setup

Build and run using Docker:

```bash
docker build -t hrms-frontend .
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://localhost:8000/api hrms-frontend
```

## 📄 License

Proprietary - All rights reserved.
