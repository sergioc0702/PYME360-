/** Lee texto separado por comas, punto y coma o tabuladores, respetando las comillas. */
export function parseDelimitedText(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"]
    .map((item) => ({ item, count: firstLine.split(item).length }))
    .sort((left, right) => right.count - left.count)[0].item;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) rows.push([...row, cell.replace(/\r$/, "")]);
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

/** Excel en español suele guardar CSV en Windows-1252, no en UTF-8. */
export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}
