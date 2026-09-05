(function () {
  "use strict";

  const LS_SESSION = "srivimart_session";
  const LS_ORDERS = "srivimart_orders";
  const DELIVERY_CHARGE = 20;

  const stationeryCategories = [
    { key: "all", label: "All" },
    { key: "stationery", label: "Stationery" },
    { key: "notebooks", label: "Notebooks" },
    { key: "pens", label: "Pens" },
    { key: "files", label: "Files" },
    { key: "gifts", label: "Gifts" },
  ];

  const xeroxCategories = [
    { key: "all", label: "All Services" },
    { key: "xerox", label: "Photocopy" },
    { key: "print", label: "Digital Print" },
    { key: "binding", label: "Binding/Spiral" },
    { key: "scan", label: "Scanning" },
  ];

  const productCatalog = [];

  const shops = [];

  const deliveryAreas = [];

  let selectedCategory = "all";
  let cart = {}; // Object: ID -> Qty (for standard) OR virtualID -> Object (for custom)
  
  // Custom Xerox state
  let pendingXeroxItem = null;
  
  let activeShoppingRestId = null;
  let activeShoppingRestName = null;
  let activeShoppingInventory = [];

  function mapsUrl(query) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  }

  function formatRupee(n) {
    return "₹" + n.toLocaleString("en-IN");
  }

  function orderAmounts(o) {
    if (typeof o.subtotal === "number" && typeof o.deliveryCharge === "number" && typeof o.total === "number") {
      return { subtotal: o.subtotal, deliveryCharge: o.deliveryCharge, total: o.total };
    }
    const t = typeof o.total === "number" ? o.total : 0;
    return { subtotal: t, deliveryCharge: 0, total: t };
  }

  function getCustomerOrderCount() {
    const s = getSession();
    if (!s || s.role !== "customer") return 0;
    const all = loadOrders();
    return all.filter(function (o) {
      const phoneMatch = s.phone && o.customerPhone === s.phone;
      const emailMatch =
        s.email &&
        o.customerEmail &&
        String(o.customerEmail).toLowerCase() === String(s.email).toLowerCase();
      return phoneMatch || emailMatch;
    }).length;
  }

  function calculateDistance(shopId, pincode) {
    if (!pincode || pincode.length < 6) return 2.5;
    // Simulation: Deterministic hash based on PIN and shopId
    const seed = parseInt(pincode.substring(0,6)) + (shopId ? String(shopId).length : 0);
    const mock = (seed % 100) / 10 + 1.2; // 1.2km to 11.2km
    return parseFloat(mock.toFixed(1));
  }

  function getGoogleDistance(shopId, pincode, callback) {
    const fallback = calculateDistance(shopId, pincode);
    if (typeof google === 'undefined' || !google.maps || !google.maps.DistanceMatrixService) {
      return callback(fallback, "Simulated (Maps API not loaded)");
    }
    
    const shop = shops.find(s => s.id === shopId || s.name === shopId);
    if (!shop || !shop.lat) return callback(fallback, "Simulated (Shop location unknown)");

    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix({
      origins: [{ lat: shop.lat, lng: shop.lng }],
      destinations: [pincode + ", Tamil Nadu, India"],
      travelMode: 'DRIVING',
    }, (response, status) => {
      if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
        const distKm = response.rows[0].elements[0].distance.value / 1000;
        callback(parseFloat(distKm.toFixed(1)), "Google Maps real-time");
      } else {
        callback(fallback, "Simulated (API lookup failed)");
      }
    });
  }

  function getDeliveryCharge(distance) {
    // [MOD] First 2 orders are free delivery
    if (getCustomerOrderCount() < 2) return 0;
    
    // [MOD] 20 upto 6 km
    let charge = 20; 
    if (distance > 6) {
        // Extra ₹10 per km over 6km
        charge += Math.ceil(distance - 6) * 10;
    }
    return charge;
  }

  function getOrderById(id) {
    const orders = loadOrders();
    for (let i = 0; i < orders.length; i++) {
      if (orders[i].id === id) return orders[i];
    }
    return null;
  }

  function escapeHtmlMultiline(s) {
    return escapeHtml(s || "").split("\n").join("<br />");
  }

  function prefillCartAddress() {
    const s = getSession();
    const ta = document.getElementById("deliveryAddress");
    const lm = document.getElementById("deliveryLandmark");
    const pin = document.getElementById("deliveryPincode");
    if (!ta || !lm || !pin) return;
    if (s && s.role === "customer" && s.savedAddress) {
      if (!ta.value.trim()) ta.value = s.savedAddress.address || "";
      if (!lm.value.trim()) lm.value = s.savedAddress.landmark || "";
      if (!pin.value.trim()) pin.value = s.savedAddress.pincode || "";
    }
  }

  function clearCartAddressFields() {
    const ta = document.getElementById("deliveryAddress");
    const lm = document.getElementById("deliveryLandmark");
    const pin = document.getElementById("deliveryPincode");
    if (ta) ta.value = "";
    if (lm) lm.value = "";
    if (pin) pin.value = "";
  }

  function buildInvoiceHtml(o, amounts) {
    const rows = o.items
      .map(function (it) {
        const line = it.price * it.qty;
        return (
          "<tr><td>" +
          escapeHtml(it.name) +
          "</td><td>" +
          it.qty +
          "</td><td>" +
          formatRupee(it.price) +
          "</td><td>" +
          formatRupee(line) +
          "</td></tr>"
        );
      })
      .join("");
    let addrBlock = "—";
    if (o.deliveryAddress && o.deliveryAddress.address) {
      addrBlock =
        escapeHtmlMultiline(o.deliveryAddress.address) +
        (o.deliveryAddress.landmark
          ? "<br />Landmark: " + escapeHtml(o.deliveryAddress.landmark)
          : "") +
        (o.deliveryAddress.pincode ? "<br />PIN: " + escapeHtml(o.deliveryAddress.pincode) : "");
    }
    return (
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/><title>Invoice " +
      escapeHtml(o.id) +
      "</title><style>body{font-family:Mulish,system-ui,sans-serif;padding:28px;max-width:560px;margin:0 auto;color:#1c1c1c}h1{color:#e23744;font-size:1.35rem;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#696969}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border-bottom:1px solid #eee;padding:10px 6px;text-align:left;font-size:14px}th{font-size:11px;text-transform:uppercase;color:#696969}.tot{text-align:right;margin:6px 0;font-size:14px}.grand{font-size:1.15rem;font-weight:800;margin-top:12px}.box{background:#f8f8f8;padding:12px;border-radius:8px;font-size:13px;line-height:1.5;margin:12px 0}</style></head><body><h1>SRIVI MART</h1><p style=\"color:#696969;font-size:13px;margin:0\">Invoice / Bill (demo)</p><div class=\"box\"><strong>Invoice no.</strong> " +
      escapeHtml(o.id) +
      "<br /><strong>Date</strong> " +
      escapeHtml(o.timeLabel) +
      "</div><h2>Bill to</h2><div class=\"box\">" +
      escapeHtml(o.customerName) +
      "<br />" +
      escapeHtml(o.customerPhone || "—") +
      (o.customerEmail ? "<br />" + escapeHtml(o.customerEmail) : "") +
      "</div><h2>Deliver to</h2><div class=\"box\">" +
      addrBlock +
      "</div><h2>Items</h2><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>" +
      rows +
      "</tbody></table><p class=\"tot\">Items subtotal: " +
      formatRupee(amounts.subtotal) +
      "</p><p class=\"tot\">Delivery charge: " +
      formatRupee(amounts.deliveryCharge) +
      "</p><p class=\"tot grand\">Total payable: " +
      formatRupee(amounts.total) +
      "</p><p style=\"margin-top:28px;font-size:12px;color:#696969\">Thank you for ordering with SRIVI MART. This is a demo document.</p></body></html>"
    );
  }

  function openInvoice(orderId) {
    const o = getOrderById(orderId);
    if (!o) {
      showToast("Order not found");
      return;
    }
    const amounts = orderAmounts(o);
    const html = buildInvoiceHtml(o, amounts);
    const w = window.open("", "_blank");
    if (!w) {
      showToast("Allow pop-ups to print invoice");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () {
      w.print();
    }, 250);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function openXeroxModal() {
      document.getElementById("xeroxModalBackdrop").hidden = false;
      document.getElementById("xeroxOptionModal").hidden = false;
      // Reset checkboxes
      document.querySelectorAll("#xeroxCustomerTypes input").forEach(i => i.checked = false);

      // Populate shop owner mobile info
      const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
      const shop = db.shops.find(s => s.restaurantId === activeShoppingRestId || s.id === activeShoppingRestId);
      const phoneEl = document.getElementById("xeroxModalPhone");
      const waWrap = document.getElementById("xeroxModalWaWrap");
      
      if (shop) {
          const mobNum = shop.whatsapp || shop.phone || "Not provided";
          if (phoneEl) phoneEl.textContent = mobNum;
          
          if (waWrap) {
              if (shop.whatsapp) {
                  const waMsg = encodeURIComponent("Hello " + shop.name + "! I am taking a Xerox copy/print order. I am attaching my document here.");
                  waWrap.innerHTML = "<a href='https://wa.me/" + shop.whatsapp + "?text=" + waMsg + "' target='_blank' class='btn zm-btn-primary' style='display:inline-flex; align-items:center; gap:6px; background:#25D366; border-color:#25D366; padding:6px 12px; font-size:12px; text-decoration:none; color:#fff;'>📱 Send Document on WhatsApp (" + escapeHtml(shop.whatsapp) + ")</a>";
              } else if (shop.phone) {
                  waWrap.innerHTML = "<a href='tel:" + shop.phone + "' class='btn zm-btn-outline' style='display:inline-flex; align-items:center; gap:6px; padding:6px 12px; font-size:12px; text-decoration:none;'>📞 Call Shop (" + escapeHtml(shop.phone) + ")</a>";
              } else {
                  waWrap.innerHTML = "";
              }
          }
      } else {
          if (phoneEl) phoneEl.textContent = "—";
          if (waWrap) waWrap.innerHTML = "";
      }
  }

  function closeXeroxModal() {
      document.getElementById("xeroxModalBackdrop").hidden = true;
      document.getElementById("xeroxOptionModal").hidden = true;
      pendingXeroxItem = null;
  }

  document.getElementById("xeroxModalClose").onclick = closeXeroxModal;
  document.getElementById("xeroxModalBackdrop").onclick = closeXeroxModal;

  document.getElementById("xeroxConfirmBtn").onclick = function() {
      if (!pendingXeroxItem) return;
      
      const types = [];
      document.querySelectorAll("#xeroxCustomerTypes input:checked").forEach(i => types.push(i.value));
      const size = document.getElementById("xeroxCustomerSize").value;
      const layout = document.getElementById("xeroxCustomerLayout").value;
      
      const virtualId = pendingXeroxItem.id + "__" + types.sort().join("_") + "_" + size + "_" + layout;
      
      if (cart[virtualId]) {
          cart[virtualId].qty++;
      } else {
          cart[virtualId] = {
              id: pendingXeroxItem.id,
              virtualId: virtualId,
              qty: 1,
              isXeroxSpecial: true,
              xeroxType: types,
              paperSize: size,
              layout: layout,
              name: pendingXeroxItem.name // cached for order lines
          };
      }
      
      updateCartUI();
      closeXeroxModal();
      showToast("Configured & added to cart");
  };

  function findProductById(id) {
    // If it's a virtual ID, extract the base ID
    const baseId = id.split("__")[0];
    let p = activeShoppingInventory.find((x) => x.id === baseId);
    if (!p) p = productCatalog.find((x) => x.id === baseId);
    return p;
  }

  function productById(id) {
    for (let i = 0; i < activeShoppingInventory.length; i++) {
      if (activeShoppingInventory[i].id === id) return activeShoppingInventory[i];
    }
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    if (db.shops && db.shops.length) {
      for (let s = 0; s < db.shops.length; s++) {
        const inv = SriviAuth.getShopInventory(db.shops[s].restaurantId);
        if (inv && inv.length) {
          for (let i = 0; i < inv.length; i++) {
            if (inv[i].id === id) return inv[i];
          }
        }
      }
    }
    for (let i = 0; i < productCatalog.length; i++) {
      if (productCatalog[i].id === id) return productCatalog[i];
    }
    return null;
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(data) {
    if (data) localStorage.setItem(LS_SESSION, JSON.stringify(data));
    else localStorage.removeItem(LS_SESSION);
  }

  function loadOrders() {
    try {
      const raw = localStorage.getItem(LS_ORDERS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveOrders(list) {
    localStorage.setItem(LS_ORDERS, JSON.stringify(list));
  }

  function genOrderId() {
    return "SM" + Date.now().toString(36).toUpperCase();
  }

  function genOtp() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  function renderCategoryChips() {
    const root = document.getElementById("categoryChips");
    if (!root) return;
    root.innerHTML = "";
    
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    
    // Determine which category set to use
    const shop = db.shops.find(s => s.restaurantId === activeShoppingRestId);
    let activeCats = [];
    if (shop && shop.category === "Xerox Shop") {
      activeCats = [...xeroxCategories];
    } else {
      activeCats = [...stationeryCategories];
      // Add any custom categories from activeShoppingInventory dynamically
      if (activeShoppingInventory && activeShoppingInventory.length) {
        activeShoppingInventory.forEach(function (item) {
          if (item.cat) {
            const keyLower = item.cat.trim().toLowerCase();
            const exists = activeCats.some(function (c) { return c.key.toLowerCase() === keyLower; });
            if (!exists) {
              const label = item.cat.charAt(0).toUpperCase() + item.cat.slice(1);
              activeCats.push({ key: keyLower, label: label });
            }
          }
        });
      }
    }

    activeCats.forEach(function (c) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "category-chip" + (c.key === selectedCategory ? " active" : "");
      b.textContent = c.label;
      b.setAttribute("data-cat", c.key);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", c.key === selectedCategory ? "true" : "false");
      b.addEventListener("click", function () {
        selectedCategory = c.key;
        root.querySelectorAll(".category-chip").forEach(function (el) {
          const on = el.getAttribute("data-cat") === selectedCategory;
          el.classList.toggle("active", on);
          el.setAttribute("aria-selected", on ? "true" : "false");
        });
        renderCatalog();
      });
      root.appendChild(b);
    });
  }

  function renderCatalog() {
    const root = document.getElementById("productFeed");
    const q = (document.getElementById("catalogSearch") && document.getElementById("catalogSearch").value || "").trim().toLowerCase();
    root.innerHTML = "";
    activeShoppingInventory.forEach(function (p) {
      if (selectedCategory !== "all" && p.cat !== selectedCategory) return;
      const hay = (p.name + " " + p.desc + " " + p.tag).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      const card = document.createElement("article");
      card.className = "product-card";
      
      let metaExtra = "";
      if ((p.xeroxType && p.xeroxType.length) || p.paperSize || p.layout) {
        let typeStr = Array.isArray(p.xeroxType) ? p.xeroxType.join(" + ") : (p.xeroxType || "");
        metaExtra = "<div class='shop-meta' style='margin-bottom:8px; display:flex; flex-wrap:wrap; gap:4px;'>" +
                    (typeStr ? "<span class='otp-badge' style='background:#fff3f3; color:#e23744; text-transform:capitalize;'>" + escapeHtml(typeStr) + "</span>" : "") +
                    (p.paperSize ? " <span class='otp-badge' style='background:#f0f7ff; color:#0056b3;'>" + escapeHtml(p.paperSize) + "</span>" : "") +
                    (p.layout && p.layout !== "1" ? " <span class='otp-badge' style='background:#f8f9fa; color:#666;'>" + escapeHtml(p.layout) + " per page</span>" : "") +
                    "</div>";
      }
      
      let imgHtml = "";
      if (p.image) {
        imgHtml = "<div class='product-img-wrap'><img class='product-img' src='" + escapeHtml(p.image) + "' alt='" + escapeHtml(p.name) + "' /></div>";
      }
      
      card.innerHTML = imgHtml +
        "<div class='product-info'>" +
        (p.tag ? "<span class=\"product-tag\">" + escapeHtml(p.tag) + "</span>" : "") +
        "<h3>" + escapeHtml(p.name) + "</h3>" +
        metaExtra +
        "<p class=\"product-desc\">" + escapeHtml(p.desc) + "</p>" +
        "<div class=\"product-footer\">" +
        "<div class=\"product-price\">" +
        "<span class=\"current\">" + formatRupee(p.price) + "</span>" +
        (p.old ? "<span class=\"old\">" + formatRupee(p.old) + "</span>" : "") +
        "</div>" +
        "<button type=\"button\" class=\"btn zm-btn-outline add-to-cart\" data-id=\"" + escapeHtml(p.id) + "\">Add</button>" +
        "</div></div>";
      root.appendChild(card);
    });
    if (!root.children.length) {
      const p = document.createElement("p");
      p.className = "section-sub";
      p.textContent = "No items match. Try another category or clear search.";
      root.appendChild(p);
    }
  }

  function renderAreas() {
    const root = document.getElementById("areaCards");
    if (!root) return;
    root.innerHTML = "";
    deliveryAreas.forEach(function (a) {
      const el = document.createElement("div");
      el.className = "area-card";
      el.innerHTML =
        "<h3>" +
        escapeHtml(a.title) +
        "</h3><p>" +
        escapeHtml(a.blurb) +
        "</p><ul>" +
        a.pins.map(function (x) {
          return "<li>" + escapeHtml(x) + "</li>";
        }).join("") +
        "</ul>";
      root.appendChild(el);
    });
  }

  function renderDynamicShopList(filterTown, searchText) {
    const root = document.getElementById("shopList");
    root.innerHTML = "";
    const q = (searchText || "").trim().toLowerCase();
    shops.forEach(function (s) {
      if (filterTown !== "all" && s.town !== filterTown) return;
      const hay = (s.name + " " + s.note + " " + s.town).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      const li = document.createElement("li");
      li.className = "shop-item";
      li.innerHTML =
        "<div><span class=\"shop-type\">" +
        escapeHtml(s.type) +
        "</span><h3>" +
        escapeHtml(s.name) +
        "</h3><p class=\"shop-meta\">" +
        escapeHtml(s.town) +
        " — " +
        escapeHtml(s.note) +
        "</p></div><div class=\"shop-actions\"><a href=\"" +
        mapsUrl(s.mapsQuery) +
        "\" target=\"_blank\" rel=\"noopener noreferrer\">Open in Maps</a></div>";
      root.appendChild(li);
    });
    if (!root.children.length) {
      const li = document.createElement("li");
      li.className = "shop-item";
      li.innerHTML = "<div><h3>No matches</h3><p class=\"shop-meta\">Try another filter.</p></div>";
      root.appendChild(li);
    }
  }

  function initMapTabs() {
    const tabs = document.querySelectorAll(".map-tab");
    const frames = document.querySelectorAll(".map-frame");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        const id = tab.getAttribute("data-map");
        tabs.forEach(function (t) {
          t.classList.toggle("active", t === tab);
        });
        frames.forEach(function (f) {
          const on = f.getAttribute("data-map") === id;
          f.classList.toggle("active", on);
          f.hidden = !on;
        });
      });
    });
  }

  function cartTotals() {
    let count = 0;
    let sum = 0;
    Object.keys(cart).forEach(function (id) {
      const p = findProductById(id);
      if (!p) return;
      const qty = typeof cart[id] === "object" ? cart[id].qty : cart[id];
      count += qty;
      sum += p.price * qty;
    });
    return { count: count, sum: sum };
  }

  function updateCartUI() {
    const { count, sum } = cartTotals();
    const el = document.getElementById("cartCount");
    if (el) el.textContent = String(count);
    const list = document.getElementById("cartList");
    const empty = document.getElementById("cartEmpty");
    const addrBlock = document.getElementById("cartAddressBlock");
    const summary = document.getElementById("cartSummary");
    const delEl = document.getElementById("cartDeliveryFee");
    const totalEl = document.getElementById("cartTotal");
    
    if (!list) return;
    
    // Find if current shop has whatsapp
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    const shop = db.shops.find(s => s.restaurantId === activeShoppingRestId);
    const shopWhatsApp = shop ? shop.whatsapp : "";
    
    let totalItems = 0;
    const itemSet = [];
    
    if (count === 0) {
      if (empty) empty.hidden = false;
      if (addrBlock) addrBlock.hidden = true;
      if (summary) summary.hidden = true;
      clearCartAddressFields();
      list.innerHTML = "";
    } else {
      if (empty) empty.hidden = true;
      if (addrBlock) addrBlock.hidden = false;
      if (summary) summary.hidden = false;
      prefillCartAddress();
      
      Object.keys(cart).forEach(function (id) {
        if (Number(cart[id])) {
            totalItems += cart[id];
            itemSet.push({ id, qty: cart[id] });
        } else if (cart[id] && typeof cart[id] === "object") {
            totalItems += cart[id].qty;
            itemSet.push(cart[id]);
        }
      });
      
      document.getElementById("cartCount").textContent = totalItems;
      list.innerHTML = "";
      
      itemSet.forEach(function (it) {
        const p = findProductById(it.id);
        if (!p) return;
        
        const li = document.createElement("li");
        li.className = "cart-item";
        
        let metaHtml = "";
        if (it.isXeroxSpecial) {
           const typeStr = (it.xeroxType || []).join(" + ") || "Standard";
           metaHtml = "<div class='shop-meta' style='font-size:11px;'>" + escapeHtml(typeStr) + " (" + escapeHtml(it.paperSize) + ", " + it.layout + " pg/sheet)</div>";
        }

        li.innerHTML =
          "<div>" +
          "<strong>" + escapeHtml(p.name) + " × " + it.qty + "</strong>" +
          metaHtml +
          "<div>" + formatRupee(p.price * it.qty) + "</div>" +
          "</div>" +
          "<button type=\"button\" class=\"icon-btn\" data-remove=\"" + escapeHtml(it.virtualId || it.id) + "\">×</button>";
        list.appendChild(li);
      });
    }

    const pinInput = document.getElementById("deliveryPincode");
    const pincode = pinInput ? pinInput.value : "";
    
    if (delEl && count > 0) {
        delEl.innerHTML = "<span style='font-size:12px; color:#666;'>Calculating distance...</span>";
    }

    getGoogleDistance(activeShoppingRestId, pincode, function(distance, source) {
        const dCharge = getDeliveryCharge(distance);
        const isPromo = dCharge === 0 && count > 0;
        const grand = count ? sum + dCharge : 0;

        if (delEl) {
            let label = formatRupee(count ? dCharge : 0);
            if (count > 0) {
                label += " <small style='display:block; font-size:10px; color:#666; font-weight:400;'>Distance: " + distance + " km (" + source + ")</small>";
            }
            delEl.innerHTML = label;
            if (isPromo) {
                const normalCharge = 20 + (distance > 6 ? Math.ceil(distance - 6) * 10 : 0);
                delEl.innerHTML = "<span style='text-decoration:line-through; color:#999; font-size:12px; margin-right:4px;'>" + formatRupee(normalCharge) + "</span> Free" +
                                 " <small style='display:block; font-size:10px; color:#666; font-weight:400;'>Distance: " + distance + " km (" + source + ")</small>";
            }
        }
        if (totalEl) totalEl.textContent = formatRupee(grand);
    });
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      t.hidden = true;
    }, 2600);
  }

  function redirectCustomerLogin() {
    window.location.href = "login-customer.html?next=" + encodeURIComponent("index.html");
  }

  function updateHeaderSession() {
    const s = getSession();
    const pill = document.getElementById("userPill");
    const loginLink = document.getElementById("headerLoginLink");
    const logoutBtn = document.getElementById("headerLogoutBtn");
    if (!pill) return;
    if (s && s.role === "customer") {
      pill.hidden = false;
      pill.textContent = s.name || s.phone || s.email;
      if (loginLink) loginLink.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
    } else if (s && s.role === "agent") {
      pill.hidden = false;
      pill.textContent = "Partner: " + (s.agentId || "Agent");
      if (loginLink) loginLink.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
    } else {
      pill.hidden = true;
      if (loginLink) {
        loginLink.hidden = false;
        loginLink.href = "login.html";
        loginLink.textContent = "Login";
      }
      if (logoutBtn) logoutBtn.hidden = true;
    }
  }

  function showCustomerShell() {
    document.getElementById("customerApp").hidden = false;
    document.getElementById("agentApp").hidden = true;
    document.getElementById("bottomNav").hidden = false;
    document.getElementById("agentBottomNav").hidden = true;
    document.body.style.paddingBottom = "calc(72px + env(safe-area-inset-bottom, 0px))";
  }

  function showAgentShell() {
    document.getElementById("customerApp").hidden = true;
    document.getElementById("agentApp").hidden = false;
    document.getElementById("bottomNav").hidden = true;
    document.getElementById("agentBottomNav").hidden = false;
    document.body.style.paddingBottom = "calc(64px + env(safe-area-inset-bottom, 0px))";
    renderAgentDashboard();
  }

  function renderCustomerOrders() {
    const s = getSession();
    const list = document.getElementById("customerOrderList");
    const empty = document.getElementById("customerOrdersEmpty");
    if (!list || !empty) return;
    list.innerHTML = "";
    if (!s || s.role !== "customer") {
      empty.hidden = false;
      empty.textContent = "Login as student/parent to see and track your orders.";
      return;
    }
    const show = loadOrders().filter(function (o) {
      const phoneMatch = s.phone && o.customerPhone === s.phone;
      const emailMatch =
        s.email &&
        o.customerEmail &&
        String(o.customerEmail).toLowerCase() === String(s.email).toLowerCase();
      return phoneMatch || emailMatch;
    });
    if (!show.length) {
      empty.hidden = false;
      empty.textContent = "No orders yet. Add items and tap Place order.";
      return;
    }
    empty.hidden = true;
    show
      .slice()
      .reverse()
      .forEach(function (o) {
        list.appendChild(orderCardCustomer(o));
      });
  }

  function orderCardCustomer(o) {
    const li = document.createElement("li");
    li.className = "order-card";
    const amt = orderAmounts(o);
    const lines = o.items
      .map(function (it) {
        return "<li>" + escapeHtml(it.name) + " × " + it.qty + "</li>";
      })
      .join("");
    let addrHtml = "";
    if (o.deliveryAddress && o.deliveryAddress.address) {
      addrHtml =
        "<div class=\"deliver-to-box\"><strong>Delivery address</strong>" +
        escapeHtmlMultiline(o.deliveryAddress.address) +
        (o.deliveryAddress.landmark
          ? "<br />Landmark: " + escapeHtml(o.deliveryAddress.landmark)
          : "") +
        (o.deliveryAddress.pincode ? "<br />PIN " + escapeHtml(o.deliveryAddress.pincode) : "") +
        "</div>";
    }

    // Retrieve shop contact and WhatsApp information
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    const shop = db.shops.find(s => s.restaurantId === o.shopId || s.name === o.shopName);
    
    let shopInfoHtml = "";
    if (shop) {
        let contactDetails = [];
        if (shop.phone) {
            contactDetails.push("Phone: <b>" + escapeHtml(shop.phone) + "</b>");
        }
        let waBtn = "";
        if (shop.category === "Xerox Shop" && shop.whatsapp) {
            contactDetails.push("WhatsApp: <b>" + escapeHtml(shop.whatsapp) + "</b>");
            
            const waMsg = encodeURIComponent("Hello! I just placed Order #" + o.id + " on SRIVI MART.\n\nItems:\n" + o.items.map(i => "• " + i.name).join("\n") + "\n\nI am attaching my documents for printout here.");
            const waUrl = "https://wa.me/" + shop.whatsapp + "?text=" + waMsg;
            waBtn = "<div style='margin-top:10px;'><a href='" + waUrl + "' target='_blank' class='btn zm-btn-primary' style='display:inline-flex; align-items:center; gap:8px; background:#25D366; border-color:#25D366; padding:8px 16px; font-size:13px; text-decoration:none; color:#fff; cursor:pointer;'>📤 Send documents via WhatsApp</a></div>";
        }
        
        if (contactDetails.length > 0) {
            shopInfoHtml = "<div class='deliver-to-box' style='background:#f8f9fa; border:1px solid #e9ecef; margin-top:10px;'><strong>Shop Contact (" + escapeHtml(shop.name) + ")</strong><br/>" + 
                           contactDetails.join(" · ") + waBtn + "</div>";
        }
    }

    li.innerHTML =
      "<div class=\"order-card-head\"><div><span class=\"order-id\">" +
      escapeHtml(o.id) +
      "</span><br /><span class=\"shop-meta\">" +
      escapeHtml(o.timeLabel) +
      "</span></div><span class=\"order-status " +
      statusClass(o.status) +
      "\">" +
      escapeHtml(statusLabel(o.status)) +
      "</span></div>" +
      addrHtml +
      shopInfoHtml +
      "<ul class=\"order-lines\">" +
      lines +
      "</ul><p class=\"order-total\">Items " +
      formatRupee(amt.subtotal) +
      " + Delivery " +
      formatRupee(amt.deliveryCharge) +
      "</p><p class=\"order-total\"><strong>Total " +
      formatRupee(amt.total) +
      "</strong></p><div class=\"order-actions\">" +
      (o.deliveryOtp ? "<div class=\"otp-badge\">Delivery OTP: <b>" + escapeHtml(o.deliveryOtp) + "</b></div>" : "") +
      "<button type=\"button\" class=\"btn zm-btn-outline\" data-invoice=\"" +
      escapeHtml(o.id) +
      "\">View / print invoice</button></div>";
    return li;
  }

  function statusClass(st) {
    if (st === "delivered") return "delivered";
    if (st === "picked") return "picked";
    if (st === "ready") return "ready";
    return "placed";
  }

  function statusLabel(st) {
    if (st === "delivered") return "Delivered";
    if (st === "picked") return "Out for delivery";
    if (st === "ready") return "Ready for pickup";
    return "Shop preparing";
  }

  function renderAgentDashboard() {
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    const orders = loadOrders();
    const list = document.getElementById("agentOrderList");
    const empty = document.getElementById("agentOrdersEmpty");
    const stats = document.getElementById("agentStats");
    const welcome = document.getElementById("agentWelcome");
    const notifEl = document.getElementById("agentNotifBanner");
    const s = getSession();
    if (welcome && s && s.role === "agent") {
      welcome.textContent =
        "Signed in as " +
        (s.agentId || "Partner") +
        ". Pick up only after the shop marks the order ready — you will see a banner when notified.";
    }
    if (typeof SriviAuth !== "undefined" && notifEl) {
      const unread = SriviAuth.getUnreadNotifications();
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
        SriviAuth.markAllNotificationsRead();
      } else {
        notifEl.hidden = true;
      }
    } else if (notifEl) notifEl.hidden = true;
    if (!list) return;
    list.innerHTML = "";
    const active = orders.filter(function (o) {
      return o.status !== "delivered";
    }).length;
    const done = orders.filter(function (o) {
      return o.status === "delivered";
    }).length;
    if (stats) {
      stats.innerHTML =
        "<div class=\"stat-pill\"><strong>" +
        active +
        "</strong><span>Active</span></div>" +
        "<div class=\"stat-pill\"><strong>" +
        done +
        "</strong><span>Delivered</span></div>" +
        "<div class=\"stat-pill\"><strong>" +
        orders.length +
        "</strong><span>All time</span></div>";
    }
    if (!orders.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    orders
      .slice()
      .reverse()
      .forEach(function (o) {
        const shop = db.shops.find(s => s.restaurantId === o.shopId);
        const wa = shop ? shop.whatsapp : "";

        const li = document.createElement("li");
        li.className = "order-card";
        
        let waBtn = "";
        if (wa && shop.category === "Xerox Shop") {
            const waMsg = encodeURIComponent("Hello! I just placed Order #" + o.id + " on SRIVI MART.\n\nItems:\n" + o.items.map(i => "• " + i.name).join("\n") + "\n\nI am attaching my documents for printout here.");
            waBtn = "<div style='margin-top:10px;'><a href='https://wa.me/" + wa + "?text=" + waMsg + "' target='_blank' class='btn zm-btn-primary' style='display:inline-flex; align-items:center; gap:8px; background:#25D366; border-color:#25D366; padding:8px 16px; font-size:13px; text-decoration:none;'>📤 Upload Documents to WhatsApp</a></div>";
        }

        const amt = orderAmounts(o);
        const lines = o.items
          .map(function (it) {
            return "<li>" + escapeHtml(it.name) + " × " + it.qty + "</li>";
          })
          .join("");
        
        li.innerHTML =
          "<div class='order-card-inner'>" +
          "<div class=\"order-header\">" +
          "<strong>Order #" + escapeHtml(o.id) + "</strong>" +
          "<span>" + o.timeLabel + "</span>" +
          "</div>" +
          "<div class=\"shop-name\">" + escapeHtml(o.shopName) + "</div>" +
          "<ul class=\"order-items\">" + lines + "</ul>" +
          waBtn +
          "<div class=\"order-status\"><span class=\"status-dot status-" + (o.status || "placed") + "\"></span> " + (o.status || "placed").toUpperCase() + "</div>" +
          "</div>";

        let addrHtml = "";
        if (o.deliveryAddress && o.deliveryAddress.address) {
          addrHtml =
            "<div class=\"deliver-to-box\"><strong>Deliver to (customer)</strong>" +
            escapeHtmlMultiline(o.deliveryAddress.address) +
            (o.deliveryAddress.landmark
              ? "<br />Landmark: " + escapeHtml(o.deliveryAddress.landmark)
              : "") +
            (o.deliveryAddress.pincode ? "<br />PIN " + escapeHtml(o.deliveryAddress.pincode) : "") +
            "</div>";
        } else {
          addrHtml =
            "<div class=\"deliver-to-box\"><strong>Deliver to</strong> Address not on file (old order).</div>";
        }
        let actions = "";
        if (o.status === "placed") {
          actions =
            "<span class=\"shop-meta\">Waiting for shop to prepare — you cannot pick up yet.</span>";
        } else if (o.status === "ready") {
          actions =
            "<button type=\"button\" class=\"btn zm-btn-primary\" data-act=\"picked\" data-oid=\"" +
            escapeHtml(o.id) +
            "\">Mark picked up</button>";
        } else if (o.status === "picked") {
          actions =
            "<button type=\"button\" class=\"btn zm-btn-primary\" data-act=\"delivered\" data-oid=\"" +
            escapeHtml(o.id) +
            "\">Mark delivered</button>";
        } else {
          actions = "<span class=\"shop-meta\">Completed</span>";
        }
        actions +=
          " <button type=\"button\" class=\"btn zm-btn-outline\" data-invoice=\"" +
          escapeHtml(o.id) +
          "\">Invoice</button>";
        li.innerHTML =
          "<div class=\"order-card-head\"><div><span class=\"order-id\">" +
          escapeHtml(o.id) +
          "</span><br /><span class=\"shop-meta\">" +
          escapeHtml(o.customerName) +
          " · " +
          escapeHtml(o.customerPhone) +
          "<br />" +
          escapeHtml(o.timeLabel) +
          "</span></div><span class=\"order-status " +
          statusClass(o.status) +
          "\">" +
          escapeHtml(statusLabel(o.status)) +
          "</span></div>" +
          addrHtml +
          "<ul class=\"order-lines\">" +
          lines +
          "</ul><p class=\"order-total\">Items " +
          formatRupee(amt.subtotal) +
          " + Delivery " +
          formatRupee(amt.deliveryCharge) +
          " · <strong>Total " +
          formatRupee(amt.total) +
          "</strong></p><div class=\"order-actions\">" +
          actions +
          "</div>";
        list.appendChild(li);
      });
  }

  function setOrderStatus(orderId, status) {
    const orders = loadOrders();
    const idx = orders.findIndex(function (o) {
      return o.id === orderId;
    });
    if (idx === -1) return;
    const cur = orders[idx].status;
    if (status === "picked" && cur !== "ready") {
      showToast("Wait until the shop marks this order ready for pickup.");
      return;
    }
    orders[idx].status = status;
    saveOrders(orders);
    renderAgentDashboard();
    renderCustomerOrders();
    showToast("Order updated");
  }

  function placeOrder() {
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    const s = getSession();
    if (!s || s.role !== "customer") {
      redirectCustomerLogin();
      return;
    }
    const { count, sum } = cartTotals();
    if (!count) {
      showToast("Cart is empty");
      return;
    }
    const addressEl = document.getElementById("deliveryAddress");
    const landmarkEl = document.getElementById("deliveryLandmark");
    const pinEl = document.getElementById("deliveryPincode");
    const address = (addressEl && addressEl.value.trim()) || "";
    const landmark = (landmarkEl && landmarkEl.value.trim()) || "";
    const pincode = (pinEl && pinEl.value.trim()) || "";
    if (address.length < 8) {
      showToast("Enter full delivery address");
      if (addressEl) addressEl.focus();
      return;
    }
    if (!/^\d{6}$/.test(pincode)) {
      showToast("Enter valid 6-digit PIN code");
      if (pinEl) pinEl.focus();
      return;
    }

    const locText = (address + " " + landmark).toLowerCase();
    const inServiceArea = locText.includes("sivakasi") || 
                          locText.includes("rajapalayam") || 
                          locText.includes("srivi") || 
                          pincode.startsWith("626");

    if (!inServiceArea) {
      showToast("Delivery is not available for this location.");
      return;
    }
    const items = [];
    Object.keys(cart).forEach(function (id) {
      if (Number(cart[id])) {
          const p = findProductById(id);
          if (!p) return;
          items.push({ id: p.id, name: p.name, qty: cart[id], price: p.price });
      } else if (cart[id] && typeof cart[id] === "object") {
          const it = cart[id];
          const p = findProductById(it.id);
          if (!p) return;
          let displayName = p.name;
          if (it.isXeroxSpecial) {
              const types = (it.xeroxType || []).join(" + ") || "Standard";
              displayName += " (" + types + " · " + it.paperSize + (it.layout !== "1" ? " · " + it.layout + " pg/sheet" : "") + ")";
          }
          items.push({ 
              id: p.id, 
              name: displayName, 
              qty: it.qty, 
              price: p.price,
              isXeroxSpecial: it.isXeroxSpecial,
              xeroxType: it.xeroxType,
              paperSize: it.paperSize,
              layout: it.layout
          });
      }
    });

    const subtotal = sum;
    const shopId = activeShoppingRestId || "";
    const shopName = activeShoppingRestName || "Global Order";
    const distance = calculateDistance(shopId, pincode);
    const deliveryCharge = getDeliveryCharge(distance);
    const total = subtotal + deliveryCharge;
    const now = new Date();

    const order = {
      id: genOrderId(),
      distance: distance,
      time: now.toISOString(),
      timeLabel: now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
      customerName: s.name,
      customerPhone: s.phone || "",
      customerEmail: s.email || "",
      shopId: shopId,
      shopName: shopName,
      items: items,
      subtotal: subtotal,
      deliveryCharge: deliveryCharge,
      total: total,
      deliveryAddress: {
        address: address,
        landmark: landmark,
        pincode: pincode,
      },
      status: "placed",
      deliveryOtp: genOtp(),
    };
    const all = loadOrders();
    all.push(order);
    saveOrders(all);

    // [MOD] Notify shop owner and delivery partner at the same time
    if (typeof SriviAuth !== "undefined") {
      SriviAuth.notifyShop(
        shopId,
        order.id,
        "New order " + order.id + " placed by " + (s.name || "customer") + "."
      );
      SriviAuth.notifyDeliveryPartners(
        order.id,
        "New task: Order " + order.id + " is being prepared at " + (shopName || "shop") + "."
      );
    }

    Object.keys(cart).forEach(function (k) {
      delete cart[k];
    });
    setSession(
      Object.assign({}, s, {
        savedAddress: {
          address: address,
          landmark: landmark,
          pincode: pincode,
        },
      })
    );
    updateCartUI();
    renderCustomerOrders();
    saveOrders(orders);
    cart = {};
    updateCartUI();
    renderAgentDashboard();
    closeCart();
    renderCustomerOrders();
    
    // Xerox specific success message with WhatsApp button
    const shop = db.shops.find(s => s.restaurantId === shopId);
    if (shop && shop.category === "Xerox Shop" && shop.whatsapp) {
        const waMsg = encodeURIComponent("Hello! I just placed Order #" + order.id + " on SRIVI MART.\n\nItems:\n" + order.items.map(i => "• " + i.name).join("\n") + "\n\nI am attaching my documents for printout here.");
        const waUrl = "https://wa.me/" + shop.whatsapp + "?text=" + waMsg;
        
        const t = document.getElementById("toast");
        t.innerHTML = "<div style='text-align:center;'>Order placed! 🎉<br/><a href='" + waUrl + "' target='_blank' style='display:inline-block; margin-top:10px; background:#fff; color:#25D366; padding:8px 12px; border-radius:8px; font-weight:700; text-decoration:none;'>📤 Upload Documents to WhatsApp</a></div>";
        t.hidden = false;
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(function () { t.hidden = true; }, 10000); // Show for 10s
    } else {
        showToast("Order placed successfully! 🎉 Total " + formatRupee(total));
    }
    
    scrollToSection("customerOrdersSection");
  }

  function closeCart() {
    const panel = document.getElementById("cartPanel");
    const backdrop = document.getElementById("cartBackdrop");
    const toggle = document.getElementById("cartToggle");
    if (panel) panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function openCart() {
    const panel = document.getElementById("cartPanel");
    const backdrop = document.getElementById("cartBackdrop");
    const toggle = document.getElementById("cartToggle");
    if (panel) panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    prefillCartAddress();
  }

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setBottomNav(view) {
    document.querySelectorAll("#bottomNav .bottom-nav-item").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === view);
    });
    const acc = document.getElementById("accountSection");
    if (acc) acc.classList.remove("visible");
    if (view === "home") {
      scrollToSection("deals");
    } else if (view === "orders") {
      scrollToSection("customerOrdersSection");
    } else if (view === "workflow") {
      scrollToSection("workflow");
    } else if (view === "cart") {
      openCart();
    } else if (view === "account") {
      if (acc) {
        acc.classList.add("visible");
        scrollToSection("accountSection");
      }
      updateAccountPanel();
    }
  }

  function updateAccountPanel() {
    const s = getSession();
    const user = document.getElementById("accountPanelUser");
    if (!user) return;
    if (s && s.role === "customer") {
      user.hidden = false;
      document.getElementById("accountUserName").textContent = "Hi, " + (s.name || "Customer");
      document.getElementById("accountUserMeta").textContent =
        (s.phone ? "Mobile " + s.phone : "") +
        (s.email ? (s.phone ? " · " : "") + s.email : "") +
        " · Orders saved on this device.";
    } else {
      user.hidden = true;
    }
  }

  function initAuthUI() {
    const logoutBtn = document.getElementById("headerLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        setSession(null);
        updateHeaderSession();
        updateAccountPanel();
        renderCustomerOrders();
        showCustomerShell();
        setBottomNav("home");
        showToast("Logged out");
      });
    }

    document.getElementById("logoutCustomerBtn").addEventListener("click", function () {
      setSession(null);
      updateHeaderSession();
      updateAccountPanel();
      renderCustomerOrders();
      showToast("Logged out");
    });

    document.getElementById("logoHome").addEventListener("click", function (ev) {
      ev.preventDefault();
      const s = getSession();
      if (s && s.role === "agent") return;
      showCustomerShell();
      setBottomNav("home");
    });
  }

  function initBottomNav() {
    document.querySelectorAll("#bottomNav .bottom-nav-item").forEach(function (b) {
      b.addEventListener("click", function () {
        const s = getSession();
        if (s && s.role === "agent") return;
        showCustomerShell();
        setBottomNav(b.getAttribute("data-view"));
      });
    });
    document.querySelectorAll("#agentBottomNav .bottom-nav-item").forEach(function (b) {
      b.addEventListener("click", function () {
        const v = b.getAttribute("data-agent-view");
        if (v === "logout") {
          setSession(null);
          updateHeaderSession();
          showCustomerShell();
          setBottomNav("home");
          showToast("Partner logged out");
        } else {
          document.querySelectorAll("#agentBottomNav .bottom-nav-item").forEach(function (x) {
            x.classList.toggle("active", x === b);
          });
          scrollToSection("agentApp");
        }
      });
    });
  }

  function initCart() {
    const panel = document.getElementById("cartPanel");
    const backdrop = document.getElementById("cartBackdrop");
    const toggle = document.getElementById("cartToggle");
    const close = document.getElementById("cartClose");

    toggle.addEventListener("click", function () {
      if (panel.hidden) openCart();
      else closeCart();
    });
    close.addEventListener("click", closeCart);
    backdrop.addEventListener("click", closeCart);

    document.body.addEventListener("click", function (e) {
      const inv = e.target.closest("[data-invoice]");
      if (inv) {
        const oid = inv.getAttribute("data-invoice");
        if (oid) openInvoice(oid);
        return;
      }
      const btn = e.target.closest(".add-to-cart");
      if (btn) {
        const id = btn.getAttribute("data-id");
        const p = findProductById(id);
        
        // If it's a Xerox shop, open specializing modal
        const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
        const shop = db.shops.find(s => s.restaurantId === activeShoppingRestId || s.id === activeShoppingRestId);
        if (shop && shop.category === "Xerox Shop") {
            pendingXeroxItem = p;
            openXeroxModal();
            return;
        }

        cart[id] = (cart[id] || 0) + 1;
        updateCartUI();
        showToast("Added to cart");
        return;
      }
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        delete cart[rm.getAttribute("data-remove")];
        updateCartUI();
        return;
      }
      
      const shopBtn = e.target.closest("[data-sel-shop]");
      if (shopBtn) {
        const sid = shopBtn.getAttribute("data-sel-shop");
        const sname = shopBtn.getAttribute("data-sel-name");
        activeShoppingRestId = sid;
        activeShoppingRestName = sname;
        activeShoppingInventory = SriviAuth.getShopInventory(sid);
        
        if (!activeShoppingInventory.length) {
            activeShoppingInventory = JSON.parse(JSON.stringify(productCatalog));
            SriviAuth.saveShopInventory(sid, activeShoppingInventory);
        }

        const selSec = document.getElementById("activeShopSelect");
        if (selSec) selSec.hidden = true;
        const dealsSec = document.getElementById("deals");
        if (dealsSec) dealsSec.hidden = false;
        
        const title = document.getElementById("catalogShopTitle");
        if (title) title.textContent = "Catalogue: " + sname;
        
        // Populate Xerox Shop Notice Banner
        const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
        const shop = db.shops.find(s => s.restaurantId === sid);
        const banner = document.getElementById("xeroxShopNoticeBanner");
        if (banner) {
          if (shop && shop.category === "Xerox Shop") {
            const mob = shop.whatsapp || shop.phone || "N/A";
            let waBtnHtml = "";
            if (shop.whatsapp) {
              const msg = encodeURIComponent("Hello " + shop.name + "! I am sending a document for Xerox copy/print.");
              waBtnHtml = " <a href='https://wa.me/" + shop.whatsapp + "?text=" + msg + "' target='_blank' class='btn zm-btn-primary' style='display:inline-flex; align-items:center; gap:6px; background:#25D366; border-color:#25D366; padding:4px 10px; font-size:12px; margin-left:8px; text-decoration:none; color:#fff;'>📤 Send document via WhatsApp (" + escapeHtml(shop.whatsapp) + ")</a>";
            }
            banner.hidden = false;
            banner.innerHTML = "<div style='display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;'><span style='font-size:13px; color:#0369a1;'>📄 <strong>Xerox Shop Document Contact:</strong> Mobile <b>" + escapeHtml(mob) + "</b> (Controlled by Shop Owner)</span>" + waBtnHtml + "</div>";
          } else {
            banner.hidden = true;
          }
        }
        
        renderCatalog();
        scrollToSection("deals");
        return;
      }

      const act = e.target.closest("[data-act]");
      if (act && act.getAttribute("data-oid")) {
        const oid = act.getAttribute("data-oid");
        const a = act.getAttribute("data-act");
        const o = getOrderById(oid);
        if (!o) return;

        if (a === "picked") {
            const entered = prompt("Enter Pickup OTP from Shop Owner:");
            if (entered === o.pickupOtp) {
                setOrderStatus(oid, "picked");
            } else {
                showToast("Invalid Pickup OTP!");
            }
        }
        if (a === "delivered") {
            const entered = prompt("Enter Delivery OTP from Customer:");
            if (entered === o.deliveryOtp) {
                setOrderStatus(oid, "delivered");
            } else {
                showToast("Invalid Delivery OTP!");
            }
        }
      }
    });

    document.getElementById("checkoutBtn").addEventListener("click", placeOrder);
    
    const pinEl = document.getElementById("deliveryPincode");
    if (pinEl) {
      pinEl.addEventListener("input", updateCartUI);
    }

    const btnChange = document.getElementById("btnChangeShop");
    if (btnChange) {
      btnChange.addEventListener("click", function() {
        // Do not empty the cart when changing shops per the new requirement
        activeShoppingRestId = null;
        activeShoppingRestName = null;
        
        const selSec = document.getElementById("activeShopSelect");
        if (selSec) selSec.hidden = false;
        const dealsSec = document.getElementById("deals");
        if (dealsSec) dealsSec.hidden = true;
      });
    }

    updateCartUI();
  }

  let selectedShopCategory = "all";

  function renderDynamicShopList(cityFilter, query) {
    const root = document.getElementById("dynamicShopList");
    if (!root) return;
    root.innerHTML = "";
    const q = (query || "").trim().toLowerCase();
    
    const db = typeof SriviAuth !== "undefined" ? SriviAuth.loadDb() : { shops: [] };
    if (!db.shops || !db.shops.length) {
      root.innerHTML = "<p class='section-sub'>No shops are active right now. Admins/owners need to register shops first.</p>";
      return;
    }
    let matched = 0;
    db.shops.forEach(function(s) {
      if (cityFilter && cityFilter !== "all" && s.town !== cityFilter) return;
      if (selectedShopCategory !== "all" && s.category !== selectedShopCategory) return;
      
      const hay = (s.name + " " + (s.town || "") + " " + (s.note || "") + " " + (s.category || "")).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      matched++;
      
      const card = document.createElement("article");
      card.className = "product-card";

      let docMobileHtml = "";
      if (s.category === "Xerox Shop") {
        const mob = s.whatsapp || s.phone;
        if (mob) {
          docMobileHtml = "<div style='margin:6px 0 10px; background:#f0f9ff; border:1px solid #bae6fd; padding:6px 10px; border-radius:6px; font-size:12px; color:#0369a1;'>" +
                          "📱 Doc Mobile: <b>" + escapeHtml(mob) + "</b>" +
                          (s.whatsapp ? "<br/><a href='https://wa.me/" + s.whatsapp + "?text=" + encodeURIComponent("Hello " + s.name + "! I want to send a document for Xerox copy.") + "' target='_blank' style='color:#16a34a; font-weight:700; text-decoration:underline; font-size:11px; display:inline-block; margin-top:2px;'>📤 Send document via WhatsApp</a>" : "") +
                          "</div>";
        }
      }

      card.innerHTML = "<h3>" + escapeHtml(s.name) + "</h3>" +
                       "<div style='display:flex; gap:6px; margin-bottom:8px;'><span class='otp-badge' style='background:#fde9ea; color:#e23744; border:none; padding:2px 8px;'>" + escapeHtml(s.category || "General Store") + "</span></div>" +
                       "<p class='section-sub'>" + escapeHtml(s.note || s.town || "") + "</p>" +
                       docMobileHtml +
                       "<button type='button' class='btn zm-btn-outline btn-block' style='margin-top:auto;' data-sel-shop='" + escapeHtml(s.restaurantId) + "' data-sel-name='" + escapeHtml(s.name) + "'>Browse shop →</button>";
      root.appendChild(card);
    });
    if (!matched) {
      root.innerHTML = "<p class='section-sub'>No matched shops for your current filters.</p>";
    }
  }

  function initShopFilters() {
    const city = document.getElementById("cityFilter");
    const search = document.getElementById("shopSearch");
    if(!city || !search) return;

    function apply() {
      renderDynamicShopList(city.value, search.value);
    }
    
    city.addEventListener("change", apply);
    search.addEventListener("input", apply);

    // Hero Category Toggle
    document.querySelectorAll(".category-hero-card").forEach(function(card) {
        card.addEventListener("click", function() {
            const cat = card.getAttribute("data-shop-cat");
            const wasActive = card.classList.contains("active");
            
            document.querySelectorAll(".category-hero-card").forEach(c => c.classList.remove("active"));
            
            if (wasActive) {
                selectedShopCategory = "all";
            } else {
                card.classList.add("active");
                selectedShopCategory = cat;
            }
            
            // Go back to shop select view if catalog is open
            activeShoppingRestId = null;
            activeShoppingRestName = null;
            
            const selSec = document.getElementById("activeShopSelect");
            if (selSec) selSec.hidden = false;
            const dealsSec = document.getElementById("deals");
            if (dealsSec) dealsSec.hidden = true;
            
            apply();
            
            // Scroll to the shops list
            scrollToSection("activeShopSelect");
        });
    });
  }

  function bootShell() {
    const s = getSession();
    if (!s) {
      window.location.href = "login.html";
      return;
    }
    if (s && s.role === "shop") {
      window.location.href = "shop.html";
      return;
    }
    if (s && s.role === "admin") {
      window.location.href = "admin.html";
      return;
    }
    if (s && s.role === "agent") showAgentShell();
    else showCustomerShell();
    updateHeaderSession();
    updateAccountPanel();
  }

  document.getElementById("year").textContent = String(new Date().getFullYear());
  renderCategoryChips();
  renderDynamicShopList();
  document.getElementById("catalogSearch").addEventListener("input", function () {
    renderCatalog();
  });
  renderAreas();
  initMapTabs();
  initShopFilters();
  initCart();
  initAuthUI();
  initBottomNav();
  bootShell();
  renderCustomerOrders();

  function highlightBottomNav(view) {
    document.querySelectorAll("#bottomNav .bottom-nav-item").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === view);
    });
  }

  function applyWorkflowHash() {
    if (location.hash !== "#workflow") return;
    const s = getSession();
    if (s && s.role === "agent") return;
    showCustomerShell();
    highlightBottomNav("workflow");
    const acc = document.getElementById("accountSection");
    if (acc) acc.classList.remove("visible");
    scrollToSection("workflow");
  }

  window.addEventListener("hashchange", applyWorkflowHash);
  setTimeout(applyWorkflowHash, 80);
})();
