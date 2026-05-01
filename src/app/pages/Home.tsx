import React from "react";
import { Link, Navigate } from "react-router-dom";
import { ClipboardCheck, User, Users, Settings, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import logo from "../../assets/logo-new.jpg";

export function Home() {
  const { user, status } = useAuth();
  if (status === "authenticated" && user?.role === "agent") {
    return <Navigate to="/agent/today" replace />;
  }

  const navigationCards = [
    {
      title: "My Schedule",
      description: "View your published shift and manage punch status",
      icon: ClipboardCheck,
      path: "/agent/today",
      roles: ["agent"],
    },
    {
      title: "My Account",
      description: "Manage your profile, preferences, and account settings",
      icon: User,
      path: "/my-account",
    },
    {
      title: "Workforce Management",
      description: "Forecasting, capacity planning, scheduling, and analytics tools",
      icon: Users,
      path: "/wfm",
      roles: ["super_admin", "client_admin", "rta", "supervisor", "read_only"],
    },
    {
      title: "Configuration",
      description: "System configuration, integrations, and admin settings",
      icon: Settings,
      path: "/configuration",
      roles: ["super_admin", "client_admin"],
    },
  ];
  const visibleCards = navigationCards.filter(card => !card.roles || (user && card.roles.includes(user.role)));

  return (
    <div className="min-h-screen bg-background relative">
      <div className="container mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-block mb-6">
            <img src={logo} alt="Exordium WFM" className="h-32 w-auto" />
          </div>
          <p className="text-xs font-bold tracking-[0.4em] uppercase text-muted-foreground">
            Workforce Management &nbsp;·&nbsp; Enterprise Platform
          </p>
        </div>

        {/* Navigation Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {visibleCards.map((card) => (
            <Link
              key={card.path}
              to={card.path}
              className="group relative bg-card border border-border rounded-lg p-8 hover:shadow-lg hover:border-primary/30 transition-[box-shadow,border-color,background-color,color] cursor-pointer"
            >
              {/* Icon Container */}
              <div className="bg-primary/10 group-hover:bg-primary/20 w-14 h-14 rounded-lg flex items-center justify-center mb-6 transition-colors">
                <card.icon className="size-7 text-primary" />
              </div>

              {/* Content */}
              <div>
                <h2 className="text-xl font-semibold mb-2 text-card-foreground group-hover:text-primary transition-colors">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {card.description}
                </p>
              </div>

              {/* Hover Arrow */}
              <div className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <ChevronRight className="size-5 text-primary" />
              </div>
            </Link>
          ))}
        </div>

      </div>

      {/* Copyright */}
      <div className="fixed bottom-4 right-6">
        <p className="text-xs text-muted-foreground">
          © 2026 Exordium WFM. All rights reserved.
        </p>
      </div>
    </div>
  );
}
