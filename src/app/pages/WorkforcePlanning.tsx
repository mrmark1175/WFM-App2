import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Clock, ArrowLeft } from 'lucide-react';

const WorkforcePlanning = () => {
  const navigate = useNavigate();

  const planningModules = [
    {
      title: 'Capacity Planning',
      description: 'Long-term staffing requirements and FTE calculations.',
      icon: <Users className="w-8 h-8 text-blue-600" />,
      path: '/planning/capacity'
    },
    {
      title: 'Intraday Forecast',
      description: 'Real-time adjustments and interval-level volume tracking.',
      icon: <Clock className="w-8 h-8 text-green-600" />,
      path: '/planning/intraday'
    }
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <button 
        onClick={() => navigate('/')}
        className="flex items-center text-gray-600 hover:text-black mb-6 transition-colors"
      >
        <ArrowLeft className="mr-2 w-4 h-4" /> Back to Dashboard
      </button>

      <h1 className="text-3xl font-bold mb-2">Workforce Planning</h1>
      <p className="text-gray-500 mb-10">Select a module to optimize your resource allocation.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {planningModules.map((module) => (
          <div 
            key={module.title}
            onClick={() => navigate(module.path)}
            className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-300 cursor-pointer transition-all group"
          >
            <div className="mb-4">{module.icon}</div>
            <h2 className="text-xl font-semibold group-hover:text-blue-600 transition-colors">
              {module.title}
            </h2>
            <p className="text-gray-500 mt-2">{module.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkforcePlanning;