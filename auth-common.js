/**
 * Shared demo auth + notifications for SRIVI MART (localStorage only — not secure for production).
 */
(function (global) {
  "use strict";

  var LS_CRED = "srivimart_credentials_v1";
  var LS_NOTIF = "srivimart_agent_notifs";
  var LS_SHOP_NOTIF = "srivimart_shop_notifs";
  var LS_SESS = "srivimart_session";
  var LS_INVENTORY = "srivimart_inventory";

  function emptyDb() {
    return { customers: [], shops: [], agents: [], admins: [] };
  }

  function loadDb() {
    try {
      var d = localStorage.getItem(LS_CRED);
      return d ? JSON.parse(d) : emptyDb();
    } catch (e) {
      return emptyDb();
    }
  }

  function saveDb(db) {
    localStorage.setItem(LS_CRED, JSON.stringify(db));
  }

  function generatePassword(length) {
    var chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@%^*&";
    var n = length || 12;
    var s = "";
    for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  function normEmail(e) {
    return (e || "").trim().toLowerCase();
  }

  function registerCustomer(rec) {
    var db = loadDb();
    if (!rec.password || !rec.phone || !rec.name)
      return { ok: false, msg: "Fill name, mobile, and password." };
    
    var email = normEmail(rec.email);
    if (email && db.customers.some(function (c) { return normEmail(c.email) === email; }))
      return { ok: false, msg: "Email already registered." };
    
    if (db.customers.some(function (c) { return c.phone.replace(/\s/g, "") === rec.phone.replace(/\s/g, ""); }))
      return { ok: false, msg: "Mobile already registered." };
    rec.userId = "USR-" + Date.now().toString(36).toUpperCase();
    rec.email = rec.email.trim();
    rec.address = rec.address || "";
    db.customers.push(rec);
    saveDb(db);
    return { ok: true, user: rec };
  }

  function loginCustomer(emailOrPhone, password) {
    var db = loadDb();
    var q = (emailOrPhone || "").trim();
    var qLower = q.toLowerCase();
    var u = db.customers.find(function (c) {
      return normEmail(c.email) === qLower || (c.phone && c.phone.replace(/\s/g, "") === q.replace(/\s/g, ""));
    });
    if (!u || u.password !== password) return { ok: false, msg: "Invalid email/mobile or password." };
    return { ok: true, user: u };
  }

  function registerShop(rec) {
    var db = loadDb();
    if (!rec.email || !rec.password || !rec.name || !rec.town) return { ok: false, msg: "Fill shop name, town, owner email, and password." };
    if (db.shops.some(function (s) { return normEmail(s.email) === normEmail(rec.email); }))
      return { ok: false, msg: "Email already registered for a shop." };
    rec.restaurantId = "RST-" + Date.now().toString(36).toUpperCase();
    rec.email = rec.email.trim();
    rec.ownerName = rec.ownerName || "";
    rec.town = rec.town || "Other";
    rec.rating = typeof rec.rating === "number" ? rec.rating : 5;
    db.shops.push(rec);
    saveDb(db);
    return { ok: true, user: rec };
  }

  function loginShop(email, password) {
    var db = loadDb();
    var u = db.shops.find(function (s) { return normEmail(s.email) === normEmail(email); });
    if (!u || u.password !== password) return { ok: false, msg: "Invalid email or password." };
    return { ok: true, user: u };
  }

  function registerAgent(rec) {
    var db = loadDb();
    if (!rec.email || !rec.password) return { ok: false, msg: "Fill email and password." };
    
    var aid = (rec.agentId || "").trim().toUpperCase();
    if (!aid) {
      // Generate unique AGT-XXXX
      var attempts = 0;
      do {
        aid = "AGT-" + Math.floor(1000 + Math.random() * 9000);
        attempts++;
      } while (db.agents.some(function (a) { return a.agentId === aid; }) && attempts < 100);
    } else {
      if (db.agents.some(function (a) { return a.agentId.toUpperCase() === aid; }))
        return { ok: false, msg: "Agent ID already taken." };
    }

    rec.agentId = aid;
    rec.email = rec.email.trim();
    rec.name = rec.name || aid;
    rec.location = rec.location || "";
    rec.available = rec.available !== false;
    db.agents.push(rec);
    saveDb(db);
    return { ok: true, user: rec };
  }

  function loginAgent(agentIdOrEmail, password) {
    var db = loadDb();
    var q = (agentIdOrEmail || "").trim();
    var qUpper = q.toUpperCase();
    var u = db.agents.find(function (a) {
      return a.agentId.toUpperCase() === qUpper || normEmail(a.email) === q.toLowerCase();
    });
    if (!u || u.password !== password) return { ok: false, msg: "Invalid Agent ID/email or password." };
    return { ok: true, user: u };
  }

  function registerAdmin(rec, accessCode) {
    if ((accessCode || "").trim() !== "SRIVI-ADMIN-DEMO")
      return { ok: false, msg: "Invalid access code. Demo code: SRIVI-ADMIN-DEMO" };
    var db = loadDb();
    if (!rec.email || !rec.password) return { ok: false, msg: "Fill email and password." };
    if (db.admins.some(function (a) { return normEmail(a.email) === normEmail(rec.email); }))
      return { ok: false, msg: "Email already registered." };
    rec.adminId = "ADM-" + Date.now().toString(36).toUpperCase();
    rec.email = rec.email.trim();
    db.admins.push(rec);
    saveDb(db);
    return { ok: true, user: rec };
  }

  function loginAdmin(email, password) {
    var db = loadDb();
    var u = db.admins.find(function (a) { return normEmail(a.email) === normEmail(email); });
    if (!u || u.password !== password) return { ok: false, msg: "Invalid email or password." };
    return { ok: true, user: u };
  }

  function setSession(obj) {
    localStorage.setItem(LS_SESS, JSON.stringify(obj));
  }

  function clearSession() {
    localStorage.removeItem(LS_SESS);
  }

  function clearAllShops() {
    var db = loadDb();
    db.shops = [];
    saveDb(db);
    console.log("All registered shops cleared.");
    return true;
  }

  function notifyDeliveryPartners(orderId, message) {
    var raw = localStorage.getItem(LS_NOTIF);
    var arr = raw ? JSON.parse(raw) : [];
    arr.push({ orderId: orderId, message: message || "Order update", ts: Date.now(), read: false });
    localStorage.setItem(LS_NOTIF, JSON.stringify(arr));
  }

  function getUnreadNotifications() {
    var raw = localStorage.getItem(LS_NOTIF);
    var arr = raw ? JSON.parse(raw) : [];
    return arr.filter(function (n) { return !n.read; });
  }

  function markAllNotificationsRead() {
    var raw = localStorage.getItem(LS_NOTIF);
    var arr = raw ? JSON.parse(raw) : [];
    arr.forEach(function (n) { n.read = true; });
    localStorage.setItem(LS_NOTIF, JSON.stringify(arr));
  }

  function notifyShop(shopId, orderId, message) {
    if (!shopId) return;
    var raw = localStorage.getItem(LS_SHOP_NOTIF);
    var all = raw ? JSON.parse(raw) : {};
    if (!all[shopId]) all[shopId] = [];
    all[shopId].push({ orderId: orderId, message: message || "New order", ts: Date.now(), read: false });
    localStorage.setItem(LS_SHOP_NOTIF, JSON.stringify(all));
  }

  function getUnreadShopNotifications(shopId) {
    if (!shopId) return [];
    var raw = localStorage.getItem(LS_SHOP_NOTIF);
    var all = raw ? JSON.parse(raw) : {};
    var arr = all[shopId] || [];
    return arr.filter(function (n) { return !n.read; });
  }

  function markShopNotificationsRead(shopId) {
    if (!shopId) return;
    var raw = localStorage.getItem(LS_SHOP_NOTIF);
    var all = raw ? JSON.parse(raw) : {};
    var arr = all[shopId] || [];
    arr.forEach(function (n) { n.read = true; });
    all[shopId] = arr;
    localStorage.setItem(LS_SHOP_NOTIF, JSON.stringify(all));
  }

  function getShopInventory(shopId) {
    var raw = localStorage.getItem(LS_INVENTORY);
    var all = raw ? JSON.parse(raw) : {};
    return all[shopId] || [];
  }

  function saveShopInventory(shopId, items) {
    var raw = localStorage.getItem(LS_INVENTORY);
    var all = raw ? JSON.parse(raw) : {};
    all[shopId] = items || [];
    localStorage.setItem(LS_INVENTORY, JSON.stringify(all));
  }

  global.SriviAuth = {
    LS_CRED: LS_CRED,
    LS_NOTIF: LS_NOTIF,
    LS_SESS: LS_SESS,
    loadDb: loadDb,
    saveDb: saveDb,
    generatePassword: generatePassword,
    registerCustomer: registerCustomer,
    loginCustomer: loginCustomer,
    registerShop: registerShop,
    loginShop: loginShop,
    registerAgent: registerAgent,
    loginAgent: loginAgent,
    registerAdmin: registerAdmin,
    loginAdmin: loginAdmin,
    setSession: setSession,
    clearSession: clearSession,
    notifyDeliveryPartners: notifyDeliveryPartners,
    getUnreadNotifications: getUnreadNotifications,
    markAllNotificationsRead: markAllNotificationsRead,
    notifyShop: notifyShop,
    getUnreadShopNotifications: getUnreadShopNotifications,
    markShopNotificationsRead: markShopNotificationsRead,
    getShopInventory: getShopInventory,
    saveShopInventory: saveShopInventory,
    clearAllShops: clearAllShops,
    factoryReset: function() {
      var keys = [
        LS_CRED, LS_NOTIF, LS_SHOP_NOTIF, LS_SESS, LS_INVENTORY,
        "srivimart_orders"
      ];
      keys.forEach(function(k) { localStorage.removeItem(k); });
      location.reload();
    }
  };
})(window);
