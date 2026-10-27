import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    // التحقق من أن الرابط يحتوي على hash recovery
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setValid(true);
    } else {
      // في بعض الحالات يتم التعامل مع recovery من خلال supabase
      // نتحقق من الجلسة
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user?.aud === "authenticated") {
          setValid(true);
        }
      });
    }
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      return toast.error("يجب أن تكون كلمة المرور ٨ أحرف على الأقل");
    }
    if (password !== confirmPassword) {
      return toast.error("كلمتا المرور غير متطابقتين");
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      return toast.error(error.message);
    }
    toast.success("تم تغيير كلمة المرور بنجاح");
    setTimeout(() => navigate("/auth"), 1500);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-soft to-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-primary text-primary-foreground items-center justify-center text-2xl font-bold mb-3">
            د
          </div>
          <h1 className="text-2xl font-bold">إعادة تعيين كلمة المرور</h1>
          <p className="text-sm text-muted-foreground mt-1">
            أدخل كلمة المرور الجديدة
          </p>
        </div>

        {!valid && (
          <p className="text-center text-destructive text-sm">
            رابط إعادة التعيين غير صالح أو منتهي الصلاحية.
          </p>
        )}

        {valid && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <Label htmlFor="np">كلمة المرور الجديدة</Label>
              <Input
                id="np"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">٨ أحرف على الأقل</p>
            </div>
            <div>
              <Label htmlFor="cp">تأكيد كلمة المرور</Label>
              <Input
                id="cp"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "تغيير كلمة المرور"}
            </Button>
          </form>
        )}

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="text-sm text-primary hover:underline"
          >
            العودة لتسجيل الدخول
          </button>
        </div>
      </Card>
    </div>
  );
}
