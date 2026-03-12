import { Link } from "react-router-dom";
import { User, Users, Settings } from "lucide-react";
import logo from "../../assets/logo.png";

export function Home() {
  const navigationCards = [
    {
      title: "My Account",
      description: "Manage your profile, preferences, and account settings",
      icon: User,
      path: "/my-account",
      color: "bg-blue-50 dark:bg-blue-950/20",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "WFM",
      description: "Workforce management, scheduling, and forecasting tools",
      icon: Users,
      path: "/wfm",
      color: "bg-purple-50 dark:bg-purple-950/20",
      iconColor: "text-purple-600 dark:text-purple-400",
    },
    {
      title: "Configuration",
      description: "System configuration, integrations, and admin settings",
      icon: Settings,
      path: "/configuration",
      color: "bg-green-50 dark:bg-green-950/20",
      iconColor: "text-green-600 dark:text-green-400",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-indigo-950 dark:to-purple-950">
      <div className="container mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-block mb-4">
            <img src={logo} alt="Exordium WFM" className="h-32 w-auto" />
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mt-4">
            Enterprise Workforce Management Platform
          </p>
        </div>

        {/* Navigation Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {navigationCards.map((card) => (
            <Link
              key={card.path}
              to={card.path}
              className="group relative bg-white dark:bg-slate-800 rounded-xl p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-primary/20 dark:hover:border-primary/30"
            >
              {/* Icon Container */}
              <div className={`${card.color} w-16 h-16 rounded-lg flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                <card.icon className={`size-8 ${card.iconColor}`} />
              </div>

              {/* Content */}
              <div>
                <h2 className="text-xl mb-2 text-foreground group-hover:text-primary transition-colors">
                  {card.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {card.description}
                </p>
              </div>

              {/* Hover Arrow */}
              <div className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <svg
                  className="size-5 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
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