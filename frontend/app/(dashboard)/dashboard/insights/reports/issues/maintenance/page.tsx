"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Wrench, Construction } from "lucide-react";

export default function MaintenanceCostsReportPage() {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">Maintenance Costs Report</h1>
            <p className="text-xs text-dark/50">Repair costs by asset, category, and location</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-surface-border p-16 flex flex-col items-center gap-3 text-dark/40">
        <Construction className="w-10 h-10 opacity-30" />
        <p className="font-semibold text-dark text-sm">Coming soon</p>
        <p className="text-xs text-center max-w-xs">This report is being built. Data will appear here once the report API is connected.</p>
      </div>
    </div>
  );
}
