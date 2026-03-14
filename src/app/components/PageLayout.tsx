import { Link, useLocation } from "react-router-dom";
import { Home, ChevronRight } from "lucide-react"; // Added ChevronRight
import logo from "../../assets/logo.png";
import React from "react";

interface PageLayoutProps {
  children: React.ReactNode;
  title: string;
}

export function PageLayout({ children, title }: PageLayoutProps) {
  const location = useLocation();
  
  // Split the URL path into segments (e.g., ["wfm", "roster"])
  const pathnames = location.pathname.split("/").filter((x) => x);

  // Mapping URL slugs to readable display names
  const breadcrumbNameMap: Record<string, string> = {
    wfm: "Workforce Management",
    roster: "Employee Roster",
    forecasting: "Forecasting",
    capacity: "Workforce Planning",
    intraday: "Intraday Forecast",
    "my-account": "My Account",
    configuration: "Configuration",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src={logo} alt="Exordium WFM" className="h-14 w-auto" />
            </Link>
            <Link
              to="/"
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-accent transition-colors"
            >
              <Home className="size-4" />
              <span className="text-sm">Home</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="w-full max-w-[1920px] mx-auto px-8 py-8">
        {/* ── BREADCRUMBS SECTION ── */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/" className="hover:text-primary flex items-center gap-1 transition-colors">
            <Home className="size-3.5" />
            Home
          </Link>

          {pathnames.map((value, index) => {
            const last = index === pathnames.length - 1;
            const to = `/${pathnames.slice(0, index + 1).join("/")}`;
            const name = breadcrumbNameMap[value] || value.charAt(0).toUpperCase() + value.slice(1);

            return (
              <React.Fragment key={to}>
                <ChevronRight className="size-3.5 opacity-50" />
                {last ? (
                  <span className="font-medium text-foreground">{name}</span>
                ) : (
                  <Link to={to} className="hover:text-primary transition-colors">
                    {name}
                  </Link>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <h1 className="text-3xl mb-8 text-foreground font-bold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}