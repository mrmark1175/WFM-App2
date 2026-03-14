import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Map of URL slugs to readable names
  const breadcrumbNameMap: Record<string, string> = {
    wfm: 'Workforce Management',
    roster: 'Employee Roster',
    forecasting: 'Forecasting',
    capacity: 'Workforce Planning',
    intraday: 'Intraday Forecast',
    'my-account': 'My Account',
    configuration: 'Configuration'
  };

  return (
    <nav className="flex items-center space-x-2 text-sm text-muted-foreground mb-4">
      <Link to="/" className="hover:text-primary flex items-center gap-1">
        <Home className="size-3.5" />
        Home
      </Link>
      
      {pathnames.map((value, index) => {
        const last = index === pathnames.length - 1;
        const to = `/${pathnames.slice(0, index + 1).join('/')}`;
        const name = breadcrumbNameMap[value] || value.charAt(0).toUpperCase() + value.slice(1);

        return (
          <React.Fragment key={to}>
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
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
  );
}