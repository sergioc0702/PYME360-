---
name: Pyme360
description: Operación diaria y ahorro de recursos para microempresas que fabrican en Boyacá.
colors:
  green: "#1f4d33"
  green-dark: "#16391f"
  green-soft: "#dfe9cf"
  field-0: "#a8c66c"
  field-1: "#e0b64a"
  field-2: "#7fb3a6"
  field-3: "#c9a6d8"
  field-4: "#d98f5a"
  field-ink: "#16301f"
  red: "#a83f1a"
  red-strong: "#8a3213"
  red-soft: "#f7e3d8"
  amber: "#744b00"
  warning-surface: "#f0eade"
  canvas: "#f3f6ee"
  surface: "#ffffff"
  surface-muted: "#e8eedf"
  surface-hover: "#dde6d0"
  text: "#16301f"
  muted: "#3f5a48"
  line: "#cfdcc4"
  line-soft: "#dfe7d5"
  control-border: "#6d8473"
  focus-ring: "#176644"
  on-primary: "#ffffff"
  sidebar-canvas: "#1f4d33"
  sidebar-line: "#386b4e"
  sidebar-text: "#ffffff"
  sidebar-muted: "#dbe8d6"
  sidebar-icon: "#c9dcc3"
  sidebar-hover: "#2a5d40"
  sidebar-active: "#a8c66c"
  sidebar-active-text: "#16301f"
  oscuro-green: "#80c99b"
  oscuro-green-dark: "#a0ddb5"
  oscuro-field-0: "#8fb058"
  oscuro-field-1: "#d0a63e"
  oscuro-field-2: "#6fa597"
  oscuro-field-3: "#b896c8"
  oscuro-field-4: "#c9804c"
  oscuro-field-ink: "#10231a"
  oscuro-urgent: "#e08a63"
  oscuro-urgent-hover: "#eda27f"
  oscuro-urgent-ink: "#2a1208"
  oscuro-canvas: "#151a18"
  oscuro-surface: "#1f2623"
  oscuro-text: "#edf2ee"
  oscuro-muted: "#b8c3bc"
  oscuro-line: "#3b4540"
  oscuro-focus-ring: "#a0ddb5"
  oscuro-on-primary: "#14231a"
  oscuro-sidebar-canvas: "#17392a"
  oscuro-sidebar-active: "#a8c66c"
  oscuro-sidebar-active-text: "#16301f"
typography:
  display:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(2rem, 1.5rem + 1.6vw, 2.75rem)"
    fontWeight: 800
    lineHeight: 1.1
  figure:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(2.25rem, 1.9rem + 1vw, 3rem)"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "tnum"
  headline:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
  title:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.625
  note:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.4
  button:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
  label:
    fontFamily: "'Figtree Variable', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
rounded:
  xs: "2px"
  md: "0.5rem"
  lg: "0.625rem"
spacing:
  inline: "0.5rem"
  block: "0.75rem"
  row: "1rem"
  facts: "1.5rem"
  section: "2.25rem"
  column: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 1.375rem"
    height: "2.875rem"
  button-primary-hover:
    backgroundColor: "{colors.green-dark}"
  button-urgent:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 1.375rem"
    height: "2.875rem"
  button-urgent-hover:
    backgroundColor: "{colors.red-strong}"
  button-more:
    textColor: "{colors.green}"
    typography: "{typography.body}"
    padding: "0.5rem 0"
  task-row:
    textColor: "{colors.text}"
    typography: "{typography.title}"
    padding: "1rem 0"
  nav-item:
    textColor: "{colors.sidebar-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 0.625rem"
    height: "2.75rem"
  nav-item-hover:
    backgroundColor: "{colors.sidebar-hover}"
    textColor: "{colors.sidebar-text}"
  nav-item-active:
    backgroundColor: "{colors.sidebar-active}"
    textColor: "{colors.sidebar-active-text}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  panel-header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    padding: "1rem 1.25rem"
  parcel-map:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    height: "16.25rem"
  parcel:
    textColor: "{colors.field-ink}"
    padding: "0.625rem 0.75rem"
---

# Design System: Pyme360

## Overview

**Creative North Star: "Parcelas del altiplano"**

Pyme360 se ve como el mosaico de cultivos del altiplano boyacense visto desde lejos: campos planos de color, separados por linderos delgados, sobre un fondo verde muy claro. El menú verde oscuro es la tierra firme. El color de los campos se reserva para mostrar datos, así que cuando aparece, significa algo.

La interfaz es directa y calmada, con letra grande y mucho aire entre filas. La usan personas con poca experiencia digital, entre tareas, en computador y en celular. Por eso el orden se hace con líneas y espacio, no con cajas ni efectos. Las esquinas son rectas o apenas redondeadas y las superficies no flotan.

**Estado actual.** Solo el marco (menú y cabecera) e Inicio están rehechos en este sistema. Las demás pantallas ya usan los colores nuevos, pero conservan su distribución anterior y se rehacen una a la vez. Al rehacer cada pantalla, sigue este documento y no su código anterior.

**Key Characteristics:**
- Campos de color planos, sin degradados.
- Verde oscuro para el menú y las acciones; rojo barro solo para lo urgente.
- Una sola familia de letra, Figtree, con títulos muy gruesos.
- Filas separadas por líneas en lugar de tarjetas con sombra.
- Tema claro y tema oscuro con los mismos papeles de color.

## Colors

Una base de verdes del páramo con cinco colores de cultivo que solo salen a escena para mostrar datos.

### Primary
- **Verde Monte** (green): botones principales, enlaces de acción y la cifra de ahorro. Sobre él, texto blanco (on-primary).
- **Verde Monte Hondo** (green-dark): estado hover de los botones principales.
- **Verde Rocío** (green-soft): fondos suaves de estado positivo.

### Secondary
- **Rojo Barro** (red): solo el botón de una tarea urgente y los avisos de peligro. Hover en red-strong; fondo suave en red-soft.
- **Ámbar Tostado** (amber): texto de advertencia sobre warning-surface.

### Tertiary
Los cinco campos del mapa de parcelas. Todos llevan encima el mismo texto oscuro (field-ink), con contraste de al menos 5:1.
- **Verde Hierba** (field-0): primera parcela. También marca la opción activa del menú y la selección de texto.
- **Ocre de Trigo** (field-1): segunda parcela.
- **Verde Laguna** (field-2): tercera parcela.
- **Lila Flor de Papa** (field-3): cuarta parcela.
- **Barro Cocido** (field-4): quinta parcela.

### Neutral
- **Neblina Verde** (canvas): fondo de toda la app y de los linderos entre parcelas.
- **Blanco** (surface): paneles, cabecera, ventanas y el recuadro del logo.
- **Pasto Seco** (surface-muted, surface-hover): cabeceras de panel y de tabla; hover de filas.
- **Tinta de Monte** (text): texto principal.
- **Musgo** (muted): fechas, explicaciones y notas.
- **Lindero** (line, line-soft): líneas entre filas y bordes de panel.
- **Borde de Control** (control-border): borde de campos de formulario.
- **Anillo de Foco** (focus-ring): contorno de foco con teclado sobre fondos claros.

### Tema oscuro
Los tokens con prefijo `oscuro-` son los valores del tema oscuro para los mismos papeles. El fondo pasa a verde casi negro y los campos bajan un poco de brillo. El menú sigue siendo verde oscuro, un poco más hondo, y la opción activa conserva el verde hierba. El botón urgente usa oscuro-urgent con texto oscuro-urgent-ink, porque el rojo del tema oscuro es demasiado claro para ese papel.

### Named Rules
**La Regla del Campo.** Ocre, laguna, lila y barro cocido solo pintan datos: parcelas y su leyenda. Nunca botones, avisos ni adornos. Verde hierba es la única excepción, porque también marca dónde estás en el menú y la selección de texto.

**La Regla del Rojo Escaso.** El rojo significa "esto no puede esperar". Si todas las filas son urgentes, ninguna lo es.

## Typography

**Display Font:** Figtree Variable (con Segoe UI, Helvetica Neue, Arial)
**Body Font:** Figtree Variable (con los mismos respaldos)

**Character:** Una sola letra, redonda y amable, que gana autoridad con el peso. Los títulos en 800 hacen el trabajo que otros sistemas dejan a una segunda fuente.

### Hierarchy
- **Display** (800, entre 2rem y 2.75rem, 1.1): el título de la pantalla, escrito como frase. Ejemplo: "Hoy te faltan 3 cosas".
- **Figure** (800, entre 2.25rem y 3rem, 1.1, cifras tabulares): la cifra que resume una pantalla, como el ahorro en pesos.
- **Headline** (800, 1.375rem): títulos de sección.
- **Title** (700, 1.3125rem, 1.25): el nombre de cada tarea o fila principal.
- **Body** (400, 1.0625rem, 1.625): texto corriente.
- **Note** (400, 1.0625rem, 1.4): explicaciones de una cifra y mensajes sin datos, en color musgo.
- **Button** (700, 1.125rem): texto de botones principales.
- **Label** (500, 0.9375rem): opciones del menú y datos secundarios. La opción activa sube a 700.

### Named Rules
**La Regla de la Letra Grande.** En pantallas rehechas ningún texto baja de 0.9375rem. Quien usa la app puede estar de pie en una bodega y mirando un celular.

**La Regla del Peso Alineado.** Pesos, kilovatios y cantidades usan cifras tabulares, para que los números se puedan comparar de un vistazo.

## Layout

El marco es un menú fijo a la izquierda (17rem, o 4.5rem plegado) y el contenido a la derecha, hasta 1800px de ancho. Las pantallas rehechas ordenan lo que hay que hacer primero y lo que hay que analizar después.

Inicio usa dos columnas: una flexible para las tareas y otra de 20 a 27.5rem para el ahorro y el mapa, separadas por 2.5rem. Las filas tienen 1rem de aire arriba y abajo, y las secciones se separan 2.25rem. La línea de 2px abre un grupo de datos; la de 1px separa filas menores.

Cambios por tamaño:
- **Hasta 62rem:** una sola columna, en este orden: tareas, ahorro y mapa, negocio.
- **Hasta 760px:** barra verde abajo con Inicio, Vender, Inventario y Más. Más abre el menú completo como cajón lateral. Todos los controles miden al menos 44px.
- **Hasta 34rem:** cada tarea se apila y su botón ocupa todo el ancho. Los datos del negocio pasan a filas.
- **Ventanas de menos de 760px de alto, desde 761px de ancho:** el menú se compacta y esconde la tarjeta de empresa, para que se vean todas las opciones sin desplazarse.

## Elevation & Depth

El sistema es plano. La profundidad sale del cambio de tono entre fondo, superficie y menú, y de las líneas. Los paneles y las filas no llevan sombra.

### Shadow Vocabulary
- **Capa flotante** (`box-shadow: 0 8px 24px rgb(22 48 31 / 10%)`; en tema oscuro `0 16px 40px rgb(0 0 0 / 25%)`): solo para lo que de verdad pasa por encima del contenido, como ventanas, avisos y ayudas emergentes.

### Named Rules
**La Regla del Suelo Plano.** Lo que está en la página no flota. La sombra solo se usa en una capa que tapa algo, nunca para adornar.

## Shapes

Formas de terreno: rectángulos con esquinas rectas o poco redondeadas. Botones, opciones del menú y paneles usan 0.5rem; el mapa de parcelas, 0.625rem; la muestra de color de la leyenda, 2px. Las parcelas son rectángulos sin curva, recortados por el borde del mapa. Los avatares son círculos.

**La Regla del Lindero.** Las parcelas se separan con un borde de 2px del color del fondo. El lindero es un hueco en el terreno, no una línea dibujada.

## Components

### Buttons
Grandes, sólidos y con un verbo claro.
- **Shape:** poco redondeado (0.5rem), 2.875rem de alto.
- **Primary:** fondo verde monte, texto blanco.
- **Urgent:** misma forma, fondo rojo barro.
- **Hover / Focus:** el fondo se oscurece en 140ms, sin moverse. Contorno de 3px con 2px de separación.
- **Más opciones:** texto verde subrayado, sin fondo, para "Ver 3 más".

Los botones de las pantallas sin rehacer conservan su forma anterior. Al rehacer cada una, pasan a este modelo.

### Lista de tareas
La pieza central de Inicio. Cada fila lleva título, motivo en una línea y un botón a la derecha, separada de la anterior por una línea de 2px. Sin íconos ni casillas: la acción está en el botón. Si no hay tareas, una frase lo dice.

### Mapa de parcelas
La pieza propia del sistema. Rectángulos de color cuyo tamaño es proporcional al gasto de cada rubro, 16.25rem de alto. Una parcela solo lleva nombre y valor si ocupa al menos el 9% del mapa. Debajo siempre va una lista con muestra de color, nombre y valor, y una nota que dice de qué mes son los datos y cómo se calcularon. Sin datos, se muestra una frase, no un mapa vacío.

**La Regla del Mapa Acompañado.** El mapa nunca va solo. Los lectores de pantalla lo saltan y las parcelas pequeñas no llevan texto, así que la lista es la que garantiza que todos los datos se puedan leer.

### Cifra de ahorro
Una cifra en pesos con letra Figure, seguida de una nota que dice contra qué mes se compara. Nunca aparece sin esa nota.

### Datos del negocio
Tres datos en fila bajo una línea de 2px: nombre en musgo y valor en 700 a 1.375rem. Sin caja alrededor.

### Cards / Containers
El panel compartido es el contenedor de las pantallas que necesitan una tabla o un formulario.
- **Corner Style:** poco redondeado (0.5rem).
- **Background:** blanco, con cabecera en pasto seco.
- **Shadow Strategy:** ninguna.
- **Border:** 1px color lindero.
- **Internal Padding:** cabecera de 1rem por 1.25rem.

### Navigation
Menú verde oscuro con diez opciones en una lista plana, sin grupos ni encabezados, cada una con ícono de 1.375rem y nombre sencillo: Inicio, Vender, Comprar, Inventario, Producción, Consumo y ahorro, Clientes y proveedores, Dinero, Datos y respaldo, Historial de cambios.
- **Default:** texto claro sobre verde, 2.75rem de alto.
- **Hover:** fondo un punto más claro y texto blanco.
- **Active:** fondo verde hierba, texto oscuro y peso 700. Se nota sin depender del ícono.
- **Logo:** el logo actual va sobre un recuadro blanco.
- **Celular:** la barra inferior repite el mismo verde y el mismo estado activo.

### Inputs / Fields
Aún sin rehacer. Por ahora se mantienen el borde color control y el fondo blanco. Su forma se define cuando se rehaga la primera pantalla con formulario.

## Do's and Don'ts

### Do:
- **Do** empieza cada pantalla rehecha por lo que la persona debe hacer, con un título escrito como frase.
- **Do** usa los campos en orden (field-0 a field-4) y con texto field-ink encima.
- **Do** acompaña toda cifra con una nota que explique de dónde sale y contra qué se compara.
- **Do** separa las filas con líneas de 1px o 2px color lindero y deja 1rem de aire.
- **Do** mantén botones de 2.875rem de alto y controles de al menos 44px en celular.
- **Do** muestra una frase clara cuando falten datos.
- **Do** revisa cada pieza nueva en tema claro y tema oscuro.

### Don't:
- **Don't** uses ocre, laguna, lila ni barro cocido fuera de los datos.
- **Don't** uses degradados: los campos son planos.
- **Don't** pongas sombra a paneles, filas o botones; solo las capas flotantes la llevan.
- **Don't** redondees contenedores ni botones más de 0.625rem.
- **Don't** pongas una etiqueta pequeña en mayúsculas encima de los títulos.
- **Don't** muevas los botones al pasar el cursor; solo cambia su color.
- **Don't** muestres el mapa de parcelas sin su lista.
- **Don't** agregues una segunda familia de letra.
