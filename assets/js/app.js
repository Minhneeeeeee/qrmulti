(() => {
  "use strict";

  const root = document.documentElement;
  const lang = root.dataset.lang || "vi";
  const t = window.QR_MULTI_I18N[lang] || window.QR_MULTI_I18N.vi;
  const qs = (s, p = document) => p.querySelector(s);
  const qsa = (s, p = document) => [...p.querySelectorAll(s)];
  const state = {
    type: "text",
    logo: "",
    logoName: "",
    transparent: false
  };

  qsa("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (Object.prototype.hasOwnProperty.call(t, key)) el.textContent = t[key];
  });
  qsa("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (Object.prototype.hasOwnProperty.call(t, key)) el.placeholder = t[key];
  });

  const defaultData = lang === "zh-cn" ? "https://qrmulti.com/zh-cn/" : lang === "en" ? "https://qrmulti.com/en/" : "https://qrmulti.com/vi/";
  const canvas = qs("#qrCanvas");
  const status = qs("#qrStatus");
  const charCount = qs("#charCount");
  const fileName = qs("#fileName");
  const pngBtn = qs("#downloadPng");
  const svgBtn = qs("#downloadSvg");
  const copyBtn = qs("#copyPng");
  const toast = qs("#toast");

  const qr = new QRCodeStyling({
    width: 360,
    height: 360,
    type: "svg",
    data: defaultData,
    margin: 16,
    qrOptions: { errorCorrectionLevel: "Q" },
    dotsOptions: { color: "#111827", type: "rounded" },
    cornersSquareOptions: { color: "#111827", type: "extra-rounded" },
    cornersDotOptions: { color: "#111827", type: "dot" },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { hideBackgroundDots: true, imageSize: 0.28, margin: 5, saveAsBlob: true }
  });
  qr.append(canvas);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function escapeWifi(value) {
    return String(value || "").replace(/([\\;,:"])/g, "\\$1");
  }

  function vcardEscape(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function getData() {
    if (state.type === "text") return qs("#textContent").value.trim();
    if (state.type === "url") {
      const raw = qs("#urlContent").value.trim();
      if (!raw) return "";
      return /^(https?:\/\/|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}`;
    }
    if (state.type === "wifi") {
      const ssid = qs("#wifiSsid").value.trim();
      if (!ssid) return "";
      const password = qs("#wifiPassword").value;
      const security = qs("#wifiSecurity").value;
      const hidden = qs("#wifiHidden").checked ? "true" : "false";
      const passwordPart = security === "nopass" ? "" : `P:${escapeWifi(password)};`;
      return `WIFI:T:${security};S:${escapeWifi(ssid)};${passwordPart}H:${hidden};;`;
    }
    const name = qs("#vcName").value.trim();
    if (!name) return "";
    const company = qs("#vcCompany").value.trim();
    const phone = qs("#vcPhone").value.trim();
    const email = qs("#vcEmail").value.trim();
    const website = qs("#vcWebsite").value.trim();
    const address = qs("#vcAddress").value.trim();
    return [
      "BEGIN:VCARD", "VERSION:3.0", `FN:${vcardEscape(name)}`,
      company ? `ORG:${vcardEscape(company)}` : "",
      phone ? `TEL;TYPE=CELL:${vcardEscape(phone)}` : "",
      email ? `EMAIL:${vcardEscape(email)}` : "",
      website ? `URL:${vcardEscape(website)}` : "",
      address ? `ADR:;;${vcardEscape(address)};;;;` : "",
      "END:VCARD"
    ].filter(Boolean).join("\n");
  }

  function getOptions(data) {
    const size = Number(qs("#qrSize").value);
    const qrColor = qs("#qrColor").value;
    const bgColor = state.transparent ? "transparent" : qs("#bgColor").value;
    return {
      width: size,
      height: size,
      data,
      image: state.logo || "",
      margin: Number(qs("#qrMargin").value),
      qrOptions: { errorCorrectionLevel: qs("#errorCorrection").value },
      dotsOptions: { color: qrColor, type: qs("#dotStyle").value },
      cornersSquareOptions: { color: qrColor, type: qs("#cornerStyle").value },
      cornersDotOptions: { color: qrColor, type: qs("#cornerDotStyle").value },
      backgroundOptions: { color: bgColor },
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: Number(qs("#logoSize").value),
        margin: 5,
        saveAsBlob: true
      }
    };
  }

  function validate(data) {
    if (!data) return { ok: false, message: t.empty };
    if (data.length > 2900) return { ok: false, message: t.tooLong };
    return { ok: true, message: t.ready };
  }

  let updateTimer;
  function updateQr() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const data = getData();
      const result = validate(data);
      const fallback = result.ok ? data : defaultData;
      try {
        qr.update(getOptions(fallback));
        status.textContent = result.message;
        status.className = result.ok ? "status-ok" : "status-error";
        [pngBtn, svgBtn, copyBtn].forEach(btn => btn.disabled = !result.ok);
      } catch (error) {
        status.textContent = t.tooLong;
        status.className = "status-error";
        [pngBtn, svgBtn, copyBtn].forEach(btn => btn.disabled = true);
      }
      const textValue = qs("#textContent")?.value || "";
      charCount.textContent = `${textValue.length} ${t.chars}`;
      qsa("[data-range-output]").forEach(output => {
        const input = qs(`#${output.dataset.rangeOutput}`);
        if (!input) return;
        output.textContent = output.dataset.suffix === "%" ? `${Math.round(Number(input.value) * 100)}%` : `${input.value}${output.dataset.suffix || ""}`;
      });
    }, 80);
  }

  function switchType(type) {
    state.type = type;
    qsa(".type-btn").forEach(btn => {
      const active = btn.dataset.type === type;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    qsa(".type-form").forEach(form => form.hidden = form.dataset.form !== type);
    updateQr();
  }

  qsa(".type-btn").forEach(btn => btn.addEventListener("click", () => switchType(btn.dataset.type)));
  qsa("input, textarea, select").forEach(input => input.addEventListener(input.type === "file" ? "change" : "input", updateQr));
  qsa("select, input[type=checkbox]").forEach(input => input.addEventListener("change", updateQr));

  qs("#logoFile").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/i.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.logo = String(reader.result);
      state.logoName = file.name;
      qs("#logoName").textContent = file.name;
      qs("#removeLogo").disabled = false;
      updateQr();
    };
    reader.readAsDataURL(file);
  });

  qs("#removeLogo").addEventListener("click", () => {
    state.logo = "";
    state.logoName = "";
    qs("#logoFile").value = "";
    qs("#logoName").textContent = "";
    qs("#removeLogo").disabled = true;
    updateQr();
  });

  qs("#transparentBg").addEventListener("change", event => {
    state.transparent = event.target.checked;
    qs("#bgColor").disabled = state.transparent;
    updateQr();
  });

  qs("#resetSettings").addEventListener("click", () => {
    qs("#dotStyle").value = "rounded";
    qs("#cornerStyle").value = "extra-rounded";
    qs("#cornerDotStyle").value = "dot";
    qs("#errorCorrection").value = "Q";
    qs("#qrSize").value = "600";
    qs("#qrMargin").value = "16";
    qs("#qrColor").value = "#111827";
    qs("#bgColor").value = "#ffffff";
    qs("#logoSize").value = "0.28";
    qs("#transparentBg").checked = false;
    qs("#bgColor").disabled = false;
    state.transparent = false;
    updateQr();
  });

  function cleanFileName() {
    const raw = fileName.value.trim() || "qr-multi";
    return raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "qr-multi";
  }

  async function download(extension) {
    const data = getData();
    if (!validate(data).ok) return;
    qr.update(getOptions(data));
    await qr.download({ name: cleanFileName(), extension });
    showToast(t.downloadDone);
  }
  pngBtn.addEventListener("click", () => download("png"));
  svgBtn.addEventListener("click", () => download("svg"));

  copyBtn.addEventListener("click", async () => {
    try {
      const data = getData();
      if (!validate(data).ok) return;
      qr.update(getOptions(data));
      const blob = await qr.getRawData("png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast(t.copied);
    } catch (error) {
      showToast(t.copyFailed);
    }
  });

  function saveLanguage(value) {
    try { window.localStorage.setItem("qrMultiLang", value); } catch (_) {}
  }

  qsa(".lang-btn").forEach(btn => btn.addEventListener("click", () => {
    saveLanguage(btn.dataset.lang);
    window.location.href = btn.dataset.href;
  }));
  saveLanguage(lang);

  switchType("text");
  updateQr();
})();
