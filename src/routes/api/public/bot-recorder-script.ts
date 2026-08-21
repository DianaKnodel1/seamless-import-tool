// Liefert das Recorder-Skript, das der Admin per Bookmarklet auf der
// Bankseite lädt. Enthält keine Geheimnisse – das Aufnahme-Token steckt
// in der URL, mit der das Bookmarklet dieses Skript lädt.
import { createFileRoute } from "@tanstack/react-router";

const SCRIPT = String.raw`(function () {
  var me = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="bot-recorder-script"]');
    return s[s.length - 1];
  })();
  if (!me) return;
  var src = new URL(me.src, location.href);
  var token = src.searchParams.get("t");
  var api = src.origin + "/api/public/bot-recordings";
  if (!token) return;
  if (window.__botRecorder) { window.__botRecorder.stop(); return; }

  var buffer = [];
  var all = [];
  var sent = 0;
  var uploadOk = 0;
  var uploadFail = 0;


  function label(el) {
    var t = (el.getAttribute("aria-label") || "").trim();
    if (t) return t.slice(0, 80);
    if (el.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.innerText.trim()) return lab.innerText.trim().slice(0, 80);
    }
    var wrap = el.closest && el.closest("label");
    if (wrap && wrap.innerText.trim()) return wrap.innerText.trim().slice(0, 80);
    var txt = (el.innerText || el.value || el.placeholder || el.title || "").trim();
    return txt.slice(0, 80);
  }

  function randomish(s) {
    return /[a-f0-9]{8,}|:r[0-9a-z]+:|css-[a-z0-9]{5,}|__[a-z0-9]{5,}/i.test(s);
  }

  function selectors(el) {
    var out = [];
    var aria = el.getAttribute("aria-label");
    var testid = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    var name = el.getAttribute("name");
    var tag = el.tagName.toLowerCase();
    if (testid) out.push('[data-testid="' + testid + '"]');
    if (aria) out.push('[aria-label="' + aria + '"]');
    if (el.id && !randomish(el.id)) out.push("#" + el.id);
    if (name) out.push(tag + '[name="' + name + '"]');
    var txt = (el.innerText || "").trim();
    if (txt && txt.length < 40 && (tag === "button" || tag === "a" || el.getAttribute("role") === "button")) {
      out.push("text=" + txt);
      out.push("role=" + (tag === "a" ? "link" : "button") + ":" + txt);
    }
    if (el.placeholder) out.push(tag + '[placeholder="' + el.placeholder + '"]');
    if (!out.length) {
      var path = [], node = el, depth = 0;
      while (node && node.nodeType === 1 && depth < 4) {
        var part = node.tagName.toLowerCase();
        if (node.classList.length) {
          var cls = Array.prototype.filter.call(node.classList, function (c) { return !randomish(c); })[0];
          if (cls) part += "." + cls;
        }
        path.unshift(part);
        node = node.parentElement; depth++;
      }
      out.push(path.join(" > "));
    }
    return out.slice(0, 4);
  }

  function guess(el) {
    var hay = ((el.getAttribute("name") || "") + " " + (el.id || "") + " " + label(el) + " " + (el.type || "")).toLowerCase();
    var table = [[/e-?mail/, "email"], [/pass|kennwort/, "password"], [/tel|phone|mobil|handy/, "phone"],
      [/vorname|first ?name/, "first_name"], [/nachname|last ?name|surname/, "last_name"],
      [/geburt|birth|dob/, "birth_date"], [/stra|street/, "street"], [/plz|zip|postal/, "zip"],
      [/ort|city|stadt/, "city"], [/iban/, "iban"]];
    for (var i = 0; i < table.length; i++) if (table[i][0].test(hay)) return table[i][1];
    return "";
  }

  function push(step) {
    step.t = Date.now();
    step.url = location.href;
    buffer.push(step);
    all.push(step);
    try { sessionStorage.setItem("__botRecSteps", JSON.stringify(all).slice(0, 400000)); } catch (e) {}
    paint();
  }


  function onClick(e) {
    var el = e.target && e.target.closest
      ? e.target.closest("button, a, input, select, textarea, [role=button], [role=link], label, [onclick]")
      : null;
    if (!el) return;
    var tag = el.tagName.toLowerCase();
    if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) {
      push({ kind: "check", selectors: selectors(el), label: label(el), tag: tag, type: el.type, checked: !!el.checked });
      return;
    }
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    push({ kind: "click", selectors: selectors(el), label: label(el), tag: tag });
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === "select") {
      push({ kind: "select", selectors: selectors(el), label: label(el), tag: tag, sample: el.value ? String(el.value).slice(0, 60) : "" });
      return;
    }
    if (tag !== "input" && tag !== "textarea") return;
    if (el.type === "checkbox" || el.type === "radio") return;
    // Werte werden NICHT übertragen – nur Feld-Metadaten für den Platzhalter.
    push({
      kind: "input", selectors: selectors(el), label: label(el), tag: tag,
      type: el.type || "text", name: el.getAttribute("name") || "", guess: guess(el),
    });
  }

  function onSubmit(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    push({ kind: "submit", selectors: selectors(el), label: "Formular absenden", tag: "form" });
  }

  var lastUrl = location.href;
  function watchUrl() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      push({ kind: "navigate" });
    }
  }

  function flush(final) {
    if (!buffer.length) return Promise.resolve();
    var batch = buffer.splice(0, buffer.length);
    sent += batch.length;
    return fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, steps: batch, final: !!final }),
      keepalive: true,
      mode: "cors",
    }).then(function (r) {
      if (r && r.ok) { uploadOk++; } else { uploadFail++; }
      paint();
    }).catch(function () {
      // Seite blockiert das Senden (CSP) – Schritte bleiben lokal, Export nutzen.
      uploadFail++; paint();
    });
  }

  var bar = document.createElement("div");
  bar.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#111827;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center";
  var text = document.createElement("span");
  var exportBtn = document.createElement("button");
  exportBtn.textContent = "Kopieren";
  exportBtn.style.cssText = "background:#374151;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit";
  var stopBtn = document.createElement("button");
  stopBtn.textContent = "Stopp";
  stopBtn.style.cssText = "background:#ef4444;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit";
  bar.appendChild(text); bar.appendChild(exportBtn); bar.appendChild(stopBtn);
  function paint() {
    var status = uploadFail > 0 && uploadOk === 0 ? " · Senden blockiert – „Kopieren“ nutzen" : "";
    text.textContent = "Aufnahme läuft · " + all.length + " Schritte" + status;
  }
  exportBtn.addEventListener("click", function () {
    var data = JSON.stringify(all);
    var done = function () { exportBtn.textContent = "Kopiert!"; setTimeout(function () { exportBtn.textContent = "Kopieren"; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(data).then(done, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = data;
      ta.style.cssText = "position:fixed;z-index:2147483647;left:5vw;top:5vh;width:90vw;height:60vh";
      document.documentElement.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      setTimeout(function () { ta.remove(); }, 15000);
    }
  });
  paint();
  document.documentElement.appendChild(bar);


  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("submit", onSubmit, true);
  var urlTimer = setInterval(watchUrl, 700);
  var flushTimer = setInterval(function () { flush(false); }, 3000);
  window.addEventListener("beforeunload", function () { flush(false); });

  function stop() {
    clearInterval(urlTimer); clearInterval(flushTimer);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("submit", onSubmit, true);
    flush(true).then(function () {
      text.textContent = "Aufnahme beendet – im Portal weiter";
      stopBtn.remove();
      setTimeout(function () { bar.remove(); }, 4000);
    });
    window.__botRecorder = null;
  }
  stopBtn.addEventListener("click", stop);
  window.__botRecorder = { stop: stop };
})();`;

export const Route = createFileRoute("/api/public/bot-recorder-script")({
  server: {
    handlers: {
      GET: async () =>
        new Response(SCRIPT, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
