const CART_STORAGE_KEY = "prerna-canteen-cart";
const LOCATION_STORAGE_KEY = "prerna-canteen-location";

const formatPrice = (value) => `Rs. ${value}`;

document.addEventListener("DOMContentLoaded", () => {
  initAppShell();
  initRevealAnimations();

  const page = document.body.dataset.page;

  if (page === "home") {
    initStorefront();
  }

  if (page === "admin") {
    initAdminDashboard();
  }

  if (page === "success") {
    initSuccessPage();
  }
});

function initAppShell() {
  registerServiceWorker();
  initInstallPrompt();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

function initInstallPrompt() {
  const installAppBtn = document.getElementById("installAppBtn");
  const installCard = document.getElementById("installCard");
  const installCardBtn = document.getElementById("installCardBtn");
  let deferredPrompt = null;

  const showInstallUi = () => {
    installAppBtn?.classList.remove("hidden");
    installCard?.classList.remove("hidden");
  };

  const hideInstallUi = () => {
    installAppBtn?.classList.add("hidden");
    installCard?.classList.add("hidden");
  };

  const promptInstall = async () => {
    if (!deferredPrompt) {
      return;
    }

    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    hideInstallUi();
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideInstallUi();
  });

  installAppBtn?.addEventListener("click", promptInstall);
  installCardBtn?.addEventListener("click", promptInstall);
}

function initRevealAnimations() {
  const revealItems = document.querySelectorAll(".reveal");
  if (!revealItems.length) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  revealItems.forEach((item) => observer.observe(item));
}

function initStorefront() {
  const config = window.APP_CONFIG || {};
  const cart = hydrateCart();
  const cartItems = document.getElementById("cartItems");
  const cartTotal = document.getElementById("cartTotal");
  const cartCount = document.getElementById("cartCount");
  const clearCartBtn = document.getElementById("clearCartBtn");
  const orderForm = document.getElementById("orderForm");
  const formMessage = document.getElementById("formMessage");
  const captureLocationBtn = document.getElementById("captureLocationBtn");
  const stopTrackingBtn = document.getElementById("stopTrackingBtn");
  const locationStatus = document.getElementById("locationStatus");
  const locationMeta = document.getElementById("locationMeta");
  const locationHelp = document.getElementById("locationHelp");
  const deliveryBadge = document.getElementById("deliveryBadge");
  const mapShell = document.getElementById("mapShell");
  const mapPreview = document.getElementById("mapPreview");
  const placeOrderBtn = document.getElementById("placeOrderBtn");
  const mobileCartBar = document.getElementById("mobileCartBar");
  const mobileCartLabel = document.getElementById("mobileCartLabel");
  const mobileCartTotal = document.getElementById("mobileCartTotal");
  const checkoutSection = document.getElementById("checkoutSection");

  const locationState = {
    latitude: null,
    longitude: null,
    accuracy: null,
    distanceKm: null,
    updatedAt: null,
    watchId: null,
    isTracking: false,
  };

  restoreSavedLocation();
  applyLocationStatus();

  document.querySelectorAll(".menu-card").forEach((card) => {
    const qtyDisplay = card.querySelector(".menu-qty");
    const minusButton = card.querySelector('[data-direction="-1"]');
    const plusButton = card.querySelector('[data-direction="1"]');
    const addButton = card.querySelector(".add-btn");
    let quantity = 1;

    const syncQty = () => {
      qtyDisplay.textContent = String(quantity);
    };

    minusButton.addEventListener("click", () => {
      quantity = Math.max(1, quantity - 1);
      syncQty();
    });

    plusButton.addEventListener("click", () => {
      quantity += 1;
      syncQty();
    });

    addButton.addEventListener("click", () => {
      const name = card.dataset.name;
      const price = Number(card.dataset.price);
      const existing = cart.get(name);
      cart.set(name, {
        name,
        price,
        quantity: (existing?.quantity || 0) + quantity,
      });
      quantity = 1;
      syncQty();
      persistCart(cart);
      renderCart();
      flashElement(document.getElementById("cartSection"));
      setFormMessage(`${name} added to cart.`, "success");
    });
  });

  cartItems.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    const name = target.dataset.name;
    if (!action || !name || !cart.has(name)) {
      return;
    }

    const current = cart.get(name);
    if (!current) {
      return;
    }

    if (action === "increase") {
      current.quantity += 1;
    }

    if (action === "decrease") {
      current.quantity -= 1;
      if (current.quantity <= 0) {
        cart.delete(name);
      }
    }

    if (action === "remove") {
      cart.delete(name);
    } else if (cart.has(name)) {
      cart.set(name, current);
    }

    persistCart(cart);
    renderCart();
  });

  clearCartBtn.addEventListener("click", () => {
    cart.clear();
    persistCart(cart);
    renderCart();
    setFormMessage("Cart cleared.", "success");
  });

  captureLocationBtn.addEventListener("click", startLiveTracking);
  stopTrackingBtn.addEventListener("click", stopLiveTracking);

  mobileCartBar?.addEventListener("click", () => {
    checkoutSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormMessage("", "");

    const ward = document.getElementById("wardInput").value.trim();
    const phone = document.getElementById("phoneInput").value.trim();
    const items = Array.from(cart.values()).map(({ name, quantity }) => ({ name, quantity }));

    if (!items.length) {
      setFormMessage("Add at least one item to the cart.", "error");
      return;
    }

    if (!ward) {
      setFormMessage("Ward / room is required.", "error");
      return;
    }

    if (!phone) {
      setFormMessage("Phone number is required.", "error");
      return;
    }

    if (locationState.latitude === null || locationState.longitude === null) {
      setFormMessage("Please start live tracking and wait for your location before placing the order.", "error");
      return;
    }

    if (locationState.distanceKm !== null && locationState.distanceKm > config.maxDistanceKm) {
      setFormMessage(`Delivery is available only within ${config.maxDistanceKm} km.`, "error");
      return;
    }

    if (locationState.updatedAt && Date.now() - locationState.updatedAt > 5 * 60 * 1000) {
      setFormMessage("Your saved location is old. Refresh live tracking once before placing the order.", "error");
      return;
    }

    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = "Saving order...";

    try {
      const response = await fetch(config.orderEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ward,
          phone,
          latitude: locationState.latitude,
          longitude: locationState.longitude,
          items,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not place the order.");
      }

      persistCart(new Map());
      window.location.href = data.redirectUrl;
    } catch (error) {
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = "Place order";
      setFormMessage(error.message || "Could not place the order.", "error");
    }
  });

  renderCart();
  refreshPermissionHint();

  function renderCart() {
    const items = Array.from(cart.values());

    if (!items.length) {
      cartItems.innerHTML = `
        <div class="empty-card">
          <h3>Cart is empty</h3>
          <p>Add a few snacks or a meal to get started.</p>
        </div>
      `;
      cartTotal.textContent = formatPrice(0);
      cartCount.textContent = "0 items";
      mobileCartBar?.classList.add("hidden");
      mobileCartLabel.textContent = "0 items in cart";
      mobileCartTotal.textContent = formatPrice(0);
      return;
    }

    let total = 0;
    let quantityCount = 0;

    cartItems.innerHTML = items
      .map((item) => {
        total += item.price * item.quantity;
        quantityCount += item.quantity;
        return `
          <article class="cart-item">
            <div class="cart-item-info">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${formatPrice(item.price)} each</span>
              <span>${formatPrice(item.price * item.quantity)}</span>
            </div>
            <div class="cart-item-controls">
              <div class="cart-qty">
                <button type="button" class="qty-btn" data-action="decrease" data-name="${escapeAttribute(item.name)}" aria-label="Decrease item quantity">-</button>
                <span class="cart-item-qty">${item.quantity}</span>
                <button type="button" class="qty-btn" data-action="increase" data-name="${escapeAttribute(item.name)}" aria-label="Increase item quantity">+</button>
              </div>
              <button type="button" class="text-btn" data-action="remove" data-name="${escapeAttribute(item.name)}">Remove</button>
            </div>
          </article>
        `;
      })
      .join("");

    cartTotal.textContent = formatPrice(total);
    cartCount.textContent = `${quantityCount} item${quantityCount === 1 ? "" : "s"}`;
    mobileCartLabel.textContent = `${quantityCount} item${quantityCount === 1 ? "" : "s"} in cart`;
    mobileCartTotal.textContent = formatPrice(total);
    mobileCartBar?.classList.remove("hidden");
  }

  function setFormMessage(message, type) {
    formMessage.textContent = message;
    formMessage.className = "form-message";
    if (type) {
      formMessage.classList.add(type);
    }
  }

  function startLiveTracking() {
    if (!navigator.geolocation) {
      locationHelp.textContent = "This phone or browser does not support location services.";
      locationHelp.classList.remove("hidden");
      setFormMessage("Geolocation is not supported on this device.", "error");
      return;
    }

    if (!isLocationSecure()) {
      locationHelp.textContent = "Live tracking needs HTTPS or localhost. If you opened this site on a phone over plain http, location will be blocked by the browser.";
      locationHelp.classList.remove("hidden");
      locationStatus.textContent = "Browser blocked location because the page is not secure.";
      locationMeta.textContent = "Open the site using https:// or run it on localhost for testing.";
      updateDeliveryBadge(null, config.maxDistanceKm, deliveryBadge, placeOrderBtn);
      return;
    }

    if (locationState.watchId !== null) {
      navigator.geolocation.clearWatch(locationState.watchId);
      locationState.watchId = null;
    }

    locationState.isTracking = true;
    captureLocationBtn.disabled = true;
    captureLocationBtn.textContent = "Starting tracker...";
    stopTrackingBtn.classList.remove("hidden");
    locationHelp.classList.add("hidden");
    locationStatus.textContent = "Waiting for live GPS fix...";
    locationMeta.textContent = "Move near a window or open area if the phone takes time to lock your position.";

    locationState.watchId = navigator.geolocation.watchPosition(
      (position) => {
        applyPosition(position.coords);
        captureLocationBtn.disabled = false;
        captureLocationBtn.textContent = "Refresh live tracking";
        stopTrackingBtn.classList.remove("hidden");
        locationState.isTracking = true;
        setFormMessage("Live location tracker is running.", "success");
      },
      (error) => {
        captureLocationBtn.disabled = false;
        captureLocationBtn.textContent = "Start live tracking";
        stopTrackingBtn.classList.add("hidden");
        locationState.isTracking = false;
        handleLocationError(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  function stopLiveTracking() {
    if (locationState.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationState.watchId);
    }
    locationState.watchId = null;
    locationState.isTracking = false;
    captureLocationBtn.disabled = false;
    captureLocationBtn.textContent = locationState.latitude === null ? "Start live tracking" : "Restart live tracking";
    stopTrackingBtn.classList.add("hidden");
    if (locationState.latitude !== null) {
      locationMeta.textContent = "Using the last captured live location. Restart tracking if you move.";
    }
  }

  function applyPosition(coords) {
    const { latitude, longitude, accuracy } = coords;
    const distanceKm = calculateDistanceKm(
      config.canteen.latitude,
      config.canteen.longitude,
      latitude,
      longitude
    );

    locationState.latitude = latitude;
    locationState.longitude = longitude;
    locationState.accuracy = accuracy || null;
    locationState.distanceKm = distanceKm;
    locationState.updatedAt = Date.now();

    persistLocation(locationState);
    applyLocationStatus();
    updateDeliveryBadge(distanceKm, config.maxDistanceKm, deliveryBadge, placeOrderBtn);
    updateMapPreview(mapShell, mapPreview, latitude, longitude);
    flashElement(document.querySelector(".location-card"));
  }

  function applyLocationStatus() {
    if (locationState.latitude === null || locationState.longitude === null) {
      locationStatus.textContent = "Location not captured yet.";
      locationMeta.textContent = "Enable location permission to auto-detect your exact delivery point.";
      updateDeliveryBadge(null, config.maxDistanceKm, deliveryBadge, placeOrderBtn);
      return;
    }

    const updatedLabel = new Date(locationState.updatedAt || Date.now()).toLocaleTimeString();
    const accuracyLabel = locationState.accuracy ? `${Math.round(locationState.accuracy)} m` : "N/A";
    locationStatus.textContent = `Live location locked: ${locationState.latitude.toFixed(5)}, ${locationState.longitude.toFixed(5)}`;
    locationMeta.textContent = `Accuracy: ${accuracyLabel} | Last update: ${updatedLabel}`;
    updateDeliveryBadge(locationState.distanceKm, config.maxDistanceKm, deliveryBadge, placeOrderBtn);
    updateMapPreview(mapShell, mapPreview, locationState.latitude, locationState.longitude);
    captureLocationBtn.textContent = locationState.isTracking ? "Refresh live tracking" : "Restart live tracking";
  }

  function restoreSavedLocation() {
    const saved = readJsonStorage(LOCATION_STORAGE_KEY);
    if (!saved) {
      return;
    }

    locationState.latitude = saved.latitude ?? null;
    locationState.longitude = saved.longitude ?? null;
    locationState.accuracy = saved.accuracy ?? null;
    locationState.distanceKm = saved.distanceKm ?? null;
    locationState.updatedAt = saved.updatedAt ?? null;
  }

  function handleLocationError(error) {
    const errorMap = {
      1: "Location permission was denied. Allow location access in your browser settings and try again.",
      2: "The phone could not determine your location. Turn on GPS and mobile network or Wi-Fi.",
      3: "The location request timed out. Move to an open area and try again.",
    };
    const message = errorMap[error.code] || "Unable to fetch your location.";
    locationStatus.textContent = message;
    locationHelp.textContent = message;
    locationHelp.classList.remove("hidden");
    locationMeta.textContent = "If you are testing on a phone, make sure the site is opened over https:// and location permission is allowed.";
    updateDeliveryBadge(null, config.maxDistanceKm, deliveryBadge, placeOrderBtn);
    setFormMessage(message, "error");
  }

  async function refreshPermissionHint() {
    if (!navigator.permissions?.query) {
      return;
    }

    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "denied") {
        locationHelp.textContent = "Location access is denied for this site. Enable it in the browser settings to use live tracking.";
        locationHelp.classList.remove("hidden");
      }
    } catch (_) {
      return;
    }
  }
}

function initAdminDashboard() {
  const config = window.ADMIN_CONFIG || {};
  const ordersContainer = document.getElementById("ordersContainer");
  const manualRefreshBtn = document.getElementById("manualRefreshBtn");
  const totalOrders = document.getElementById("totalOrders");
  const pendingOrders = document.getElementById("pendingOrders");
  const activeOrders = document.getElementById("activeOrders");
  const lastRefresh = document.getElementById("lastRefresh");
  const adminNotice = document.getElementById("adminNotice");

  const knownIds = new Set();
  let firstLoad = true;
  let audioContext = null;
  let audioReady = false;

  const unlockAudio = async () => {
    if (audioReady) {
      return;
    }

    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      adminNotice.textContent = "This browser does not support sound notifications.";
      return;
    }

    audioContext = new Context();
    try {
      await audioContext.resume();
      audioReady = true;
      adminNotice.textContent = "Sound notifications enabled.";
    } catch (error) {
      adminNotice.textContent = "Click again to enable sound notifications.";
    }
  };

  document.body.addEventListener("click", unlockAudio, { once: true });

  manualRefreshBtn.addEventListener("click", () => {
    fetchOrders(true);
  });

  ordersContainer.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.classList.contains("status-select")) {
      return;
    }

    const orderId = target.dataset.orderId;
    try {
      const response = await fetch(`${config.statusApiBase}/${orderId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: target.value }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not update order status.");
      }

      adminNotice.textContent = `Order #${orderId} updated to ${target.value}.`;
      fetchOrders(false);
    } catch (error) {
      adminNotice.textContent = error.message || "Could not update order status.";
    }
  });

  fetchOrders(false);
  window.setInterval(() => fetchOrders(false), config.refreshMs || 5000);

  async function fetchOrders(isManual) {
    if (isManual) {
      adminNotice.textContent = "Refreshing orders...";
    }

    try {
      const response = await fetch(config.ordersApi, { cache: "no-store" });
      const data = await response.json();
      renderMetrics(data.metrics);
      renderOrders(data.orders);
      lastRefresh.textContent = new Date().toLocaleTimeString();

      const incomingIds = new Set(data.orders.map((order) => order.id));
      if (!firstLoad) {
        const hasNewOrder = data.orders.some((order) => !knownIds.has(order.id));
        if (hasNewOrder) {
          adminNotice.textContent = "New order received.";
          playNotification();
        } else if (isManual) {
          adminNotice.textContent = "Orders refreshed.";
        }
      }

      knownIds.clear();
      incomingIds.forEach((id) => knownIds.add(id));
      firstLoad = false;
    } catch (error) {
      adminNotice.textContent = error.message || "Could not refresh orders.";
    }
  }

  function renderMetrics(metrics) {
    totalOrders.textContent = String(metrics.total || 0);
    pendingOrders.textContent = String(metrics.pending || 0);
    activeOrders.textContent = String(metrics.active || 0);
  }

  function renderOrders(orders) {
    if (!orders.length) {
      ordersContainer.innerHTML = `
        <article class="empty-card wide">
          <h3>No orders yet</h3>
          <p>New incoming orders will appear here automatically.</p>
        </article>
      `;
      return;
    }

    ordersContainer.innerHTML = orders
      .map(
        (order) => `
          <article class="admin-order-card">
            <div class="admin-order-head">
              <div>
                <p class="eyebrow">Order #${order.id}</p>
                <h3>${escapeHtml(order.ward)}</h3>
                <p class="muted">${escapeHtml(order.created_at)}</p>
              </div>
              <span class="status-pill ${slugify(order.status)}">${order.status}</span>
            </div>

            <div class="order-meta-row">
              <span>Phone</span>
              <strong>${escapeHtml(order.phone)}</strong>
            </div>
            <div class="order-meta-row">
              <span>Distance</span>
              <strong>${order.distance_km} km</strong>
            </div>
            <div class="order-meta-row">
              <span>Total</span>
              <strong>${formatPrice(order.total_amount)}</strong>
            </div>

            <div class="order-items-list">
              ${order.items
                .map(
                  (item) => `
                    <div class="order-item-line">
                      <span>${escapeHtml(item.item_name)} x${item.quantity}</span>
                      <strong>${formatPrice(item.subtotal)}</strong>
                    </div>
                  `
                )
                .join("")}
            </div>

            <label class="field">
              <span>Update status</span>
              <select class="status-select" data-order-id="${order.id}">
                ${config.statuses
                  .map(
                    (status) => `
                      <option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>
                    `
                  )
                  .join("")}
              </select>
            </label>

            <div class="order-links">
              <a class="inline-link" href="${order.map_url}" target="_blank" rel="noopener">Open location</a>
              <a class="inline-link" href="${order.whatsapp_url}" target="_blank" rel="noopener">WhatsApp</a>
              <a class="inline-link" href="${order.bill_url}" target="_blank" rel="noopener">Bill</a>
            </div>
          </article>
        `
      )
      .join("");
  }

  function playNotification() {
    if (!audioReady || !audioContext) {
      return;
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.36);
  }
}

function initSuccessPage() {
  const config = window.SUCCESS_CONFIG || {};
  if (!config.whatsappUrl) {
    return;
  }

  window.setTimeout(() => {
    window.open(config.whatsappUrl, "_blank", "noopener");
  }, 600);
}

function updateDeliveryBadge(distanceKm, maxDistanceKm, badge, placeOrderBtn) {
  badge.className = "delivery-badge";

  if (distanceKm === null) {
    badge.textContent = "Delivery check pending";
    placeOrderBtn.disabled = false;
    return;
  }

  if (distanceKm <= maxDistanceKm) {
    badge.classList.add("ok");
    badge.textContent = `Within delivery radius: ${distanceKm.toFixed(2)} km`;
    placeOrderBtn.disabled = false;
    return;
  }

  badge.classList.add("error");
  badge.textContent = `Outside delivery radius: ${distanceKm.toFixed(2)} km`;
  placeOrderBtn.disabled = true;
}

function updateMapPreview(mapShell, mapPreview, latitude, longitude) {
  mapPreview.src = `https://www.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;
  mapShell.classList.remove("hidden");
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hydrateCart() {
  const saved = readJsonStorage(CART_STORAGE_KEY);
  const cart = new Map();
  if (!Array.isArray(saved)) {
    return cart;
  }

  saved.forEach((item) => {
    if (!item || !item.name || !Number.isFinite(Number(item.price)) || !Number.isFinite(Number(item.quantity))) {
      return;
    }
    cart.set(item.name, {
      name: item.name,
      price: Number(item.price),
      quantity: Math.max(1, Number(item.quantity)),
    });
  });
  return cart;
}

function persistCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(Array.from(cart.values())));
  } catch (_) {
    return;
  }
}

function persistLocation(locationState) {
  try {
    localStorage.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({
        latitude: locationState.latitude,
        longitude: locationState.longitude,
        accuracy: locationState.accuracy,
        distanceKm: locationState.distanceKm,
        updatedAt: locationState.updatedAt,
      })
    );
  } catch (_) {
    return;
  }
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function isLocationSecure() {
  const params = new URLSearchParams(window.location.search);
  const appMode = params.get("app_mode");
  const userAgent = navigator.userAgent || "";
  return (
    appMode === "android" ||
    userAgent.includes("PrernaCanteenAndroid") ||
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function flashElement(element) {
  if (!element || !element.animate) {
    return;
  }

  element.animate(
    [
      { transform: "scale(1)", boxShadow: "0 24px 54px rgba(25, 36, 61, 0.12)" },
      { transform: "scale(1.01)", boxShadow: "0 30px 64px rgba(239, 108, 47, 0.2)" },
      { transform: "scale(1)", boxShadow: "0 24px 54px rgba(25, 36, 61, 0.12)" },
    ],
    { duration: 420, easing: "ease-out" }
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
