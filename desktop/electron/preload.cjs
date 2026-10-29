const { contextBridge, ipcRenderer } = require("electron");

function call(channel) {
  return (args) => ipcRenderer.invoke(channel, args || {});
}

contextBridge.exposeInMainWorld("api", {
  operations: { call: call("operations:call") },
  auth: {
    login: call("auth:login"),
    logout: call("auth:logout"),
    me: call("auth:me"),
    changePassword: call("auth:changePassword"),
    listUsers: call("auth:listUsers"),
    createUser: call("auth:createUser"),
    setUserActive: call("auth:setUserActive"),
  },
  queries: {
    inventoryRevision:call('queries:inventoryRevision'),
    latestBatch: call("queries:latestBatch"),
    listBatches: call("queries:listBatches"),
    movementsByBatch: call("queries:movementsByBatch"),
    listBatchesContinuous: call("queries:listBatchesContinuous"),
    movementsByBatchIds: call("queries:movementsByBatchIds"),
    listLocations: call("queries:listLocations"),
    getSettings: call("queries:getSettings"),
    setSetting: call("queries:setSetting"),
  },
  upload: {
    parseExcel: call("upload:parseExcel"),
    saveBatch: call("upload:saveBatch"),
  },
  backup: {
    export: call("backup:export"),
    restore: call("backup:restore"),
  },
  maintenance: {
    wipeAll: call("maintenance:wipeAll"),
  },
  stockTxn: {
    list: call("stockTxn:list"),
    insert: call("stockTxn:insert"),
    delete: call("stockTxn:delete"),
  },
  audit: {
    insert: call("audit:insert"),
    list: call("audit:list"),
  },
  app: {
    version: call("app:version"),
    dbPath: call("app:dbPath"),
  },
});
