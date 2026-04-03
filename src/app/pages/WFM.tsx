import { PageLayout } from "../components/PageLayout";
import { Calendar, Users, BarChart3, Clock, TrendingUp, FileText, UserCog, Phone, Grid, Monitor, PieChart, LineChart, Database, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import React from "react";

export function WFM() {
  const wfmModules = [
    {
      title: "Long Term Forecasting (Demand)",
      description: "Forecast monthly contact demand and required staffing needs",
      icon: LineChart,
      stats: "Demand Only",
      path: "/wfm/long-term-forecasting-demand",
    },
    {
      title: "Workforce Planning",
      description: "Forecast staffing needs and optimize resource allocation",
      icon: Users,
      stats: "156 Employees",
      path: "/wfm/capacity",
    },
    {
      title: "Schedule Management",
      description: "Create, edit, and publish employee schedules",
      icon: Calendar,
      stats: "24 Active Schedules",
    },
    {
      title: "Real Time Management",
      description: "Monitor live queue activity, agent states, and SLA in real time",
      icon: Monitor,
      stats: "Coming Soon",
      placeholder: true,
    },
    {
      title: "Time & Attendance",
      description: "Monitor clock-ins, breaks, and time-off requests",
      icon: Clock,
      stats: "12 Pending Requests",
    },
    {
      title: "Productivity Report",
      description: "Analyze agent productivity, utilization, and output trends",
      icon: PieChart,
      stats: "Coming Soon",
      placeholder: true,
    },
    {
      title: "Performance Analytics",
      description: "Track KPIs, service levels, and detailed queue performance metrics",
      icon: BarChart3,
      stats: "Detailed KPIs",
      path: "/wfm/performance-analytics",
    },
    {
      title: "Interaction Arrival",
      description: "Intraday volume and AHT by 15-min intervals",
      icon: Grid,
      stats: "Intraday",
      path: "/wfm/interaction-arrival",
    },
    {
      title: "Arrival Analysis",
      description: "YoY, monthly, weekly, daily & intraday volume pivot — short & long-term forecasting",
      icon: LineChart,
      stats: "Pivot & Export",
      path: "/wfm/arrival-analysis",
    },
    {
      title: "Employee Roster",
      description: "Manage employee profiles, skills, and availability",
      icon: UserCog,
      stats: "156 Employees",
      path: "/wfm/roster",
    },
    {
      title: "Telephony Integrations",
      description: "Connect and manage telephony systems and call routing",
      icon: Phone,
      stats: "5 Active Systems",
    },
    {
      title: "Telephony Raw Data",
      description: "Import and manage raw call records, AHT, and agent activity logs",
      icon: Database,
      stats: "Import Tool",
      path: "/wfm/telephony-raw",
    },
  ];

  return (
    <PageLayout title="Workforce Management">
      <div className="grid md:grid-cols-3 gap-6">
        {wfmModules.map((module) => {
          const isPlaceholder = (module as any).placeholder === true;

          const CardContent = (
            <div className={`bg-card border rounded-lg p-6 transition-all h-full
              ${isPlaceholder
                ? "border-dashed border-border opacity-60 cursor-default"
                : "border-border hover:shadow-lg hover:border-primary/30 cursor-pointer group"
              }`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-lg transition-colors
                  ${isPlaceholder
                    ? "bg-muted"
                    : "bg-primary/10 group-hover:bg-primary/20"
                  }`}>
                  <module.icon className={`size-6 ${isPlaceholder ? "text-muted-foreground" : "text-primary"}`} />
                </div>
                <span className={`text-xs px-3 py-1 rounded-full
                  ${isPlaceholder
                    ? "bg-muted text-muted-foreground border border-dashed border-border"
                    : "bg-accent text-accent-foreground"
                  }`}>
                  {module.stats}
                </span>
              </div>
              <h3 className={`text-lg font-semibold mb-2 transition-colors
                ${isPlaceholder
                  ? "text-muted-foreground"
                  : "text-card-foreground group-hover:text-primary"
                }`}>
                {module.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {module.description}
              </p>
            </div>
          );

          if (isPlaceholder) {
            return <div key={module.title}>{CardContent}</div>;
          }

          return (module as any).path ? (
            <Link key={module.title} to={(module as any).path} className="block no-underline text-inherit">
              {CardContent}
            </Link>
          ) : (
            <div key={module.title}>{CardContent}</div>
          );
        })}
      </div>
    </PageLayout>
  );
}
