import { PageLayout } from "../components/PageLayout";
import { User, Mail, Shield, Bell } from "lucide-react";

export function MyAccount() {
  const accountSections = [
    {
      title: "Profile Information",
      description: "Update your personal details and contact information",
      icon: User,
    },
    {
      title: "Email Preferences",
      description: "Manage email notifications and communication settings",
      icon: Mail,
    },
    {
      title: "Security",
      description: "Password, two-factor authentication, and security settings",
      icon: Shield,
    },
    {
      title: "Notifications",
      description: "Configure system alerts and notification preferences",
      icon: Bell,
    },
  ];

  return (
    <PageLayout title="My Account">
      <div className="grid md:grid-cols-2 gap-6 max-w-5xl">
        {accountSections.map((section) => (
          <div
            key={section.title}
            className="bg-card border border-border rounded-lg p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3 rounded-lg">
                <section.icon className="size-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg mb-1 text-card-foreground">{section.title}</h3>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
