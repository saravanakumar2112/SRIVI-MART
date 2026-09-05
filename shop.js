(function () {
  "use strict";

  var LS_ORDERS = "srivimart_orders";

  function getSession() {
    try {
      var r = localStorage.getItem("srivimart_session");
      return r ? JSON.parse(r) : null;
    } catch (e) {
      return null;
    }
  }

  function loadOrders() {
    try {
      var r = localStorage.getItem(LS_ORDERS);
      return r ? JSON.parse(r) : [];
    } catch (e) {
      return [];
    }
  }

  function saveOrders(arr) {
    localStorage.setItem(LS_ORDERS, JSON.stringify(arr));
  }

  function rupee(n) {
    return "₹" + Number(n).toLocaleString("en-IN");
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () {
      t.hidden = true;
    }, 2600);
  }

  function boot() {
    var s = getSession();
    if (!s || s.role !== "shop") {
      location.href = "login-shop.html";
      return;
    }
    document.getElementById("shopTitle").textContent = s.name || "Shop";
    var docMobileStr = s.whatsapp || s.phone ? (" · Document Mobile: " + (s.whatsapp || s.phone)) : "";
    document.getElementById("shopSub").textContent =
      "RestaurantID: " + (s.restaurantId || "—") + " · Owner: " + (s.email || "") + docMobileStr;

    document.getElementById("shopLogout").addEventListener("click", function () {
      SriviAuth.clearSession();
      location.href = "login.html";
    });

    // Handle Xerox-only UI
    var xFields = document.getElementById("xeroxOnlyFields");
    var gFields = document.getElementById("generalCategoryField");
    
    // Specialize UI labels for Xerox
    if (s.category === "Xerox Shop") {
        if (xFields) xFields.hidden = false;
        if (gFields) gFields.hidden = true;
        
        // Rename tabs and headings
        var tabs = document.querySelectorAll(".lp-tab");
        tabs.forEach(t => {
            if (t.getAttribute("data-tab") === "inventory") t.textContent = "Manage Services";
        });
        var invSec = document.getElementById("viewInventory");
        if (invSec) {
            var h3 = invSec.querySelector("h3");
            if (h3) h3.textContent = "Define New Service";
            var sub = invSec.querySelector(".section-sub");
            if (sub) sub.textContent = "Manage your printing rates and specialized service types.";
        }

        // Auto-populate default services if empty
        var inv = SriviAuth.getShopInventory(s.restaurantId);
        if (!inv || !inv.length) {
            inv = [
                { id: "X-01", name: "Normal Xerox (B/W)", desc: "Standard black and white photocopies", cat: "xerox", price: 2, xeroxType: ["normal"], paperSize: "A4", layout: "1", image: "https://image.pollinations.ai/prompt/black%20and%20white%20photocopy%20stack%20office?width=600&height=400" },
                { id: "X-02", name: "Color Printing", desc: "High quality color laser prints", cat: "xerox", price: 10, xeroxType: ["color"], paperSize: "A4", layout: "1", image: "https://image.pollinations.ai/prompt/color%20laser%20printout%20vibrant%20digital?width=600&height=400" },
                { id: "X-03", name: "Spiral & Binding", desc: "Professional document finishing", cat: "xerox", price: 40, xeroxType: ["spiral", "binding"], paperSize: "A4", layout: "1", image: "https://image.pollinations.ai/prompt/spiral%20binding%20notebook%20professional?width=600&height=400" }
            ];
            SriviAuth.saveShopInventory(s.restaurantId, inv);
        }
    }

    // [MOD] Check for notifications
    var notifEl = document.getElementById("shopNotifBanner");
    if (notifEl && typeof SriviAuth !== "undefined") {
      var unread = SriviAuth.getUnreadShopNotifications(s.restaurantId);
      if (unread.length) {
        notifEl.hidden = false;
        notifEl.textContent =
          "🔔 " +
          unread.length +
          " new: " +
          unread
            .map(function (n) {
              return n.message;
            })
            .join(" · ");
        SriviAuth.markShopNotificationsRead(s.restaurantId);
      } else {
        notifEl.hidden = true;
      }
    }

    var viewOrders = document.getElementById("viewOrders");
    var viewInventory = document.getElementById("viewInventory");
    var viewSettings = document.getElementById("viewSettings");
    
    document.querySelectorAll(".lp-tab").forEach(function (t) {
      t.addEventListener("click", function () {
        document.querySelectorAll(".lp-tab").forEach(function (x) { x.classList.toggle("active", x === t); });
        var tab = t.getAttribute("data-tab");
        if (viewOrders) viewOrders.hidden = tab !== "orders";
        if (viewInventory) viewInventory.hidden = tab !== "inventory";
        if (viewSettings) viewSettings.hidden = tab !== "settings";
        if (tab === "inventory") renderInventory();
        if (tab === "settings") populateSettingsForm();
      });
    });

    function populateSettingsForm() {
      var currentShop = getSession();
      if (!currentShop) return;
      var phoneInput = document.getElementById("settingsPhone");
      var waInput = document.getElementById("settingsWhatsapp");
      var waGroup = document.getElementById("settingsWhatsappGroup");
      
      if (phoneInput) phoneInput.value = currentShop.phone || "";
      if (waInput) waInput.value = currentShop.whatsapp || "";
      
      if (currentShop.category !== "Xerox Shop") {
        if (waGroup) waGroup.style.display = "none";
        if (waInput) waInput.removeAttribute("required");
      } else {
        if (waGroup) waGroup.style.display = "block";
        if (waInput) waInput.setAttribute("required", "required");
      }
    }

    function renderInventory() {
      var inv = SriviAuth.getShopInventory(s.restaurantId);
      var root = document.getElementById("inventoryList");
      if (!root) return;
      root.innerHTML = "";
      if (!inv.length) {
        root.innerHTML = "<p class='section-sub'>No items in your catalogue yet. Add one below!</p>";
        return;
      }
      inv.forEach(function(item, idx) {
        var d = document.createElement("div");
        d.className = "order-card shop-order";
        d.style.display = "flex";
        d.style.gap = "1rem";
        d.style.alignItems = "center";
        
        var imgHtml = "";
        if (item.image) {
          imgHtml = "<img src='" + esc(item.image) + "' style='width:60px; height:60px; border-radius:8px; object-fit:cover; background:#eee;' alt='AI Preview' />";
        }
        
        var metaExtra = "";
        if ((item.xeroxType && item.xeroxType.length) || item.paperSize) {
          var typeStr = Array.isArray(item.xeroxType) ? item.xeroxType.join(" + ") : (item.xeroxType || "");
          metaExtra = " · <span style='text-transform:capitalize; font-weight:700; color:var(--zm-red);'>" + esc(typeStr) + "</span>" +
                      (item.paperSize ? " (" + esc(item.paperSize) + ")" : "") +
                      (item.layout && item.layout !== "1" ? " · <span style='color:#666;'>" + item.layout + " per page</span>" : "");
        }
        
        var catHtml = s.category === "Xerox Shop" ? "" : " (" + esc(item.cat) + ")";
        
        d.innerHTML = imgHtml +
                      "<div style='flex:1;'>" +
                      "<div><strong>" + esc(item.name) + "</strong> — " + rupee(item.price) + "</div>" +
                      "<div class='shop-meta'>" + esc(item.desc) + catHtml + metaExtra + "</div>" +
                      "<div style='margin-top:0.5rem;'><button type='button' class='btn zm-btn-outline' style='padding:4px 8px; font-size:12px;' data-del-idx='" + idx + "'>Remove</button></div>" +
                      "</div>";
        root.appendChild(d);
      });
    }

    var invListEl = document.getElementById("inventoryList");
    if (invListEl) {
      invListEl.addEventListener("click", function(e) {
        var b = e.target.closest("[data-del-idx]");
        if (!b) return;
        var idx = parseInt(b.getAttribute("data-del-idx"), 10);
        var inv = SriviAuth.getShopInventory(s.restaurantId);
        inv.splice(idx, 1);
        SriviAuth.saveShopInventory(s.restaurantId, inv);
        toast("Item removed");
        renderInventory();
      });
    }

    var catSelect = document.getElementById("catSelect");
    var customField = document.getElementById("customCategoryField");
    if (catSelect && customField) {
      catSelect.addEventListener("change", function() {
        customField.hidden = catSelect.value !== "custom";
        if (catSelect.value !== "custom") {
          var customInput = customField.querySelector("input");
          if (customInput) customInput.value = "";
        }
      });
    }

    var formAdd = document.getElementById("formAddInventory");
    if (formAdd) {
      formAdd.addEventListener("submit", function(e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var inv = SriviAuth.getShopInventory(s.restaurantId);
        var name = fd.get("name").trim();
        var cat = s.category === "Xerox Shop" ? "xerox" : fd.get("cat");
        if (cat === "custom") {
          cat = (fd.get("customCat") || "").trim().toLowerCase();
          if (!cat) {
            toast("Please specify a custom category name");
            return;
          }
        }
        var prompt = encodeURIComponent(name + ", " + cat + ", high quality stationery product photography professional lighting white background");
        var aiImage = "https://image.pollinations.ai/prompt/" + prompt + "?width=600&height=400&nologo=true&seed=" + Math.floor(Math.random() * 1000);
        
        var selectedTypes = [];
        e.target.querySelectorAll("input[name='xeroxType']:checked").forEach(function(cb) {
            selectedTypes.push(cb.value);
        });
        
        inv.push({
          id: "ITM" + Date.now(),
          name: name,
          desc: fd.get("desc").trim(),
          cat: cat,
          price: parseFloat(fd.get("price")),
          image: aiImage,
          xeroxType: selectedTypes,
          paperSize: fd.get("paperSize") || "",
          layout: fd.get("layout") || "1"
        });
        SriviAuth.saveShopInventory(s.restaurantId, inv);
        toast("Item added to catalog");
        e.target.reset();
        if (customField) customField.hidden = true;
        renderInventory();
      });
    }

    var formUpdateSettings = document.getElementById("formUpdateSettings");
    if (formUpdateSettings) {
      formUpdateSettings.addEventListener("submit", function(e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var newPhone = fd.get("phone").trim();
        var newWhatsapp = fd.get("whatsapp") ? fd.get("whatsapp").trim() : "";
        
        // Update in DB
        var db = SriviAuth.loadDb();
        var shopIdx = db.shops.findIndex(function(sh) { return sh.restaurantId === s.restaurantId; });
        if (shopIdx !== -1) {
          db.shops[shopIdx].phone = newPhone;
          db.shops[shopIdx].whatsapp = newWhatsapp;
          SriviAuth.saveDb(db);
          
          // Update current session
          s.phone = newPhone;
          s.whatsapp = newWhatsapp;
          SriviAuth.setSession(s);
          
          var docMobileStr = s.whatsapp || s.phone ? (" · Document Mobile: " + (s.whatsapp || s.phone)) : "";
          document.getElementById("shopSub").textContent =
            "RestaurantID: " + (s.restaurantId || "—") + " · Owner: " + (s.email || "") + docMobileStr;
          
          toast("Mobile contact numbers updated successfully!");
        } else {
          toast("Error: Shop not found in credentials database.");
        }
      });
    }

    function render() {
      var orders = loadOrders();
      var root = document.getElementById("shopList");
      var empty = document.getElementById("shopEmpty");
      root.innerHTML = "";
      var placed = orders.filter(function (o) {
        return o.status === "placed" && (!o.shopId || o.shopId === s.restaurantId);
      });
      if (!placed.length) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      placed
        .slice()
        .reverse()
        .forEach(function (o) {
          var card = document.createElement("div");
          card.className = "order-card shop-order";
          var lines = o.items
            .map(function (it) {
              return "<li>" + esc(it.name) + " × " + it.qty + "</li>";
            })
            .join("");
          card.innerHTML =
            "<div class=\"order-card-head\"><div><span class=\"order-id\">" +
            esc(o.id) +
            "</span><br /><span class=\"shop-meta\">" +
            esc(o.customerName) +
            " · " +
            esc(o.customerPhone) +
            "<br />" +
            esc(o.timeLabel) +
            "</span></div><span class=\"order-status placed\">New — prepare</span></div>" +
            "<ul class=\"order-lines\">" +
            lines +
            "</ul>" +
            "<p class=\"order-total\"><strong>" +
            rupee(o.total) +
            "</strong>" +
            (o.distance ? " <span style='font-size:12px; color:#666; font-weight:400;'>(" + o.distance + " km)</span>" : "") +
            "</p>" +
            (o.pickupOtp ? "<div class=\"shop-meta\" style=\"color:#e23744; font-weight:800; margin-bottom:8px;\">PICKUP OTP: " + esc(o.pickupOtp) + "</div>" : "") +
            "<div class=\"shop-actions\"><button type=\"button\" class=\"btn zm-btn-primary\" data-ready=\"" +
            esc(o.id) +
            "\">Mark ready for pickup (notify partner)</button></div>";
          root.appendChild(card);
        });
    }

    document.getElementById("shopList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ready]");
      if (!b) return;
      var id = b.getAttribute("data-ready");
      var orders = loadOrders();
      var idx = orders.findIndex(function (x) {
        return x.id === id;
      });
      if (idx === -1) return;
      if (orders[idx].status !== "placed") return;
      orders[idx].status = "ready";
      orders[idx].pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
      saveOrders(orders);
      SriviAuth.notifyDeliveryPartners(
        id,
        "Order " + id + " is ready for pickup at the shop."
      );
      toast("Partner notified. Order marked ready.");
      render();
    });

    render();
  }

  boot();
})();
