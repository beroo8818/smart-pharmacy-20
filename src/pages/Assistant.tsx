import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Msg { role: "user" | "assistant"; content: string; }

export default function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "مرحبًا. اسألني عن النقص أو الزيادة أو الراكد أو أي صنف معين. أجيب من بيانات قاعدة البيانات فقط." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: next.map(m => ({ role: m.role, content: m.content })) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages([...next, { role: "assistant", content: data.reply || "لا توجد بيانات كافية." }]);
    } catch (e: any) {
      toast.error(e.message || "تعذر الاتصال بالمساعد");
      setMessages([...next, { role: "assistant", content: "حدث خطأ في الاتصال بالمساعد. حاول لاحقًا." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-[900px]">
      <PageHeader title="المساعد الذكي" description="اسأل بالعربية عن حالة الأصناف، النقص، أو التحويلات." />
      <Card className="p-5 flex flex-col h-[600px]">
        <div className="flex-1 overflow-auto space-y-3 mb-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                {m.role === "assistant" && <Sparkles className="inline w-3 h-3 ml-1 text-primary" />}
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            </div>
          ))}
          {busy && <div className="text-xs text-muted-foreground text-center">يفكر المساعد...</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="مثلاً: ما الأصناف التي بها نقص في صيدلية الطوارئ؟" disabled={busy} />
          <Button type="submit" disabled={busy || !input.trim()}>
            <Send className="w-4 h-4" /> إرسال
          </Button>
        </form>
      </Card>
    </div>
  );
}