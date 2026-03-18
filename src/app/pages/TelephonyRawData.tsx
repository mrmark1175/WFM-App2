import React, { useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { Database, Upload, Trash2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { Link } from "react-router-dom";

export function TelephonyRawData() {
  const [rawData, setRawData] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const handleProcessData = async () => {
    if (!rawData.trim()) return;
    setIsProcessing(true);
    setStatus(null);

    try {
      // Mock processing logic - in a real scenario, this would send to /api/telephony/import
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setStatus({ 
        ok: true, 
        text: "Successfully processed and staged 124 records. You can now sync them to Interaction Arrival." 
      });
      setRawData("");
    } catch (error) {
      setStatus({ ok: false, text: "Failed to process data. Please check the format." });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <PageLayout title="Telephony Raw Data">
      <div className="space-y-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/wfm" className="hover:text-primary transition-colors">Workforce Management</Link>
          <span>/</span>
          <span className="text-foreground font-medium">Telephony Raw Data</span>
        </nav>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Input Area */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <h3 className="font-semibold text-sm">Paste Raw Telephony Data</h3>
                </div>
                <button 
                  onClick={() => setRawData("")}
                  className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="size-3" />
                  Clear
                </button>
              </div>
              <div className="p-0">
                <textarea
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                  placeholder="Paste CSV, TSV or JSON data from your telephony system here...&#10;Example:&#10;Date,Interval,Volume,AHT&#10;2024-03-18,08:00,45,320"
                  className="w-full h-[400px] p-4 font-mono text-sm bg-transparent focus:outline-none resize-none"
                />
              </div>
              <div className="p-4 bg-muted/10 border-t flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Supported formats: CSV, Tab-Delimited, JSON
                </p>
                <button
                  onClick={handleProcessData}
                  disabled={isProcessing || !rawData.trim()}
                  className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all
                    ${isProcessing || !rawData.trim() 
                      ? "bg-muted text-muted-foreground cursor-not-allowed" 
                      : "bg-primary text-primary-foreground hover:shadow-md active:scale-95"}`}
                >
                  {isProcessing ? (
                    <div className="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {isProcessing ? "Processing..." : "Process Data"}
                </button>
              </div>
            </div>

            {status && (
              <div className={`p-4 rounded-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-2
                ${status.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-destructive/10 border-destructive/20 text-destructive"}`}>
                {status.ok ? <CheckCircle2 className="size-5 shrink-0" /> : <AlertCircle className="size-5 shrink-0" />}
                <p className="text-sm font-medium">{status.text}</p>
              </div>
            )}
          </div>

          {/* Guidelines / Sidebar */}
          <div className="space-y-6">
            <div className="bg-card border rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Database className="size-5 text-primary" />
                Import Guide
              </h3>
              <ul className="space-y-4">
                <li className="flex gap-3">
                  <div className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</div>
                  <div>
                    <p className="text-sm font-semibold">Export from Source</p>
                    <p className="text-xs text-muted-foreground mt-1">Get your interval data (15/30 min) from Genesys, Avaya, or Cisco in CSV format.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <div className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</div>
                  <div>
                    <p className="text-sm font-semibold">Paste & Validate</p>
                    <p className="text-xs text-muted-foreground mt-1">Paste the data here. The system will automatically detect columns like Date, Time, and Volume.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <div className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</div>
                  <div>
                    <p className="text-sm font-semibold">Map to Arrival</p>
                    <p className="text-xs text-muted-foreground mt-1">Once processed, data can be pushed directly to the Interaction Arrival analysis module.</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <h4 className="text-amber-800 text-sm font-bold flex items-center gap-2 mb-2">
                <AlertCircle className="size-4" />
                Data Privacy
              </h4>
              <p className="text-xs text-amber-700 leading-relaxed">
                Ensure all PII (Personally Identifiable Information) is removed before pasting raw logs. Only volume and AHT metrics should be imported.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
