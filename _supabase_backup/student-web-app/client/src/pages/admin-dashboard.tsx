import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { FileText, Settings, LogOut, Search, RefreshCw, Layers } from "lucide-react";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function AdminDashboard() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Settings
  const [jobExpirationHours, setJobExpirationHours] = useState("24");
  const [maxFilesLimit, setMaxFilesLimit] = useState("5");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("adminAuth") !== "true") {
      setLocation("/admin-login");
      return;
    }

    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch Jobs
      const { data: printJobs } = await supabase
        .from("print_jobs")
        .select("*")
        .order("created_at", { ascending: false });

      if (printJobs) setJobs(printJobs);

      // Fetch Settings
      const { data: settingsData } = await supabase
        .from("system_settings")
        .select("*");
      if (settingsData) {
        const expiration = settingsData.find(
          (s: any) => s.key === "jobExpirationHours"
        );
        const limit = settingsData.find(
          (s: any) => s.key === "maxFilesLimit"
        );
        if (expiration) setJobExpirationHours(expiration.value);
        if (limit) setMaxFilesLimit(limit.value);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data: printJobs } = await supabase
        .from("print_jobs")
        .select("*")
        .order("created_at", { ascending: false });

      if (printJobs) setJobs(printJobs);
      toast({ title: "Refreshed", description: "Print jobs list updated." });
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await supabase.from("system_settings").upsert(
        [
          { key: "jobExpirationHours", value: jobExpirationHours },
          { key: "maxFilesLimit", value: maxFilesLimit },
        ],
        { onConflict: "key" }
      );

      // Actively trigger cleanup based on new retention settings
      await fetch("/api/admin/cleanup", { method: "POST" }).catch(console.error);
      
      // Refresh the table so disappeared files are immediately removed from UI
      await fetchDashboardData();

      toast({
        title: "Settings Saved",
        description: "System configuration updated and cleanup triggered successfully.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Could not save settings.",
        variant: "destructive",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    try {
      const safeDateStr = !dateStr.endsWith('Z') && !dateStr.includes('+') ? `${dateStr}Z` : dateStr;
      const d = new Date(safeDateStr);
      if (isNaN(d.getTime())) return "—";
      return format(d, "MMM d, yyyy h:mm a");
    } catch {
      return "—";
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminAuth");
    setLocation("/admin-login");
  };

  // Group Jobs by job_id for visual batching
  const groupedJobs: { type: 'single' | 'batch', job?: any, jobs?: any[] }[] = [];
  const groups: Record<string, any[]> = {};

  const filteredJobs = jobs.filter(
    (job) =>
      job.file_name?.toLowerCase().includes(search.toLowerCase()) ||
      job.student_name?.toLowerCase().includes(search.toLowerCase()) ||
      job.teacher_emp_id?.includes(search)
  );

  filteredJobs.forEach(job => {
    if (job.job_id) {
      if (!groups[job.job_id]) groups[job.job_id] = [];
      groups[job.job_id].push(job);
    } else {
      groupedJobs.push({ type: 'single', job });
    }
  });

  Object.values(groups).forEach(group => {
    if (group.length === 1) {
      groupedJobs.push({ type: 'single', job: group[0] });
    } else {
      groupedJobs.push({ type: 'batch', jobs: group });
    }
  });

  groupedJobs.sort((a, b) => {
    const timeA = new Date(a.type === 'single' ? a.job.created_at : a.jobs![0].created_at).getTime();
    const timeB = new Date(b.type === 'single' ? b.job.created_at : b.jobs![0].created_at).getTime();
    return timeB - timeA;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm tracking-wide font-medium">
          Loading Admin Portal…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ─── Top Navbar ─── */}
      <header className="bg-white border-b border-zinc-200 px-6 py-3.5 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center shadow-md">
            <span className="text-black font-extrabold text-sm tracking-tighter">
              VIT
            </span>
          </div>
          <h1 className="text-lg font-bold text-zinc-950 tracking-tight">
            Admin Dashboard
          </h1>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 rounded-lg transition-colors font-medium"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </header>

      {/* ─── Main Content ─── */}
      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── LEFT COLUMN: Print Jobs Log (2/3) ─── */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="bg-white border-zinc-200 shadow-soft">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-zinc-950">
                    <FileText className="w-5 h-5 text-primary" />
                    Print Jobs Log
                  </CardTitle>
                  <CardDescription className="text-zinc-500 mt-1">
                    All documents uploaded by teachers
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <Input
                      placeholder="Search files, names, IDs…"
                      className="pl-9 w-64 bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="p-2.5 rounded-lg bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-950 hover:border-zinc-300 transition-colors disabled:opacity-50"
                    title="Refresh data"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          Teacher Name / EMP ID
                        </th>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          File Name
                        </th>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          Pages
                        </th>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          Color Mode
                        </th>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          Date &amp; Time
                        </th>
                        <th className="px-4 py-3 border-b border-zinc-200 font-semibold">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {groupedJobs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-10 text-center text-zinc-500"
                          >
                            No print jobs found.
                          </td>
                        </tr>
                      ) : (
                        groupedJobs.map((item) => {
                          if (item.type === 'single') {
                            const job = item.job;
                            return (
                              <tr
                                key={job.id}
                                className="hover:bg-zinc-50/50 transition-colors"
                              >
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-zinc-900">
                                    {job.student_name || "—"}
                                  </div>
                                  <div className="text-xs text-zinc-500 mt-0.5">
                                    ID: {job.teacher_emp_id || "N/A"}
                                  </div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-zinc-700 max-w-[200px] truncate cursor-help">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="truncate block">{job.file_name}</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs font-mono text-[10px] break-all">
                                      {job.file_name}
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                                <td className="px-4 py-3 text-zinc-700">
                                  {job.page_count ?? "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs text-zinc-700 capitalize">
                                    {job.color_mode || "—"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                                  {formatDate(job.created_at)}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-black border border-primary/20">
                                    {job.status || "pending"}
                                  </span>
                                </td>
                              </tr>
                            );
                          } else {
                            const batch = item.jobs!;
                            const firstJob = batch[0];
                            const totalPages = batch.reduce((sum, j) => sum + (j.page_count || 0), 0);
                            const fileNames = batch.map(j => j.file_name).join("\n");
                            const colorModes = Array.from(new Set(batch.map(j => j.color_mode || "—")));
                            const displayColor = colorModes.length === 1 ? colorModes[0] : "Mixed";
                            
                            return (
                              <tr
                                key={firstJob.job_id}
                                className="hover:bg-zinc-50/50 transition-colors bg-zinc-100/30"
                              >
                                <td className="px-4 py-3">
                                  <div className="font-semibold text-zinc-900">
                                    {firstJob.student_name || "—"}
                                  </div>
                                  <div className="text-xs text-zinc-500 mt-0.5">
                                    ID: {firstJob.teacher_emp_id || "N/A"}
                                  </div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-zinc-700 max-w-[200px] truncate cursor-help">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-primary" />
                                        <span className="font-semibold">Batch of {batch.length} files</span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="whitespace-pre-wrap max-w-sm font-mono text-[10px] bg-zinc-900 text-white p-2">
                                      {fileNames}
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                                <td className="px-4 py-3 text-zinc-700 font-semibold">
                                  {totalPages} <span className="text-xs font-normal text-zinc-500">(Total)</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs text-zinc-700 capitalize">
                                    {displayColor}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                                  {formatDate(firstJob.created_at)}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-black border border-primary/20">
                                    {firstJob.status || "pending"}
                                  </span>
                                </td>
                              </tr>
                            );
                          }
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Job count footer */}
              <div className="mt-3 text-xs text-zinc-500 text-right font-medium">
                Showing {filteredJobs.length} of {jobs.length} jobs
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── RIGHT COLUMN: System Settings (1/3) ─── */}
        <div className="space-y-6">
          <Card className="bg-white border-zinc-200 shadow-soft sticky top-20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-950">
                <Settings className="w-5 h-5 text-primary" />
                System Settings
              </CardTitle>
              <CardDescription className="text-zinc-500">
                Customize global parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* File Retention */}
              <div className="space-y-2">
                <Label className="text-zinc-700 text-sm font-medium">
                  File Retention Duration (Hours)
                </Label>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  How long files remain in the database before auto-deletion.
                </p>
                <Input
                  type="number"
                  value={jobExpirationHours}
                  onChange={(e) => setJobExpirationHours(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                />
              </div>

              {/* Max Files Limit */}
              <div className="space-y-2">
                <Label className="text-zinc-700 text-sm font-medium">
                  Max Files Limit per Teacher
                </Label>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Maximum number of concurrent files allowed in queue.
                </p>
                <Input
                  type="number"
                  value={maxFilesLimit}
                  onChange={(e) => setMaxFilesLimit(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                />
              </div>

              {/* Divider */}
              <div className="border-t border-zinc-150" />

              {/* Save Button */}
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-primary text-black hover:bg-primary/95 active:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {savingSettings ? "Saving…" : "Save Changes"}
              </button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
