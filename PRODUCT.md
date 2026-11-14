# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dueños y empleados de pequeñas empresas que fabrican (alimentos y bebidas, confección y calzado, madera, metalmecánica) en Duitama, Sogamoso y el corredor industrial de Boyacá, Colombia. Casi todas son microempresas. El dueño revisa resultados y decide; un empleado registra en bodega, producción o mostrador. Tienen poca experiencia con sistemas y muchos llevan sus cuentas en cuadernos o Excel. Usan la app tanto en computador como en celular.

## Product Purpose

Pyme360 ayuda a estas empresas a llevar ventas, compras, inventario y producción, y con esos mismos datos les muestra cuánta energía, agua y material gastan, cuál es su huella de carbono y cuánto ahorran en pesos. Éxito: el empresario registra sin ayuda, entiende qué hacer hoy y convierte esa información en ahorros reales.

## Positioning

Une la operación diaria con la reducción de recursos: relaciona el consumo con lo que se produce y muestra el resultado en pesos, kilovatios y CO₂. Los programas contables no se enfocan en producción ni huella, y la calculadora pública da una cifra sin seguimiento.

## Operating Context

Se usa entre tareas, en mostrador, oficina, bodega o planta, a veces con mala conexión. Cada mes llegan recibos de energía y agua de distintas empresas. Muchos clientes traen sus datos en Excel desordenado. Hoy funciona en local con SQLite como aplicación de escritorio o en navegador.

## Capabilities and Constraints

Ventas, compras, inventario, recetas, producción, contactos, dinero, consumo y ahorro, plan de ahorro, informe PDF, Excel, importación de archivos desordenados, lectura de recibos, facturación por proveedor externo, usuarios y permisos, respaldos. Las pantallas deben conservar todas las funciones y validaciones existentes. La interfaz se rehace una pantalla a la vez, sin dejar la app rota. Stack: React y TypeScript con Tailwind, servidor local en Python.

## Brand Commitments

Nombre Pyme360. Se conserva el logo actual (`frontend/public/pyme360-logo-*.png`, `pyme360-mark-*.png`). Los colores y el resto de la apariencia pueden renovarse.

Voz: español sencillo de Colombia, de tú, sin jerga técnica ni ambiental. Decir "Consumo del mes", no "lectura ambiental"; "Gasto por unidad", no "intensidad".

## Evidence on Hand

No hay clientes, testimonios ni resultados reales de ahorro. No se deben inventar. La demanda aún no está validada.

## Product Principles

- Primero qué hacer hoy; los análisis vienen después.
- Registrar debe tomar pocos minutos y pedir poca información.
- Todo resultado se explica en pesos y en palabras simples.
- Mostrar de dónde sale cada dato y avisar cuando esté incompleto; nunca prometer ni certificar.

## Accessibility & Inclusion

Personas con poca experiencia digital: textos claros, contraste alto, botones grandes y uso cómodo con el dedo en celular.
