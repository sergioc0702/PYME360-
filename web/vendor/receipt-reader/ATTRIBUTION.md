# Componentes locales para lectura de recibos

Pyme360 incluye estos componentes de código abierto para procesar archivos en el navegador:

- `pdfjs-dist` 6.4.299 — Mozilla PDF.js — Apache-2.0. Lee PDF digitales y prepara las páginas escaneadas para OCR.
- `tesseract.js` 7.0.0 y `tesseract.js-core` 7.0.0 — Tesseract.js — Apache-2.0. Reconocimiento óptico de caracteres en el navegador.
- `@tesseract.js-data/spa` 1.0.0 — modelo de español `4.0.0_best_int` — MIT. Permite reconocer recibos en español sin descargar el modelo durante el uso.

Los avisos de licencias y los archivos de licencia están en esta carpeta y junto a los archivos minificados. Las versiones originales se registran en `package.json` y `package-lock.json`. El paquete no envía el recibo ni los datos extraídos a los autores de estas herramientas.
