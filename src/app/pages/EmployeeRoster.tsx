import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

// Define what an Agent looks like based on your pgAdmin data
interface Agent {
  id: number;
  name: string;
  agent_id_code: string;
  status: string;
  team: string;
  lob: string;
  campaign: string;
}

export function EmployeeRoster() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Ask the backend for the data
    fetch("http://localhost:5000/api/agents")
      .then((res) => res.json())
      .then((data) => {
        // 2. Save the data and stop the spinner
        setAgents(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Connection Error:", err);
        setLoading(false); // Stop spinning even if it fails so we can see the error
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-4 text-sm text-gray-500">
          <Link to="/wfm" className="hover:text-blue-600">WFM</Link> / <span>Employee Roster</span>
        </nav>

        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Employee Roster</h1>
          <div className="flex gap-4">
             <span className="bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-semibold">
                Total Agents: {agents.length}
             </span>
             <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                + Add Agent
             </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            /* SHOW SPINNER IF LOADING */
            <div className="p-20 text-center">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-4"></div>
              <p className="text-gray-500 font-medium">Connecting to Exordium Database...</p>
            </div>
          ) : (
            /* SHOW TABLE IF DATA IS LOADED */
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Name</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Agent ID</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Campaign</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">LOB</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {agents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-blue-50/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{agent.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{agent.agent_id_code}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{agent.campaign}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{agent.lob}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          agent.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {agent.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}