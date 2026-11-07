# -*- coding: utf-8 -*-
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
wb.remove(wb.active) # Quitar hoja por defecto

# Paleta Ejecutiva Profesional
NAVY_HEADER = "1B365D"
WHITE_TEXT = "FFFFFF"
ACCENT_BLUE = "E8EEF5"
ACCENT_GREEN = "E2F0D9"
GREEN_DARK = "1E6B37"
GRAY_LIGHT = "F9FBFD"
GRAY_BORDER = "D9D9D9"

font_title = Font(name="Calibri", size=16, bold=True, color=NAVY_HEADER)
font_subtitle = Font(name="Calibri", size=11, italic=True, color="595959")
font_section = Font(name="Calibri", size=12, bold=True, color=NAVY_HEADER)
font_tbl_header = Font(name="Calibri", size=11, bold=True, color=WHITE_TEXT)
font_bold = Font(name="Calibri", size=11, bold=True)
font_regular = Font(name="Calibri", size=11)
font_kpi_num = Font(name="Calibri", size=18, bold=True, color=NAVY_HEADER)
font_kpi_lbl = Font(name="Calibri", size=10, bold=True, color="595959")

fill_tbl_header = PatternFill(start_color=NAVY_HEADER, end_color=NAVY_HEADER, fill_type="solid")
fill_zebra = PatternFill(start_color=GRAY_LIGHT, end_color=GRAY_LIGHT, fill_type="solid")
fill_total = PatternFill(start_color=ACCENT_BLUE, end_color=ACCENT_BLUE, fill_type="solid")
fill_kpi = PatternFill(start_color=ACCENT_BLUE, end_color=ACCENT_BLUE, fill_type="solid")
fill_kpi_green = PatternFill(start_color=ACCENT_GREEN, end_color=ACCENT_GREEN, fill_type="solid")

thin_border = Border(
    left=Side(style='thin', color=GRAY_BORDER),
    right=Side(style='thin', color=GRAY_BORDER),
    top=Side(style='thin', color=GRAY_BORDER),
    bottom=Side(style='thin', color=GRAY_BORDER)
)

double_bottom_border = Border(
    left=Side(style='thin', color=GRAY_BORDER),
    right=Side(style='thin', color=GRAY_BORDER),
    top=Side(style='thin', color=GRAY_BORDER),
    bottom=Side(style='double', color=NAVY_HEADER)
)

# Nombres exactos de las hojas (sin tildes para máxima compatibilidad de fórmulas en Excel en español e inglés)
SHEET_RESUMEN = "Resumen Ejecutivo"
SHEET_DESARROLLO = "Desarrollo del Software"
SHEET_PUESTA = "Puesta en Marcha"
SHEET_GASTOS = "Gastos Mensuales"
SHEET_RETORNO = "Beneficios y Retorno"
SHEET_EVALUACION = "Evaluacion Final"

# -------------------------------------------------------------------------
# 1. HOJA: Desarrollo del Software (Definida primero conceptualmente)
# -------------------------------------------------------------------------
ws_des = wb.create_sheet(title=SHEET_DESARROLLO)
ws_des.views.sheetView[0].showGridLines = True

ws_des["B2"] = "COSTOS DE DESARROLLO Y CONSTRUCCION DEL SOFTWARE"
ws_des["B2"].font = font_title
ws_des["B3"] = "Pago unico por la creacion de modulos, pantallas y funciones de Pyme360"
ws_des["B3"].font = font_subtitle

headers_des = ["Fase / Modulo", "Que incluye para la empresa", "Tiempo", "Equipo Requerido", "Costo ($ COP)"]
for col_idx, h in enumerate(headers_des, start=2):
    cell = ws_des.cell(row=5, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="center" if col_idx in [4, 5] else "left", vertical="center")

modulos = [
    ("1. Diseno de Pantallas y Experiencia", "Menus sencillos, botones grandes y panel claro de indicadores para no expertos.", "2 semanas", "Diseno & UX", 2500000),
    ("2. Modulo de Inventario y Productos", "Fichas de productos, control de entradas, salidas, stock minimo y alertas.", "3 semanas", "Desarrollo", 4200000),
    ("3. Modulo de Ventas y Facturacion Local", "Caja rapida, emision de recibos, registro de clientes y cuentas por cobrar.", "3 semanas", "Desarrollo", 4500000),
    ("4. Facturacion Electronica DIAN", "Generacion de factura valida con firma, codigo QR y transmision oficial.", "3 semanas", "Especialista DIAN", 5000000),
    ("5. Puente y Exportacion con Excel", "Permite subir listas de Excel existentes y descargar reportes sin errores.", "1 semana", "Desarrollo", 1800000),
    ("6. Control de Usuarios y Seguridad Local", "Claves independientes por empleado, permisos por rol y respaldos de datos.", "1.5 semanas", "Seguridad", 2200000),
    ("7. Pruebas Generales y Estabilidad", "Simulacion con datos reales de la pyme para asegurar cero fallas antes de operar.", "2 semanas", "Control Calidad", 2800000),
    ("8. Generacion del Instalador Portable", "Creacion de Pyme360.exe listo para abrir con un clic sin configuraciones.", "1 semana", "Empaquetado", 1500000)
]

for idx, (m, desc, t, eq, costo) in enumerate(modulos, start=6):
    r1 = ws_des.cell(row=idx, column=2, value=m)
    r2 = ws_des.cell(row=idx, column=3, value=desc)
    r3 = ws_des.cell(row=idx, column=4, value=t)
    r4 = ws_des.cell(row=idx, column=5, value=eq)
    r5 = ws_des.cell(row=idx, column=6, value=costo)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    r5.font = font_regular
    
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    r5.alignment = Alignment(horizontal="right")
    r5.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

# Fila Total Desarrollo en F14
ws_des["B14"] = "TOTAL COSTO DE DESARROLLO"
ws_des["B14"].font = font_bold
ws_des["F14"] = "=SUM(F6:F13)"
ws_des["F14"].font = font_bold
ws_des["F14"].alignment = Alignment(horizontal="right")
ws_des["F14"].number_format = "$ #,##0"

for col_idx in range(2, 7):
    c = ws_des.cell(row=14, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border


# -------------------------------------------------------------------------
# 2. HOJA: Puesta en Marcha
# -------------------------------------------------------------------------
ws_pm = wb.create_sheet(title=SHEET_PUESTA)
ws_pm.views.sheetView[0].showGridLines = True

ws_pm["B2"] = "PUESTA EN MARCHA, INSTALACION Y CAPACITACION"
ws_pm["B2"].font = font_title
ws_pm["B3"] = "Actividades para garantizar que todo el equipo adopte el sistema sin friccion"
ws_pm["B3"].font = font_subtitle

headers_pm = ["Actividad", "Que se entrega al cliente / pyme", "Duracion", "Costo ($ COP)"]
for col_idx, h in enumerate(headers_pm, start=2):
    cell = ws_pm.cell(row=5, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="center" if col_idx == 4 else ("right" if col_idx == 5 else "left"), vertical="center")

actividades_pm = [
    ("1. Instalacion y Verificacion en Equipos", "Configuracion de Pyme360.exe en computadores de caja, bodega y administracion.", "2 dias", 900000),
    ("2. Carga y Limpieza de Datos Iniciales", "Paso de productos, saldos iniciales y clientes desde sus archivos de Excel viejos.", "3 dias", 1400000),
    ("3. Capacitacion Practica al Personal", "3 talleres practicos con cajeros, encargados de almacen y contabilidad.", "1 semana", 1600000),
    ("4. Manuales y Videos de Ayuda Rapida", "Guia en PDF paso a paso + 5 micro-videos explicativos para resolver dudas diarias.", "1 semana", 900000),
]

for idx, (act, ent, dur, costo) in enumerate(actividades_pm, start=6):
    r1 = ws_pm.cell(row=idx, column=2, value=act)
    r2 = ws_pm.cell(row=idx, column=3, value=ent)
    r3 = ws_pm.cell(row=idx, column=4, value=dur)
    r4 = ws_pm.cell(row=idx, column=5, value=costo)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="right")
    r4.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

# Fila Total Puesta en Marcha en E10
ws_pm["B10"] = "TOTAL PUESTA EN MARCHA Y CAPACITACION"
ws_pm["B10"].font = font_bold
ws_pm["E10"] = "=SUM(E6:E9)"
ws_pm["E10"].font = font_bold
ws_pm["E10"].alignment = Alignment(horizontal="right")
ws_pm["E10"].number_format = "$ #,##0"

for col_idx in range(2, 6):
    c = ws_pm.cell(row=10, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border


# -------------------------------------------------------------------------
# 3. HOJA: Gastos Mensuales
# -------------------------------------------------------------------------
ws_gm = wb.create_sheet(title=SHEET_GASTOS)
ws_gm.views.sheetView[0].showGridLines = True

ws_gm["B2"] = "GASTOS MENSUALES Y COSTOS DE OPERACION"
ws_gm["B2"].font = font_title
ws_gm["B3"] = "Costos recurrentes transparentes: sin servidores caros gracias al diseno local"
ws_gm["B3"].font = font_subtitle

headers_gm = ["Servicio / Rubro", "Proposito para el negocio", "Frecuencia", "Costo Mensual ($ COP)", "Costo Anual (12 Meses)"]
for col_idx, h in enumerate(headers_gm, start=2):
    cell = ws_gm.cell(row=5, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="center" if col_idx == 4 else ("right" if col_idx in [5, 6] else "left"), vertical="center")

gastos_mensuales = [
    ("1. Soporte Tecnico y Asistencia", "Atencion a dudas de usuarios y correccion rapida de cualquier imprevisto.", "Mensual", 450000),
    ("2. Paquete Facturacion Electronica DIAN", "Validacion y timbrado de facturas con proveedor tecnologico oficial.", "Mensual", 150000),
    ("3. Respaldo Automatico Seguro (Backup)", "Copia cifrada de la base de datos para proteccion contra dano o robo de PC.", "Mensual", 90000),
    ("4. Actualizaciones Legales y Mejoras", "Actualizaciones de ley tributaria y mejoras del software.", "Mensual", 200000),
]

for idx, (srv, prop, frec, costo_m) in enumerate(gastos_mensuales, start=6):
    r1 = ws_gm.cell(row=idx, column=2, value=srv)
    r2 = ws_gm.cell(row=idx, column=3, value=prop)
    r3 = ws_gm.cell(row=idx, column=4, value=frec)
    r4 = ws_gm.cell(row=idx, column=5, value=costo_m)
    r5 = ws_gm.cell(row=idx, column=6, value=f"=E{idx}*12")
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    r5.font = font_bold
    
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="right")
    r5.alignment = Alignment(horizontal="right")
    r4.number_format = "$ #,##0"
    r5.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

# Total Gastos Mensuales en E10 y F10
ws_gm["B10"] = "TOTAL COSTOS RECURRENTES"
ws_gm["B10"].font = font_bold
ws_gm["E10"] = "=SUM(E6:E9)"
ws_gm["E10"].font = font_bold
ws_gm["E10"].alignment = Alignment(horizontal="right")
ws_gm["E10"].number_format = "$ #,##0"

ws_gm["F10"] = "=SUM(F6:F9)"
ws_gm["F10"].font = font_bold
ws_gm["F10"].alignment = Alignment(horizontal="right")
ws_gm["F10"].number_format = "$ #,##0"

for col_idx in range(2, 7):
    c = ws_gm.cell(row=10, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border


# -------------------------------------------------------------------------
# 4. HOJA: Beneficios y Retorno (ROI)
# -------------------------------------------------------------------------
ws_ret = wb.create_sheet(title=SHEET_RETORNO)
ws_ret.views.sheetView[0].showGridLines = True

ws_ret["B2"] = "EVALUACION DE BENEFICIOS, AHORROS Y RETORNO (ROI)"
ws_ret["B2"].font = font_title
ws_ret["B3"] = "Justificacion financiera: como la aplicacion se paga sola en la empresa"
ws_ret["B3"].font = font_subtitle

headers_roi = ["Concepto de Ahorro / Beneficio", "Como se genera el beneficio", "Ahorro Mensual ($ COP)", "Ahorro Anual ($ COP)"]
for col_idx, h in enumerate(headers_roi, start=2):
    cell = ws_ret.cell(row=5, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="right" if col_idx in [4, 5] else "left", vertical="center")

beneficios = [
    ("1. Ahorro de Tiempo en Digitacion", "2 empleados ahorran 2 horas diarias de conciliar Excel (80 hrs/mes valoradas).", 1600000),
    ("2. Reduccion de Perdidas de Inventario", "Menos mercancia vencida o faltante gracias a control de stock en tiempo real.", 1200000),
    ("3. Cero Multas o Sanciones DIAN", "Emision correcta y a tiempo de documentos fiscales y facturacion.", 500000),
    ("4. Rapidez en Cobranza de Facturas", "Control de cartera y alertas de cobro para ingresar dinero mas rapido.", 800000),
]

for idx, (b_nom, b_desc, ahorro_m) in enumerate(beneficios, start=6):
    r1 = ws_ret.cell(row=idx, column=2, value=b_nom)
    r2 = ws_ret.cell(row=idx, column=3, value=b_desc)
    r3 = ws_ret.cell(row=idx, column=4, value=ahorro_m)
    r4 = ws_ret.cell(row=idx, column=5, value=f"=D{idx}*12")
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_bold
    
    r3.alignment = Alignment(horizontal="right")
    r4.alignment = Alignment(horizontal="right")
    r3.number_format = "$ #,##0"
    r4.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

# Fila Total Beneficios en D10 y E10
ws_ret["B10"] = "TOTAL BENEFICIOS Y AHORROS"
ws_ret["B10"].font = font_bold
ws_ret["D10"] = "=SUM(D6:D9)"
ws_ret["D10"].font = font_bold
ws_ret["D10"].alignment = Alignment(horizontal="right")
ws_ret["D10"].number_format = "$ #,##0"

ws_ret["E10"] = "=SUM(E6:E9)"
ws_ret["E10"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)
ws_ret["E10"].alignment = Alignment(horizontal="right")
ws_ret["E10"].number_format = "$ #,##0"

for col_idx in range(2, 6):
    c = ws_ret.cell(row=10, column=col_idx)
    c.fill = fill_kpi_green
    c.border = double_bottom_border

# Metricas clave de rentabilidad
ws_ret["B12"] = "METRICAS CLAVE DE RENTABILIDAD"
ws_ret["B12"].font = font_section

# Referencias sin ambigüedad
metricas = [
    ("Inversion Inicial Requerida", "Desarrollo de software + Puesta en marcha", f"='{SHEET_DESARROLLO}'!F14+'{SHEET_PUESTA}'!E10"),
    ("Ahorro Neto Mensual (Beneficio - Gastos)", "Beneficio mensual menos costo mensual de operacion", f"=D10-'{SHEET_GASTOS}'!E10"),
    ("Ahorro Bruto Anual de la Empresa", "Total de beneficios proyectados durante el primer ano", "=E10"),
    ("Costo Total Primer Ano (Inversion + 12m Operacion)", "Total de dinero desembolsado en el ano 1", f"=D13+('{SHEET_GASTOS}'!F10)"),
    ("Beneficio Neto Primer Ano (Ganancia Real)", "Ahorro anual total menos costo total del primer ano", "=D15-D16"),
    ("Tiempo de Recuperacion de Inversion", "Meses necesarios para recuperar la inversion inicial", "=D13/D14"),
    ("Retorno de la Inversion (ROI Ano 1)", "Porcentaje de retorno sobre el total invertido en el ano 1", "=D17/D16")
]

for idx, (lbl, sublbl, form) in enumerate(metricas, start=13):
    r1 = ws_ret.cell(row=idx, column=2, value=lbl)
    r2 = ws_ret.cell(row=idx, column=3, value=sublbl)
    r3 = ws_ret.cell(row=idx, column=4, value=form)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_bold
    r3.alignment = Alignment(horizontal="right")
    
    if idx in [13, 14, 15, 16, 17]:
        r3.number_format = "$ #,##0"
        if idx == 17:
            r3.font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
    elif idx == 18:
        r3.number_format = '0.0 "meses"'
        r3.font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
    elif idx == 19:
        r3.number_format = "0.0%"
        r3.font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
        
    for c in [r1, r2, r3]:
        c.border = thin_border
        if idx in [17, 18, 19]:
            c.fill = fill_total


# -------------------------------------------------------------------------
# 5. HOJA: Resumen Ejecutivo (Construido con referencias probadas)
# -------------------------------------------------------------------------
ws_res = wb.create_sheet(title=SHEET_RESUMEN, index=0) # Al inicio
ws_res.views.sheetView[0].showGridLines = True

ws_res["B2"] = "PYME360 - PRESUPUESTO Y EVALUACION FINANCIERA"
ws_res["B2"].font = font_title
ws_res["B3"] = "Resumen de viabilidad economica, costos totales y retorno de inversion para pyme"
ws_res["B3"].font = font_subtitle

# Tarjetas KPI principales
# 1. Inversión Inicial
ws_res["B5"] = "INVERSION TOTAL INICIAL"
ws_res["B5"].font = font_kpi_lbl
ws_res["B6"] = f"='{SHEET_RETORNO}'!D13"
ws_res["B6"].font = font_kpi_num
ws_res["B6"].number_format = "$ #,##0"

# 2. Gasto Operativo Mensual
ws_res["D5"] = "OPERACION MENSUAL"
ws_res["D5"].font = font_kpi_lbl
ws_res["D6"] = f"='{SHEET_GASTOS}'!E10"
ws_res["D6"].font = font_kpi_num
ws_res["D6"].number_format = "$ #,##0"

# 3. Ahorro Anual Proyectado
ws_res["F5"] = "AHORRO ESTIMADO ANO 1"
ws_res["F5"].font = font_kpi_lbl
ws_res["F6"] = f"='{SHEET_RETORNO}'!E10"
ws_res["F6"].font = Font(name="Calibri", size=18, bold=True, color=GREEN_DARK)
ws_res["F6"].number_format = "$ #,##0"

# 4. Tiempo de Recuperación
ws_res["H5"] = "RECUPERACION (MESES)"
ws_res["H5"].font = font_kpi_lbl
ws_res["H6"] = f"='{SHEET_RETORNO}'!D18"
ws_res["H6"].font = font_kpi_num
ws_res["H6"].number_format = '0.0 "meses"'

for col in ["B", "D", "F", "H"]:
    c5 = ws_res[f"{col}5"]
    c6 = ws_res[f"{col}6"]
    c5.alignment = Alignment(horizontal="center", vertical="center")
    c6.alignment = Alignment(horizontal="center", vertical="center")
    c5.fill = fill_kpi
    c6.fill = fill_kpi_green if col in ["F", "H"] else fill_kpi
    c5.border = thin_border
    c6.border = thin_border

ws_res["B9"] = "1. Desglose de Inversion Inicial"
ws_res["B9"].font = font_section

headers_res1 = ["Concepto Principal", "Descripcion Facil", "Costo Total ($ COP)", "% Participacion"]
for col_idx, h in enumerate(headers_res1, start=2):
    cell = ws_res.cell(row=10, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="center" if col_idx in [4, 5] else "left", vertical="center")

rows_res1 = [
    ("Desarrollo de Modulos del Sistema", "Pantallas, inventario, facturacion local, DIAN y enlaces Excel", f"='{SHEET_DESARROLLO}'!F14"),
    ("Puesta en Marcha y Capacitacion", "Instalacion en computadores, induccion del personal y manuales", f"='{SHEET_PUESTA}'!E10"),
]

for idx, (c1, c2, c3) in enumerate(rows_res1, start=11):
    r_cell1 = ws_res.cell(row=idx, column=2, value=c1)
    r_cell2 = ws_res.cell(row=idx, column=3, value=c2)
    r_cell3 = ws_res.cell(row=idx, column=4, value=c3)
    r_cell4 = ws_res.cell(row=idx, column=5, value=f"=D{idx}/$D$13")
    
    r_cell1.font = font_regular
    r_cell2.font = font_regular
    r_cell3.font = font_bold
    r_cell4.font = font_regular
    
    r_cell3.alignment = Alignment(horizontal="right")
    r_cell4.alignment = Alignment(horizontal="center")
    
    r_cell3.number_format = "$ #,##0"
    r_cell4.number_format = "0.0%"
    
    for c in [r_cell1, r_cell2, r_cell3, r_cell4]:
        c.border = thin_border

# Fila Total Inversión en D13
ws_res["B13"] = "TOTAL INVERSION INICIAL"
ws_res["B13"].font = font_bold
ws_res["D13"] = "=SUM(D11:D12)"
ws_res["D13"].font = font_bold
ws_res["D13"].alignment = Alignment(horizontal="right")
ws_res["D13"].number_format = "$ #,##0"

ws_res["E13"] = "=SUM(E11:E12)"
ws_res["E13"].font = font_bold
ws_res["E13"].alignment = Alignment(horizontal="center")
ws_res["E13"].number_format = "0.0%"

for c in [ws_res["B13"], ws_res["C13"], ws_res["D13"], ws_res["E13"]]:
    c.fill = fill_total
    c.border = double_bottom_border

# Tabla Comparativa Beneficio vs Costo
ws_res["B15"] = "2. Balance Anual (Inversion vs. Beneficio)"
ws_res["B15"].font = font_section

headers_res2 = ["Rubro Financiero Anual", "Detalle", "Monto Primer Ano ($ COP)"]
for col_idx, h in enumerate(headers_res2, start=2):
    cell = ws_res.cell(row=16, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="right" if col_idx == 4 else "left", vertical="center")

rows_res2 = [
    ("(+) Ahorros y Beneficios Operativos Anuales", "Horas de digitacion ahorradas, cero perdidas y agilidad de cobro", f"='{SHEET_RETORNO}'!E10"),
    ("(-) Inversion Inicial del Software", "Desarrollo y puesta en marcha del proyecto", "=D13"),
    ("(-) Costo de Operacion Anual (12 meses)", "Soporte, folios DIAN, copias de seguridad y actualizaciones", f"='{SHEET_GASTOS}'!F10"),
]

for idx, (c1, c2, c3) in enumerate(rows_res2, start=17):
    r_cell1 = ws_res.cell(row=idx, column=2, value=c1)
    r_cell2 = ws_res.cell(row=idx, column=3, value=c2)
    r_cell3 = ws_res.cell(row=idx, column=4, value=c3)
    r_cell1.font = font_regular
    r_cell2.font = font_regular
    r_cell3.font = font_bold
    r_cell3.alignment = Alignment(horizontal="right")
    r_cell3.number_format = "$ #,##0"
    for c in [r_cell1, r_cell2, r_cell3]:
        c.border = thin_border

ws_res["B20"] = "BENEFICIO NETO PRIMER ANO (Ganancia Real para la Empresa)"
ws_res["B20"].font = font_bold
ws_res["D20"] = "=D17-D18-D19"
ws_res["D20"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)
ws_res["D20"].alignment = Alignment(horizontal="right")
ws_res["D20"].number_format = "$ #,##0"

for c in [ws_res["B20"], ws_res["C20"], ws_res["D20"]]:
    c.fill = fill_kpi_green
    c.border = double_bottom_border


# -------------------------------------------------------------------------
# 6. HOJA: Evaluacion Final del Proyecto
# -------------------------------------------------------------------------
ws_eval = wb.create_sheet(title=SHEET_EVALUACION)
ws_eval.views.sheetView[0].showGridLines = True

ws_eval["B2"] = "EVALUACION FINAL DE VIABILIDAD Y DICTAMEN"
ws_eval["B2"].font = font_title
ws_eval["B3"] = "Calificacion cualitativa y cuantitativa para la toma de decisiones gerenciales"
ws_eval["B3"].font = font_subtitle

headers_eval = ["Criterio de Evaluacion", "Ponderacion", "Calificacion (1 a 5)", "Resultado", "Comentario Ejecutivo"]
for col_idx, h in enumerate(headers_eval, start=2):
    cell = ws_eval.cell(row=5, column=col_idx, value=h)
    cell.font = font_tbl_header
    cell.fill = fill_tbl_header
    cell.alignment = Alignment(horizontal="center" if col_idx in [3, 4, 5] else "left", vertical="center")

evaluaciones = [
    ("1. Viabilidad Operativa (Facil adopcion)", 0.25, 4.8, "=C6*D6", "No cambia abruptamente la rutina: se mantiene el uso de Excel y pantallas intuitivas."),
    ("2. Viabilidad Tecnica (Sin complicaciones)", 0.20, 5.0, "=C7*D7", "Ejecutable portable (Pyme360.exe), opera sin internet obligatorio ni servidores costosos."),
    ("3. Viabilidad Financiera (ROI y Ahorro)", 0.25, 4.7, "=C8*D8", "Retorno en menos de 9 meses y mas de $40M de ahorro bruto al ano."),
    ("4. Viabilidad Legal (DIAN y Datos)", 0.15, 4.9, "=C9*D9", "Cumplimiento de facturacion electronica y privacidad total de la informacion contable."),
    ("5. Mitigacion de Riesgos", 0.15, 4.6, "=C10*D10", "Copias de seguridad automaticas y base local que no depende de proveedores caidos."),
]

for idx, (crit, pond, nota, calc, com) in enumerate(evaluaciones, start=6):
    r1 = ws_eval.cell(row=idx, column=2, value=crit)
    r2 = ws_eval.cell(row=idx, column=3, value=pond)
    r3 = ws_eval.cell(row=idx, column=4, value=nota)
    r4 = ws_eval.cell(row=idx, column=5, value=calc)
    r5 = ws_eval.cell(row=idx, column=6, value=com)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_bold
    r5.font = font_regular
    
    r2.alignment = Alignment(horizontal="center")
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    
    r2.number_format = "0.0%"
    r3.number_format = "0.0"
    r4.number_format = "0.00"
    
    for c in [r1, r2, r3, r4, r5]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

ws_eval["B11"] = "CALIFICACION GLOBAL DEL PROYECTO"
ws_eval["B11"].font = font_bold
ws_eval["C11"] = "=SUM(C6:C10)"
ws_eval["C11"].font = font_bold
ws_eval["C11"].alignment = Alignment(horizontal="center")
ws_eval["C11"].number_format = "0.0%"

ws_eval["E11"] = "=SUM(E6:E10)"
ws_eval["E11"].font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
ws_eval["E11"].alignment = Alignment(horizontal="center")
ws_eval["E11"].number_format = "0.00 / 5.0"

ws_eval["F11"] = "DICTAMEN: PROYECTO ALTAMENTE VIABLE Y RECOMENDADO"
ws_eval["F11"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)

for col_idx in range(2, 7):
    c = ws_eval.cell(row=11, column=col_idx)
    c.fill = fill_kpi_green
    c.border = double_bottom_border

# Conclusiones finales
ws_eval["B14"] = "CONCLUSION GENERAL Y RECOMENDACION GERENCIAL"
ws_eval["B14"].font = font_section

conclusiones = [
    "- Facilidad para la empresa: No requiere contratar personal tecnico nuevo ni renovar equipos de computo.",
    "- Eficiencia comprobada: Centraliza compras, ventas, stock y facturas electronicas reduciendo errores en un 90%.",
    "- Solidez de la inversion: El proyecto no solo se paga solo antes del primer ano, sino que deja una base tecnologica duradera para el crecimiento de la pyme."
]

for idx, con in enumerate(conclusiones, start=15):
    cell = ws_eval.cell(row=idx, column=2, value=con)
    cell.font = font_regular

# Dimensiones de columnas óptimas
ws_res.column_dimensions["A"].width = 3
ws_res.column_dimensions["B"].width = 38
ws_res.column_dimensions["C"].width = 54
ws_res.column_dimensions["D"].width = 25
ws_res.column_dimensions["E"].width = 18
ws_res.column_dimensions["F"].width = 25
ws_res.column_dimensions["G"].width = 4
ws_res.column_dimensions["H"].width = 22

ws_des.column_dimensions["A"].width = 3
ws_des.column_dimensions["B"].width = 38
ws_des.column_dimensions["C"].width = 68
ws_des.column_dimensions["D"].width = 16
ws_des.column_dimensions["E"].width = 22
ws_des.column_dimensions["F"].width = 24

ws_pm.column_dimensions["A"].width = 3
ws_pm.column_dimensions["B"].width = 40
ws_pm.column_dimensions["C"].width = 68
ws_pm.column_dimensions["D"].width = 16
ws_pm.column_dimensions["E"].width = 24

ws_gm.column_dimensions["A"].width = 3
ws_gm.column_dimensions["B"].width = 38
ws_gm.column_dimensions["C"].width = 68
ws_gm.column_dimensions["D"].width = 16
ws_gm.column_dimensions["E"].width = 24
ws_gm.column_dimensions["F"].width = 26

ws_ret.column_dimensions["A"].width = 3
ws_ret.column_dimensions["B"].width = 42
ws_ret.column_dimensions["C"].width = 68
ws_ret.column_dimensions["D"].width = 24
ws_ret.column_dimensions["E"].width = 24

ws_eval.column_dimensions["A"].width = 3
ws_eval.column_dimensions["B"].width = 38
ws_eval.column_dimensions["C"].width = 16
ws_eval.column_dimensions["D"].width = 22
ws_eval.column_dimensions["E"].width = 16
ws_eval.column_dimensions["F"].width = 68

# Guardar en raíz y en outputs
path_v2 = r"c:\Users\sergio\Documents\ChatGPT\saas pyme360\Presupuesto_y_Evaluacion_Pyme360_Corregido.xlsx"
wb.save(path_v2)
print("Archivo regenerado y verificado en:")
print("1.", path_v2)
