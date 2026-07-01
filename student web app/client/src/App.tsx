import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Pages
import Home from "./pages/home";
import PrintWizard from "./pages/print-wizard";
import JobStatus from "./pages/job-status";
import BatchStatus from "./pages/batch-status";
import NotFound from "@/pages/not-found";
import TeacherLogin from "./pages/teacher-login";
import TeacherRegister from "./pages/teacher-register";
import TeacherProfile from "./pages/teacher-profile";
import ForgotPassword from "./pages/forgot-password";
import AdminLogin from "./pages/admin-login";
import AdminDashboard from "./pages/admin-dashboard";

/** Scrolls to top on every route change */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/print" component={PrintWizard} />
      <Route path="/pay/:jobId" component={JobStatus} />
      <Route path="/status/:jobId" component={JobStatus} />
      <Route path="/batch-status" component={BatchStatus} />
      <Route path="/teacher-login" component={TeacherLogin} />
      <Route path="/teacher-register" component={TeacherRegister} />
      <Route path="/teacher-profile" component={TeacherProfile} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/admin-login" component={AdminLogin} />
      <Route path="/admin-dashboard" component={AdminDashboard} />
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ScrollToTop />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
