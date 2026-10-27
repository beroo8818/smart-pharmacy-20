import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound.tsx";
import AuthPage from "./pages/Auth.tsx";
import ResetPasswordPage from "./pages/ResetPassword.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import UploadPage from "./pages/Upload.tsx";
import Dictionary from "./pages/Dictionary.tsx";
import ActiveIngredients from "./pages/ActiveIngredients.tsx";
import ActiveIngredientGroup from "./pages/ActiveIngredientGroup.tsx";
import Items from "./pages/Items.tsx";
import ItemDetail from "./pages/ItemDetail.tsx";
import Alerts from "./pages/Alerts.tsx";
import Transfers from "./pages/Transfers.tsx";
import Reports from "./pages/Reports.tsx";
import PharmacyReport from "./pages/PharmacyReport.tsx";
import WhatToDo from "./pages/WhatToDo.tsx";
import ActionsLog from "./pages/ActionsLog.tsx";
import DailyActionCenter from "./pages/DailyActionCenter.tsx";
import CompareMonths from "./pages/CompareMonths.tsx";
import DataReview from "./pages/DataReview.tsx";
import StockTransactions from "./pages/StockTransactions.tsx";
import GoogleSheetSync from "./pages/GoogleSheetSync.tsx";
import DataSources from "./pages/DataSources.tsx";
import OperationCenter from "./pages/OperationCenter.tsx";
import Backup from "./pages/Backup.tsx";
import Assistant from "./pages/Assistant.tsx";
import Help from "./pages/Help.tsx";
import Settings from "./pages/Settings.tsx";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";
import AppLayout from "@/components/AppLayout";

const queryClient = new QueryClient();

function RootRedirect() {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        جارٍ التحميل...
      </div>
    );
  return <Navigate to={session ? "/home" : "/auth"} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {[
              { path: "/dashboard", el: <Dashboard /> },
              { path: "/home", el: <OperationCenter /> },
              { path: "/daily", el: <DailyActionCenter /> },
              { path: "/upload", el: <UploadPage /> },
              { path: "/google-sync", el: <GoogleSheetSync /> },
              { path: "/data-sources", el: <DataSources /> },
              { path: "/dictionary", el: <Dictionary /> },
              { path: "/active-ingredients", el: <ActiveIngredients /> },
              { path: "/active-ingredients/group/:key", el: <ActiveIngredientGroup /> },
              { path: "/items", el: <Items /> },
              { path: "/items/:id", el: <ItemDetail /> },
              { path: "/alerts", el: <Alerts /> },
              { path: "/transfers", el: <Transfers /> },
              { path: "/stock-transactions", el: <StockTransactions /> },
              { path: "/what-to-do", el: <WhatToDo /> },
              { path: "/actions-log", el: <ActionsLog /> },
              { path: "/reports", el: <Reports /> },
              { path: "/reports/pharmacy-status", el: <PharmacyReport /> },
              { path: "/reports/compare", el: <CompareMonths /> },
              { path: "/data-review", el: <DataReview /> },
              { path: "/backup", el: <Backup /> },
              { path: "/assistant", el: <Assistant /> },
              { path: "/help", el: <Help /> },
              { path: "/settings", el: <Settings /> },
            ].map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={
                  <RoleProtectedRoute path={r.path}>
                    <AppLayout>{r.el}</AppLayout>
                  </RoleProtectedRoute>
                }
              />
            ))}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
