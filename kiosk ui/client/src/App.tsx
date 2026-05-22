import { Switch, Route, Router } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Kiosk Layout & Components
import { Header } from "@/components/Header";
import { AnimatedWrapper } from "@/components/PageTransition";
import { RealtimeStatusHandler } from "@/components/RealtimeStatusHandler";

// Pages
import { IdleScreen } from "@/pages/IdleScreen";
import { JobConfirmationScreen } from "@/pages/JobConfirmationScreen";
import { PrintingScreen } from "@/pages/PrintingScreen";
import { SuccessScreen } from "@/pages/SuccessScreen";
import { ErrorScreen } from "@/pages/ErrorScreen";
import NotFound from "@/pages/not-found";

function KioskRouter() {
  return (
    <Router base="/kiosk-app">
      <AnimatedWrapper>
        <Switch>
          <Route path="/" component={IdleScreen} />
          <Route path="/confirm/:printId" component={JobConfirmationScreen} />
          <Route path="/printing/:printId" component={PrintingScreen} />
          <Route path="/success" component={SuccessScreen} />
          <Route path="/error" component={ErrorScreen} />
          <Route component={NotFound} />
        </Switch>
      </AnimatedWrapper>
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="absolute inset-0 flex flex-col bg-background text-foreground overflow-hidden selection:bg-transparent">
          <RealtimeStatusHandler />
          <Header />
          <main className="flex-1 relative flex flex-col z-0 min-h-0">
            {/* Background design elements to make it feel premium */}
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />

            <div className="relative z-10 w-full h-full flex flex-col min-h-0">
              <KioskRouter />
            </div>
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
