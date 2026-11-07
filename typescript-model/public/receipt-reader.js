(function (global) {
  "use strict";

  var MAX_FILE_BYTES = 15 * 1024 * 1024;
  var MAX_PDF_PAGES = 8;
  var MONTHS = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
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
      raw =
        commaDecimals > 0 && commaDecimals <= 2
          ? raw.replace(/\./g, "").replace(",", ".")
          : raw.replace(/,/g, "");
    } else if (dot >= 0) {
      var dotDecimals = raw.length - dot - 1;
      if (dotDecimals === 3) raw = raw.replace(/\./g, "");
      else raw = raw.replace(/\.(?=.*\.)/g, "");
    }
    var number = Number(raw);
    return Number.isFinite(number) ? number : NaN;
  }

  var MONTH_ABBREVIATIONS = {
    ene: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    sep: "09",
    set: "09",
    oct: "10",
    nov: "11",
    dic: "12",
  };

  function validPeriod(year, month, day) {
    return (
      year >= 2000 &&
      year <= new Date().getFullYear() + 1 &&
      month >= 1 &&
      month <= 12 &&
      (day === undefined || (day >= 1 && day <= 31))
    );
  }

  function periodKey(year, month) {
    return year + "-" + String(month).padStart(2, "0");
  }

  /** Lee las fechas de un rango "desde - hasta", en año/mes/día o día/mes/año. */
  function dateParts(value) {
    var match = /^(\d{1,4})\D(\d{1,2})\D(\d{1,4})$/.exec(value);
    if (!match) return null;
    var first = Number(match[1]);
    var month = Number(match[2]);
    var last = Number(match[3]);
    var year = match[1].length === 4 ? first : last < 100 ? 2000 + last : last;
    var day = match[1].length === 4 ? last : first;
    return validPeriod(year, month, day) ? { year: year, month: month } : null;
  }

  /** El año del final no puede ser anterior al del inicio: es un error de lectura. */
  function rangeDates(range) {
    var start = dateParts(range[1]);
    var end = dateParts(range[2]);
    if (start && end && end.year < start.year) end.year = start.year;
    return { start: start, end: end };
  }

  var PERIOD_RANGE =
    /(?:per\w{2,5}do|desde)[^\n]{0,40}?(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})[^\d\n]{1,14}(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})/g;

  /** Muchos recibos cobran dos o tres meses juntos: el consumo no es de un solo mes. */
  function coveredMonths(normalized) {
    if (/t?r?imestral/.test(normalized) && !/semestral/.test(normalized)) return 3;
    if (/bimestral/.test(normalized)) return 2;
    var range = PERIOD_RANGE.exec(normalized);
    PERIOD_RANGE.lastIndex = 0;
    if (range) {
      var dates = rangeDates(range);
      if (dates.start && dates.end) {
        var months =
          (dates.end.year - dates.start.year) * 12 + dates.end.month - dates.start.month + 1;
        if (months >= 1 && months <= 12) return months;
      }
    }
    // En una foto el año suele fallar, pero el mes de cada fecha se alcanza a leer.
    var loose = /desde\D{0,4}\d{1,2}\D(\d{1,2})\D[^\n]{0,14}hasta\D{0,4}\d{1,2}\D(\d{1,2})\D/.exec(
      normalized,
    );
    if (loose && Number(loose[1]) <= 12 && Number(loose[2]) <= 12) {
      var span = ((Number(loose[2]) - Number(loose[1]) + 12) % 12) + 1;
      if (span <= 6) return span;
    }
    return 1;
  }

  function monthFromText(text) {
    var normalized = String(text || "")
      .toLocaleLowerCase("es-CO")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    var service =
      /mes de (?:servicio|consumo|facturacion)[^\n]{0,30}?\b(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\W{0,3}(20\d{2})\b/.exec(
        normalized,
      );
    if (service && validPeriod(Number(service[2]), Number(MONTH_ABBREVIATIONS[service[1]])))
      return { period: service[2] + "-" + MONTH_ABBREVIATIONS[service[1]], confidence: 0.9 };

    var labels = [];
    var labelRegex =
      /(?<!\d[ \t]?)\b(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\s?[\/\-il|]\s?(20\d{2})\b/g;
    var label;
    while ((label = labelRegex.exec(normalized))) {
      if (validPeriod(Number(label[2]), Number(MONTH_ABBREVIATIONS[label[1]])))
        labels.push(label[2] + "-" + MONTH_ABBREVIATIONS[label[1]]);
    }

    // Con dos lecturas de la misma foto, la fecha que más se repite es la confiable.
    var ends = {};
    var range;
    while ((range = PERIOD_RANGE.exec(normalized))) {
      var end = rangeDates(range).end;
      if (end) {
        var key = periodKey(end.year, end.month);
        ends[key] = (ends[key] || 0) + 1;
      }
    }
    var best = Object.keys(ends).sort(function (left, right) {
      return ends[right] - ends[left] || right.localeCompare(left);
    })[0];
    if (best) return { period: best, confidence: 0.86 };
    // Los meses de la gráfica van en orden: el último es el del recibo.
    if (labels.length) return { period: labels.sort().pop(), confidence: 0.6 };

    var periodContext = normalized.search(/periodo|ciclo|consumo|facturacion/);
    var searchText =
      periodContext >= 0 ? normalized.slice(periodContext, periodContext + 180) : normalized;
    var dates = [];
    var dateRegex = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/g;
    var match;
    while ((match = dateRegex.exec(searchText))) {
      var month = Number(match[2]);
      if (month >= 1 && month <= 12) dates.push(match[3] + "-" + String(month).padStart(2, "0"));
    }
    var monthYear =
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/.exec(
        searchText,
      );
    if (monthYear)
      return {
        period: monthYear[2] + "-" + MONTHS[monthYear[1]],
        confidence: periodContext >= 0 ? 0.9 : 0.72,
      };
    if (dates.length)
      return { period: dates[dates.length - 1], confidence: periodContext >= 0 ? 0.86 : 0.58 };
    return { period: "", confidence: 0 };
  }

  /**
   * La resta de las lecturas del medidor confirma el consumo: en una foto un 2 se
   * confunde con un 7, pero es raro que la misma cifra salga también de la resta.
   */
  function meterConsumptions(text) {
    var results = [];
    var previous = text.match(/lectura\s+anterior\D{0,14}(\d{2,8})/gi) || [];
    var current = text.match(/lectura\s+actual\D{0,14}(\d{2,8})/gi) || [];
    var digits = function (value) {
      return Number(/(\d+)\s*$/.exec(value)[1]);
    };
    previous.forEach(function (before) {
      current.forEach(function (after) {
        var difference = digits(after) - digits(before);
        if (difference > 0 && difference < 100000) results.push(difference);
      });
    });
    var rowRegex = /\b(\d{3,8})\s+(\d{3,8})\s+(\d{1,6})\s*m/gi;
    var row;
    while ((row = rowRegex.exec(text))) {
      if (Number(row[2]) - Number(row[1]) === Number(row[3])) results.push(Number(row[3]));
    }
    return results;
  }

  function usageCandidates(text, type) {
    var unit =
      type === "energy" ? "(?:kwh|kilovatios?\\s*hora?s?)" : "(?:m\\s*[³3]|metros?\\s*cubicos?)";
    var expressions = [
      new RegExp(
        "(?:consumo|consumido|consumida|facturado|facturada|energia activa|agua consumida)[^\\d]{0,90}(\\d[\\d.,]*)\\s*" +
          unit,
        "ig",
      ),
      new RegExp("(\\d[\\d.,]*)\\s*" + unit, "ig"),
      new RegExp(unit + "[^\\d]{0,10}(\\d[\\d.,]*)", "ig"),
      // Algunos recibos ponen la unidad en otra columna.
      /(?:consumo\s+(?:del\s+)?mes|total\s+consumo)[^\d\n]{0,25}(\d{1,6})\b/gi,
    ];
    if (type === "water")
      expressions.push(
        /(?<![\d/])\b(\d{1,5})\s*m(?:[3³il1]|\b)(?=\s|$)/gi,
        /\b\d{3,8}\s+\d{3,8}\s+(\d{1,5})\s*m/gi,
      );
    var candidates = [];
    expressions.forEach(function (regex, expressionIndex) {
      var match;
      while ((match = regex.exec(text))) {
        var value = normalizeNumber(match[1]);
        if (!Number.isFinite(value) || value <= 0) continue;
        var start = Math.max(0, match.index - 65);
        var end = Math.min(text.length, regex.lastIndex + 45);
        var context = text.slice(start, end).toLocaleLowerCase("es-CO");
        if (
          /\$\s*\/|tarifa|valor unitario|precio/.test(context) &&
          !/consumo|consumido|facturado/.test(context)
        )
          continue;
        if (/promedio/i.test(text.slice(Math.max(0, match.index - 30), regex.lastIndex))) continue;
        if (text[match.index + match[0].indexOf(match[1]) - 1] === "/") continue;
        var score =
          expressionIndex === 0 || expressionIndex === 3
            ? 3
            : expressionIndex === 5
              ? 4
              : expressionIndex === 2
                ? 2
                : 1;
        if (/consumo|consumid|facturad|lectura/.test(context)) score += 2;
        if (
          /total del periodo|total periodo|energia activa|m3 facturado|kwh facturado/.test(context)
        )
          score += 1;
        candidates.push({ value: value, score: score, context: context });
      }
    });
    var meters = meterConsumptions(text);
    var confirmed = meters.filter(function (value) {
      return candidates.some(function (candidate) {
        return candidate.value === value;
      });
    });
    candidates.forEach(function (candidate) {
      if (confirmed.indexOf(candidate.value) >= 0) {
        candidate.score += 5;
        candidate.meterConfirmed = true;
      }
    });
    // Si el total no cuadra con el medidor, pesa más la resta: son dos cifras grandes y claras.
    if (meters.length && !confirmed.length)
      candidates.push({ value: meters[0], score: 6, context: "", fromMeter: true });
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    return candidates;
  }

  function looksLike(text, type) {
    var pattern =
      type === "water"
        ? /acueducto|alcantarillado|agua|\bm3\b|\bm³/gi
        : /kwh|energia|energía|tension|tensión|reactiva|alumbrado/gi;
    return (text.match(pattern) || []).length;
  }

  function parseReceipt(text, method, ocrConfidence) {
    var clean = String(text || "").replace(/\r/g, "\n");
    var energy = usageCandidates(clean, "energy");
    var water = usageCandidates(clean, "water");
    var period = monthFromText(clean);
    var hasWaterContext =
      /acueducto|agua potable|servicio de agua|alcantarillado|consumo de agua/i.test(clean);
    var type =
      water.length && (!energy.length || (hasWaterContext && water[0].score >= energy[0].score))
        ? "water"
        : "energy";
    if (looksLike(clean, "water") > looksLike(clean, "energy") + 1 && water.length) type = "water";
    if (looksLike(clean, "energy") > looksLike(clean, "water") + 1 && energy.length)
      type = "energy";
    var selected = type === "water" ? water[0] : energy[0];
    // En una foto, un número suelto junto a "m3" suele ser una tarifa: mejor pedirlo que inventarlo.
    if (method === "OCR" && selected && selected.score < 3) selected = undefined;
    var warnings = [];
    var confidence = selected ? (selected.score >= 5 ? 0.93 : selected.score >= 3 ? 0.8 : 0.66) : 0;
    var meterConfirmed = Boolean(selected && selected.meterConfirmed);
    if (method === "OCR" && Number.isFinite(ocrConfidence) && !meterConfirmed)
      confidence = Math.min(confidence || 0.4, Math.max(0.25, ocrConfidence / 100));
    var months = coveredMonths(
      clean
        .toLocaleLowerCase("es-CO")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
    );
    if (!selected)
      warnings.push(
        "No encontramos un consumo con unidad kWh o m³. Escríbelo manualmente y revisa la unidad.",
      );
    if (!period.period)
      warnings.push("No encontramos con claridad el mes de consumo. Elige el período correcto.");
    else if (period.confidence < 0.7)
      warnings.push(
        "Encontramos una fecha, pero no podemos confirmar que sea el período de consumo.",
      );
    if (confidence < 0.75 && selected)
      warnings.push(
        "La lectura del consumo es dudosa. Compárala con el total de consumo del recibo.",
      );
    if (selected && selected.fromMeter)
      warnings.push(
        "El consumo salió de restar las lecturas del medidor, porque el total del recibo no se leyó igual. Compruébalo.",
      );
    if (months > 1)
      warnings.push(
        "Este recibo cubre " +
          months +
          " meses. El consumo es de todo ese tiempo, no de un solo mes: tenlo en cuenta al comparar.",
      );
    if (method === "OCR" && Number.isFinite(ocrConfidence) && ocrConfidence < 65)
      warnings.push(
        "La foto o el escaneo tiene baja nitidez. Verifica los números antes de guardar.",
      );
    return {
      type: type,
      period: period.period,
      consumption: selected ? selected.value : "",
      unit: type === "water" ? "m³" : "kWh",
      confidence: confidence,
      coveredMonths: months,
      periodConfidence: period.confidence,
      method: method,
      sourceLabel: "Recibo procesado en este dispositivo",
      warnings: warnings,
      textPreview: clean.slice(0, 12000),
    };
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  }

  function validate(file) {
    if (!file) throw new Error("Selecciona un archivo para continuar.");
    if (file.size > MAX_FILE_BYTES)
      throw new Error("El archivo supera 15 MB. Comprime el PDF o toma una foto más liviana.");
    var allowed =
      isPdf(file) ||
      /^image\/(jpeg|png|webp)$/i.test(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name || "");
    if (!allowed) throw new Error("Formato no compatible. Elige un PDF, JPG, PNG o WebP.");
  }

  /* Extracción de texto de PDF y páginas escaneadas. */
  async function readPdf(file, onProgress, token) {
    checkCancelled(token);
    if (!global.pdfjsLib) {
      try {
        global.pdfjsLib = await import(assetUrl("vendor/receipt-reader/pdfjs/pdf.mjs"));
      } catch (error) {
        throw new Error(
          "No se pudo cargar el lector PDF local. Inicia Pyme360 con el lanzador de tu sistema e inténtalo de nuevo.",
        );
      }
    }
    if (global.pdfjsLib.GlobalWorkerOptions) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl(
        "vendor/receipt-reader/pdfjs/pdf.worker.min.mjs",
      );
    }
    var data = await file.arrayBuffer();
    checkCancelled(token);
    var loadingTask = global.pdfjsLib.getDocument({ data: data });
    var pdf = await loadingTask.promise;
    if (token) token.pdf = pdf;
    var worker = null;
    try {
      checkCancelled(token);
      if (pdf.numPages > MAX_PDF_PAGES)
        throw new Error(
          "El PDF tiene más de " +
            MAX_PDF_PAGES +
            " páginas. Sube solo la página que muestra el consumo.",
        );
      var pageTexts = [];
      var scannedPages = [];
      for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        checkCancelled(token);
        progress(
          onProgress,
          "Revisando página " + pageNumber + " de " + pdf.numPages + "…",
          10 + Math.round((pageNumber / pdf.numPages) * 20),
        );
        var page = await pdf.getPage(pageNumber);
        var content = await page.getTextContent();
        var pageText = content.items
          .map(function (item) {
            return item.str || "";
          })
          .join(" ");
        pageTexts.push(pageText);
        if (pageText.replace(/\s/g, "").length < 35) scannedPages.push(page);
      }
      var joined = pageTexts.join("\n");
      var hasDigitalText = joined.replace(/\s/g, "").length >= 60;
      var hasDigitalConsumption =
        usageCandidates(joined, "energy").length || usageCandidates(joined, "water").length;
      if (hasDigitalText && (hasDigitalConsumption || !scannedPages.length))
        return { text: joined, method: "PDF con texto", confidence: 95 };
      if (!global.Tesseract)
        throw new Error("El PDF parece escaneado y el lector OCR no está disponible.");
      worker = await createOcrWorker(onProgress, 32, token);
      var results = hasDigitalText ? [joined] : [];
      var totalConfidence = 0;
      for (var i = 0; i < scannedPages.length; i += 1) {
        checkCancelled(token);
        var canvas = await renderPdfPage(scannedPages[i]);
        progress(
          onProgress,
          "Leyendo imagen " + (i + 1) + " de " + scannedPages.length + "…",
          45 + Math.round((i / scannedPages.length) * 45),
        );
        var result = await worker.recognize(canvas);
        results.push(result.data.text || "");
        totalConfidence += Number(result.data.confidence) || 0;
        canvas.width = 0;
        canvas.height = 0;
      }
      return {
        text: results.join("\n"),
        method: "OCR",
        confidence: scannedPages.length ? totalConfidence / scannedPages.length : 0,
      };
    } finally {
      if (worker && (!token || token.worker === worker)) {
        if (token) token.worker = null;
        await worker.terminate();
      }
      if (!token || token.pdf === pdf) {
        if (token) token.pdf = null;
        await loadingTask.destroy();
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
        var phase =
          message.status === "recognizing text"
            ? "Reconociendo texto…"
            : message.status === "loading language traineddata"
              ? "Preparando el reconocimiento en español…"
              : "Preparando el lector…";
        var percent = basePercent + Math.round((Number(message.progress) || 0) * 12);
        progress(onProgress, phase, percent);
      },
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

  /* Preparación de fotos: enderezar y quitar sombras antes de leer. */
  function drawPhoto(bitmap, scale, angle, blur) {
    var width = Math.round(bitmap.width * scale);
    var height = Math.round(bitmap.height * scale);
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    if (blur) context.filter = "blur(" + blur + "px)";
    context.translate(width / 2, height / 2);
    context.rotate((angle * Math.PI) / 180);
    context.translate(-width / 2, -height / 2);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  }

  /** Compara cada punto con lo que lo rodea: las sombras y el fondo dejan de estorbar. */
  function flattenLight(canvas, windowRatio, gain) {
    var width = canvas.width;
    var height = canvas.height;
    var context = canvas.getContext("2d", { willReadFrequently: true });
    var image = context.getImageData(0, 0, width, height);
    var data = image.data;
    var stride = width + 1;
    var sums = new Float64Array(stride * (height + 1));
    var x;
    var y;
    for (y = 0; y < height; y += 1) {
      var rowSum = 0;
      for (x = 0; x < width; x += 1) {
        var offset = (y * width + x) * 4;
        var gray = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
        data[offset] = gray;
        rowSum += gray;
        sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum;
      }
    }
    var half = Math.max(8, Math.round(Math.max(width, height) * windowRatio) >> 1);
    for (y = 0; y < height; y += 1) {
      var top = Math.max(0, y - half);
      var bottom = Math.min(height, y + half + 1);
      for (x = 0; x < width; x += 1) {
        var left = Math.max(0, x - half);
        var right = Math.min(width, x + half + 1);
        var total =
          sums[bottom * stride + right] -
          sums[top * stride + right] -
          sums[bottom * stride + left] +
          sums[top * stride + left];
        var mean = total / ((right - left) * (bottom - top));
        var position = (y * width + x) * 4;
        var ratio = data[position] / Math.max(mean, 1);
        var value = 255 - Math.min(255, Math.max(0, (1 - ratio) * gain * 255));
        data[position] = value;
        data[position + 1] = value;
        data[position + 2] = value;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  /** Busca el giro en el que las líneas de texto quedan más marcadas. */
  function findSkew(bitmap) {
    var scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    var bestAngle = 0;
    var bestScore = -1;
    for (var angle = -10; angle <= 10; angle += 1) {
      var canvas = flattenLight(drawPhoto(bitmap, scale, angle), 0.04, 3.34);
      var width = canvas.width;
      var height = canvas.height;
      var data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
      var start = Math.floor(width * 0.25);
      var end = Math.floor(width * 0.75);
      var previous = 0;
      var score = 0;
      for (var y = 0; y < height; y += 1) {
        var dark = 0;
        for (var x = start; x < end; x += 1) if (data[(y * width + x) * 4] < 128) dark += 1;
        score += (dark - previous) * (dark - previous);
        previous = dark;
      }
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
      canvas.width = 0;
      canvas.height = 0;
    }
    return bestAngle;
  }

  async function readImage(file, onProgress, token) {
    checkCancelled(token);
    if (!global.Tesseract) throw new Error("No se cargó el lector OCR local.");
    progress(onProgress, "Enderezando la foto…", 12);
    var bitmap = await createImageBitmap(file);
    var longSide = Math.max(bitmap.width, bitmap.height);
    var angle = findSkew(bitmap);
    // Dos lecturas: la segunda une los puntos de los recibos de impresora matricial.
    var passes = [
      { scale: Math.min(2, 3200 / longSide), blur: 0, window: 0.03, gain: 2.5 },
      { scale: Math.min(2.5, 4000 / longSide), blur: 1.5, window: 0.04, gain: 3 },
    ];
    var worker = await createOcrWorker(onProgress, 25, token);
    try {
      // Una foto trae columnas y tablas: leerla como un solo bloque revuelve las filas.
      await worker.setParameters({
        tessedit_pageseg_mode: "3",
        preserve_interword_spaces: "1",
      });
      var texts = [];
      var bestConfidence = 0;
      for (var index = 0; index < passes.length; index += 1) {
        checkCancelled(token);
        var pass = passes[index];
        progress(
          onProgress,
          "Leyendo la foto (" + (index + 1) + " de " + passes.length + ")…",
          45 + index * 22,
        );
        var canvas = flattenLight(
          drawPhoto(bitmap, pass.scale, angle, pass.blur),
          pass.window,
          pass.gain,
        );
        var result = await worker.recognize(canvas);
        canvas.width = 0;
        canvas.height = 0;
        texts.push(result.data.text || "");
        bestConfidence = Math.max(bestConfidence, Number(result.data.confidence) || 0);
      }
      return { text: texts.join("\n"), method: "OCR", confidence: bestConfidence };
    } finally {
      bitmap.close();
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
    var result = isPdf(file)
      ? await readPdf(file, onProgress, token)
      : await readImage(file, onProgress, token);
    checkCancelled(token);
    progress(onProgress, "Preparando los campos para revisar…", 92);
    var parsed = parseReceipt(result.text, result.method, result.confidence);
    parsed.sourceLabel = "Recibo procesado en este dispositivo";
    return parsed;
  }

  /* API usada por la interfaz. */
  global.Pyme360ReceiptReader = { read: read, parse: parseReceipt };
})(window);
