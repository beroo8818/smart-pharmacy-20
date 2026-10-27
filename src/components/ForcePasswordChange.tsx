import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { ShieldAlert } from "lucide-react";

/**
 * بوابة إجبارية: لا يُسمح بالمتابعة قبل تغيير كلمة المرور الافتراضية.
 * تظهر عندما تكون profiles.must_change_password = true.
 */
export default function ForcePasswordChange() {
  const { user, signOut, refreshProfile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("يجب أن تكون كلمة المرور ٨ أحرف على الأقل");
    if (password !== confirm) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user!.id);
    if (pErr) {
      setBusy(false);
      return toast.error(pErr.message);
    }
    await logAudit({ userId: user!.id, action: "password_changed_forced", entityType: "profile", entityId: user!.id });
    toast.success("تم تغيير كلمة المرور بنجاح");
    await refreshProfile();
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-soft to-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-destructive/10 text-destructive items-center justify-center mb-3">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold">تغيير كلمة المرور مطلوب</h1>
          <p className="text-sm text-destructive mt-2 font-semibold">
            يجب تغيير كلمة المرور الافتراضية قبل استخدام البرنامج
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="np">كلمة المرور الجديدة</Label>
            <Input id="np" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">٨ أحرف على الأقل</p>
          </div>
          <div>
            <Label htmlFor="cp">تأكيد كلمة المرور</Label>
            <Input id="cp" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور الجديدة"}
          </Button>
          <button type="button" onClick={() => signOut()} className="w-full text-sm text-muted-foreground hover:underline">
            تسجيل الخروج
          </button>
        </form>
      </Card>
    </div>
  );
}