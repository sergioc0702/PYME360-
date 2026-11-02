(function (global) {
  "use strict";

  var definitions = [
    { key: "company", name: "Empresa", headers: ["Nombre o razón social", "NIT", "Ciudad", "Actividad"], fields: ["company", "companyNit", "city", "activityType"] },
    { key: "contacts", name: "Contactos", headers: ["ID", "Nombre", "Tipo", "Cliente ordinario", "Identificación", "Correo", "Teléfono"], fields: ["id", "name", "role", "ordinaryCustomer", "idNumber", "email", "phone"] },
    { key: "products", name: "Productos", headers: ["ID", "SKU", "Nombre", "Tipo", "Unidad", "Existencia", "Mínimo", "Costo unitario COP", "Precio COP", "Tipo de IVA", "Tarifa IVA %"], fields: ["id", "sku", "name", "type", "unit", "stock", "min", "cost", "price", "taxType", "taxRate"] },
    { key: "recipes", name: "Recetas", headers: ["Producto SKU", "Material SKU", "Cantidad por unidad"], fields: ["productSku", "materialSku", "amount"] },
    { key: "sales", name: "Ventas", headers: ["ID", "Número", "Cliente", "Fecha", "Total COP", "Descuento COP", "IVA %", "Estado de pago", "Forma de pago", "Fecha de pago", "Medio de pago", "Seguimiento de factura", "Número del documento externo", "Fecha del documento externo"], fields: ["id", "number", "customer", "date", "total", "discount", "taxRate", "status", "payment", "paidDate", "method", "invoiceFollowUpStatus", "externalInvoiceNumber", "externalInvoiceDate"] },
    { key: "saleLines", name: "Detalle de ventas", headers: ["Número de venta", "Producto SKU", "Cantidad", "Precio unitario COP", "IVA %"], fields: ["saleNumber", "sku", "quantity", "unitPrice", "taxRate"] },
    { key: "purchases", name: "Compras", headers: ["ID", "Número", "Proveedor", "Fecha", "Total COP", "Estado", "Detalle"], fields: ["id", "number", "supplier", "date", "total", "status", "detail"] },
    { key: "purchaseLines", name: "Detalle de compras", headers: ["Número de compra", "Producto SKU", "Cantidad", "Costo total COP"], fields: ["purchaseNumber", "sku", "quantity", "total"] },
    { key: "salePayments", name: "Pagos recibidos", headers: ["ID de pago", "Número de venta", "Fecha", "Valor recibido COP", "Medio de pago"], fields: ["paymentId", "saleNumber", "date", "amount", "method"] },
    { key: "production", name: "Producción", headers: ["ID", "Número de orden", "Producto SKU", "Producto", "Cantidad", "Fecha", "Estado", "Desperdicio kg", "Fecha de terminación"], fields: ["id", "number", "productSku", "product", "quantity", "date", "status", "wasteKg", "completedDate"] },
    { key: "productionInputs", name: "Consumos de producción", headers: ["Número de orden", "Material SKU", "Cantidad consumida"], fields: ["productionNumber", "sku", "quantity"] },
    { key: "environment", name: "Impacto ambiental", headers: ["Período", "Energía kWh", "Agua m³", "Combustible L", "Residuos orgánicos kg", "Aprovechables kg", "No aprovechables kg", "Peligrosos kg", "Reciclado o reutilizado kg", "Producción unidades", "Origen energía", "Método energía", "Fecha de confirmación energía", "Origen agua", "Método agua", "Fecha de confirmación agua"], fields: ["period", "electricityKwh", "waterM3", "fuelL", "organicKg", "recyclableKg", "nonRecyclableKg", "hazardousKg", "recycledKg", "productionUnits", "energySource", "energyMethod", "energyCapturedAt", "waterSource", "waterMethod", "waterCapturedAt"] },
    { key: "extras", name: "Datos adicionales", headers: ["Entidad", "Clave del registro", "Campo original", "Valor"], fields: ["entity", "recordKey", "field", "value"] }
  ];

  function getXlsx() {
    if (!global.XLSX) throw new Error("No se cargó el componente de Excel. Recarga la página e inténtalo de nuevo.");
    return global.XLSX;
  }

  /* Conversión del estado local a las hojas del libro. */
  function sheetRows(data, definition) {
    var rows = [];
    switch (definition.key) {
      case "company":
        return [{
          company: data.company || "",
          companyNit: data.companyNit || "",
          city: data.city || "",
          activityType: data.activityType || ""
        }];
      case "contacts":
        return data.contacts || [];
      case "products":
        return data.inventory || [];
      case "recipes":
        (data.inventory || []).forEach(function (product) {
          (product.inputs || []).forEach(function (input) {
            rows.push({ productSku: product.sku, materialSku: input.sku, amount: input.amount });
          });
        });
        return rows;
      case "sales":
        return data.sales || [];
      case "saleLines":
        (data.sales || []).forEach(function (sale) {
          (sale.lines || []).forEach(function (line) {
            rows.push({ saleNumber: sale.number, sku: line.sku, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate });
          });
        });
        return rows;
      case "purchases":
        return data.purchases || [];
      case "purchaseLines":
        (data.purchases || []).forEach(function (purchase) {
          var lines = Array.isArray(purchase.lines) && purchase.lines.length ? purchase.lines : (purchase.productSku ? [{ sku: purchase.productSku, quantity: purchase.quantity, total: purchase.total }] : []);
          lines.forEach(function (line) { rows.push({ purchaseNumber: purchase.number, sku: line.sku, quantity: line.quantity, total: line.total }); });
        });
        return rows;
      case "salePayments":
        (data.sales || []).forEach(function (sale) {
          (sale.payments || []).forEach(function (payment) {
            rows.push({ paymentId: payment.id, saleNumber: sale.number, date: payment.date, amount: payment.amount, method: payment.method });
          });
        });
        return rows;
      case "production":
        return (data.production || []).map(function (order) {
          var product = (data.inventory || []).find(function (entry) {
            return entry.id === order.productId || entry.name === order.product;
          });
          return Object.assign({}, order, { productSku: product ? product.sku : "" });
        });
      case "productionInputs":
        (data.production || []).forEach(function (order) {
          (order.inputConsumption || []).forEach(function (input) {
            rows.push({ productionNumber: order.number, sku: input.sku, quantity: input.quantity });
          });
        });
        return rows;
      case "environment":
        return data.environment || [];
      case "extras":
        (data.importExtras || []).forEach(function (record) {
          if (record.field != null) {
            rows.push({
              entity: record.entity,
              recordKey: record.recordKey,
              field: record.field,
              value: record.value
            });
            return;
          }
          Object.keys(record.fields || {}).forEach(function (field) {
            rows.push({
              entity: record.entity,
              recordKey: record.recordKey,
              field: field,
              value: record.fields[field]
            });
          });
        });
        return rows;
      default:
        return rows;
    }
  }

  function fieldValue(row, field) {
    var value = field.split(".").reduce(function (current, key) {
      return current == null ? undefined : current[key];
    }, row);
    return value == null ? "" : value;
  }

  function buildWorkbook(data, blank) {
    var XLSX = getXlsx();
    var workbook = XLSX.utils.book_new();
    definitions.forEach(function (definition) {
      var rows = blank ? [] : sheetRows(data, definition);
      var sheetRowsArray = [definition.headers].concat(rows.map(function (row) {
        return definition.fields.map(function (field) { return fieldValue(row, field); });
      }));
      var sheet = XLSX.utils.aoa_to_sheet(sheetRowsArray);
      sheet["!cols"] = definition.headers.map(function (header) { return { wch: Math.max(14, Math.min(32, header.length + 4)) }; });
      XLSX.utils.book_append_sheet(workbook, sheet, definition.name);
    });
    return workbook;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/\.xlsx?$|\.xls$/i.test(file.name || "")) return reject(new Error("Elige un archivo Excel .xlsx o .xls."));
      if (file.size > 10 * 1024 * 1024) return reject(new Error("El archivo supera el límite de 10 MB."));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("No se pudo leer el archivo. Revisa que siga disponible e inténtalo de nuevo.")); };
      reader.onload = function (event) {
        try {
          var XLSX = getXlsx();
          var workbook = XLSX.read(event.target.result, { type: "array", cellDates: false, sheetRows: 10001 });
          var total = 0;
          var sheets = workbook.SheetNames.map(function (name) {
            var rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: true, blankrows: false });
            total += rows.length;
            return { name: name, rows: rows.slice(0, 10001) };
          });
          if (total > 10000) throw new Error("El archivo contiene más de 10.000 filas. Divídelo en varios archivos e inténtalo de nuevo.");
          if (!sheets.length || !sheets.some(function (sheet) { return sheet.rows.length; })) throw new Error("El archivo no contiene filas para importar.");
          resolve({ name: file.name, sheets: sheets });
        } catch (error) { reject(error); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function download(data, blank, filename) {
    var XLSX = getXlsx();
    XLSX.writeFile(buildWorkbook(data, blank), filename, { compression: true });
  }

  global.Pyme360Excel = {
    definitions: definitions,
    downloadMaster: function (data) { download(data, false, "pyme360-maestro.xlsx"); },
    downloadTemplate: function () { download({}, true, "pyme360-plantilla-vacia.xlsx"); },
    readFile: readFile
  };
})(window);
