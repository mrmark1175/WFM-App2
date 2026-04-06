import { Link } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { Settings, Database, Plug, Users2, Building2, Lock, ChevronRight, SlidersHorizontal } from "lucide-react";

interface ConfigSection {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  href?: string;
}

export function Configuration() {
  const configSections: ConfigSection[] = [
    {
      title: "Lines of Business",
      description: "Create, rename, and manage your LOBs. View scenario counts and last-activity stats for each.",
      icon: Building2,
      category: "Organization",
      href: "/configuration/lob-management",
    },
    {
      title: "LOB Settings",
      description: "Define active channels, pooling mode, staffing parameters (AHT, SLA, ASA, concurrency), and operating hours per LOB per channel.",
      icon: SlidersHorizontal,
      category: "Workforce",
      href: "/configuration/lob-settings",
    },
    {
      title: "System Settings",
      description: "General system configuration and preferences",
      icon: Settings,
      category: "Core",
    },
    {
      title: "Database Configuration",
      description: "Database connections, backups, and maintenance",
      icon: Database,
      category: "Infrastructure",
    },
    {
      title: "Integrations",
      description: "Third-party integrations and API configurations",
      icon: Plug,
      category: "Connectivity",
    },
    {
      title: "User Management",
      description: "Manage users, roles, and permissions",
      icon: Users2,
      category: "Access Control",
    },
    {
      title: "Security & Compliance",
      description: "Security policies, audit logs, and compliance settings",
      icon: Lock,
      category: "Security",
    },
  ];

  return (
    <PageLayout title="Configuration">
      <div className="grid md:grid-cols-2 gap-6 max-w-6xl">
        {configSections.map((section) => {
          const inner = (
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                <section.icon className="size-7 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg text-card-foreground group-hover:text-primary transition-colors">
                    {section.title}
                  </h3>
                  <span className="text-xs px-2 py-1 bg-muted rounded text-muted-foreground">
                    {section.category}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {section.description}
                </p>
              </div>
              {section.href && (
                <ChevronRight className="size-5 text-muted-foreground group-hover:text-primary transition-colors self-center shrink-0" />
              )}
            </div>
          );

          const cls = "bg-card border border-border rounded-lg p-6 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group";

          return section.href ? (
            <Link key={section.title} to={section.href} className={cls}>
              {inner}
            </Link>
          ) : (
            <div key={section.title} className={cls}>
              {inner}
            </div>
          );
        })}
      </div>
    </PageLayout>
  );
}
