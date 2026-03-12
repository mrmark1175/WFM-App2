import { Link, useLocation } from "react-router-dom";
import { Home } from "lucide-react";
import logo from "../../assets/logo.png";

interface PageLayoutProps {
  children: React.ReactNode;
  title: string;
}

export function PageLayout({ children, title }: PageLayoutProps) {
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
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl mb-8 text-foreground">{title}</h1>
        {children}
      </main>
    </div>
  );
}