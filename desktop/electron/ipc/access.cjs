const { getDb } = require("../db/sqlite.cjs");
function assigned(user) {
  const rights=require('./rights.cjs'),p=rights.profile(user);
  if(p.all_branches)return null;
  return getDb().prepare("SELECT id, name, type FROM locations WHERE id = ? AND active = 1 AND type = 'sub_pharmacy'").get(p.location_ids[0] || "");
}
function visible(user, name, type) {
  return require('./rights.cjs').allowed(user,name,type);
}
const manager = (user) => require('./rights.cjs').has(user,'users.manage');
module.exports = { assigned, visible, manager };
