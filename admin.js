(function () {
  "use strict";

  function getSession() {
    try {
      var r = localStorage.getItem("srivimart_session");
      return r ? JSON.parse(r) : null;
    } catch (e) {
      return null;
    }
  }

  function boot() {
    var s = getSession();
    if (!s || s.role !== "admin") {
      location.href = "login-admin.html";
      return;
    }
    document.getElementById("adminMeta").textContent =
      "Signed in as " + (s.email || "") + " · AdminID: " + (s.adminId || "");

    document.getElementById("adminLogout").addEventListener("click", function () {
      SriviAuth.clearSession();
      location.href = "login.html";
    });

    var db = SriviAuth.loadDb();
    var orders = [];
    try {
      orders = JSON.parse(localStorage.getItem("srivimart_orders") || "[]");
    } catch (e) {}

    var byStatus = { placed: 0, ready: 0, picked: 0, delivered: 0 };
    orders.forEach(function (o) {
      var st = o.status || "placed";
      if (Object.prototype.hasOwnProperty.call(byStatus, st)) byStatus[st]++;
    });

    document.getElementById("adminStats").innerHTML =
      "<div class=\"admin-card\"><strong>" +
      db.customers.length +
      "</strong><span>Users</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      db.shops.length +
      "</strong><span>Shops</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      db.agents.length +
      "</strong><span>Partners</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      db.admins.length +
      "</strong><span>Admins</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      orders.length +
      "</strong><span>Orders</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      byStatus.placed +
      "</strong><span>New</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      byStatus.ready +
      "</strong><span>Ready</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      byStatus.picked +
      "</strong><span>Out</span></div>" +
      "<div class=\"admin-card\"><strong>" +
      byStatus.delivered +
      "</strong><span>Done</span></div>";

    // Render registered shops list
    var shopsListHtml = "";
    if (db.shops && db.shops.length > 0) {
      db.shops.forEach(function(shop) {
        var phones = [];
        if (shop.phone) phones.push("Call: " + shop.phone);
        if (shop.whatsapp) phones.push("WA: " + shop.whatsapp);
        var phoneStr = phones.length ? phones.join(" · ") : "N/A";

        shopsListHtml += "<tr>" +
          "<td><strong>" + (shop.name || "N/A") + "</strong></td>" +
          "<td><span class='otp-badge' style='background:#fde9ea; color:#e23744; border:none; padding:2px 6px;'>" + (shop.category || "N/A") + "</span></td>" +
          "<td>" + (shop.town || "N/A") + "</td>" +
          "<td>" + (shop.ownerName || "N/A") + "</td>" +
          "<td><small style='font-weight:600; color:#0369a1;'>" + phoneStr + "</small></td>" +
          "<td>" + (shop.email || "N/A") + "</td>" +
          "<td><code>" + (shop.restaurantId || "N/A") + "</code></td>" +
          "</tr>";
      });
    } else {
      shopsListHtml = "<tr><td colspan='7' style='text-align:center;'>No shops registered yet.</td></tr>";
    }
    var shopsListEl = document.getElementById("adminShopsList");
    if (shopsListEl) shopsListEl.innerHTML = shopsListHtml;
      
    // Render the sales analysis pie charts
    renderSalesCharts(orders);
  }

  function renderSalesCharts(orders) {
    var dailySales = {};
    var monthlySales = {};
    var totalDailySales = 0;
    var totalMonthlySales = 0;

    var now = new Date();
    var currentYear = now.getFullYear();

    orders.forEach(function (o) {
      if (o.status === "placed" || o.status === "cancelled") {
        // optionally skip non-revenue if needed
        // but for analysis let's count all or maybe skip 'cancelled' if that existed.
      }
      
      if (!o.time || typeof o.total !== "number") return;

      var d = new Date(o.time);
      if (isNaN(d.getTime())) return;
      
      var diffTime = Math.abs(now - d);
      var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Daily (Last 7 Days)
      if (diffDays <= 7) {
        var dayString = d.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
        dailySales[dayString] = (dailySales[dayString] || 0) + o.total;
        totalDailySales += o.total;
      }

      // Monthly (Current Year)
      if (d.getFullYear() === currentYear) {
        var monthString = d.toLocaleDateString("en-IN", { month: "long" });
        monthlySales[monthString] = (monthlySales[monthString] || 0) + o.total;
        totalMonthlySales += o.total;
      }
    });

    document.getElementById("dailySalesTotal").textContent = totalDailySales.toLocaleString("en-IN");
    document.getElementById("monthlySalesTotal").textContent = totalMonthlySales.toLocaleString("en-IN");

    // Colors for pie charts
    var bgColors = [
      "rgba(226, 55, 68, 0.8)",
      "rgba(54, 162, 235, 0.8)",
      "rgba(255, 206, 86, 0.8)",
      "rgba(75, 192, 192, 0.8)",
      "rgba(153, 102, 255, 0.8)",
      "rgba(255, 159, 64, 0.8)",
      "rgba(199, 199, 199, 0.8)"
    ];

    // Destroy existing charts if reloading
    if (window.dailyChart) window.dailyChart.destroy();
    if (window.monthlyChart) window.monthlyChart.destroy();

    var ctxDaily = document.getElementById("dailySalesChart");
    if (ctxDaily && window.Chart) {
      window.dailyChart = new Chart(ctxDaily, {
        type: "pie",
        data: {
          labels: Object.keys(dailySales).length ? Object.keys(dailySales) : ["No Data"],
          datasets: [{
            data: Object.keys(dailySales).length ? Object.values(dailySales) : [1],
            backgroundColor: Object.keys(dailySales).length ? bgColors : ["#eaeaea"],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right" }
          }
        }
      });
    }

    var ctxMonthly = document.getElementById("monthlySalesChart");
    if (ctxMonthly && window.Chart) {
      window.monthlyChart = new Chart(ctxMonthly, {
        type: "pie",
        data: {
          labels: Object.keys(monthlySales).length ? Object.keys(monthlySales) : ["No Data"],
          datasets: [{
            data: Object.keys(monthlySales).length ? Object.values(monthlySales) : [1],
            backgroundColor: Object.keys(monthlySales).length ? bgColors : ["#eaeaea"],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right" }
          }
        }
      });
    }
  }

  boot();
})();
