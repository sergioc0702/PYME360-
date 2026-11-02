(function (global) {
  "use strict";

  var MAX_FILE_BYTES = 15 * 1024 * 1024;
  var MAX_PDF_PAGES = 8;
  var MONTHS = {
    enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
    julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10",
    noviembre: "11", diciembre: "12"
  };

  function assetUrl(path) {
    return new URL(path, document.baseURI).href;
  }

  function progress(onProgress, label, percent) {
    if (typeof onProgress === "function") onProgress({ label: label, percent: percent });
  }

  /* Interpretación del texto de la factura. */
  function checkCancelled(token) {
    if (token && token.cancelled) {
      var error = new Error("Lectura cancelada.");
      error.name = "AbortError";
      throw error;
    }
  }

  function normalizeNumber(value) {
    var raw = String(value || "").replace(/\s/g, "");
    if (!raw) return NaN;
    var comma = raw.lastIndexOf(",");
    var dot = raw.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
      else raw = raw.replace(/,/g, "");
    } else if (comma >= 0) {
      var commaDecimals = raw.length - comma - 1;
      raw = commaDecimals > 0 && commaDecimals <= 2 ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    } else if (dot >= 0) {
      var dotDecimals = raw.length - dot - 1;
      if (dotDecimals === 3) raw = raw.replace(/\./g, "");
      else raw = raw.replace(/\.(?=.*\.)/g, "");
    }
    var number = Number(raw);
    return Number.isFinite(number) ? number : NaN;
  }

  function monthFromText(text) {
    var normalized = String(text || "").toLocaleLowerCase("es-CO").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    var periodContext = normalized.search(/periodo|ciclo|consumo|facturacion/);
    var searchText = periodContext >= 0 ? normalized.slice(periodContext, periodContext + 180) : normalized;
    var dates = [];
    var dateRegex = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/g;
    var match;
    while ((match = dateRegex.exec(searchText))) {
      var month = Number(match[2]);
      if (month >= 1 && month <= 12) dates.push(match[3] + "-" + String(month).padStart(2, "0"));
    }
    var monthYear = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/.exec(searchText);
    if (monthYear) return { period: monthYear[2] + "-" + MONTHS[monthYear[1]], confidence: periodContext >= 0 ? 0.9 : 0.72 };
    if (dates.length) return { period: dates[dates.length - 1], confidence: periodContext >= 0 ? 0.86 : 0.58 };
    return { period: "", confidence: 0 };
  }

  function usageCandidates(text, type) {
    var unit = type === "energy" ? "(?:kwh|kilovatios?\\s*hora?s?)" : "(?:m\\s*[³3]|metros?\\s*cubicos?)";
    var expressions = [
      new RegExp("(?:consumo|consumido|consumida|facturado|facturada|energia activa|agua consumida)[^\\d]{0,90}(\\d[\\d.,]*)\\s*" + unit, "ig"),
      new RegExp("(\\d[\\d.,]*)\\s*" + unit, "ig"),
      new RegExp(unit + "[^\\d]{0,10}(\\d[\\d.,]*)", "ig")
    ];
    var candidates = [];
    expressions.forEach(function (regex, expressionIndex) {
      var match;
      while ((match = regex.exec(text))) {
        var value = normalizeNumber(match[1]);
        if (!Number.isFinite(value) || value <= 0) continue;
        var start = Math.max(0, match.index - 65);
        var end = Math.min(text.length, regex.lastIndex + 45);
        var context = text.slice(start, end).toLocaleLowerCase("es-CO");
        if (/\$\s*\/|tarifa|valor unitario|precio/.test(context) && !/consumo|consumido|facturado/.test(context)) continue;
        var score = expressionIndex === 0 ? 3 : expressionIndex === 2 ? 2 : 1;
        if (/consumo|consumid|facturad|lectura/.test(context)) score += 2;
        if (/total del periodo|total periodo|energia activa|m3 facturado|kwh facturado/.test(context)) score += 1;
        candidates.push({ value: value, score: score, context: context });
      }
    });
    candidates.sort(function (a, b) { return b.score - a.score; });
    return candidates;
  }

  function parseReceipt(text, method, ocrConfidence) {
    var clean = String(text || "").replace(/\r/g, "\n");
    var energy = usageCandidates(clean, "energy");
    var water = usageCandidates(clean, "water");
    var period = monthFromText(clean);
    var hasWaterContext = /acueducto|agua potable|servicio de agua|alcantarillado|consumo de agua/i.test(clean);
    var type = water.length && (!energy.length || (hasWaterContext && water[0].score >= energy[0].score)) ? "water" : "energy";
    var selected = type === "water" ? water[0] : energy[0];
    var warnings = [];
    var confidence = selected ? (selected.score >= 5 ? 0.93 : selected.score >= 3 ? 0.8 : 0.66) : 0;
    if (method === "OCR" && Number.isFinite(ocrConfidence)) confidence = Math.min(confidence || 0.4, Math.max(0.25, ocrConfidence / 100));
    if (!selected) warnings.push("No encontramos un consumo con unidad kWh o m³. Escríbelo manualmente y revisa la unidad.");
    if (!period.period) warnings.push("No encontramos con claridad el mes de consumo. Elige el período correcto.");
    else if (period.confidence < 0.7) warnings.push("Encontramos una fecha, pero no podemos confirmar que sea el período de consumo.");
    if (confidence < 0.75 && selected) warnings.push("La lectura del consumo es dudosa. Compárala con el total de consumo del recibo.");
    if (method === "OCR" && Number.isFinite(ocrConfidence) && ocrConfidence < 65) warnings.push("La foto o el escaneo tiene baja nitidez. Verifica los números antes de guardar.");
    return {
      type: type,
      period: period.period,
      consumption: selected ? selected.value : "",
      unit: type === "water" ? "m³" : "kWh",
      confidence: confidence,
      periodConfidence: period.confidence,
      method: method,
      sourceLabel: "Recibo procesado en este dispositivo",
      warnings: warnings,
      textPreview: clean.slice(0, 12000)
    };
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  }

  function validate(file) {
    if (!file) throw new Error("Selecciona un archivo para continuar.");
    if (file.size > MAX_FILE_BYTES) throw new Error("El archivo supera 15 MB. Comprime el PDF o toma una foto más liviana.");
    var allowed = isPdf(file) || /^image\/(jpeg|png)$/i.test(file.type) || /\.(jpe?g|png)$/i.test(file.name || "");
    if (!allowed) throw new Error("Formato no compatible. Elige un PDF, JPG o PNG.");
  }

  /* Extracción de texto de PDF y páginas escaneadas. */
  async function readPdf(file, onProgress, token) {
    checkCancelled(token);
    if (!global.pdfjsLib) {
      try { global.pdfjsLib = await import(assetUrl("vendor/receipt-reader/pdfjs/pdf.mjs")); }
      catch (error) { throw new Error("No se pudo cargar el lector PDF local. Inicia Pyme360 con el lanzador de tu sistema e inténtalo de nuevo."); }
    }
    if (global.pdfjsLib.GlobalWorkerOptions) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl("vendor/receipt-reader/pdfjs/pdf.worker.min.mjs");
    }
    var data = await file.arrayBuffer();
    checkCancelled(token);
    var pdf = await global.pdfjsLib.getDocument({ data: data }).promise;
    if (token) token.pdf = pdf;
    var worker = null;
    try {
      checkCancelled(token);
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error("El PDF tiene más de " + MAX_PDF_PAGES + " páginas. Sube solo la página que muestra el consumo.");
      var pageTexts = [];
      var scannedPages = [];
      for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        checkCancelled(token);
        progress(onProgress, "Revisando página " + pageNumber + " de " + pdf.numPages + "…", 10 + Math.round(pageNumber / pdf.numPages * 20));
        var page = await pdf.getPage(pageNumber);
        var content = await page.getTextContent();
        var pageText = content.items.map(function (item) { return item.str || ""; }).join(" ");
        pageTexts.push(pageText);
        if (pageText.replace(/\s/g, "").length < 35) scannedPages.push(page);
      }
      var joined = pageTexts.join("\n");
      var hasDigitalText = joined.replace(/\s/g, "").length >= 60;
      var hasDigitalConsumption = usageCandidates(joined, "energy").length || usageCandidates(joined, "water").length;
      if (hasDigitalText && (hasDigitalConsumption || !scannedPages.length)) return { text: joined, method: "PDF con texto", confidence: 95 };
      if (!global.Tesseract) throw new Error("El PDF parece escaneado y el lector OCR no está disponible.");
      worker = await createOcrWorker(onProgress, 32, token);
      var results = hasDigitalText ? [joined] : [];
      var totalConfidence = 0;
      for (var i = 0; i < scannedPages.length; i += 1) {
        checkCancelled(token);
        var canvas = await renderPdfPage(scannedPages[i]);
        progress(onProgress, "Leyendo imagen " + (i + 1) + " de " + scannedPages.length + "…", 45 + Math.round((i / scannedPages.length) * 45));
        var result = await worker.recognize(canvas);
        results.push(result.data.text || "");
        totalConfidence += Number(result.data.confidence) || 0;
        canvas.width = 0;
        canvas.height = 0;
      }
      return { text: results.join("\n"), method: "OCR", confidence: scannedPages.length ? totalConfidence / scannedPages.length : 0 };
    } finally {
      if (worker && (!token || token.worker === worker)) {
        if (token) token.worker = null;
        await worker.terminate();
      }
      if (!token || token.pdf === pdf) {
        if (token) token.pdf = null;
        await pdf.destroy();
      }
    }
  }

  async function renderPdfPage(page) {
    var original = page.getViewport({ scale: 1 });
    var scale = Math.min(2, 1800 / Math.max(original.width, original.height));
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    return canvas;
  }

  /* Reconocimiento OCR de imágenes. */
  async function createOcrWorker(onProgress, basePercent, token) {
    var workerPath = assetUrl("vendor/receipt-reader/tesseract/worker.min.js");
    var corePath = assetUrl("vendor/receipt-reader/tesseract-core");
    var langPath = assetUrl("vendor/receipt-reader/spa");
    var worker = await global.Tesseract.createWorker("spa", 1, {
      workerPath: workerPath,
      corePath: corePath,
      langPath: langPath,
      workerBlobURL: true,
      gzip: true,
      logger: function (message) {
        var phase = message.status === "recognizing text" ? "Reconociendo texto…" : message.status === "loading language traineddata" ? "Preparando el reconocimiento en español…" : "Preparando el lector…";
        var percent = basePercent + Math.round((Number(message.progress) || 0) * 12);
        progress(onProgress, phase, percent);
      }
    });
    if (token) {
      token.worker = worker;
      if (token.cancelled) {
        await worker.terminate();
        token.worker = null;
        checkCancelled(token);
      }
    }
    return worker;
  }

  async function readImage(file, onProgress, token) {
    checkCancelled(token);
    if (!global.Tesseract) throw new Error("No se cargó el lector OCR local.");
    var worker = await createOcrWorker(onProgress, 25, token);
    try {
      checkCancelled(token);
      progress(onProgress, "Reconociendo el texto de la imagen…", 45);
      var result = await worker.recognize(file);
      return { text: result.data.text || "", method: "OCR", confidence: Number(result.data.confidence) || 0 };
    } finally {
      if (!token || token.worker === worker) {
        if (token) token.worker = null;
        await worker.terminate();
      }
    }
  }

  async function read(file, onProgress, token) {
    validate(file);
    checkCancelled(token);
    progress(onProgress, "Abriendo el archivo en este dispositivo…", 5);
    var result = isPdf(file) ? await readPdf(file, onProgress, token) : await readImage(file, onProgress, token);
    checkCancelled(token);
    progress(onProgress, "Preparando los campos para revisar…", 92);
    var parsed = parseReceipt(result.text, result.method, result.confidence);
    parsed.sourceLabel = "Recibo procesado en este dispositivo";
    return parsed;
  }

  /* API usada por la interfaz. */
  global.Pyme360ReceiptReader = { read: read, parse: parseReceipt };
})(window);
