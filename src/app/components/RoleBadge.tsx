import React from "react";
import { type UserRole } from "@/context/AuthContext";

const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  super_admin: { label: "Super Admin", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  client_admin: { label: "Admin", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  supervisor: { label: "Supervisor", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" },
  read_only: { label: "Read Only", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

export function RoleBadge({ role }: { role: UserRole }) {
  const config = ROLE_CONFIG[role];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
