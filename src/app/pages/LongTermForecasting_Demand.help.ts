export interface DemandHelpSection {
  title: string;
  points: string[];
}

export const demandForecastHelpSections: DemandHelpSection[] = [
  {
    title: "What This Page Does",
    points: [
      "Forecasts long-term demand volumes and converts demand workload into required staffing.",
      "Keeps forecast generation, historical override inputs, and staffing outputs on one planning page.",
      "Lets planners explain staffing decisions using shared or dedicated channel pools.",
    ],
  },
  {
    title: "Historical Data Source",
    points: [
      "Channel View lets you switch between Voice, Email, and Chat historical datasets so you can see the right API baseline or enter manual history for that channel.",
      "API Historical Volume is the original system-fed baseline for the selected channel, and Clear API Data lets planners remove that baseline when no client API access is available.",
      "Override Volume lets planners enter their own monthly volume for that channel only, and overrides persist independently per channel.",
      "Final Historical Volume Used is what the forecast engine actually uses for trend, growth, seasonality, and future staffing outputs.",
      "Reset actions affect only the currently selected channel so edits on other channels stay intact.",
    ],
  },
  {
    title: "Blended Channel Staffing",
    points: [
      "Blend presets determine which channels share the same staffed agent pool.",
      "Workload is combined first by pool, then required FTE is calculated at the pool level.",
      "Channels not included in the shared pool remain standalone and add their own required FTE.",
    ],
  },
  {
    title: "Channel Assumptions",
    points: [
      "Voice uses the page forecast volume and current AHT assumption.",
      "Email uses 20% of omni forecast volume at 600 seconds AHT.",
      "Chat uses 30% of omni forecast volume at 450 seconds AHT with concurrency of 2.",
      "Voice, Email, and Chat each have their own SLA and ASA targets, so staffing can reflect different response expectations by channel.",
    ],
  },
  {
    title: "How Required FTE Is Calculated",
    points: [
      "The page uses occupancy, shrinkage, channel-specific SLA target percentages, answer-seconds thresholds, ASA targets, operating hours, safety margin, and FTE monthly hours assumptions configured on the page.",
      "Monthly forecast workload is converted into average concurrent demand during the configured open hours, then translated into staffed seats and required FTE.",
      "For blended pools, workload is summed first and the service targets are weighted across the included channels before FTE is calculated.",
      "Total Required FTE is the sum of all shared-pool and standalone-pool FTE outputs for the month.",
    ],
  },
  {
    title: "How To Use It",
    points: [
      "Start by reviewing historical source data, or clear the API baseline and key in your own monthly volumes if client API data is unavailable.",
      "Choose the blend preset that matches the operating model for the agent group.",
      "Review the output cards, staffing trend, and demand forecast detail table to compare demand impact month by month.",
    ],
  },
];

export const buildDemandHelpPrintHtml = () => {
  const renderedSections = demandForecastHelpSections.map((section) => `
    <section style="margin-bottom:20px;">
      <h2 style="font-size:14px;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.08em;color:#0f172a;">${section.title}</h2>
      <ul style="margin:0;padding-left:18px;color:#334155;font-size:12px;line-height:1.6;">
        ${section.points.map((point) => `<li style="margin-bottom:6px;">${point}</li>`).join("")}
      </ul>
    </section>
  `).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Planner Quick Guide - Long Term Forecasting Demand</title>
        <style>
          body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 32px;
            color: #0f172a;
            background: #ffffff;
          }
          .header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #e2e8f0;
          }
          .title {
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 8px 0;
          }
          .subtitle {
            font-size: 13px;
            color: #475569;
            margin: 0;
          }
          .footer {
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #e2e8f0;
            font-size: 11px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="title">Planner Quick Guide</h1>
          <p class="subtitle">Long Term Forecasting Demand</p>
        </div>
        ${renderedSections}
        <div class="footer">
          Generated from the in-app demand forecasting guide.
        </div>
      </body>
    </html>
  `;
};
