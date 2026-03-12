import { PageLayout } from "../components/PageLayout";
import { Settings, Database, Plug, Users2, Building2, Lock } from "lucide-react";

export function Configuration() {
  const configSections = [
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
      title: "Organization Setup",
      description: "Company structure, departments, and locations",
      icon: Building2,
      category: "Organization",
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
        {configSections.map((section) => (
          <div
            key={section.title}
            className="bg-card border border-border rounded-lg p-6 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group"
          >
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
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
