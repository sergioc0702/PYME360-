import type { Quotation } from "../../domain/types";

export async function downloadQuotationPdf(quote: Quotation): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const money = (value: number) => `${new Intl.NumberFormat("es-CO").format(value)} COP`;
  let y = 48;
  function write(text: string, size = 11) {
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(text, 516) as string[]) {
      if (y > 738) {
        pdf.addPage();
        pdf.setFontSize(10);
        pdf.text(`Cotización comercial ${quote.number}`, 48, 36);
        pdf.setFontSize(size);
        y = 60;
      }
      pdf.text(line, 48, y);
      y += size + 5;
    }
  }
  write("Cotización comercial", 24);
  write(quote.number, 14);
  write(`Emisión ${quote.date} · Válida hasta ${quote.validUntil}`);
  y += 10;
  write(`Empresa: ${quote.company.name}`);
  if (quote.company.taxId) write(`NIT: ${quote.company.taxId}`);
  if (quote.company.city) write(quote.company.city);
  write(`Cliente: ${quote.customerName}`);
  if (quote.customerTaxId) write(`Identificación: ${quote.customerTaxId}`);
  for (const line of quote.lines) {
    y += 10;
    write(`${line.productName} (${line.sku})`, 12);
    write(
      `Cantidad ${line.quantity} × ${money(line.unitPrice)} · Descuento ${money(line.discountShare)}`,
    );
    write(`IVA ${line.vatRate}%: ${money(line.vatAmount)} · Total ${money(line.total)}`);
  }
  y += 14;
  write(
    `Subtotal ${money(quote.subtotal)} · Descuento ${money(quote.discount)} · IVA ${money(quote.vatAmount)}`,
  );
  write(`Total cotizado ${money(quote.total)}`, 16);
  pdf.save(`Pyme360-${quote.number}.pdf`);
}
