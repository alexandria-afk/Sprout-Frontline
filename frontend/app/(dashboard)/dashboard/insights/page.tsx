"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart2, RefreshCw, X, ChevronRight, ClipboardList, AlertOctagon,
  Users, BookOpen, CheckSquare, Trophy, Lightbulb, Sparkles,
  Filter, MapPin, Calendar, ChevronDown, PackageX, Timer,
} from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/services/api/client";
import { listLocations, type Location } from "@/services/users";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";

// ─── Style tokens ─────────────────────────────────────────────────────────────
const AXIS = "#94A3B8";
const GRID = "#F1F5F9";
const TT   = { background:"#fff", border:"1px solid #E2E8F0", borderRadius:10, boxShadow:"0 4px 16px rgba(0,0,0,.08)", fontSize:12, color:"#1E293B" };
const BAR_COLORS = ["#00B4D8","#7C3AED","#10B981","#F59E0B","#F43F5E","#6366F1","#FB923C"];

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_AUDIT_TREND = [
  { week:"2026-01-06", pass_rate:72, avg_score:74 },{ week:"2026-01-13", pass_rate:78, avg_score:79 },
  { week:"2026-01-20", pass_rate:75, avg_score:76 },{ week:"2026-01-27", pass_rate:82, avg_score:83 },
  { week:"2026-02-03", pass_rate:80, avg_score:81 },{ week:"2026-02-10", pass_rate:85, avg_score:86 },
  { week:"2026-02-17", pass_rate:88, avg_score:89 },{ week:"2026-02-24", pass_rate:84, avg_score:85 },
  { week:"2026-03-03", pass_rate:91, avg_score:90 },{ week:"2026-03-10", pass_rate:87, avg_score:88 },
  { week:"2026-03-17", pass_rate:93, avg_score:92 },{ week:"2026-03-23", pass_rate:90, avg_score:91 },
];
const MOCK_ISSUE_VOLUME = [
  { category:"Maintenance", count:47 },{ category:"Food Safety", count:31 },
  { category:"Customer Service", count:28 },{ category:"Equipment", count:22 },
  { category:"Cleanliness", count:18 },{ category:"Loss Prevention", count:12 },
  { category:"Safety Hazard", count:9 },
];
const MOCK_SCORECARD = [
  { name:"BGC Branch", score:94 },{ name:"Ortigas Branch", score:88 },
  { name:"Makati Branch", score:81 },{ name:"QC Branch", score:73 },
  { name:"Pasay Branch", score:67 },
];
const MOCK_RESOLUTION = [
  { category:"Maintenance", actual_hrs:6.2, sla_hrs:8 },
  { category:"Food Safety", actual_hrs:3.1, sla_hrs:2 },
  { category:"Equipment", actual_hrs:11.4, sla_hrs:12 },
  { category:"Safety Hazard", actual_hrs:4.8, sla_hrs:2 },
  { category:"Customer Service", actual_hrs:1.9, sla_hrs:4 },
];
const MOCK_CERTIFICATION = [
  { location:"BGC Branch", certified:18, expiring:2, expired:0 },
  { location:"Makati Branch", certified:14, expiring:4, expired:2 },
  { location:"Pasay Branch", certified:11, expiring:3, expired:5 },
  { location:"QC Branch", certified:16, expiring:1, expired:1 },
  { location:"Ortigas Branch", certified:20, expiring:0, expired:0 },
];
const MOCK_INSIGHTS = [
  { id:"m1", severity:"critical" as const, title:"8 certifications expiring at Pasay in 14 days", body:"Pasay Branch has 8 staff whose Food Safety certifications expire within 14 days — 40% of the frontline team.", recommendation:"Schedule a group renewal session this week." },
  { id:"m2", severity:"warning"  as const, title:"Food Safety resolution averaging 3× over SLA", body:"Food Safety issues are averaging 3.1 hours to resolve against a 2-hour SLA — consistent for 3 weeks.", recommendation:"Review escalation rules and confirm current assignees have authority to act." },
  { id:"m3", severity:"info"     as const, title:"BGC Branch leading composite score 3 months running", body:"BGC Branch has ranked #1 in composite score for 3 consecutive months. Checklist completion 96%, audit pass rate 94%.", recommendation:"Document BGC practices and share as a best-practice template with Pasay and QC." },
];

// ─── Report groups ────────────────────────────────────────────────────────────
const REPORT_GROUPS: {
  icon: React.ElementType; color: string; bg: string; label: string;
  description: string; reports: { label:string; href:string; soon?:boolean }[];
}[] = [
  { icon:ClipboardList, color:"text-blue-600",   bg:"bg-blue-50",   label:"Operations",
    description:"Checklists, audits, and corrective action plans",
    reports:[
      { label:"Checklist Completion", href:"/dashboard/insights/reports/operations/checklists" },
      { label:"Audit Compliance",     href:"/dashboard/insights/reports/operations/audits" },
      { label:"CAP Status",           href:"/dashboard/insights/reports/operations/caps" },
      { label:"Pull-Outs & Wastage",  href:"/dashboard/insights/reports/operations/pull-outs" },
    ]},
  { icon:AlertOctagon, color:"text-orange-600", bg:"bg-orange-50", label:"Issues",
    description:"Issue summary, recurring patterns, maintenance costs, incidents",
    reports:[
      { label:"Issue Summary",     href:"/dashboard/insights/reports/issues/summary" },
      { label:"Recurring Issues",  href:"/dashboard/insights/reports/issues/recurring" },
      { label:"Maintenance Costs", href:"/dashboard/insights/reports/issues/maintenance" },
      { label:"Incident Reports",  href:"/dashboard/insights/reports/issues/incidents" },
    ]},
  { icon:Users,       color:"text-purple-600", bg:"bg-purple-50", label:"Workforce",
    description:"Attendance, timesheets, and shift schedules",
    reports:[
      { label:"Attendance",     href:"#", soon:true },
      { label:"Timesheets",     href:"#", soon:true },
      { label:"Shift Schedule", href:"#", soon:true },
    ]},
  { icon:BookOpen,    color:"text-teal-600",   bg:"bg-teal-50",   label:"Training",
    description:"Course completion, certification expiry, and onboarding",
    reports:[
      { label:"Training Completion",  href:"/dashboard/insights/reports/training" },
      { label:"Certification Expiry", href:"/dashboard/insights/reports/training/certification-expiry" },
      { label:"Onboarding Progress",  href:"#", soon:true },
    ]},
  { icon:CheckSquare, color:"text-green-600",  bg:"bg-green-50",  label:"Tasks",
    description:"Task completion rates, overdue tasks, and source breakdown",
    reports:[{ label:"Task Completion", href:"/dashboard/insights/reports/tasks" }]},
  { icon:Trophy,      color:"text-amber-600",  bg:"bg-amber-50",  label:"Safety",
    description:"Safety leaderboard rankings and badges awarded",
    reports:[{ label:"Safety Leaderboard", href:"/dashboard/insights/reports/safety/leaderboard" }]},
  { icon: Timer, color: "text-red-600", bg: "bg-red-50", label: "Aging & SLA",
    description: "Task and issue age, SLA breach rates, and resolution trends",
    reports: [
      { label: "Aging & SLA Report", href: "/dashboard/insights/reports/aging" },
    ]},
];

// ─── AI Insights panel ────────────────────────────────────────────────────────
interface AiInsight { title:string; body:string; recommendation?:string; severity:"info"|"warning"|"critical" }
const SEV: Record<string,{badge:string;bar:string;label:string}> = {
  critical:{ badge:"bg-red-50 text-red-600 border border-red-100",   bar:"bg-red-400",   label:"🔴 CRITICAL" },
  warning: { badge:"bg-amber-50 text-amber-600 border border-amber-100", bar:"bg-amber-400", label:"⚠️ WARNING" },
  info:    { badge:"bg-blue-50 text-blue-600 border border-blue-100",  bar:"bg-blue-400",  label:"ℹ️ INFO" },
};

const SEV_FILTERS = ["all", "critical", "warning", "info"] as const;
type SevFilter = typeof SEV_FILTERS[number];

function InsightsPanel() {
  const [brief, setBrief]           = useState<string>("");
  const [insights, setInsights]     = useState<AiInsight[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed]   = useState<Set<number>>(new Set());
  const [sevFilter, setSevFilter]   = useState<SevFilter>("all");
  const [cachedAt, setCachedAt]     = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const d = await apiFetch<{ brief:string; insights:AiInsight[]; cached_at:string }>(`/api/v1/ai/dashboard-insights${refresh ? "?refresh=true" : ""}`);
      setBrief(d.brief || "");
      setInsights(Array.isArray(d.insights) ? d.insights : []);
      if (d.cached_at) {
        try { setCachedAt(new Date(d.cached_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })); } catch {}
      }
    } catch {
      // fallback: keep mock insights for demo
      setInsights(MOCK_INSIGHTS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = insights.filter((ins, i) =>
    !dismissed.has(i) && (sevFilter === "all" || ins.severity === sevFilter)
  );

  return (
    <div className="rounded-2xl border-2 border-transparent overflow-hidden" style={{ background: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #9333EA 0%, #6366F1 100%) border-box' }}>
      <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent">Sidekick Insights</p>
            <p className="text-xs text-dark-secondary mt-0.5">Pattern analysis across your operations data</p>
          </div>
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-border text-xs font-medium text-dark-secondary hover:bg-gray-50 disabled:opacity-50 transition-colors">
          <RefreshCw className={clsx("w-3.5 h-3.5", refreshing && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Brief text */}
      {!loading && brief && (
        <div className="px-5 py-3 border-b border-surface-border">
          <p className="text-sm text-dark/70 leading-relaxed">{brief}</p>
          {cachedAt && <p className="text-[10px] text-dark/25 mt-1">Generated at {cachedAt} · refreshes tomorrow</p>}
        </div>
      )}

      {/* Severity filter */}
      {!loading && insights.length > 0 && (
        <div className="px-5 py-2 border-b border-surface-border flex items-center gap-1.5">
          {SEV_FILTERS.map(f => (
            <button key={f} onClick={() => setSevFilter(f)}
              className={clsx("px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                sevFilter === f ? "bg-sprout-purple text-white" : "bg-gray-100 text-dark-secondary hover:bg-gray-200"
              )}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2 p-4">{[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-dark/40">
          <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{insights.length === 0 ? "No insights for this period" : "No insights match the selected filter"}</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-border">
          {visible.map((ins, i) => {
            const s = SEV[ins.severity] ?? SEV.info;
            const originalIdx = insights.indexOf(ins);
            return (
              <div key={i} className="px-5 py-4 flex gap-3 items-start">
                <div className={clsx("w-1 self-stretch rounded-full shrink-0 mt-0.5", s.bar)} />
                <div className="flex-1 min-w-0">
                  <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded-full", s.badge)}>{s.label}</span>
                  <p className="text-sm font-semibold text-dark mt-1.5 leading-snug">{ins.title}</p>
                  <p className="text-xs text-dark-secondary mt-1 leading-relaxed">{ins.body}</p>
                  {ins.recommendation && <p className="text-xs text-sprout-purple mt-1.5 font-medium">{ins.recommendation}</p>}
                </div>
                <button onClick={() => setDismissed(p => new Set(Array.from(p).concat(originalIdx)))} className="p-1 text-dark/25 hover:text-dark/50">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chart card ───────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, loading, empty, children, className }: {
  title:string; subtitle:string; loading?:boolean; empty?:boolean; children?:React.ReactNode; className?:string;
}) {
  return (
    <div className={clsx("bg-white rounded-2xl border border-surface-border overflow-hidden", className)}>
      <div className="px-5 pt-5 pb-1"><p className="text-sm font-semibold text-dark">{title}</p><p className="text-xs text-dark-secondary mt-0.5">{subtitle}</p></div>
      <div className="p-4" style={{ minHeight:220 }}>
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="w-6 h-6 border-2 border-sprout-purple/20 border-t-sprout-purple rounded-full animate-spin" /></div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center h-48 text-dark/30"><BarChart2 className="w-8 h-8 mb-2 opacity-40" /><p className="text-xs">No data for this period</p></div>
        ) : children}
      </div>
    </div>
  );
}

// ─── Graphs ───────────────────────────────────────────────────────────────────
function AuditTrendGraph({ from, to, locationId }: { from:string; to:string; locationId:string }) {
  const [data, setData] = useState(MOCK_AUDIT_TREND);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ from, to, format:"json", group_by:"week", ...(locationId ? { location_id:locationId } : {}) });
    apiFetch<{ trend:typeof data }>(`/api/v1/reports/compliance?${p}`)
      .then(r => { if (r?.trend?.length) setData(r.trend); }).catch(() => {}).finally(() => setLoading(false));
  }, [from, to, locationId]);
  const fmtWeek = (v: string) => { const d=new Date(v); return `${d.toLocaleString("default",{month:"short"})} ${d.getDate()}`; };
  return (
    <ChartCard title="Audit Compliance Trend" subtitle="Weekly pass rate and average score" loading={loading}>
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data} margin={{ top:5, right:10, left:-15, bottom:0 }}>
          <defs>
            <linearGradient id="gCyan2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00B4D8" stopOpacity={0.2}/><stop offset="100%" stopColor="#00B4D8" stopOpacity={0}/></linearGradient>
            <linearGradient id="gGreen2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.2}/><stop offset="100%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="week" tick={{fontSize:10,fill:AXIS}} tickFormatter={fmtWeek}/>
          <YAxis domain={[0,100]} tick={{fontSize:10,fill:AXIS}} tickFormatter={v=>`${v}%`}/>
          <Tooltip contentStyle={TT} formatter={(v,n)=>[`${v ?? 0}%`,n==="pass_rate"?"Pass Rate":"Avg Score"] as [string,string]} labelFormatter={l=>`Week of ${new Date(l).toLocaleDateString()}`}/>
          <Area type="monotone" dataKey="pass_rate" name="Pass Rate" stroke="#00B4D8" strokeWidth={2.5} fill="url(#gCyan2)" dot={false} activeDot={{r:5,fill:"#00B4D8"}}/>
          <Area type="monotone" dataKey="avg_score"  name="Avg Score"  stroke="#10B981" strokeWidth={2.5} fill="url(#gGreen2)" dot={false} activeDot={{r:5,fill:"#10B981"}} strokeDasharray="5 4"/>
          <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function IssueVolumeGraph({ from, to, locationId }: { from:string; to:string; locationId:string }) {
  const [data, setData] = useState(MOCK_ISSUE_VOLUME);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ from, to, format:"json", ...(locationId ? { location_id:locationId } : {}) });
    apiFetch<typeof data>(`/api/v1/reports/issues/by-category?${p}`)
      .then(r => { if (Array.isArray(r) && r.length) setData(r.slice(0,8)); }).catch(() => {}).finally(() => setLoading(false));
  }, [from, to, locationId]);
  return (
    <ChartCard title="Issue Volume by Category" subtitle="Top issue categories by volume" loading={loading}>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} layout="vertical" margin={{top:0,right:20,left:5,bottom:0}}>
          <defs>{BAR_COLORS.map((c,i) => <linearGradient key={i} id={`bG${i}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={c} stopOpacity={0.9}/><stop offset="100%" stopColor={c} stopOpacity={0.5}/></linearGradient>)}</defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false}/>
          <XAxis type="number" tick={{fontSize:10,fill:AXIS}}/>
          <YAxis type="category" dataKey="category" tick={{fontSize:10,fill:AXIS}} width={110}/>
          <Tooltip contentStyle={TT} cursor={{fill:"#F8FAFC"}}/>
          <Bar dataKey="count" name="Issues" radius={[0,6,6,0]}>
            {data.map((_,i) => <Cell key={i} fill={`url(#bG${i%BAR_COLORS.length})`}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function LocationScorecardGraph({ from, to, locationId }: { from:string; to:string; locationId:string }) {
  const [data, setData] = useState(MOCK_SCORECARD.map(l => ({ ...l, fill:l.score>=80?"#10B981":l.score>=60?"#F59E0B":"#F43F5E" })));
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ from, to, format:"json", ...(locationId ? { location_id:locationId } : {}) });
    apiFetch<{ location:string; composite_score:number }[]>(`/api/v1/reports/locations/scorecard?${p}`)
      .then(r => { if (Array.isArray(r) && r.length) setData(r.map(l => ({ name:l.location, score:l.composite_score, fill:l.composite_score>=80?"#10B981":l.composite_score>=60?"#F59E0B":"#F43F5E" }))); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [from, to, locationId]);
  return (
    <ChartCard title="Location Scorecard" subtitle="Composite score per location" loading={loading}>
      <div className="flex flex-col gap-2.5 pt-1">
        {data.map(loc => (
          <div key={loc.name} className="flex items-center gap-3">
            <p className="text-xs text-dark/70 w-28 truncate shrink-0">{loc.name}</p>
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width:`${loc.score}%`, background:loc.score>=80?"linear-gradient(90deg,#10B981,#6EE7B7)":loc.score>=60?"linear-gradient(90deg,#F59E0B,#FDE68A)":"linear-gradient(90deg,#F43F5E,#FDA4AF)" }}/>
            </div>
            <span className="text-xs font-bold w-9 text-right shrink-0" style={{color:loc.fill}}>{loc.score}%</span>
          </div>
        ))}
        <div className="flex gap-4 mt-2 pt-2 border-t border-surface-border">
          {[["#10B981","≥80% Good"],["#F59E0B","60–79% Caution"],["#F43F5E","<60% At Risk"]].map(([color,label]) => (
            <div key={label} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:color}}/><span className="text-[10px] text-dark/50">{label}</span></div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

function ResolutionTimeGraph({ from, to, locationId }: { from:string; to:string; locationId:string }) {
  const [data, setData] = useState(MOCK_RESOLUTION);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ from, to, format:"json", group_by:"category", ...(locationId ? { location_id:locationId } : {}) });
    apiFetch<typeof data>(`/api/v1/reports/issues/resolution-time?${p}`)
      .then(r => { if (Array.isArray(r) && r.length) setData(r); }).catch(() => {}).finally(() => setLoading(false));
  }, [from, to, locationId]);
  return (
    <ChartCard title="Resolution Time vs SLA" subtitle="Actual hours vs SLA target by category" loading={loading}>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{top:5,right:10,left:-15,bottom:20}}>
          <defs>
            <linearGradient id="resA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7C3AED" stopOpacity={0.9}/><stop offset="100%" stopColor="#C4B5FD" stopOpacity={0.6}/></linearGradient>
            <linearGradient id="resS" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#94A3B8" stopOpacity={0.5}/><stop offset="100%" stopColor="#CBD5E1" stopOpacity={0.2}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="category" tick={{fontSize:9,fill:AXIS}} angle={-20} textAnchor="end" height={40}/>
          <YAxis tick={{fontSize:10,fill:AXIS}} tickFormatter={v=>`${v}h`}/>
          <Tooltip contentStyle={TT} formatter={(v,n)=>[`${v ?? 0}h`,n==="actual_hrs"?"Actual":"SLA Target"] as [string,string]}/>
          <Legend wrapperStyle={{fontSize:11,paddingTop:4}} formatter={v=>v==="actual_hrs"?"Actual":"SLA Target"}/>
          <Bar dataKey="actual_hrs" name="actual_hrs" fill="url(#resA)" radius={[4,4,0,0]}/>
          <Bar dataKey="sla_hrs"    name="sla_hrs"    fill="url(#resS)" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function CertificationStatusGraph({ from, to, locationId }: { from:string; to:string; locationId:string }) {
  const [data, setData] = useState(MOCK_CERTIFICATION);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ from, to, format:"json", group_by:"location", ...(locationId ? { location_id:locationId } : {}) });
    apiFetch<typeof data>(`/api/v1/reports/training/certification-status?${p}`)
      .then(r => { if (Array.isArray(r) && r.length) setData(r); }).catch(() => {}).finally(() => setLoading(false));
  }, [from, to, locationId]);
  return (
    <ChartCard title="Training Certification Status" subtitle="Certified, expiring, and expired staff by location" loading={loading} className="lg:col-span-3">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{top:0,right:20,left:5,bottom:0}}>
          <defs>
            <linearGradient id="cOk"  x1="1" y1="0" x2="0" y2="0"><stop offset="0%" stopColor="#10B981" stopOpacity={0.9}/><stop offset="100%" stopColor="#6EE7B7" stopOpacity={0.6}/></linearGradient>
            <linearGradient id="cExp" x1="1" y1="0" x2="0" y2="0"><stop offset="0%" stopColor="#F59E0B" stopOpacity={0.9}/><stop offset="100%" stopColor="#FDE68A" stopOpacity={0.6}/></linearGradient>
            <linearGradient id="cBad" x1="1" y1="0" x2="0" y2="0"><stop offset="0%" stopColor="#F43F5E" stopOpacity={0.9}/><stop offset="100%" stopColor="#FDA4AF" stopOpacity={0.6}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false}/>
          <XAxis type="number" tick={{fontSize:10,fill:AXIS}}/>
          <YAxis type="category" dataKey="location" tick={{fontSize:10,fill:AXIS}} width={100}/>
          <Tooltip contentStyle={TT}/>
          <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
          <Bar dataKey="certified" name="Certified"     stackId="a" fill="url(#cOk)"/>
          <Bar dataKey="expiring"  name="Expiring ≤30d" stackId="a" fill="url(#cExp)"/>
          <Bar dataKey="expired"   name="Expired"       stackId="a" fill="url(#cBad)" radius={[0,4,4,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
type DatePreset = "today"|"week"|"month"|"3m"|"6m"|"custom";
const PRESETS: { value:DatePreset; label:string; days:number }[] = [
  { value:"today", label:"Today",         days:0   },
  { value:"week",  label:"This week",     days:7   },
  { value:"month", label:"This month",    days:30  },
  { value:"3m",    label:"Last 3 months", days:90  },
  { value:"6m",    label:"Last 6 months", days:180 },
  { value:"custom",label:"Custom",        days:0   },
];
function presetDates(preset: DatePreset, customFrom: string, customTo: string): { from:string; to:string } {
  if (preset === "custom") return { from:customFrom, to:customTo };
  const to   = new Date();
  const from = new Date();
  const p    = PRESETS.find(x => x.value === preset)!;
  from.setDate(from.getDate() - (preset === "today" ? 0 : p.days));
  const fmt  = (d:Date) => d.toISOString().slice(0,10);
  return { from:fmt(from), to:fmt(to) };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"analytics"|"reports">(
    searchParams.get("tab") === "reports" ? "reports" : "analytics"
  );

  // ── Filter state ────────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]   = useState<DatePreset>("month");
  const [customFrom, setCustomFrom]   = useState("");
  const [customTo,   setCustomTo]     = useState("");
  const [locationId, setLocationId]   = useState("");
  const [locations,  setLocations]    = useState<Location[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [locSearch, setLocSearch]     = useState("");

  useEffect(() => {
    listLocations().then(setLocations).catch(() => {});
  }, []);

  const { from, to } = useMemo(
    () => presetDates(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo]
  );

  const activeFilterCount = [
    locationId !== "",
    datePreset === "custom" && (customFrom || customTo),
  ].filter(Boolean).length;

  function clearFilters() {
    setDatePreset("month"); setCustomFrom(""); setCustomTo("");
    setLocationId(""); setShowAdvanced(false);
  }

  const filteredLocs = locations.filter(l => l.name.toLowerCase().includes(locSearch.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-dark flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-sprout-purple" /> Insights
        </h1>
        <p className="text-sm text-dark/50 mt-0.5">Analytics, trends, and operational reports</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-border">
        {(["analytics","reports"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx("px-4 py-2 text-sm font-medium transition-colors capitalize",
              tab === t ? "text-sprout-purple border-b-2 border-sprout-purple -mb-px font-semibold" : "text-dark/50 hover:text-dark")}>
            {t === "analytics" ? "Analytics" : "Reports"}
          </button>
        ))}
      </div>

      {/* ── Analytics ──────────────────────────────────────────────────────── */}
      {tab === "analytics" && (
        <div className="space-y-4">

          {/* ── Sample data notice ────────────────────────────────────────── */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <span className="text-amber-500 text-lg shrink-0">📊</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Frontline is still collecting your data</p>
              <p className="text-xs text-amber-700 mt-0.5">The charts below show <strong>sample data</strong> as a preview of what you&apos;ll see once your team starts using the platform. Real data will appear automatically as activity is recorded.</p>
            </div>
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-surface-border p-4 flex flex-col gap-3">

            {/* Row 1 — date presets */}
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
              <div className="flex gap-1.5 flex-wrap">
                {PRESETS.map(opt => (
                  <button key={opt.value} onClick={() => { setDatePreset(opt.value); if (opt.value !== "custom") setShowAdvanced(false); if (opt.value === "custom") setShowAdvanced(true); }}
                    className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      datePreset === opt.value
                        ? "bg-sprout-purple text-white border-sprout-purple"
                        : "bg-white border-surface-border text-dark-secondary hover:border-sprout-purple hover:text-sprout-purple")}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2 — location + advanced */}
            <div className="flex items-center gap-2 flex-wrap">
              <MapPin className="w-3.5 h-3.5 text-dark-secondary shrink-0" />
              {/* Location selector rendered as chips */}
              <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
                <button onClick={() => setLocationId("")}
                  className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    locationId === "" ? "bg-sprout-cyan text-white border-sprout-cyan" : "border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan")}>
                  All Locations
                </button>
                {locations.slice(0, 5).map(loc => (
                  <button key={loc.id} onClick={() => setLocationId(loc.id)}
                    className={clsx("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      locationId === loc.id ? "bg-sprout-cyan text-white border-sprout-cyan" : "border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan")}>
                    {loc.name}
                  </button>
                ))}
                {locations.length > 5 && (
                  <button onClick={() => setShowAdvanced(v => !v)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border border-surface-border text-dark-secondary hover:border-sprout-cyan hover:text-sprout-cyan transition-colors">
                    +{locations.length - 5} more
                  </button>
                )}
              </div>

              {/* Advanced / clear */}
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <button onClick={() => setShowAdvanced(v => !v)}
                  className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    showAdvanced || activeFilterCount > 0
                      ? "border-sprout-purple text-sprout-purple bg-sprout-purple/5"
                      : "border-surface-border text-dark-secondary hover:bg-gray-50")}>
                  <Filter className="w-3.5 h-3.5" />
                  Advanced
                  {activeFilterCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>
                  )}
                  <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform", showAdvanced && "rotate-180")} />
                </button>
                {(activeFilterCount > 0 || datePreset !== "month") && (
                  <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-dark-secondary hover:text-dark px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Advanced panel */}
            {showAdvanced && (
              <div className="border-t border-surface-border pt-3 flex flex-col gap-3">
                {/* Custom date range */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-medium text-dark/60 w-20">Date range</span>
                  <div className="flex items-center gap-2">
                    <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setDatePreset("custom"); }}
                      className="border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
                    <span className="text-xs text-dark-secondary">to</span>
                    <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setDatePreset("custom"); }}
                      className="border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-dark focus:outline-none focus:ring-2 focus:ring-sprout-purple/30" />
                  </div>
                </div>
                {/* Location search (when many locations) */}
                {locations.length > 5 && (
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className="text-xs font-medium text-dark/60 w-20 pt-1.5">Location</span>
                    <div className="flex-1 min-w-[240px] flex flex-col gap-2">
                      <input placeholder="Search locations…" value={locSearch} onChange={e => setLocSearch(e.target.value)}
                        className="border border-surface-border rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:ring-2 focus:ring-sprout-cyan/40" />
                      <div className="flex gap-1.5 flex-wrap">
                        <button onClick={() => setLocationId("")}
                          className={clsx("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                            locationId===""?"bg-sprout-cyan text-white border-sprout-cyan":"border-surface-border text-dark-secondary hover:border-sprout-cyan")}>
                          All
                        </button>
                        {filteredLocs.map(loc => (
                          <button key={loc.id} onClick={() => setLocationId(loc.id)}
                            className={clsx("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                              locationId===loc.id?"bg-sprout-cyan text-white border-sprout-cyan":"border-surface-border text-dark-secondary hover:border-sprout-cyan")}>
                            {loc.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active filter summary */}
          {(locationId || datePreset === "custom") && (
            <div className="flex items-center gap-2 flex-wrap text-xs text-dark-secondary">
              <span className="font-medium text-dark/50">Filtered:</span>
              {locationId && (
                <span className="flex items-center gap-1 bg-sprout-cyan/10 text-sprout-cyan border border-sprout-cyan/20 px-2.5 py-1 rounded-full font-medium">
                  <MapPin className="w-3 h-3" />
                  {locations.find(l => l.id === locationId)?.name ?? "Location"}
                  <button onClick={() => setLocationId("")} className="ml-0.5 hover:text-sprout-cyan/70"><X className="w-2.5 h-2.5"/></button>
                </span>
              )}
              {datePreset === "custom" && (customFrom || customTo) && (
                <span className="flex items-center gap-1 bg-sprout-purple/10 text-sprout-purple border border-sprout-purple/20 px-2.5 py-1 rounded-full font-medium">
                  <Calendar className="w-3 h-3" />
                  {customFrom || "…"} → {customTo || "…"}
                  <button onClick={() => { setDatePreset("month"); setCustomFrom(""); setCustomTo(""); }} className="ml-0.5 hover:text-sprout-purple/70"><X className="w-2.5 h-2.5"/></button>
                </span>
              )}
            </div>
          )}

          {/* AI Insights */}
          <InsightsPanel />

          {/* Graph grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2"><AuditTrendGraph      from={from} to={to} locationId={locationId}/></div>
            <div className="lg:col-span-1"><LocationScorecardGraph from={from} to={to} locationId={locationId}/></div>
            <div className="lg:col-span-2"><IssueVolumeGraph     from={from} to={to} locationId={locationId}/></div>
            <div className="lg:col-span-1"><ResolutionTimeGraph  from={from} to={to} locationId={locationId}/></div>
            <CertificationStatusGraph from={from} to={to} locationId={locationId}/>
          </div>
        </div>
      )}

      {/* ── Reports ────────────────────────────────────────────────────────── */}
      {tab === "reports" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_GROUPS.map(group => {
            const Icon = group.icon;
            return (
              <div key={group.label} className="bg-white rounded-2xl border border-surface-border p-5 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", group.bg)}>
                    <Icon className={clsx("w-5 h-5", group.color)}/>
                  </div>
                  <div>
                    <p className="font-semibold text-dark text-sm">{group.label}</p>
                    <p className="text-xs text-dark-secondary mt-0.5 leading-snug">{group.description}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {group.reports.map(rep => (
                    rep.soon ? (
                      <div key={rep.label} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-dark/30 cursor-default">
                        <span>{rep.label}</span>
                        <span className="text-[10px] bg-gray-100 text-dark/40 px-1.5 py-0.5 rounded-full font-normal">Soon</span>
                      </div>
                    ) : (
                      <Link key={rep.label} href={rep.href}
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-dark/70 hover:bg-gray-50 hover:text-dark">
                        <span>{rep.label}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-dark/30"/>
                      </Link>
                    )
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
