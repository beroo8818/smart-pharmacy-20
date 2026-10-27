import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export default function AuthPage() {
  const { session, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername) return toast.error("يرجى إدخال اسم المستخدم.");
    setBusy(true);
    const res = await login(cleanUsername, password);
    setBusy(false);
    if (!res.ok) return toast.error(res.error || "فشل تسجيل الدخول");
    toast.success("تم تسجيل الدخول");
    navigate("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-soft to-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-primary text-primary-foreground items-center justify-center text-2xl font-bold mb-3">
            د
          </div>
          <h1 className="text-2xl font-bold">دواء</h1>
          <p className="text-sm text-muted-foreground mt-1">
            نظام إدارة وتحليل أرصدة الأدوية
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <Label htmlFor="username">اسم المستخدم</Label>
            <Input id="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">كلمة المرور</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
          </Button>
        </form>
      </Card>
    </div>
  );
}