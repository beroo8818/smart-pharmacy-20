import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

function translateAuthError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد البريد الإلكتروني بعد.";
  if (m.includes("user already registered")) return "هذا البريد مسجل بالفعل.";
  if (m.includes("password should be at least")) return "كلمة المرور قصيرة جدًا.";
  if (m.includes("invalid email")) return "البريد الإلكتروني غير صالح.";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة، يرجى المحاولة لاحقًا.";
  if (m.includes("network")) return "تعذر الاتصال بالخادم.";
  return "حدث خطأ: " + msg;
}

function validateEmail(raw: string): { ok: boolean; clean: string; error?: string } {
  if (/\s/.test(raw)) return { ok: false, clean: raw, error: "البريد الإلكتروني يحتوي على مسافة غير صحيحة." };
  const clean = raw.trim();
  if (!clean) return { ok: false, clean, error: "يرجى إدخال البريد الإلكتروني." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, clean, error: "البريد الإلكتروني غير صالح." };
  return { ok: true, clean };
}

export default function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const v = validateEmail(email);
    if (!v.ok) return toast.error(v.error!);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: v.clean, password });
    setBusy(false);
    if (error) return toast.error(translateAuthError(error.message));
    toast.success("تم تسجيل الدخول");
    navigate("/dashboard");
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const v = validateEmail(email);
    if (!v.ok) return toast.error(v.error!);
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: v.clean,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { name },
      },
    });
    setBusy(false);
    if (error) return toast.error(translateAuthError(error.message));
    toast.success("تم إنشاء الحساب، يمكنك الدخول الآن");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    const v = validateEmail(email);
    if (!v.ok) return toast.error(v.error!);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(v.clean, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return toast.error(translateAuthError(error.message));
    toast.success("تم إرسال رابط إعادة التعيين إلى بريدك");
    setForgotMode(false);
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

        {forgotMode ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-center">نسيت كلمة المرور؟</h2>
            <p className="text-sm text-muted-foreground text-center">
              أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة التعيين.
            </p>
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <Label htmlFor="fe">البريد الإلكتروني</Label>
                <Input id="fe" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "جارٍ الإرسال..." : "إرسال رابط إعادة التعيين"}
              </Button>
              <div className="text-center">
                <button type="button" onClick={() => setForgotMode(false)} className="text-sm text-primary hover:underline">
                  العودة لتسجيل الدخول
                </button>
              </div>
            </form>
          </div>
        ) : (
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 mb-6">
              <TabsTrigger value="login">دخول</TabsTrigger>
              <TabsTrigger value="signup">حساب جديد</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="e">البريد الإلكتروني</Label>
                  <Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="p">كلمة المرور</Label>
                  <Input id="p" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setForgotMode(true)} className="text-sm text-primary hover:underline">
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label htmlFor="n">الاسم</Label>
                  <Input id="n" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="e2">البريد الإلكتروني</Label>
                  <Input id="e2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="p2">كلمة المرور</Label>
                  <Input id="p2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">٨ أحرف على الأقل</p>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "جارٍ الإنشاء..." : "إنشاء حساب"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  المستخدمون الجدد يبدؤون بدور "مشاهد فقط". تواصل مع مدير النظام لرفع صلاحياتك.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </Card>
    </div>
  );
}