const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");
const auth = require("./auth.cjs");
const { manager, assigned,visible } = require("./access.cjs");
const upload = require("./upload.cjs");
const {normalizeDates}=require('./reportDates.cjs');
const rights=require('./rights.cjs');

function call({ token, action, payload: p = {} }) {
  try {
    const session = auth.getCurrentUser({ token });
    if (!session.ok) throw new Error("غير مسجل الدخول");
    const user = session.user, db = getDb(), manage = manager(user), location = assigned(user);
    if(['dictionary_list','dictionary_create'].includes(action))return require('./itemDictionary.cjs').call(db,user,action,p);
    if(action==='local_table')return require('./localTables.cjs').call(user,p,token);
    if(action==='recommendation_list')return require('./recommendations.cjs').list(user,p);
    if(action==='recommendation_save')return require('./recommendations.cjs').save(user,p);
    if(action==='recommendation_import_legacy')return require('./recommendations.cjs').importLegacy(user,p);
    const needManager = () => { if (!manage) throw new Error("هذا الإجراء لمدير الصيدلية فقط"); };
    const ownLocation = (id) => {
      const loc = db.prepare("SELECT * FROM locations WHERE id = ? AND active = 1 AND type = 'sub_pharmacy'").get(id || "");
      if (!loc || !visible(user,loc.name,loc.type)) throw new Error("الصيدلية غير مسموحة لهذا الحساب");
      return loc;
    };
    const audit = (id, detail) => db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, 'operations', ?, ?)")
      .run(user.id, action, id, JSON.stringify(detail));
    if(action==='access_self')return {ok:true,access:rights.profile(user)};
    if(action==='access_save')return rights.save(user,p.user_id,p);
    if(action==='access_overview'){
      rights.demand(user,'permissions.manage');
      return {ok:true,actor_id:user.id,actor_role:user.role,access:rights.profile(user),users:db.prepare('SELECT id,username,full_name,role,assigned_location_id FROM users WHERE active=1').all().map(u=>({id:u.id,name:u.full_name||u.username,role:u.role,access:rights.profile(u)})),locations:db.prepare("SELECT id,name,type FROM locations WHERE active=1 AND type='sub_pharmacy'").all().filter(l=>visible(user,l.name,l.type))};
    }
    if(action==='freshness'){
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
      const rows=db.prepare(`SELECT l.id,l.name,l.type,
        max(CASE WHEN b.batch_kind<>'period_consumption' AND m.closing_balance IS NOT NULL THEN b.snapshot_date END) last_balance,
        max(CASE WHEN b.batch_kind IN ('monthly','full_snapshot') AND m.closing_balance IS NOT NULL THEN b.snapshot_date END) last_full_balance,
        max(CASE WHEN b.batch_kind IN ('partial_update','weekly_update') AND m.closing_balance IS NOT NULL THEN b.snapshot_date END) last_partial_balance,
        max(CASE WHEN b.batch_kind IN ('monthly','period_consumption') AND m.issued_qty IS NOT NULL THEN COALESCE(b.issued_to,date(b.month,'+1 month','-1 day')) END) last_consumption
        FROM locations l LEFT JOIN inventory_movements m ON m.location_id=l.id
        LEFT JOIN upload_batches b ON b.id=m.upload_batch_id AND b.status='saved' AND b.snapshot_date<=?
        WHERE l.active=1 GROUP BY l.id ORDER BY l.name`).all(today).filter(l=>visible(user,l.name,l.type));
      return {ok:true,locations:rows,completeScope:rights.has(user,'data.hospital')&&rights.has(user,'data.warehouse')&&rights.has(user,'data.branches')&&rights.profile(user).all_branches};
    }
    if (action === "overview") {
      const locations = db.prepare("SELECT id, name, type FROM locations WHERE active = 1 ORDER BY name").all();
      const allowedIds=new Set(locations.filter(l=>visible(user,l.name,l.type)).map(l=>l.id));
      const reports=db.prepare('SELECT * FROM branch_reports ORDER BY created_at DESC LIMIT 2000').all().filter(r=>allowedIds.has(r.location_id));
      const transfers=db.prepare('SELECT * FROM branch_requests ORDER BY created_at DESC LIMIT 2000').all().filter(r=>allowedIds.has(r.location_id));
      return { ok: true, manager: manage, location_id: location?.id || null,
        locations: locations.filter(l=>visible(user,l.name,l.type)),access:rights.profile(user),
        users: manage ? db.prepare("SELECT id, username, full_name, role, assigned_location_id FROM users WHERE active = 1").all().map((u) => ({ id: u.id, name: u.full_name || u.username, email: u.username, assigned_location_id: u.assigned_location_id, roles: [u.assigned_location_id ? 'sub_pharmacist' : u.role] })) : [],
        catalog: db.prepare("SELECT item_code, item_name_ar AS item_name, unit FROM item_master WHERE item_code IS NOT NULL AND unit IS NOT NULL ORDER BY item_name_ar").all(),
        reports: reports.map((r) => ({ ...r, rows: JSON.parse(r.rows) })), transfers };
    }
    return db.transaction(() => {
      if (action === "location_create") {
        needManager();
        const name = String(p.name || "").trim();
        if (!name || db.prepare("SELECT id FROM locations WHERE name = ?").get(name)) throw new Error("الاسم فارغ أو موجود بالفعل");
        const id = crypto.randomUUID();
        db.prepare("INSERT INTO locations(id, name, type) VALUES (?, ?, 'sub_pharmacy')").run(id, name);
        audit(id, { name }); return { ok: true };
      }
      if (["assign", "revoke", "user_create"].includes(action)) {
        needManager();
        if (action === "user_create") {
          const loc = ownLocation(p.location_id);
          if (!String(p.username || "").trim() || String(p.password || "").length < 8) throw new Error("اسم المستخدم وكلمة مرور 8 أحرف مطلوبان");
          const id = crypto.randomUUID();
          db.prepare("INSERT INTO users(id, username, full_name, password_hash, role, assigned_location_id) VALUES (?, ?, ?, ?, 'viewer', ?)")
            .run(id, String(p.username).trim(), p.name || p.username, auth.hashPassword(p.password), loc.id);
          db.prepare('INSERT INTO user_access_profiles(user_id,permissions,location_ids,all_branches,updated_by) VALUES(?,?,?,0,?)').run(id,JSON.stringify(rights.defaults('sub_pharmacist')),JSON.stringify([loc.id]),user.id);
          audit(id, { location_id: loc.id }); return { ok: true };
        }
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(p.user_id || "");
        if (!target || target.id === user.id || target.role !== "viewer") throw new Error("يمكن إدارة حسابات الصيدلي الفرعي/المشاهد فقط، وليس المديرين أو أمناء المخزن");
        const id = action === "assign" ? ownLocation(p.location_id).id : null;
        db.prepare("UPDATE users SET assigned_location_id = ?, active = ? WHERE id = ?").run(id, action === "assign" ? 1 : 0, target.id);
        db.prepare('UPDATE user_access_profiles SET location_ids=?,all_branches=0 WHERE user_id=?').run(JSON.stringify(id?[id]:[]),target.id);
        db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(target.id);
        audit(target.id, { location_id: id }); return { ok: true };
      }
      if (action === "submit") {
        rights.demand(user,'data.upload');
        const loc = ownLocation(p.location_id);
        if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 5000 || !["monthly", "partial_update","period_consumption"].includes(p.kind)) throw new Error("بيانات التقرير غير صالحة");
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
        const dates=normalizeDates(p.month,p.snapshot_date,p.kind,p,today);
        const codes = new Set();
        const rows = p.rows.map((r) => {
          if (!r.item_code || !r.item_name || !r.unit || codes.has(r.item_code)) throw new Error("الكود والاسم والوحدة مطلوبة؛ لا تكرر الكود");
          codes.add(r.item_code);
          const item = db.prepare("SELECT unit FROM item_master WHERE item_code = ? LIMIT 1").get(r.item_code);
          if (!item || item.unit !== r.unit) throw new Error("اختر صنفًا معروفًا بنفس الوحدة؛ تعريف الأصناف للمدير");
          if ((p.kind!=='period_consumption'&&(typeof r.balance !== 'number' || !Number.isFinite(r.balance) || r.balance < 0)) || (p.kind !== 'partial_update' && (typeof r.issued !== 'number' || !Number.isFinite(r.issued) || r.issued < 0))) throw new Error("الكميات ناقصة أو سالبة");
          if(p.kind==='period_consumption'&&r.balance!=null)throw new Error('منصرف الفترة فقط لا يسجل رصيدًا جديدًا');
          if (p.kind === 'partial_update' && r.issued != null) throw new Error("تحديث الرصيد لا يضيف منصرفًا شهريًا");
          return { item_code: r.item_code, item_name: r.item_name, unit: r.unit, balance: p.kind==='period_consumption'?null:r.balance, issued: p.kind !== 'partial_update' ? r.issued : null };
        }).sort((a, b) => a.item_code.localeCompare(b.item_code));
        const hash = crypto.createHash('sha256').update(JSON.stringify(['direct-v3',loc.id, p.month, p.snapshot_date, p.kind, dates, rows])).digest('hex');
        const duplicate = db.prepare("SELECT id,status,batch_id FROM branch_reports WHERE fingerprint = ?").get(hash);
        if (duplicate?.status==='approved'&&duplicate.batch_id) return { ok: true, duplicate: true, id: duplicate.id,batchId:duplicate.batch_id };
        const input=rows.map(r=>({...db.prepare('SELECT * FROM item_master WHERE item_code=? AND unit=?').get(r.item_code,r.unit),location:loc.name,location_type:loc.type,closing:r.balance,issued:r.issued}));
        const result=upload.saveBatch({token,fileName:'تقرير '+loc.name,month:p.month,snapshotDate:p.snapshot_date,batchKind:p.kind,rows:input,...dates,branchSubmission:true,confirmRevision:p.confirm_revision===true});
        if(result.requiresRevision)return {...result,ok:true};
        if(!result.ok)throw new Error(result.error);
        const id=duplicate?.id||crypto.randomUUID();
        if(!duplicate)db.prepare("INSERT INTO branch_reports(id, location_id, month, snapshot_date, kind, rows, fingerprint, created_by,issued_from,issued_to,consumption_only,snapshot_boundary) VALUES (?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?)")
          .run(id,loc.id,p.month,p.snapshot_date,p.kind==='period_consumption'?'monthly':p.kind,JSON.stringify(rows),hash,user.id,dates.issued_from,dates.issued_to,p.kind==='period_consumption'?1:0,dates.snapshot_boundary||null);
        db.prepare("UPDATE branch_reports SET status='approved',batch_id=?,reviewed_by=?,reviewed_at=datetime('now'),note='حفظ مباشر بعد التحقق؛ بدون مرحلة اعتماد' WHERE id=?").run(result.batchId,user.id,id);
        audit(id,{location_id:loc.id,rows:rows.length,batchId:result.batchId,direct:true});return {ok:true,id,batchId:result.batchId,duplicate:result.duplicate};
      }
      if (action === "review") {
        throw new Error('مرحلة الاعتماد ألغيت؛ احفظ التقرير مباشرة من تحديث الرصيد والمنصرف');
      }
      if (action === "request") {
        rights.demand(user,'requests.create');
        const loc = ownLocation(p.location_id);
        if (!p.item_code || !p.unit || !p.item_name || !Number.isFinite(p.qty) || p.qty <= 0 || String(p.note || '').trim().length < 5) throw new Error("حدد الصنف والوحدة والكمية وسبب الطلب");
        const id = crypto.randomUUID();
        db.prepare("INSERT INTO branch_requests(id, location_id, item_code, item_name, unit, qty, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, loc.id, p.item_code, p.item_name, p.unit, p.qty, p.note, user.id);
        audit(id, { qty: p.qty, location_id: loc.id }); return { ok: true, id };
      }
      if (action === "request_status") {
        const request = db.prepare("SELECT * FROM branch_requests WHERE id = ?").get(p.id || "");
        if (!request) throw new Error("الطلب غير موجود");
        const next = { requested: ['preparing', 'rejected'], approved: ['preparing', 'rejected'], preparing: ['received'] }[request.status] || [];
        const permitted=!!ownLocation(request.location_id)&&rights.has(user,p.status==='received'?'requests.receive':'requests.prepare');
        if (!permitted || !next.includes(p.status) || String(p.note || '').trim().length < 5) throw new Error("انتقال حالة غير مسموح أو رقم المستند/السبب ناقص");
        db.prepare("UPDATE branch_requests SET status = ?, note = ? WHERE id = ?").run(p.status, request.note + '\n' + p.note, request.id);
        audit(request.id, { status: p.status, note: p.note }); return { ok: true };
      }
      throw new Error("إجراء غير معروف");
    })();
  } catch (e) { return { ok: false, error: e.message }; }
}
module.exports = { call };
