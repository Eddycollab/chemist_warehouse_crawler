import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PasswordProvider, usePassword } from "./contexts/PasswordContext";
import TenderDashboard from "./pages/TenderDashboard";
import TenderList from "./pages/TenderList";
import TenderCrawlerManager from "./pages/TenderCrawlerManager";
import Notifications from "./pages/Notifications";
import SettingsPage from "./pages/Settings";
import DashboardLayout from "./components/DashboardLayout";
import PasswordGate from "./pages/PasswordGate";

function ProtectedRouter() {
  const { isVerified } = usePassword();

  if (!isVerified) {
    return <PasswordGate />;
  }

  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={TenderDashboard} />
        <Route path="/tenders" component={TenderList} />
        <Route path="/tenders/scoring" component={TenderList} />
        <Route path="/tender-crawler" component={TenderCrawlerManager} />
        <Route path="/tender-crawler/jobs" component={TenderCrawlerManager} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <PasswordProvider>
          <TooltipProvider>
            <Toaster richColors theme="dark" />
            <ProtectedRouter />
          </TooltipProvider>
        </PasswordProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
