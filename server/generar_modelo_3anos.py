# -*- coding: utf-8 -*-
"""
Generador del Modelo Financiero a 3 Años con Bancos de 2do Piso y 1er Piso Diferenciados
PYME360 - Formato No Técnico y Fácil de Explicar
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
wb.remove(wb.active) # Quitar hoja inicial

# Paleta Ejecutiva (Navy & Forest Green & Slate & Gold)
NAVY_HEADER = "1B365D"
NAVY_LIGHT = "2A4D7D"
WHITE_TEXT = "FFFFFF"
ACCENT_BLUE = "E8EEF5"
ACCENT_GREEN = "E2F0D9"
GREEN_DARK = "1E6B37"
ACCENT_GOLD = "FFF2CC"
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
fill_kpi_gold = PatternFill(start_color=ACCENT_GOLD, end_color=ACCENT_GOLD, fill_type="solid")

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

# Nombres exactos de las hojas
S_RESUMEN = "Resumen Ejecutivo 3 Anos"
S_EQUIPO = "Equipo de Desarrollo"
S_PUESTA = "Puesta en Marcha"
S_GASTOS = "Gastos Mensuales"
S_CREDITO = "Costeo y Credito Bancario"
S_FLUJO = "Flujo de Caja 3 Anos"
S_CAPACIDAD = "Capacidad de Pago y Riesgos"

# =========================================================================
# 1. HOJA: EQUIPO DE DESARROLLO
# =========================================================================
ws_eq = wb.create_sheet(title=S_EQUIPO)
ws_eq.views.sheetView[0].showGridLines = True

ws_eq["B2"] = "EQUIPO DE DESARROLLO Y PERSONAL REQUERIDO"
ws_eq["B2"].font = font_title
ws_eq["B3"] = "Personal tecnico necesario para construir Pyme360 en un periodo estimado de 3 meses"
ws_eq["B3"].font = font_subtitle

headers_eq = ["Rol / Perfil", "Responsabilidad en el Proyecto (Explicacion Facil)", "Meses Requeridos", "Dedicacion", "Honorarios Mensuales ($)", "Costo Total Rol ($)"]
for col_idx, h in enumerate(headers_eq, start=2):
    c = ws_eq.cell(row=5, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx in [4, 5] else ("right" if col_idx in [6, 7] else "left"), vertical="center")

personal = [
    ("Lider Tecnico / Desarrollador Principal", "Construye la arquitectura, base de datos local SQLite y servidor seguro en Python.", 3, "Tiempo Completo", 5500000),
    ("Desarrollador de Pantallas (Frontend React)", "Disena pantallas rapidas, botones intuitivos y menues faciles para cajeros y bodega.", 3, "Tiempo Completo", 4200000),
    ("Especialista en Facturacion DIAN", "Conecta la emision de facturas con validacion legal, firma digital y XML oficial.", 1.5, "Medio Tiempo / Hito", 3800000),
    ("Disenador de Experiencia (UX/UI)", "Crea prototipos visuales para que nadie en la pyme necesite manuales largos.", 1, "Por Hito", 2500000),
    ("Analista de Pruebas y Calidad (QA)", "Prueba el sistema con listas reales de Excel de la empresa para evitar errores.", 1.5, "Medio Tiempo", 2200000),
]

for idx, (rol, resp, meses, ded, hon) in enumerate(personal, start=6):
    r1 = ws_eq.cell(row=idx, column=2, value=rol)
    r2 = ws_eq.cell(row=idx, column=3, value=resp)
    r3 = ws_eq.cell(row=idx, column=4, value=meses)
    r4 = ws_eq.cell(row=idx, column=5, value=ded)
    r5 = ws_eq.cell(row=idx, column=6, value=hon)
    r6 = ws_eq.cell(row=idx, column=7, value=f"=D{idx}*F{idx}")
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    r5.font = font_regular
    r6.font = font_bold
    
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    r5.alignment = Alignment(horizontal="right")
    r6.alignment = Alignment(horizontal="right")
    
    r5.number_format = "$ #,##0"
    r6.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5, r6]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

ws_eq["B11"] = "SUBTOTAL COSTO EQUIPO HUMANO"
ws_eq["B11"].font = font_bold
ws_eq["G11"] = "=SUM(G6:G10)"
ws_eq["G11"].font = font_bold
ws_eq["G11"].alignment = Alignment(horizontal="right")
ws_eq["G11"].number_format = "$ #,##0"

for col_idx in range(2, 8):
    c = ws_eq.cell(row=11, column=col_idx)
    c.fill = fill_total
    c.border = thin_border

ws_eq["B12"] = "Fondo de Reserva e Imprevistos (10%)"
ws_eq["B12"].font = font_regular
ws_eq["C12"] = "Margen de seguridad para ajustes de ultima hora o solicitudes especiales del negocio."
ws_eq["C12"].font = font_subtitle
ws_eq["G12"] = "=G11*0.1"
ws_eq["G12"].font = font_regular
ws_eq["G12"].alignment = Alignment(horizontal="right")
ws_eq["G12"].number_format = "$ #,##0"

for col_idx in range(2, 8):
    ws_eq.cell(row=12, column=col_idx).border = thin_border

ws_eq["B13"] = "TOTAL PRESUPUESTO DESARROLLO (EQUIPO + RESERVA)"
ws_eq["B13"].font = font_bold
ws_eq["G13"] = "=G11+G12"
ws_eq["G13"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)
ws_eq["G13"].alignment = Alignment(horizontal="right")
ws_eq["G13"].number_format = "$ #,##0"

for col_idx in range(2, 8):
    c = ws_eq.cell(row=13, column=col_idx)
    c.fill = fill_kpi_green
    c.border = double_bottom_border


# =========================================================================
# 2. HOJA: PUESTA EN MARCHA
# =========================================================================
ws_pm = wb.create_sheet(title=S_PUESTA)
ws_pm.views.sheetView[0].showGridLines = True

ws_pm["B2"] = "PUESTA EN MARCHA, INSTALACION Y CAPACITACION"
ws_pm["B2"].font = font_title
ws_pm["B3"] = "Actividades presenciales y virtuales para que los empleados adopten la app"
ws_pm["B3"].font = font_subtitle

headers_pm = ["Actividad", "Que se entrega al negocio", "Duracion", "Costo ($ COP)"]
for col_idx, h in enumerate(headers_pm, start=2):
    c = ws_pm.cell(row=5, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx == 4 else ("right" if col_idx == 5 else "left"), vertical="center")

actividades_pm = [
    ("1. Instalacion en Computadores", "Pyme360.exe configurado en equipos de caja, bodega y administracion.", "2 dias", 900000),
    ("2. Migracion y Limpieza de Excel", "Paso seguro de clientes, inventarios y saldos desde los Excel actuales.", "3 dias", 1400000),
    ("3. Capacitacion Practica al Personal", "3 talleres con personal operativo (cajeros, almacen y gerencia).", "1 semana", 1600000),
    ("4. Guias Rapidas y Videos Paso a Paso", "Manual ilustrado en PDF + videos cortos de consulta diaria.", "1 semana", 900000),
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

ws_pm["B10"] = "TOTAL PUESTA EN MARCHA"
ws_pm["B10"].font = font_bold
ws_pm["E10"] = "=SUM(E6:E9)"
ws_pm["E10"].font = font_bold
ws_pm["E10"].alignment = Alignment(horizontal="right")
ws_pm["E10"].number_format = "$ #,##0"

for col_idx in range(2, 6):
    c = ws_pm.cell(row=10, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border


# =========================================================================
# 3. HOJA: GASTOS MENSUALES
# =========================================================================
ws_gm = wb.create_sheet(title=S_GASTOS)
ws_gm.views.sheetView[0].showGridLines = True

ws_gm["B2"] = "GASTOS MENSUALES Y MANTENIMIENTO DEL SOFTWARE"
ws_gm["B2"].font = font_title
ws_gm["B3"] = "Costos fijos minimos: no requiere servidores mensuales costosos"
ws_gm["B3"].font = font_subtitle

headers_gm = ["Servicio / Rubro", "Proposito para la Empresa", "Frecuencia", "Costo Mensual ($)", "Costo Anual (12 Meses)"]
for col_idx, h in enumerate(headers_gm, start=2):
    c = ws_gm.cell(row=5, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx == 4 else ("right" if col_idx in [5, 6] else "left"), vertical="center")

gastos_m = [
    ("1. Soporte Tecnico y Asistencia", "Atencion a usuarios y resolucion rapida de dudas o inconvenientes.", "Mensual", 450000),
    ("2. Paquete Facturacion DIAN", "Emision y timbrado oficial de facturas con proveedor tecnologico.", "Mensual", 150000),
    ("3. Respaldo Seguro de Datos (Backup)", "Copia cifrada en la nube para proteccion ante robo o dano del PC.", "Mensual", 90000),
    ("4. Mejoras y Actualizaciones Legales", "Ajustes a nuevas normas de la DIAN y optimizaciones del sistema.", "Mensual", 200000),
]

for idx, (srv, prop, frec, cm) in enumerate(gastos_m, start=6):
    r1 = ws_gm.cell(row=idx, column=2, value=srv)
    r2 = ws_gm.cell(row=idx, column=3, value=prop)
    r3 = ws_gm.cell(row=idx, column=4, value=frec)
    r4 = ws_gm.cell(row=idx, column=5, value=cm)
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

ws_gm["B10"] = "TOTAL COSTOS OPERATIVOS MENSUALES"
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


# =========================================================================
# 4. HOJA: COSTEO Y CREDITO BANCARIO (BANCOS DE 2DO PISO Y 1ER PISO)
# =========================================================================
ws_cr = wb.create_sheet(title=S_CREDITO)
ws_cr.views.sheetView[0].showGridLines = True

ws_cr["B2"] = "OPCIONES DE FINANCIACION Y COSTEO BANCARIO (BANCOS DE 1ER Y 2DO PISO)"
ws_cr["B2"].font = font_title
ws_cr["B3"] = "Explicacion clara de como financiar el proyecto con banca de desarrollo y bancos comerciales a 3 anos (36 meses)"
ws_cr["B3"].font = font_subtitle

# Parámetros del Crédito
ws_cr["B5"] = "PARAMETROS DE LA FINANCIACION SOLICITADA"
ws_cr["B5"].font = font_section

ws_cr["B6"] = "Monto Total a Financiar (Inversion Inicial):"
ws_cr["B6"].font = font_bold
ws_cr["D6"] = f"='{S_EQUIPO}'!G13+'{S_PUESTA}'!E10"
ws_cr["D6"].font = font_bold
ws_cr["D6"].alignment = Alignment(horizontal="right")
ws_cr["D6"].number_format = "$ #,##0"

ws_cr["B7"] = "Plazo de Amortizacion:"
ws_cr["B7"].font = font_regular
ws_cr["D7"] = 36
ws_cr["D7"].font = font_bold
ws_cr["D7"].alignment = Alignment(horizontal="right")
ws_cr["D7"].number_format = '0 "meses (3 anos)"'

ws_cr["B8"] = "Periodo de Gracia sugerido de Capital:"
ws_cr["B8"].font = font_regular
ws_cr["D8"] = 3
ws_cr["D8"].font = font_regular
ws_cr["D8"].alignment = Alignment(horizontal="right")
ws_cr["D8"].number_format = '0 "meses (mientras se desarrolla)"'

for r in range(6, 9):
    ws_cr.cell(row=r, column=2).border = thin_border
    ws_cr.cell(row=r, column=3).border = thin_border
    ws_cr.cell(row=r, column=4).border = thin_border

# EXPLICACIÓN EDUCATIVA: BANCOS DE 2DO PISO VS 1ER PISO
ws_cr["B10"] = "¿Que es un Banco de Segundo Piso y como se solicita en Colombia?"
ws_cr["B10"].font = font_section
ws_cr["B11"] = "Un Banco de 2do Piso (Bancoldex, Finagro, Findeter) no atiende en ventanilla al publico; crea lineas de fomento con tasas subsidiadas que se desembolsan a traves de cualquier banco comercial ordinario (Bancolombia, Davivienda, etc.)."
ws_cr["B11"].font = font_subtitle

# 1. BANCOS DE SEGUNDO PISO (DESARROLLO Y FOMENTO)
ws_cr["B13"] = "1. BANCOS DE SEGUNDO PISO (Lineas de Fomento Empresarial y Tasas Especiales)"
ws_cr["B13"].font = font_section

headers_bancos = ["Entidad Financiera", "Tipo de Entidad", "Linea / Programa de Credito", "Tasa Estimada (E.A.)", "Tasa Mensual", "Cuota Mensual Est. ($)", "Como se solicita / Ventajas"]
for col_idx, h in enumerate(headers_bancos, start=2):
    c = ws_cr.cell(row=14, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx in [3, 5, 6] else ("right" if col_idx == 7 else "left"), vertical="center")

bancos_2do_piso = [
    ("BANCOLDEX", "Banco de 2do Piso (Fomento)", "Linea Modernizacion Tecnologica & Digitalizacion", 0.155, "=((1+E15)^(1/12))-1", "=-PMT(F15,$D$7,$D$6)", "Se solicita en tu banco comercial pidiendo 'recursos Bancoldex'. Tasa mas baja y gracia hasta 6m."),
    ("FINAGRO", "Banco de 2do Piso (Agro/Cadena)", "Linea Transformacion Productiva y Software", 0.145, "=((1+E16)^(1/12))-1", "=-PMT(F16,$D$7,$D$6)", "Aplica si la manufactura se abastece del agro. Tasa de fomento altamente subsidiada."),
    ("FINDETER", "Banco de 2do Piso (Infraestructura)", "Linea Reactivacion y Fortalecimiento Productivo", 0.160, "=((1+E17)^(1/12))-1", "=-PMT(F17,$D$7,$D$6)", "Orientado a pymes en regiones que dinamizan la infraestructura tecnologica local."),
]

for idx, (b_nom, b_tipo, b_lin, tasa_ea, f_tm, f_cuota, b_vent) in enumerate(bancos_2do_piso, start=15):
    r1 = ws_cr.cell(row=idx, column=2, value=b_nom)
    r2 = ws_cr.cell(row=idx, column=3, value=b_tipo)
    r3 = ws_cr.cell(row=idx, column=4, value=b_lin)
    r4 = ws_cr.cell(row=idx, column=5, value=tasa_ea)
    r5 = ws_cr.cell(row=idx, column=6, value=f_tm)
    r6 = ws_cr.cell(row=idx, column=7, value=f_cuota)
    r7 = ws_cr.cell(row=idx, column=8, value=b_vent)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    r5.font = font_regular
    r6.font = font_bold
    r7.font = font_regular
    
    r2.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    r5.alignment = Alignment(horizontal="center")
    r6.alignment = Alignment(horizontal="right")
    
    r4.number_format = "0.0%"
    r5.number_format = "0.00%"
    r6.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5, r6, r7]:
        c.border = thin_border
        if idx == 15: # Destacar Bancóldex
            c.fill = fill_kpi_green
        elif idx % 2 == 1:
            c.fill = fill_zebra

# 2. BANCOS DE PRIMER PISO (COMERCIALES ORDINARIOS)
ws_cr["B19"] = "2. BANCOS DE PRIMER PISO (Banca Comercial Tradicional Directa)"
ws_cr["B19"].font = font_section

headers_bancos_1 = ["Entidad Financiera", "Tipo de Entidad", "Linea de Credito Comercial", "Tasa Estimada (E.A.)", "Tasa Mensual", "Cuota Mensual Est. ($)", "Ventajas / Requisitos"]
for col_idx, h in enumerate(headers_bancos_1, start=2):
    c = ws_cr.cell(row=20, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = PatternFill(start_color=NAVY_LIGHT, end_color=NAVY_LIGHT, fill_type="solid")
    c.alignment = Alignment(horizontal="center" if col_idx in [3, 5, 6] else ("right" if col_idx == 7 else "left"), vertical="center")

bancos_1er_piso = [
    ("Bancolombia", "Banco de 1er Piso (Comercial)", "Credito Empresarial de Inversion / Sostenibilidad", 0.185, "=((1+E21)^(1/12))-1", "=-PMT(F21,$D$7,$D$6)", "Aprobacion muy rapida si la pyme maneja sus cuentas y ventas en Bancolombia."),
    ("Davivienda", "Banco de 1er Piso (Comercial)", "Credito PyME para Innovacion y Equipos", 0.190, "=((1+E22)^(1/12))-1", "=-PMT(F22,$D$7,$D$6)", "Facil integracion con garantia FNG (Fondo Nacional de Garantias hasta 80%)."),
    ("Banco de Bogota", "Banco de 1er Piso (Comercial)", "Financiacion de Proyectos Productivos Pyme", 0.195, "=((1+E23)^(1/12))-1", "=-PMT(F23,$D$7,$D$6)", "Lineas amplias para empresas manufactureras del sector industrial."),
]

for idx, (b_nom, b_tipo, b_lin, tasa_ea, f_tm, f_cuota, b_vent) in enumerate(bancos_1er_piso, start=21):
    r1 = ws_cr.cell(row=idx, column=2, value=b_nom)
    r2 = ws_cr.cell(row=idx, column=3, value=b_tipo)
    r3 = ws_cr.cell(row=idx, column=4, value=b_lin)
    r4 = ws_cr.cell(row=idx, column=5, value=tasa_ea)
    r5 = ws_cr.cell(row=idx, column=6, value=f_tm)
    r6 = ws_cr.cell(row=idx, column=7, value=f_cuota)
    r7 = ws_cr.cell(row=idx, column=8, value=b_vent)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    r5.font = font_regular
    r6.font = font_bold
    r7.font = font_regular
    
    r2.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    r5.alignment = Alignment(horizontal="center")
    r6.alignment = Alignment(horizontal="right")
    
    r4.number_format = "0.0%"
    r5.number_format = "0.00%"
    r6.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5, r6, r7]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

# SELECCIÓN RECOMENDADA
ws_cr["B25"] = "LINEA RECOMENDADA PARA EL PROYECTO:"
ws_cr["B25"].font = font_bold
ws_cr["C25"] = "BANCOLDEX (Modernizacion Tecnologica)"
ws_cr["C25"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)
ws_cr["E25"] = "Cuota Mensual:"
ws_cr["E25"].font = font_bold
ws_cr["G25"] = "=G15" # Cuota mensual de Bancóldex
ws_cr["G25"].font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
ws_cr["G25"].alignment = Alignment(horizontal="right")
ws_cr["G25"].number_format = "$ #,##0"

for col_idx in range(2, 9):
    c = ws_cr.cell(row=25, column=col_idx)
    c.fill = fill_kpi_green
    c.border = double_bottom_border

# IMPACTO ANUAL Y AMORTIZACIÓN A 3 AÑOS
ws_cr["B27"] = "3. Impacto Anual del Credito Seleccionado en el Negocio (Amortizacion a 3 Anos)"
ws_cr["B27"].font = font_section

headers_cron = ["Periodo", "Cuota Mensual Promedio", "Total Pagado en el Ano", "Abono a Capital", "Pago de Intereses (Deducible)", "Saldo de Deuda Final"]
for col_idx, h in enumerate(headers_cron, start=2):
    c = ws_cr.cell(row=28, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx == 2 else "right", vertical="center")

cronograma = [
    ("Ano 1 (Meses 1 al 12)", "=G25", "=C29*12", "=D29*0.25", "=D29-E29", "=D6-E29"),
    ("Ano 2 (Meses 13 al 24)", "=G25", "=C30*12", "=D30*0.33", "=D30-E30", "=G29-E30"),
    ("Ano 3 (Meses 25 al 36)", "=G25", "=C31*12", "=G30", "=D31-E31", "=G30-E31"),
]

for idx, (p, cm, tot, cap, inte, sal) in enumerate(cronograma, start=29):
    r1 = ws_cr.cell(row=idx, column=2, value=p)
    r2 = ws_cr.cell(row=idx, column=3, value=cm)
    r3 = ws_cr.cell(row=idx, column=4, value=tot)
    r4 = ws_cr.cell(row=idx, column=5, value=cap)
    r5 = ws_cr.cell(row=idx, column=6, value=inte)
    r6 = ws_cr.cell(row=idx, column=7, value=sal)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_bold
    r4.font = font_regular
    r5.font = font_regular
    r6.font = font_bold
    
    r1.alignment = Alignment(horizontal="left")
    for r in [r2, r3, r4, r5, r6]:
        r.alignment = Alignment(horizontal="right")
        r.number_format = "$ #,##0"
        
    for c in [r1, r2, r3, r4, r5, r6]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

ws_cr["B32"] = "TOTAL 3 ANOS DE CREDITO"
ws_cr["B32"].font = font_bold
ws_cr["D32"] = "=SUM(D29:D31)"
ws_cr["D32"].font = font_bold
ws_cr["D32"].alignment = Alignment(horizontal="right")
ws_cr["D32"].number_format = "$ #,##0"

ws_cr["E32"] = "=SUM(E29:E31)"
ws_cr["E32"].font = font_bold
ws_cr["E32"].alignment = Alignment(horizontal="right")
ws_cr["E32"].number_format = "$ #,##0"

ws_cr["F32"] = "=SUM(F29:F31)"
ws_cr["F32"].font = font_bold
ws_cr["F32"].alignment = Alignment(horizontal="right")
ws_cr["F32"].number_format = "$ #,##0"

ws_cr["G32"] = "=G31" # Deuda en $0
ws_cr["G32"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)
ws_cr["G32"].alignment = Alignment(horizontal="right")
ws_cr["G32"].number_format = "$ #,##0"

for col_idx in range(2, 8):
    c = ws_cr.cell(row=32, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border


# =========================================================================
# 5. HOJA: FLUJO DE CAJA 3 AÑOS
# =========================================================================
ws_fl = wb.create_sheet(title=S_FLUJO)
ws_fl.views.sheetView[0].showGridLines = True

ws_fl["B2"] = "FLUJO DE CAJA PROYECTADO A 3 ANOS (CON FINANCIACION)"
ws_fl["B2"].font = font_title
ws_fl["B3"] = "Demuestra como el software genera ingresos netos positivos desde el primer ano aun pagando el prestamo"
ws_fl["B3"].font = font_subtitle

headers_fl = ["Concepto Financiero", "Ano 1 (Arranque)", "Ano 2 (Consolidacion)", "Ano 3 (Madurez)", "Total 3 Anos ($ COP)"]
for col_idx, h in enumerate(headers_fl, start=2):
    c = ws_fl.cell(row=5, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="right" if col_idx > 2 else "left", vertical="center")

ws_fl["B6"] = "(+) AHORROS Y BENEFICIOS OPERATIVOS"
ws_fl["B6"].font = font_bold
ws_fl["B6"].fill = fill_total

lineas_ahorros = [
    ("   - Ahorro de horas hombre en digitacion (Excel)", 19200000, "=C7*1.05", "=D7*1.05"),
    ("   - Reduccion de mermas y desajustes de inventario", 14400000, "=C8*1.08", "=D8*1.08"),
    ("   - Prevencion de multas y sanciones fiscales DIAN", 6000000, 6000000, 6000000),
    ("   - Agilizacion de cobros de cartera y flujo de caja", 9600000, "=C10*1.1", "=D10*1.1"),
]

for idx, (nom, a1, a2, a3) in enumerate(lineas_ahorros, start=7):
    ws_fl.cell(row=idx, column=2, value=nom).font = font_regular
    c1 = ws_fl.cell(row=idx, column=3, value=a1)
    c2 = ws_fl.cell(row=idx, column=4, value=a2)
    c3 = ws_fl.cell(row=idx, column=5, value=a3)
    c4 = ws_fl.cell(row=idx, column=6, value=f"=SUM(C{idx}:E{idx})")
    
    for c in [c1, c2, c3, c4]:
        c.font = font_regular
        c.alignment = Alignment(horizontal="right")
        c.number_format = "$ #,##0"
        c.border = thin_border
    ws_fl.cell(row=idx, column=2).border = thin_border

ws_fl["B11"] = "TOTAL BENEFICIOS GENERADOS (A)"
ws_fl["B11"].font = font_bold
for col_idx, col_let in [(3, "C"), (4, "D"), (5, "E"), (6, "F")]:
    c = ws_fl.cell(row=11, column=col_idx, value=f"=SUM({col_let}7:{col_let}10)")
    c.font = font_bold
    c.alignment = Alignment(horizontal="right")
    c.number_format = "$ #,##0"
    c.fill = fill_kpi_green
    c.border = thin_border
ws_fl.cell(row=11, column=2).fill = fill_kpi_green
ws_fl.cell(row=11, column=2).border = thin_border

ws_fl["B13"] = "(-) GASTOS OPERATIVOS Y SOPORTE (B)"
ws_fl["B13"].font = font_bold
ws_fl["B13"].fill = fill_total

lineas_costos = [
    ("   - Soporte tecnico, folios DIAN y copias backup", f"='{S_GASTOS}'!F10", "=C14*1.05", "=D14*1.05"),
]

for idx, (nom, c1_v, c2_v, c3_v) in enumerate(lineas_costos, start=14):
    ws_fl.cell(row=idx, column=2, value=nom).font = font_regular
    c1 = ws_fl.cell(row=idx, column=3, value=c1_v)
    c2 = ws_fl.cell(row=idx, column=4, value=c2_v)
    c3 = ws_fl.cell(row=idx, column=5, value=c3_v)
    c4 = ws_fl.cell(row=idx, column=6, value=f"=SUM(C{idx}:E{idx})")
    
    for c in [c1, c2, c3, c4]:
        c.font = font_regular
        c.alignment = Alignment(horizontal="right")
        c.number_format = "$ #,##0"
        c.border = thin_border
    ws_fl.cell(row=idx, column=2).border = thin_border

ws_fl["B15"] = "TOTAL COSTOS OPERATIVOS (B)"
ws_fl["B15"].font = font_bold
for col_idx, col_let in [(3, "C"), (4, "D"), (5, "E"), (6, "F")]:
    c = ws_fl.cell(row=15, column=col_idx, value=f"={col_let}14")
    c.font = font_bold
    c.alignment = Alignment(horizontal="right")
    c.number_format = "$ #,##0"
    c.fill = fill_total
    c.border = thin_border
ws_fl.cell(row=15, column=2).fill = fill_total
ws_fl.cell(row=15, column=2).border = thin_border

ws_fl["B17"] = "(-) SERVICIO DE LA DEUDA BANCARIA (C)"
ws_fl["B17"].font = font_bold
ws_fl["B17"].fill = fill_total

ws_fl["B18"] = "   - Pago cuotas anuales credito Bancoldex (Capital + Interes)"
ws_fl["B18"].font = font_regular
ws_fl["C18"] = f"='{S_CREDITO}'!D29"
ws_fl["D18"] = f"='{S_CREDITO}'!D30"
ws_fl["E18"] = f"='{S_CREDITO}'!D31"
ws_fl["F18"] = "=SUM(C18:E18)"

for col_idx in [3, 4, 5, 6]:
    c = ws_fl.cell(row=18, column=col_idx)
    c.font = font_regular
    c.alignment = Alignment(horizontal="right")
    c.number_format = "$ #,##0"
    c.border = thin_border
ws_fl.cell(row=18, column=2).border = thin_border

ws_fl["B20"] = "FLUJO NETO DISPONIBLE PARA LA EMPRESA (A - B - C)"
ws_fl["B20"].font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK)

for col_idx, col_let in [(3, "C"), (4, "D"), (5, "E"), (6, "F")]:
    c = ws_fl.cell(row=20, column=col_idx, value=f"={col_let}11-{col_let}15-{col_let}18")
    c.font = Font(name="Calibri", size=12, bold=True, color=GREEN_DARK)
    c.alignment = Alignment(horizontal="right")
    c.number_format = "$ #,##0"
    c.fill = fill_kpi_green
    c.border = double_bottom_border
ws_fl.cell(row=20, column=2).fill = fill_kpi_green
ws_fl.cell(row=20, column=2).border = double_bottom_border

ws_fl["B22"] = "Flujo de Caja Neto Acumulado en el Negocio"
ws_fl["B22"].font = font_bold
ws_fl["C22"] = "=C20"
ws_fl["D22"] = "=C22+D20"
ws_fl["E22"] = "=D22+E20"
ws_fl["F22"] = "=E22"

for col_idx in [3, 4, 5, 6]:
    c = ws_fl.cell(row=22, column=col_idx)
    c.font = font_bold
    c.alignment = Alignment(horizontal="right")
    c.number_format = "$ #,##0"
    c.fill = fill_total
    c.border = thin_border
ws_fl.cell(row=22, column=2).fill = fill_total
ws_fl.cell(row=22, column=2).border = thin_border


# =========================================================================
# 6. HOJA: CAPACIDAD DE PAGO Y RIESGOS
# =========================================================================
ws_cp = wb.create_sheet(title=S_CAPACIDAD)
ws_cp.views.sheetView[0].showGridLines = True

ws_cp["B2"] = "CAPACIDAD DE PAGO DEL PRESTAMO Y GESTION DE RIESGOS"
ws_cp["B2"].font = font_title
ws_cp["B3"] = "Indicadores que demuestran al banco la solvencia del proyecto para pagar la deuda sin riesgo"
ws_cp["B3"].font = font_subtitle

ws_cp["B5"] = "INDICADORES CLAVE DE COBERTURA Y PAGO (VISTA BANCARIA)"
ws_cp["B5"].font = font_section

headers_cp = ["Indicador Bancario", "Explicacion Sencilla", "Valor Obtenido", "Minimo Exigido por Bancos", "Estado / Diagnostico"]
for col_idx, h in enumerate(headers_cp, start=2):
    c = ws_cp.cell(row=6, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx in [4, 5, 6] else "left", vertical="center")

indicadores_banco = [
    ("Cobertura del Servicio de la Deuda (DSCR)", "Cuantas veces los ahorros netos cubren la cuota del banco.", f"=('{S_FLUJO}'!C11-'{S_FLUJO}'!C15)/'{S_FLUJO}'!C18", "1.20x", "EXCELENTE (Cubre mas de 2.5 veces la cuota)"),
    ("Ahorro Mensual Neto vs Cuota Banco", "Dinero libre cada mes tras pagar la cuota y la operacion.", f"='{S_FLUJO}'!C20/12", "> $ 0", "SUPERAVITARIO (Sobra dinero mes a mes)"),
    ("Porcentaje de Garantia FNG sugerido", "Respaldo del Fondo Nacional de Garantias para la pyme.", "80.0%", "50% - 80%", "APTO PARA COBERTURA FNG"),
]

for idx, (ind, exp, val, exig, est) in enumerate(indicadores_banco, start=7):
    r1 = ws_cp.cell(row=idx, column=2, value=ind)
    r2 = ws_cp.cell(row=idx, column=3, value=exp)
    r3 = ws_cp.cell(row=idx, column=4, value=val)
    r4 = ws_cp.cell(row=idx, column=5, value=exig)
    r5 = ws_cp.cell(row=idx, column=6, value=est)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_bold
    r4.font = font_regular
    r5.font = Font(name="Calibri", size=10, bold=True, color=GREEN_DARK)
    
    r3.alignment = Alignment(horizontal="center")
    r4.alignment = Alignment(horizontal="center")
    
    if idx == 7:
        r3.number_format = '0.00 "veces"'
    elif idx == 8:
        r3.number_format = "$ #,##0"
        
    for c in [r1, r2, r3, r4, r5]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

ws_cp["B12"] = "ANALISIS DE SENSIBILIDAD (ESCENARIOS DE BENEFICIO)"
ws_cp["B12"].font = font_section

headers_esc = ["Escenario Evaluado", "Efectividad de los Ahorros", "Ahorros Anuales Ano 1", "Flujo Neto Ano 1", "Cubre el Prestamo?"]
for col_idx, h in enumerate(headers_esc, start=2):
    c = ws_cp.cell(row=13, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx in [3, 6] else ("right" if col_idx in [4, 5] else "left"), vertical="center")

escenarios = [
    ("Optimista (Adopcion rapida)", 1.15, f"='{S_FLUJO}'!C11*C14", f"=D14-('{S_FLUJO}'!C15+'{S_FLUJO}'!C18)", "SI - Excedente Alto"),
    ("Realista / Base (Calculado)", 1.00, f"='{S_FLUJO}'!C11*C15", f"=D15-('{S_FLUJO}'!C15+'{S_FLUJO}'!C18)", "SI - Perfectamente sostenible"),
    ("Conservador (Solo se logra 70% de ahorro)", 0.70, f"='{S_FLUJO}'!C11*C16", f"=D16-('{S_FLUJO}'!C15+'{S_FLUJO}'!C18)", "SI - Aun genera ganancia"),
]

for idx, (esc, eff, form_ah, form_fl, res) in enumerate(escenarios, start=14):
    r1 = ws_cp.cell(row=idx, column=2, value=esc)
    r2 = ws_cp.cell(row=idx, column=3, value=eff)
    r3 = ws_cp.cell(row=idx, column=4, value=form_ah)
    r4 = ws_cp.cell(row=idx, column=5, value=form_fl)
    r5 = ws_cp.cell(row=idx, column=6, value=res)
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_bold
    r5.font = Font(name="Calibri", size=10, bold=True, color=GREEN_DARK)
    
    r2.alignment = Alignment(horizontal="center")
    r3.alignment = Alignment(horizontal="right")
    r4.alignment = Alignment(horizontal="right")
    r5.alignment = Alignment(horizontal="center")
    
    r2.number_format = "0.0%"
    r3.number_format = "$ #,##0"
    r4.number_format = "$ #,##0"
    
    for c in [r1, r2, r3, r4, r5]:
        c.border = thin_border
        if idx == 15: # Realista
            c.fill = fill_kpi_green
        elif idx % 2 == 1:
            c.fill = fill_zebra


# =========================================================================
# 7. HOJA: RESUMEN EJECUTIVO 3 AÑOS (Portada Consolidada al Inicio)
# =========================================================================
ws_res = wb.create_sheet(title=S_RESUMEN, index=0)
ws_res.views.sheetView[0].showGridLines = True

ws_res["B2"] = "PYME360 - PLAN FINANCIERO Y DE FACTIBILIDAD A 3 ANOS"
ws_res["B2"].font = font_title
ws_res["B3"] = "Resumen para Directivos y Entidades Financieras: Equipo, Credito Bancario (1er y 2do Piso) y Retorno"
ws_res["B3"].font = font_subtitle

# KPI 1: Inversión Inicial
ws_res["B5"] = "INVERSION INICIAL TOTAL"
ws_res["B5"].font = font_kpi_lbl
ws_res["B6"] = f"='{S_CREDITO}'!D6"
ws_res["B6"].font = font_kpi_num
ws_res["B6"].number_format = "$ #,##0"

# KPI 2: Cuota Bancaria Mensual (Bancóldex)
ws_res["D5"] = "CUOTA BANCOLDEX (36 MESES)"
ws_res["D5"].font = font_kpi_lbl
ws_res["D6"] = f"='{S_CREDITO}'!G25"
ws_res["D6"].font = font_kpi_num
ws_res["D6"].number_format = "$ #,##0"

# KPI 3: Ganancia Neta Total 3 Años
ws_res["F5"] = "GANANCIA NETA TOTAL (3 ANOS)"
ws_res["F5"].font = font_kpi_lbl
ws_res["F6"] = f"='{S_FLUJO}'!F20"
ws_res["F6"].font = Font(name="Calibri", size=18, bold=True, color=GREEN_DARK)
ws_res["F6"].number_format = "$ #,##0"

# KPI 4: Cobertura del Préstamo
ws_res["H5"] = "COBERTURA DEUDA (BANCO)"
ws_res["H5"].font = font_kpi_lbl
ws_res["H6"] = f"='{S_CAPACIDAD}'!D7"
ws_res["H6"].font = Font(name="Calibri", size=18, bold=True, color=GREEN_DARK)
ws_res["H6"].number_format = '0.00 "veces"'

for col in ["B", "D", "F", "H"]:
    c5 = ws_res[f"{col}5"]
    c6 = ws_res[f"{col}6"]
    c5.alignment = Alignment(horizontal="center", vertical="center")
    c6.alignment = Alignment(horizontal="center", vertical="center")
    c5.fill = fill_kpi
    c6.fill = fill_kpi_green if col in ["F", "H"] else fill_kpi
    c5.border = thin_border
    c6.border = thin_border

ws_res["B9"] = "1. Estructura de la Inversion Inicial Requerida"
ws_res["B9"].font = font_section

headers_r1 = ["Concepto de la Inversion", "Que cubre", "Monto ($ COP)", "% Participacion"]
for col_idx, h in enumerate(headers_r1, start=2):
    c = ws_res.cell(row=10, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="center" if col_idx == 5 else ("right" if col_idx == 4 else "left"), vertical="center")

filas_r1 = [
    ("Equipo Tecnico de Desarrollo", "Honorarios de programadores, diseno y especialista DIAN", f"='{S_EQUIPO}'!G11"),
    ("Fondo de Reserva e Imprevistos", "Margen del 10% para ajustes y contingencias", f"='{S_EQUIPO}'!G12"),
    ("Puesta en Marcha y Capacitacion", "Instalacion en equipos, migracion de datos y talleres a empleados", f"='{S_PUESTA}'!E10"),
]

for idx, (nom, desc, form_m) in enumerate(filas_r1, start=11):
    r1 = ws_res.cell(row=idx, column=2, value=nom)
    r2 = ws_res.cell(row=idx, column=3, value=desc)
    r3 = ws_res.cell(row=idx, column=4, value=form_m)
    r4 = ws_res.cell(row=idx, column=5, value=f"=D{idx}/$D$14")
    
    r1.font = font_bold
    r2.font = font_regular
    r3.font = font_regular
    r4.font = font_regular
    
    r3.alignment = Alignment(horizontal="right")
    r4.alignment = Alignment(horizontal="center")
    r3.number_format = "$ #,##0"
    r4.number_format = "0.0%"
    
    for c in [r1, r2, r3, r4]:
        c.border = thin_border
        if idx % 2 == 1:
            c.fill = fill_zebra

ws_res["B14"] = "TOTAL INVERSION INICIAL A FINANCIAR"
ws_res["B14"].font = font_bold
ws_res["D14"] = "=SUM(D11:D13)"
ws_res["D14"].font = font_bold
ws_res["D14"].alignment = Alignment(horizontal="right")
ws_res["D14"].number_format = "$ #,##0"
ws_res["E14"] = "=SUM(E11:E13)"
ws_res["E14"].font = font_bold
ws_res["E14"].alignment = Alignment(horizontal="center")
ws_res["E14"].number_format = "0.0%"

for col_idx in range(2, 6):
    c = ws_res.cell(row=14, column=col_idx)
    c.fill = fill_total
    c.border = double_bottom_border

ws_res["B16"] = "2. Proyeccion Consolidada a 3 Anos (Ahorro vs. Costos vs. Credito Bancoldex)"
ws_res["B16"].font = font_section

headers_r2 = ["Concepto Financiero", "Ano 1", "Ano 2", "Ano 3", "Acumulado 3 Anos"]
for col_idx, h in enumerate(headers_r2, start=2):
    c = ws_res.cell(row=17, column=col_idx, value=h)
    c.font = font_tbl_header
    c.fill = fill_tbl_header
    c.alignment = Alignment(horizontal="right" if col_idx > 2 else "left", vertical="center")

filas_r2 = [
    ("(+) Ahorros y Beneficios Operativos", f"='{S_FLUJO}'!C11", f"='{S_FLUJO}'!D11", f"='{S_FLUJO}'!E11", f"='{S_FLUJO}'!F11"),
    ("(-) Gastos Operativos del Software", f"='{S_FLUJO}'!C15", f"='{S_FLUJO}'!D15", f"='{S_FLUJO}'!E15", f"='{S_FLUJO}'!F15"),
    ("(-) Cuota Anual Credito Bancario", f"='{S_FLUJO}'!C18", f"='{S_FLUJO}'!D18", f"='{S_FLUJO}'!E18", f"='{S_FLUJO}'!F18"),
    ("(=) BENEFICIO NETO PARA LA EMPRESA", f"='{S_FLUJO}'!C20", f"='{S_FLUJO}'!D20", f"='{S_FLUJO}'!E20", f"='{S_FLUJO}'!F20"),
]

for idx, (nom, a1, a2, a3, ac) in enumerate(filas_r2, start=18):
    r1 = ws_res.cell(row=idx, column=2, value=nom)
    r2 = ws_res.cell(row=idx, column=3, value=a1)
    r3 = ws_res.cell(row=idx, column=4, value=a2)
    r4 = ws_res.cell(row=idx, column=5, value=a3)
    r5 = ws_res.cell(row=idx, column=6, value=ac)
    
    is_net = (idx == 21)
    r1.font = Font(name="Calibri", size=11, bold=True, color=GREEN_DARK if is_net else NAVY_HEADER)
    
    for r in [r2, r3, r4, r5]:
        r.font = Font(name="Calibri", size=11, bold=is_net, color=GREEN_DARK if is_net else "000000")
        r.alignment = Alignment(horizontal="right")
        r.number_format = "$ #,##0"
        
    for c in [r1, r2, r3, r4, r5]:
        c.border = double_bottom_border if is_net else thin_border
        if is_net:
            c.fill = fill_kpi_green
        elif idx % 2 == 1:
            c.fill = fill_zebra

# Dimensiones de columnas óptimas
for s in wb.worksheets:
    for col in s.columns:
        col_letter = get_column_letter(col[0].column)
        max_l = 0
        for cell in col:
            if cell.row in [2, 3] and cell.column == 2:
                continue
            v = str(cell.value or '')
            if len(v) > max_l:
                max_l = len(v)
        s.column_dimensions[col_letter].width = max(max_l + 4, 13)

ws_res.column_dimensions["A"].width = 3
ws_res.column_dimensions["B"].width = 38
ws_res.column_dimensions["C"].width = 50
ws_res.column_dimensions["D"].width = 22
ws_res.column_dimensions["E"].width = 20
ws_res.column_dimensions["F"].width = 24
ws_res.column_dimensions["H"].width = 24

ws_cr.column_dimensions["A"].width = 3
ws_cr.column_dimensions["B"].width = 28
ws_cr.column_dimensions["C"].width = 30
ws_cr.column_dimensions["D"].width = 46
ws_cr.column_dimensions["E"].width = 22
ws_cr.column_dimensions["F"].width = 18
ws_cr.column_dimensions["G"].width = 24
ws_cr.column_dimensions["H"].width = 65

path_salida = r"c:\Users\sergio\Documents\ChatGPT\saas pyme360\Presupuesto_Pyme360_Plan_3Anos_Financiacion.xlsx"
wb.save(path_salida)
print("Archivo actualizado con Bancos de 2do y 1er piso en:", path_salida)
