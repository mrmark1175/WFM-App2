import React from "react";
import { Link } from "react-router-dom";
import { User, Users, Settings, ChevronRight } from "lucide-react";
import logo from "../../assets/logo.svg";

export function Home() {
  const navigationCards = [
    {
      title: "My Account",
      description: "Manage your profile, preferences, and account settings",
      icon: User,
      path: "/my-account",
    },
    {
      title: "WFM",
      description: "Workforce management, scheduling, and forecasting tools",
      icon: Users,
      path: "/wfm",
    },
    {
      title: "Configuration",
      description: "System configuration, integrations, and admin settings",
      icon: Settings,
      path: "/configuration",
    },
  ];

  return (
    <div className="min-h-screen bg-background relative">
      <div className="container mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-block mb-5">
            <img src={logo} alt="Exordium WFM" className="h-32 w-auto" />
          </div>
          <p className="text-xs font-bold tracking-[0.4em] uppercase text-muted-foreground">
            Workforce Management &nbsp;·&nbsp; Enterprise Platform
          </p>
        </div>

        {/* Navigation Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {navigationCards.map((card) => (
            <Link
              key={card.path}
              to={card.path}
              className="group relative bg-card border border-border rounded-lg p-8 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer"
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

        {/* Footer Info */}
        <div className="text-center mt-16">
          <p className="text-sm text-muted-foreground">
            Select a module to get started
          </p>
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