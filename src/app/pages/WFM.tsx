import { PageLayout } from "../components/PageLayout";
import { Calendar, Users, BarChart3, Clock, TrendingUp, FileText, UserCog, Phone, Grid } from "lucide-react";
import { Link } from "react-router-dom";
import React from "react";

export function WFM() {
  const wfmModules = [
    {
      title: "Schedule Management",
      description: "Create, edit, and publish employee schedules",
      icon: Calendar,
      stats: "24 Active Schedules",
    },
    {
      title: "Employee Roster",
      description: "Manage employee profiles, skills, and availability",
      icon: UserCog,
      stats: "156 Employees",
      path: "/wfm/roster",
    },
    {
      title: "Workforce Planning",
      description: "Forecast staffing needs and optimize resource allocation",
      icon: Users,
      stats: "156 Employees",
      path: "/wfm/capacity",
    },
    {
      title: "Performance Analytics",
      description: "Track KPIs, adherence, and productivity metrics",
      icon: BarChart3,
      stats: "98% Adherence",
    },
    {
      title: "Time & Attendance",
      description: "Monitor clock-ins, breaks, and time-off requests",
      icon: Clock,
      stats: "12 Pending Requests",
    },
    {
      title: "Telephony Integrations",
      description: "Connect and manage telephony systems and call routing",
      icon: Phone,
      stats: "5 Active Systems",
    },
    {
      title: "Forecasting",
      description: "Predict workload patterns and staffing requirements",
      icon: TrendingUp,
      stats: "Next 30 Days",
      path: "/wfm/forecasting",
    },
    {
      title: "Reporting",
      description: "Generate comprehensive reports and insights",
      icon: FileText,
      stats: "45 Reports",
    },
    {
      title: "Interaction Arrival",
      description: "Intraday volume and AHT by 15-min intervals",
      icon: Grid,
      stats: "Intraday",
      path: "/wfm/interaction-arrival",
    },
  ];

  return (
    <PageLayout title="Workforce Management">
      <div className="grid md:grid-cols-3 gap-6">
        {wfmModules.map((module) => {
          const CardContent = (
            <div className="bg-card border border-border rounded-lg p-6 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                  <module.icon className="size-6 text-primary" />
                </div>
                <span className="text-xs px-3 py-1 bg-accent rounded-full text-accent-foreground">
                  {module.stats}
                </span>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-card-foreground group-hover:text-primary transition-colors">
                {module.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {module.description}
              </p>
            </div>
          );

          return module.path ? (
            <Link key={module.title} to={module.path} className="block no-underline text-inherit">
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