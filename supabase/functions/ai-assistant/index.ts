// AI Assistant edge function — answers Arabic questions using DB-backed context.
// Uses Lovable AI Gateway. LOVABLE_API_KEY is auto-provided.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build small context snapshot from DB (RLS-respecting via user JWT)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const sb = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    // Require authenticated user
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: authError } = await sb.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate input
    const body = await req.json().catch(() => ({}));
    const rawMessages = body?.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 20) {
      return new Response(JSON.stringify({ error: "صيغة الرسائل غير صحيحة." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const messages = rawMessages
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "صيغة الرسائل غير صحيحة." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: items }, { data: locs }, { data: moves }] = await Promise.all([
      sb.from("item_master").select("id,item_name_ar,item_name_en,active_ingredient_ar,strength,dosage_form,unit"),
      sb.from("locations").select("id,name,type"),
      sb.from("monthly_stock_movements").select("item_master_id,location_id,month,issued_qty,closing_balance,expiry_date").order("month", { ascending: false }).limit(800),
    ]);

    const ctx = {
      items: (items || []).slice(0, 100),
      locations: locs || [],
      recent_movements: (moves || []).slice(0, 300),
    };

    const systemPrompt = `أنت مساعد ذكي داخل تطبيق إدارة أرصدة الأدوية. أجب بالعربية فقط.
- استخدم البيانات المرفقة في "CONTEXT" فقط، ولا تخترع أرقامًا.
- إذا لم تكفِ البيانات قل بوضوح: "لا توجد بيانات كافية للإجابة".
- اذكر دائمًا المصدر (اسم الصنف، اسم الموقع، الشهر) عند الاستشهاد بأرقام.
- اجعل الإجابة قصيرة ومباشرة وبلغة بسيطة للعاملين غير التقنيين.

CONTEXT:
${JSON.stringify(ctx)}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (resp.status === 429)
      return new Response(JSON.stringify({ error: "تم تجاوز الحد المسموح، حاول لاحقًا." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (resp.status === 402)
      return new Response(JSON.stringify({ error: "نفدت الأرصدة في مساعد الذكاء الاصطناعي." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("ai-assistant gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "حدث خطأ أثناء الاتصال بالمساعد." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || "لا توجد بيانات كافية للإجابة.";
    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(JSON.stringify({ error: "حدث خطأ داخلي. حاول لاحقًا." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});