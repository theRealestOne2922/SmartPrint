// Admin Dashboard — MongoDB Edition
// All Supabase database calls replaced with Express API fetch().
// Field names now use camelCase (from MongoDB/Mongoose) instead of snake_case (from Supabase REST).
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api-config";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  FileText, Settings, LogOut, Search, RefreshCw, Layers,
  Lock, Printer, CheckCircle2, AlertCircle, Clock, ShieldCheck, UserCheck,
} from "lucide-react";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Colour and icon per job state, so a glance at the table tells you what needs
// attention. Anything unrecognised falls back to neutral rather than vanishing.
const STATUS_STYLES: Record<string, { label: string; className: string; Icon: typeof Clock }> = {
  uploaded:  { label: "Waiting",   className: "bg-amber-50 text-amber-700 border-amber-200",     Icon: Clock },
  printing:  { label: "Printing",  className: "bg-blue-50 text-blue-700 border-blue-200",        Icon: Printer },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  failed:    { label: "Failed",    className: "bg-red-50 text-red-700 border-red-200",           Icon: AlertCircle },
  cancelled: { label: "Cancelled", className: "bg-zinc-100 text-zinc-600 border-zinc-200",       Icon: AlertCircle },
};

function StatusBadge({ status }: { status?: string }) {
  const style = STATUS_STYLES[status ?? ""] ?? {
    label: status || "Unknown",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
    Icon: Clock,
  };
  const { Icon } = style;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${style.className}`}>
      <Icon className="w-3 h-3" />
      {style.label}
    </span>
  );
}

function StatCard({ label, value, Icon, accent }: { label: string; value: number; Icon: typeof Clock; accent: string }) {
  return (
    <Card className="bg-white border-zinc-200 shadow-soft">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold text-zinc-950 leading-none tabular-nums">{value}</div>
          <div className="text-xs text-zinc-500 mt-1 truncate">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [approving, setApproving] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Settings
  const [jobExpirationHours, setJobExpirationHours] = useState("24");
  const [maxFilesLimit, setMaxFilesLimit] = useState("5");
  const [savingSettings, setSavingSettings] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const adminUsername = localStorage.getItem("adminUsername") || "admin";

  // Admin endpoints are gated server-side; this header is what actually
  // authorises the request. The localStorage flag only drives the UI.
  const authHeaders = (): HeadersInit => {
    const token = localStorage.getItem("adminToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // A rejected token means the session expired (or was never valid) — send the
  // admin back to the login screen rather than showing an empty dashboard.
  const handleAuthFailure = () => {
    localStorage.removeItem("adminAuth");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUsername");
    toast({
      title: "Session expired",
      description: "Please sign in again.",
      variant: "destructive",
    });
    setLocation("/admin-login");
  };

  useEffect(() => {
    if (localStorage.getItem("adminAuth") !== "true" || !localStorage.getItem("adminToken")) {
      setLocation("/admin-login");
      return;
    }

    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch Jobs via Express API (was: supabase.from("print_jobs").select("*"))
      const jobsRes = await fetch(`${API_BASE}/api/print-jobs`, { headers: authHeaders() });
      if (jobsRes.status === 401) {
        handleAuthFailure();
        return;
      }
      if (jobsRes.ok) {
        const printJobs = await jobsRes.json();
        if (printJobs) setJobs(printJobs);
      }

      // Staff accounts, so the approval queue is visible alongside the jobs.
      const teachersRes = await fetch(`${API_BASE}/api/admin/teachers`, { headers: authHeaders() });
      if (teachersRes.ok) {
        const list = await teachersRes.json();
        if (Array.isArray(list)) setTeachers(list);
      }

      // Fetch Settings via Express API (was: supabase.from("system_settings").select("*"))
      const settingsRes = await fetch(`${API_BASE}/api/settings`);
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
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
      const jobsRes = await fetch(`${API_BASE}/api/print-jobs`, { headers: authHeaders() });
      if (jobsRes.status === 401) {
        handleAuthFailure();
        return;
      }
      if (jobsRes.ok) {
        const printJobs = await jobsRes.json();
        if (printJobs) setJobs(printJobs);
      }
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
      // Update settings via Express API (was: supabase.from("system_settings").upsert(...))
      const saveRes = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          settings: [
            { key: "jobExpirationHours", value: jobExpirationHours },
            { key: "maxFilesLimit", value: maxFilesLimit },
          ]
        }),
      });
      if (saveRes.status === 401) {
        handleAuthFailure();
        return;
      }

      // The server range-checks these now, because a retention of 0 set the
      // cleanup cutoff to "now" and deleted every job. Show its reason instead
      // of reporting success on a rejected save.
      if (!saveRes.ok) {
        const body = await saveRes.json().catch(() => ({}));
        toast({
          title: "Not saved",
          description: body.message || "Those values were rejected.",
          variant: "destructive",
        });
        return;
      }

      // Actively trigger cleanup based on new retention settings
      await fetch(`${API_BASE}/api/admin/cleanup`, {
        method: "POST",
        headers: authHeaders(),
      }).catch(console.error);

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

  // Approve or revoke a staff account. A revoked account keeps its jobs and its
  // history — it simply cannot sign in — so this is reversible either way.
  const setApproval = async (teacher: any, approved: boolean) => {
    setApproving(teacher.id);
    try {
      const res = await fetch(`${API_BASE}/api/admin/teachers/${teacher.id}/approval`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ approved }),
      });
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Failed", description: body.message || "Could not update the account.", variant: "destructive" });
        return;
      }
      setTeachers((prev) => prev.map((t) => (t.id === teacher.id ? { ...t, approved } : t)));
      toast({
        title: approved ? "Account approved" : "Access revoked",
        description: `${teacher.name} (${teacher.email})`,
      });
    } catch {
      toast({ title: "Error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  // Clear a confidential job locked by repeated wrong Faculty IDs. The bound
  // stops guessing, but it also means someone who read the code off a screen
  // can strand that paper for the day — this is the way back.
  const unlockJob = async (printId: string) => {
    setUnlocking(printId);
    try {
      const res = await fetch(`${API_BASE}/api/admin/jobs/${printId}/unlock`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Failed", description: body.message || "Could not unlock the job.", variant: "destructive" });
        return;
      }
      const body = await res.json().catch(() => ({}));
      setJobs((prev) => prev.map((j) => (j.jobId === printId ? { ...j, locked: false } : j)));
      toast({
        title: "Job unlocked",
        description: `Code ${printId} can be verified again (${body.clearedAttempts ?? 0} failed attempts cleared).`,
      });
    } catch {
      toast({ title: "Error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setUnlocking(null);
    }
  };

  // Change the admin password without an SSH session and a script.
  //
  // The server signs every other admin session out and hands back a replacement
  // token for this one, so whoever is sitting here stays signed in and anyone
  // else holding a token does not.
  const changePassword = async () => {
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // A 401 here means the current password was wrong, not that the session
        // died — so this must not fall through to the sign-out handler.
        setPasswordError(body.message || "Could not change the password.");
        return;
      }

      if (body.token) localStorage.setItem("adminToken", body.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Password changed",
        description: "Any other signed-in admin session has been signed out.",
      });
    } catch {
      setPasswordError("Could not reach the server.");
    } finally {
      setChangingPassword(false);
    }
  };

  // Repeated failed sign-ins freeze an account for fifteen minutes. It clears
  // itself, but "I can't log in" fifteen minutes before an exam is not a wait
  // anyone wants, so an admin can end it here.
  const unlockTeacher = async (teacher: any) => {
    setApproving(teacher.id);
    try {
      const res = await fetch(`${API_BASE}/api/admin/teachers/${teacher.id}/unlock`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Failed", description: body.message || "Could not unlock the account.", variant: "destructive" });
        return;
      }
      setTeachers((prev) => prev.map((t) => (t.id === teacher.id ? { ...t, locked: false } : t)));
      toast({ title: "Account unlocked", description: `${teacher.name} can sign in again.` });
    } catch {
      toast({ title: "Error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setApproving(null);
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
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUsername");
    setLocation("/admin-login");
  };

  // Group Jobs by jobId for visual batching
  // Note: field names are now camelCase (MongoDB) instead of snake_case (Supabase)
  const groupedJobs: { type: 'single' | 'batch', job?: any, jobs?: any[] }[] = [];
  const groups: Record<string, any[]> = {};

  // teacherEmpId is deliberately not searchable here: it is the credential that
  // releases a confidential job at the kiosk, so the server strips it from every
  // response. Searching a field the dashboard can never receive would just look
  // broken.
  // fileName is not in this list: the server no longer sends one to the admin
  // dashboard, for any job. Searchable on who printed and the code only.
  const filteredJobs = jobs.filter(
    (job) =>
      job.studentName?.toLowerCase().includes(search.toLowerCase()) ||
      job.jobId?.includes(search)
  );

  filteredJobs.forEach(job => {
    if (job.jobId) {
      if (!groups[job.jobId]) groups[job.jobId] = [];
      groups[job.jobId].push(job);
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
    const timeA = new Date(a.type === 'single' ? a.job.createdAt : a.jobs![0].createdAt).getTime();
    const timeB = new Date(b.type === 'single' ? b.job.createdAt : b.jobs![0].createdAt).getTime();
    return timeB - timeA;
  });

  const pendingTeachers = teachers.filter((t) => !t.approved);
  const approvedTeachers = teachers.filter((t) => t.approved);

  const stats = {
    total: jobs.length,
    printing: jobs.filter((j) => j.status === "printing").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    confidential: jobs.filter((j) => j.confidential).length,
  };

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
          <div>
            <h1 className="text-lg font-bold text-zinc-950 tracking-tight leading-tight">
              Admin Dashboard
            </h1>
            <p className="text-xs text-zinc-500 leading-tight">SmartPrint — print job oversight</p>
          </div>
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
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* ─── Overview ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total jobs" value={stats.total} Icon={FileText} accent="bg-zinc-100 text-zinc-700" />
          <StatCard label="Printing now" value={stats.printing} Icon={Printer} accent="bg-blue-50 text-blue-600" />
          <StatCard label="Completed" value={stats.completed} Icon={CheckCircle2} accent="bg-emerald-50 text-emerald-600" />
          <StatCard label="Confidential" value={stats.confidential} Icon={Lock} accent="bg-amber-50 text-amber-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                        placeholder="Search file, name or code…"
                        className="pl-9 w-full sm:w-64 bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className="p-2.5 rounded-lg bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-950 hover:border-zinc-300 transition-colors disabled:opacity-50 shrink-0"
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
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">Submitted by</th>
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">File</th>
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">Pages</th>
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">Colour</th>
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">Date &amp; Time</th>
                          <th className="px-4 py-3 border-b border-zinc-200 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {groupedJobs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-14 text-center">
                              <FileText className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
                              <p className="text-zinc-600 font-medium">
                                {jobs.length === 0 ? "No print jobs yet" : "Nothing matches that search"}
                              </p>
                              <p className="text-xs text-zinc-400 mt-1">
                                {jobs.length === 0
                                  ? "Jobs appear here as staff upload them."
                                  : "Try a different file name, staff name or print code."}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          groupedJobs.map((item) => {
                            if (item.type === 'single') {
                              const job = item.job;
                              return (
                                <tr
                                  key={job.id || job._id}
                                  className="hover:bg-zinc-50/50 transition-colors"
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-zinc-900">
                                      {job.studentName || "—"}
                                    </div>
                                    <div className="text-xs text-zinc-400 mt-0.5 font-mono">
                                      Code {job.jobId || "—"}
                                    </div>
                                    {/* Too many wrong Faculty IDs will lock a
                                        confidential job for the day. That is
                                        deliberate against guessing, but it also
                                        means anyone who saw the code can strand
                                        the paper — so it has to be clearable. */}
                                    {job.locked && (
                                      <div className="mt-1.5 flex items-center gap-1.5">
                                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                          Locked
                                        </span>
                                        <button
                                          onClick={() => unlockJob(job.jobId)}
                                          disabled={unlocking === job.jobId}
                                          className="text-[10px] font-semibold text-red-600 hover:text-red-700 underline disabled:opacity-50"
                                          title="Too many incorrect Faculty IDs locked this job. Clearing lets the owner verify and print again."
                                        >
                                          {unlocking === job.jobId ? "Unlocking…" : "Unlock"}
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 max-w-[220px]">
                                    <div className="flex items-center gap-2">
                                      {job.confidential && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                          </TooltipTrigger>
                                          <TooltipContent>Confidential — encrypted, released only with the Faculty ID</TooltipContent>
                                        </Tooltip>
                                      )}
                                      {/* The server no longer sends a file name here, for any
                                          job, confidential or not — this dashboard tracks who
                                          printed and how much, never what. See the comment on
                                          GET /api/print-jobs. */}
                                      <span className="truncate block font-mono text-xs text-zinc-400 italic">
                                        Document
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-zinc-700 tabular-nums">
                                    {job.pageCount ?? "—"}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-xs text-zinc-700 capitalize">
                                      {job.colorMode === "bw" ? "B&W" : job.colorMode || "—"}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                                    {formatDate(job.createdAt)}
                                  </td>
                                  <td className="px-4 py-3">
                                    <StatusBadge status={job.status} />
                                  </td>
                                </tr>
                              );
                            } else {
                              const batch = item.jobs!;
                              const firstJob = batch[0];
                              const totalPages = batch.reduce((sum: number, j: any) => sum + (j.pageCount || 0), 0);
                              const colorModes = Array.from(new Set(batch.map((j: any) => j.colorMode || "—")));
                              const displayColor = colorModes.length === 1
                                ? (colorModes[0] === "bw" ? "B&W" : colorModes[0])
                                : "Mixed";
                              const anyConfidential = batch.some((j: any) => j.confidential);

                              return (
                                <tr
                                  key={firstJob.jobId}
                                  className="hover:bg-zinc-50/50 transition-colors bg-zinc-50/40"
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold text-zinc-900">
                                      {firstJob.studentName || "—"}
                                    </div>
                                    <div className="text-xs text-zinc-400 mt-0.5 font-mono">
                                      Code {firstJob.jobId || "—"}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 max-w-[220px]">
                                    <div className="flex items-center gap-2">
                                      {anyConfidential && (
                                        <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                      )}
                                      {/* No per-file tooltip — that was the file names. Same
                                          reason as the single-job row above. */}
                                      <div className="flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-primary shrink-0" />
                                        <span className="font-semibold text-xs text-zinc-700">
                                          Batch of {batch.length} files
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-zinc-700 font-semibold tabular-nums">
                                    {totalPages} <span className="text-xs font-normal text-zinc-500">(total)</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-xs text-zinc-700 capitalize">
                                      {displayColor}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                                    {formatDate(firstJob.createdAt)}
                                  </td>
                                  <td className="px-4 py-3">
                                    <StatusBadge status={firstJob.status} />
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

          {/* ─── RIGHT COLUMN: Staff accounts + System Settings (1/3) ─── */}
          <div className="space-y-6">
            {/* Staff approval queue */}
            <Card className="bg-white border-zinc-200 shadow-soft">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-zinc-950">
                  <UserCheck className="w-5 h-5 text-primary" />
                  Staff accounts
                  {pendingTeachers.length > 0 && (
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
                      {pendingTeachers.length} waiting
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Anyone can request an account. Only approved staff can sign in and print.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {pendingTeachers.length === 0 && approvedTeachers.length === 0 && (
                  <p className="text-xs text-zinc-500">No staff accounts yet.</p>
                )}

                {pendingTeachers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                      Awaiting approval
                    </p>
                    {pendingTeachers.map((t) => (
                      <div key={t.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                        <div className="font-semibold text-sm text-zinc-900 truncate">{t.name}</div>
                        <div className="text-xs text-zinc-600 truncate">{t.email}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          Employee ID {t.empId} · requested {formatDate(t.createdAt)}
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <button
                            onClick={() => setApproval(t, true)}
                            disabled={approving === t.id}
                            className="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {approving === t.id ? "…" : "Approve"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {approvedTeachers.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Approved ({approvedTeachers.length})
                    </p>
                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                      {approvedTeachers.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-zinc-800 truncate">{t.name}</span>
                              {t.locked && (
                                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                  Locked
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate">{t.email}</div>
                          </div>
                          {t.locked && (
                            <button
                              onClick={() => unlockTeacher(t)}
                              disabled={approving === t.id}
                              className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 transition-colors disabled:opacity-50 shrink-0"
                              title="Too many failed sign-ins froze this account. This clears it immediately; it would otherwise clear itself within fifteen minutes."
                            >
                              Unlock
                            </button>
                          )}
                          <button
                            onClick={() => setApproval(t, false)}
                            disabled={approving === t.id}
                            className="text-[11px] font-semibold text-zinc-400 hover:text-red-600 transition-colors disabled:opacity-50 shrink-0"
                            title="Revoke sign-in access, ending any session already open. Their jobs and history are kept."
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-zinc-200 shadow-soft lg:sticky lg:top-24">
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
                    How long files remain before auto-deletion. Between 1 and 8760.
                  </p>
                  <Input
                    type="number"
                    min={1}
                    max={8760}
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
                    Maximum files allowed in one upload. Between 1 and 50.
                  </p>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={maxFilesLimit}
                    onChange={(e) => setMaxFilesLimit(e.target.value)}
                    className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                  />
                </div>

                {/* Divider */}
                <div className="border-t border-zinc-200" />

                {/* Save Button */}
                <button
                  onClick={saveSettings}
                  disabled={savingSettings}
                  className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-primary text-black hover:bg-primary/95 active:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  {savingSettings ? "Saving…" : "Save Changes"}
                </button>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Saving also runs a cleanup pass, so files already past the new
                  retention window are removed immediately.
                </p>
              </CardContent>
            </Card>

            {/* Admin password */}
            <Card className="bg-white border-zinc-200 shadow-soft">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-zinc-950 text-base">
                  <Lock className="w-4 h-4 text-primary" />
                  Admin Password
                </CardTitle>
                <CardDescription className="text-zinc-500 text-xs">
                  Signed in as <span className="font-medium text-zinc-700">{adminUsername}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(""); }}
                  className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPasswordError(""); }}
                  className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(""); }}
                  className="bg-white border-zinc-200 text-zinc-950 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                />

                {passwordError && (
                  <p className="text-xs text-red-600 leading-relaxed">{passwordError}</p>
                )}

                <button
                  onClick={changePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {changingPassword ? "Changing…" : "Change Password"}
                </button>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  At least 12 characters. Changing it signs out every other admin
                  session; you stay signed in here.
                </p>
              </CardContent>
            </Card>

            {/* What this dashboard deliberately does not show */}
            <Card className="bg-white border-zinc-200 shadow-soft">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-zinc-950 text-base">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Document access
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-zinc-500 leading-relaxed">
                  This page lists jobs, never their contents. Download links and
                  Faculty IDs are withheld by the server, so an admin session
                  cannot be used to open a confidential document. Releasing one
                  still requires the Faculty ID at the kiosk.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
