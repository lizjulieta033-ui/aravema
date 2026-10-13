// Categorías de Contabilidad General
const CATEGORIAS_GASTOS = [
    "SUNAT / Impuestos",
    "Pago Flete Tercero / Vehículo Externo",
    "Honorarios Contador / Asesoría",
    "Sueldos Personal / Planilla Admin",
    "Combustible C5T-850",
    "Peajes",
    "Viáticos Conductor",
    "Mantenimiento / Taller",
    "Alquileres / Servicios (Luz, Agua)",
    "Otros Gastos Administrativos"
];

const CATEGORIAS_INGRESOS = [
    "Fletes / Servicios Transporte",
    "Préstamo Bancario / Financiamiento",
    "Aporte de Capital / Socios",
    "Otros Ingresos"
];

// Datos iniciales
const guiasIniciales = [
    {
        fecha: "2026-10-13",
        tipoVehiculo: "Propio (C5T-850)",
        costoTercero: 0.00,
        guiaRemitente: "EG07-00000091",
        guiaTransportista: "EG03-00000001",
        conductor: "Flores Carbajal Ayrton Andre",
        jabas: 0,
        detalle: "ají",
        pesoBruto: "4390 KGM",
        puntoPartida: "Cabeza de toro-Independencia-Pisco-Ica",
        puntoLlegada: "Mz. C lote. 16 Urb. Parque Industrial - Ica",
        destinatario: "Agro industria San Antonio SR LTDA",
        tarifaSinIgv: 550.00,
        estiba: 0.00,
        subtotal: 550.00,
        totalAFacturar: 649.00,
        estadoFacturacion: "NO FACTURADO",
        estadoPago: "PENDIENTE"
    }
];

const gastosIniciales = [];
const viaticosIniciales = [];
const mantenimientoInicial = [
    { placa: "C5T-850 (Volvo Aravema)", desc: "Mantenimiento General Preventivo", taller: "Taller Ica", estado: "Operativo" }
];
const asistenciaInicial = [
    { fecha: "2026-10-13", conductor: "Flores Carbajal Ayrton Andre", estado: "Laborado / Ruta", obs: "Unidad C5T-850 - Ruta Pisco - Ica" }
];

document.addEventListener('DOMContentLoaded', function () {
    if (!localStorage.getItem('aravema_guias')) localStorage.setItem('aravema_guias', JSON.stringify(guiasIniciales));
    if (!localStorage.getItem('aravema_gastos')) localStorage.setItem('aravema_gastos', JSON.stringify(gastosIniciales));
    if (!localStorage.getItem('aravema_viaticos')) localStorage.setItem('aravema_viaticos', JSON.stringify(viaticosIniciales));
    if (!localStorage.getItem('aravema_mantenimiento')) localStorage.setItem('aravema_mantenimiento', JSON.stringify(mantenimientoInicial));
    if (!localStorage.getItem('aravema_asistencia')) localStorage.setItem('aravema_asistencia', JSON.stringify(asistenciaInicial));
    if (!localStorage.getItem('aravema_pagos_choferes')) localStorage.setItem('aravema_pagos_choferes', JSON.stringify({}));

    const fechaServicioInput = document.getElementById('fechaServicio');
    if (fechaServicioInput) fechaServicioInput.value = new Date().toISOString().split('T')[0];

    actualizarCategoriasMovimiento();

    document.getElementById('numJabas')?.addEventListener('input', calcularEstibaAutomatica);
    document.getElementById('datosDestinatario')?.addEventListener('input', autocompletarTarifaCliente);

    renderizarTodo();

    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            cambiarSeccion(this.getAttribute('data-section'));
        });
    });

    const formNuevoViaje = document.getElementById('form-nuevo-viaje');
    if (formNuevoViaje) {
        formNuevoViaje.addEventListener('submit', function (e) {
            e.preventDefault();

            const tarifaSinIgv = parseFloat(document.getElementById('tarifaSinIgv').value) || 0;
            const estiba = parseFloat(document.getElementById('montoEstiba').value) || 0;
            const subtotal = tarifaSinIgv + estiba;
            const totalAFacturar = subtotal * 1.18;

            const tipoVehiculo = document.getElementById('tipoVehiculo').value;
            const costoTercero = tipoVehiculo.includes('Tercero') ? (parseFloat(document.getElementById('costoTercero').value) || 0) : 0;

            const nuevaGuia = {
                fecha: document.getElementById('fechaServicio').value || '-',
                tipoVehiculo: tipoVehiculo,
                costoTercero: costoTercero,
                guiaRemitente: document.getElementById('guiaRemitente').value.trim() || '-',
                guiaTransportista: document.getElementById('guiaTransportista').value.trim() || '-',
                conductor: document.getElementById('nombreConductor').value.trim() || '-',
                jabas: parseInt(document.getElementById('numJabas').value) || 0,
                detalle: document.getElementById('detalleProducto').value.trim() || '-',
                pesoBruto: document.getElementById('pesoBruto').value.trim() || '-',
                puntoPartida: document.getElementById('puntoPartida').value.trim() || '-',
                puntoLlegada: document.getElementById('puntoLlegada').value.trim() || '-',
                destinatario: document.getElementById('datosDestinatario').value.trim() || '-',
                tarifaSinIgv: tarifaSinIgv,
                estiba: estiba,
                subtotal: subtotal,
                totalAFacturar: totalAFacturar,
                estadoFacturacion: document.getElementById('estadoFacturacion').value,
                estadoPago: document.getElementById('estadoPago').value
            };

            const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
            guias.unshift(nuevaGuia);
            localStorage.setItem('aravema_guias', JSON.stringify(guias));

            if (costoTercero > 0) {
                const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];
                gastos.unshift({
                    tipo: 'Gasto',
                    concepto: `Pago Flete Tercero - ${nuevaGuia.conductor} (Guía: ${nuevaGuia.guiaRemitente})`,
                    monto: costoTercero,
                    categoria: 'Pago Flete Tercero / Vehículo Externo'
                });
                localStorage.setItem('aravema_gastos', JSON.stringify(gastos));
            }

            renderizarTodo();
            formNuevoViaje.reset();
            toggleVehiculoTercero();
            bootstrap.Modal.getInstance(document.getElementById('nuevoViajeModal'))?.hide();
            mostrarAlerta('¡Servicio de transporte guardado con éxito!', 'success');
        });
    }

    const formAsistencia = document.getElementById('form-nueva-asistencia');
    if (formAsistencia) {
        formAsistencia.addEventListener('submit', function (e) {
            e.preventDefault();
            const nuevaAsist = {
                fecha: document.getElementById('asistenciaFecha').value,
                conductor: document.getElementById('asistenciaConductor').value.trim(),
                estado: document.getElementById('asistenciaEstado').value,
                obs: document.getElementById('asistenciaObs').value.trim() || '-'
            };

            const asistencias = JSON.parse(localStorage.getItem('aravema_asistencia')) || [];
            asistencias.unshift(nuevaAsist);
            localStorage.setItem('aravema_asistencia', JSON.stringify(asistencias));

            renderizarTodo();
            formAsistencia.reset();
            bootstrap.Modal.getInstance(document.getElementById('nuevaAsistenciaModal'))?.hide();
            mostrarAlerta('¡Asistencia registrada correctamente!', 'success');
        });
    }

    const formGasto = document.getElementById('form-registrar-gasto');
    if (formGasto) {
        formGasto.addEventListener('submit', function (e) {
            e.preventDefault();
            const nuevoGasto = {
                tipo: document.getElementById('tipoMovimiento').value,
                concepto: document.getElementById('conceptoGasto').value.trim(),
                monto: parseFloat(document.getElementById('montoGasto').value) || 0,
                categoria: document.getElementById('categoriaGasto').value
            };

            const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];
            gastos.unshift(nuevoGasto);
            localStorage.setItem('aravema_gastos', JSON.stringify(gastos));

            renderizarTodo();
            formGasto.reset();
            mostrarAlerta('¡Movimiento contable registrado con éxito!', 'success');
        });
    }

    const formViatico = document.getElementById('form-nuevo-viatico');
    if (formViatico) {
        formViatico.addEventListener('submit', function (e) {
            e.preventDefault();
            const nuevoViatico = {
                conductor: document.getElementById('viaticoConductor').value.trim(),
                monto: parseFloat(document.getElementById('viaticoMonto').value) || 0
            };
            const viaticos = JSON.parse(localStorage.getItem('aravema_viaticos')) || [];
            viaticos.unshift(nuevoViatico);
            localStorage.setItem('aravema_viaticos', JSON.stringify(viaticos));

            renderizarTodo();
            formViatico.reset();
            bootstrap.Modal.getInstance(document.getElementById('nuevoPagoModal'))?.hide();
            mostrarAlerta('¡Viático registrado correctamente!', 'success');
        });
    }

    const formMant = document.getElementById('form-nuevo-mantenimiento');
    if (formMant) {
        formMant.addEventListener('submit', function (e) {
            e.preventDefault();
            const nuevoMant = {
                placa: document.getElementById('mantPlaca').value.trim(),
                desc: document.getElementById('mantDesc').value.trim(),
                taller: document.getElementById('mantTaller').value.trim(),
                estado: document.getElementById('mantEstado').value
            };
            const mantList = JSON.parse(localStorage.getItem('aravema_mantenimiento')) || [];
            mantList.unshift(nuevoMant);
            localStorage.setItem('aravema_mantenimiento', JSON.stringify(mantList));

            renderizarTodo();
            formMant.reset();
            bootstrap.Modal.getInstance(document.getElementById('nuevoMantenimientoModal'))?.hide();
            mostrarAlerta('¡Mantenimiento programado con éxito!', 'warning');
        });
    }
});

function toggleVehiculoTercero() {
    const tipo = document.getElementById('tipoVehiculo')?.value;
    const divTercero = document.getElementById('divCostoTercero');
    if (!divTercero) return;

    if (tipo && tipo.includes('Tercero')) {
        divTercero.classList.remove('d-none');
    } else {
        divTercero.classList.add('d-none');
        const costoInput = document.getElementById('costoTercero');
        if (costoInput) costoInput.value = '0.00';
    }
}

function actualizarCategoriasMovimiento() {
    const tipo = document.getElementById('tipoMovimiento')?.value || 'Gasto';
    const comboCat = document.getElementById('categoriaGasto');
    if (!comboCat) return;

    const lista = (tipo === 'Ingreso') ? CATEGORIAS_INGRESOS : CATEGORIAS_GASTOS;
    comboCat.innerHTML = lista.map(c => `<option value="${c}">${c}</option>`).join('');
}

function calcularEstibaAutomatica() {
    const numJabasInput = document.getElementById('numJabas');
    const montoEstibaInput = document.getElementById('montoEstiba');
    if (!numJabasInput || !montoEstibaInput) return;

    const jabas = parseInt(numJabasInput.value) || 0;
    
    if (jabas > 0 && jabas <= 150) {
        montoEstibaInput.value = (70.00).toFixed(2);
    } else if (jabas > 150) {
        montoEstibaInput.value = (140.00).toFixed(2);
    } else {
        montoEstibaInput.value = (0.00).toFixed(2);
    }

    calcularTotalesFlete();
}

function autocompletarTarifaCliente() {
    const clienteInput = document.getElementById('datosDestinatario')?.value.toLowerCase() || '';
    const tarifaInput = document.getElementById('tarifaSinIgv');

    if (!tarifaInput) return;

    if (clienteInput.includes('aisa') || clienteInput.includes('san antonio')) {
        tarifaInput.value = (550.00).toFixed(2);
    }

    calcularTotalesFlete();
}

function calcularTotalesFlete() {
    const tarifa = parseFloat(document.getElementById('tarifaSinIgv').value) || 0;
    const estiba = parseFloat(document.getElementById('montoEstiba').value) || 0;
    const subtotal = tarifa + estiba;
    const totalConIgv = subtotal * 1.18;
    document.getElementById('totalAFacturar').value = totalConIgv.toFixed(2);
}

function renderizarTodo() {
    renderizarGuias();
    renderizarGastos();
    renderizarPrefacturacion();
    renderizarChoferes();
    renderizarAsistencia();
    renderizarMantenimiento();
    actualizarKPIs();
}

function renderizarGuias() {
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    const tbodyPanel = document.getElementById('tabla-guias-body');
    const tbodyCompleta = document.getElementById('tabla-guias-completa-body');
    let html = '';

    if (guias.length === 0) {
        html = `<tr><td colspan="10" class="text-center text-muted p-3">No hay servicios registrados.</td></tr>`;
    } else {
        guias.forEach((g, index) => {
            const fecha = g.fecha || '-';
            const vehiculo = g.tipoVehiculo || 'Propio (C5T-850)';
            const esTercero = vehiculo.includes('Tercero');
            const guiaRem = g.guiaRemitente || '-';
            const guiaTrans = g.guiaTransportista || '-';
            const conductor = g.conductor || '-';
            const destinatario = g.destinatario || '-';
            const partida = g.puntoPartida || '-';
            const llegada = g.puntoLlegada || '-';
            const jabas = g.jabas ? `${g.jabas} jabas` : '-';
            const detalle = g.detalle || '-';
            const peso = g.pesoBruto || '-';
            const tarifaSinIgv = parseFloat(g.tarifaSinIgv || 0);
            const totalAFacturar = parseFloat(g.totalAFacturar || (tarifaSinIgv * 1.18) || 0);
            const estFact = g.estadoFacturacion || 'NO FACTURADO';
            const estPago = g.estadoPago || 'PENDIENTE';

            html += `
                <tr>
                    <td class="fw-semibold">${fecha}</td>
                    <td>
                        <span class="badge ${esTercero ? 'bg-warning text-dark' : 'bg-primary'} d-block mb-1">${vehiculo}</span>
                        ${esTercero ? `<small class="text-danger fw-bold">Pago Tercero: S/ ${(g.costoTercero || 0).toFixed(2)}</small>` : ''}
                    </td>
                    <td>
                        <span class="badge bg-light text-dark border d-block mb-1">Rem: ${guiaRem}</span>
                        <span class="badge bg-secondary d-block">Trans: ${guiaTrans}</span>
                    </td>
                    <td class="fw-bold">${conductor}</td>
                    <td>
                        <div class="fw-bold text-dark">${destinatario}</div>
                        <small class="text-muted d-block">${partida} ➔ ${llegada}</small>
                    </td>
                    <td>
                        <div>${jabas} (${detalle})</div>
                        <small class="text-primary fw-bold">${peso}</small>
                    </td>
                    <td>
                        <div class="small text-muted">Sin IGV: S/ ${tarifaSinIgv.toFixed(2)}</div>
                        <div class="fw-bold text-success">Total: S/ ${totalAFacturar.toFixed(2)}</div>
                    </td>
                    <td>
                        <select class="form-select form-select-sm badge-select ${estFact === 'FACTURADO' ? 'bg-success text-white' : 'bg-warning text-dark'}" onchange="cambiarEstadoGuiaFactura(${index}, this.value)">
                            <option value="NO FACTURADO" ${estFact === 'NO FACTURADO' ? 'selected' : ''}>NO FACTURADO</option>
                            <option value="FACTURADO" ${estFact === 'FACTURADO' ? 'selected' : ''}>FACTURADO</option>
                        </select>
                    </td>
                    <td>
                        <select class="form-select form-select-sm badge-select ${estPago === 'PAGADO' ? 'bg-success text-white' : 'bg-danger text-white'}" onchange="cambiarEstadoGuiaPago(${index}, this.value)">
                            <option value="PENDIENTE" ${estPago === 'PENDIENTE' ? 'selected' : ''}>PENDIENTE</option>
                            <option value="PAGADO" ${estPago === 'PAGADO' ? 'selected' : ''}>PAGADO</option>
                        </select>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarGuia(${index})"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    }
    if (tbodyPanel) tbodyPanel.innerHTML = html;
    if (tbodyCompleta) tbodyCompleta.innerHTML = html;
}

function renderizarGastos() {
    const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];
    const tbodyGastos = document.getElementById('tabla-gastos-body');
    const balanceEl = document.getElementById('balance-caja');
    if (!tbodyGastos) return;

    let html = '';
    let totalIngresosExtras = 0;
    let totalGastosGrales = 0;

    gastos.forEach((g, index) => {
        const esIngreso = g.tipo === 'Ingreso';
        const monto = parseFloat(g.monto) || 0;
        
        let categoriaTexto = g.categoria || 'Gastos Administrativos';

        if (esIngreso) totalIngresosExtras += monto;
        else totalGastosGrales += monto;

        html += `
            <tr>
                <td>
                    <span class="badge ${esIngreso ? 'bg-success' : 'bg-danger'}">${g.tipo || 'Gasto'}</span>
                </td>
                <td class="fw-semibold text-dark">${g.concepto}</td>
                <td><span class="badge bg-secondary">${categoriaTexto}</span></td>
                <td class="fw-bold ${esIngreso ? 'text-success' : 'text-danger'}">
                    ${esIngreso ? '+' : '-'} S/ ${monto.toFixed(2)}
                </td>
                <td><button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarGasto(${index})"><i class="bi bi-trash"></i></button></td>
            </tr>
        `;
    });

    tbodyGastos.innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">No hay movimientos registrados.</td></tr>`;

    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    const totalFletesPagados = guias
        .filter(g => g.estadoPago === 'PAGADO')
        .reduce((acc, curr) => acc + (parseFloat(curr.totalAFacturar) || 0), 0);

    const balanceTotal = (totalFletesPagados + totalIngresosExtras) - totalGastosGrales;

    if (balanceEl) {
        balanceEl.textContent = `Balance de Caja: S/ ${balanceTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;
    }
}

function renderizarPrefacturacion() {
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    const tbody = document.getElementById('tabla-prefacturacion-body');
    const totalPrefacturaEl = document.getElementById('total-prefactura');
    if (!tbody) return;

    const resumen = {};
    let totalGeneral = 0;

    guias.forEach(g => {
        const cliente = g.destinatario || 'Cliente General';
        if (!resumen[cliente]) {
            resumen[cliente] = { cantidad: 0, subtotal: 0, total: 0, guiasDetalle: [] };
        }
        resumen[cliente].cantidad += 1;
        const sub = parseFloat(g.subtotal || g.tarifaSinIgv || 0);
        const tot = parseFloat(g.totalAFacturar || (sub * 1.18) || 0);
        resumen[cliente].subtotal += sub;
        resumen[cliente].total += tot;
        totalGeneral += tot;
        resumen[cliente].guiasDetalle.push(g);
    });

    let html = '';
    let indexCliente = 0;
    for (const [cliente, data] of Object.entries(resumen)) {
        window[`prefactura_data_${indexCliente}`] = { cliente, ...data };

        html += `
            <tr>
                <td class="fw-bold text-dark">${cliente}</td>
                <td>${data.cantidad} viajes</td>
                <td>S/ ${data.subtotal.toFixed(2)}</td>
                <td class="fw-bold text-success">S/ ${data.total.toFixed(2)}</td>
                <td><span class="badge bg-info text-dark">LISTO PARA PRE-FACTURAR</span></td>
                <td>
                    <button class="btn btn-sm btn-success fw-bold shadow-sm" onclick="generarDocumentoPrefactura(${indexCliente})">
                        <i class="bi bi-printer me-1"></i> Imprimir Pre-factura
                    </button>
                </td>
            </tr>
        `;
        indexCliente++;
    }
    tbody.innerHTML = html || `<tr><td colspan="6" class="text-center text-muted">No hay datos de pre-facturación.</td></tr>`;
    if (totalPrefacturaEl) totalPrefacturaEl.textContent = `Total Acumulado: S/ ${totalGeneral.toFixed(2)}`;
}

function generarDocumentoPrefactura(idIndex) {
    const info = window[`prefactura_data_${idIndex}`];
    if (!info) return;

    const cliente = info.cliente;
    const fechaHoy = new Date().toLocaleDateString('es-PE');

    let filasDetalle = '';
    info.guiasDetalle.forEach((g) => {
        const subVal = parseFloat(g.subtotal || g.tarifaSinIgv || 0);
        filasDetalle += `
            <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #000;">1.00</td>
                <td style="text-align: center; padding: 6px; border: 1px solid #000;">UNIDAD</td>
                <td style="padding: 6px; border: 1px solid #000;">
                    SERVICIO TRASLADO DE ${ (g.detalle || 'CARGA AGRÍCOLA').toUpperCase() }, DE ${ (g.puntoPartida || 'ICA').toUpperCase() } A ${ (g.puntoLlegada || 'DESTINO').toUpperCase() }, SEGÚN GUÍA DE REMISIÓN REMITENTE N° ${ g.guiaRemitente || '-' } Y GUÍA TRANSPORTISTA N° ${ g.guiaTransportista || '-' }, EN EL VEHÍCULO CON PLACA: ${ (g.tipoVehiculo || 'C5T-850').toUpperCase() }
                </td>
                <td style="text-align: right; padding: 6px; border: 1px solid #000;">${subVal.toFixed(2)}</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #000;">0.00</td>
            </tr>
        `;
    });

    const igv = info.subtotal * 0.18;
    const detra = info.total * 0.04;

    const win = window.open('', '_blank', 'width=950,height=800');
    win.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Pre-Factura - ${cliente}</title>
            <style>
                @page { size: A4; margin: 15mm; }
                body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; margin: 0; padding: 10px; }
                .top-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
                .company-box { width: 58%; }
                .company-box h2 { font-size: 18px; margin: 0 0 4px 0; font-weight: bold; }
                .company-box p { margin: 2px 0; font-size: 10px; }
                .ruc-box { width: 38%; border: 2px solid #000; text-align: center; padding: 8px; border-radius: 4px; }
                .ruc-box h3 { margin: 3px 0; font-size: 14px; }
                .info-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                .info-table td { padding: 4px; vertical-align: top; }
                .grid-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                .grid-table th { border: 1px solid #000; background-color: #e9ecef; padding: 6px; text-align: center; font-size: 10px; }
                .bottom-section { display: flex; justify-content: space-between; align-items: flex-start; }
                .detraccion-box { width: 58%; border: 1px solid #000; padding: 8px; font-size: 9.5px; border-radius: 4px; }
                .totals-table { width: 38%; border-collapse: collapse; }
                .totals-table td { border: 1px solid #000; padding: 4px 8px; font-size: 10px; }
                .text-bold { font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="top-header">
                <div class="company-box">
                    <h2>ARAVEMA GROUP S.A.C.</h2>
                    <p>OTR. TIERRA NUEVA MZA. F LOTE. 13</p>
                    <p>PARCONA - ICA - ICA</p>
                    <p>Servicio de Transporte Terrestre de Carga</p>
                </div>
                <div class="ruc-box">
                    <h3>PRE-FACTURA ELECTRÓNICA</h3>
                    <p class="text-bold" style="margin:2px 0;">RUC: 20615364984</p>
                    <p style="margin:2px 0; color: #d9534f; font-weight:bold;">BORRADOR NO TRIBUTARIO</p>
                </div>
            </div>

            <table class="info-table">
                <tr>
                    <td style="width: 15%;" class="text-bold">Señor(es):</td>
                    <td style="width: 50%;">${cliente}</td>
                    <td style="width: 15%;" class="text-bold">Fecha Emisión:</td>
                    <td style="width: 20%;">${fechaHoy}</td>
                </tr>
                <tr>
                    <td class="text-bold">Forma de pago:</td>
                    <td>Contado</td>
                    <td class="text-bold">Moneda:</td>
                    <td>SOLES</td>
                </tr>
            </table>

            <table class="grid-table">
                <thead>
                    <tr>
                        <th style="width: 8%;">Cantidad</th>
                        <th style="width: 12%;">Unidad Medida</th>
                        <th style="width: 56%;">Descripción</th>
                        <th style="width: 12%;">Valor Unitario</th>
                        <th style="width: 12%;">ICBPER</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasDetalle}
                </tbody>
            </table>

            <div class="bottom-section">
                <div class="detraccion-box">
                    <p class="text-bold" style="margin:0 0 4px 0;">Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central ó Servicio de Transporte de Carga</p>
                    <p style="margin:2px 0;"><strong>Bien o Servicio:</strong> 027 Servicio de transporte de carga</p>
                    <p style="margin:2px 0;"><strong>Medio de pago:</strong> 001 Depósito en cuenta</p>
                    <p style="margin:2px 0;"><strong>Porcentaje de detracción:</strong> 4.00%</p>
                    <p style="margin:2px 0;"><strong>Nro. Cta. Banco de la Nación:</strong> 00601308010</p>
                    <p style="margin:2px 0;"><strong>Monto detracción:</strong> S/ ${detra.toFixed(2)}</p>
                </div>

                <table class="totals-table">
                    <tr>
                        <td class="text-bold">Sub Total Ventas:</td>
                        <td style="text-align: right;">S/ ${info.subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td class="text-bold">IGV (18%):</td>
                        <td style="text-align: right;">S/ ${igv.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td class="text-bold" style="background-color: #e9ecef;">Importe Total:</td>
                        <td class="text-bold" style="text-align: right; background-color: #e9ecef;">S/ ${info.total.toFixed(2)}</td>
                    </tr>
                </table>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                }
            </script>
        </body>
        </html>
    `);
    win.document.close();
}

function renderizarChoferes() {
    const asistencias = JSON.parse(localStorage.getItem('aravema_asistencia')) || [];
    const viaticosRegistrados = JSON.parse(localStorage.getItem('aravema_viaticos')) || [];
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    const estadosPagoChoferes = JSON.parse(localStorage.getItem('aravema_pagos_choferes')) || {};

    const tbody = document.getElementById('tabla-choferes-body');
    if (!tbody) return;

    const choferesPropios = new Set();
    guias.forEach(g => {
        const vehiculo = g.tipoVehiculo || 'Propio (C5T-850)';
        if (g.conductor && !vehiculo.includes('Tercero')) {
            choferesPropios.add(g.conductor);
        }
    });

    let html = '';

    if (choferesPropios.size === 0) {
        html = `<tr><td colspan="7" class="text-center text-muted p-3">No hay conductores de flota propia (C5T-850) registrados para planilla.</td></tr>`;
    } else {
        choferesPropios.forEach(conductor => {
            const diasLaborados = asistencias.filter(a => 
                a.conductor.toLowerCase() === conductor.toLowerCase() && 
                a.estado === 'Laborado / Ruta'
            ).length;

            let sueldoBase = 0;
            let viaticosBase = 0;

            if (diasLaborados === 0) {
                sueldoBase = 0.00;
                viaticosBase = 0.00;
            } else if (diasLaborados === 1) {
                sueldoBase = 100.00;
                viaticosBase = 0.00;
            } else if (diasLaborados > 1 && diasLaborados < 26) {
                sueldoBase = (2500.00 / 30) * diasLaborados;
                viaticosBase = (500.00 / 30) * diasLaborados;
            } else if (diasLaborados >= 26) {
                sueldoBase = 2500.00;
                viaticosBase = 500.00;
            }

            const adelantosEntregados = viaticosRegistrados
                .filter(v => v.conductor.toLowerCase() === conductor.toLowerCase())
                .reduce((acc, curr) => acc + (parseFloat(curr.monto) || 0), 0);

            const totalNetoAPagar = (sueldoBase + viaticosBase) - adelantosEntregados;
            const estadoActualPago = estadosPagoChoferes[conductor] || 'PENDIENTE';

            html += `
                <tr>
                    <td class="fw-bold text-dark"><i class="bi bi-person-fill text-primary me-2"></i>${conductor} <span class="badge bg-secondary ms-1" style="font-size: 0.7rem;">C5T-850</span></td>
                    <td><span class="badge bg-primary fs-6">${diasLaborados} días</span></td>
                    <td class="fw-semibold">S/ ${sueldoBase.toFixed(2)}</td>
                    <td class="text-muted">S/ ${viaticosBase.toFixed(2)}</td>
                    <td class="text-danger fw-semibold">- S/ ${adelantosEntregados.toFixed(2)}</td>
                    <td class="fw-bold text-success fs-6">S/ ${totalNetoAPagar.toFixed(2)}</td>
                    <td>
                        <select class="form-select form-select-sm badge-select ${estadoActualPago === 'PAGADO' ? 'bg-success text-white' : 'bg-danger text-white'}" onchange="cambiarEstadoPagoChofer('${conductor}', this.value, ${totalNetoAPagar})">
                            <option value="PENDIENTE" ${estadoActualPago === 'PENDIENTE' ? 'selected' : ''}>PENDIENTE</option>
                            <option value="PAGADO" ${estadoActualPago === 'PAGADO' ? 'selected' : ''}>PAGADO</option>
                        </select>
                    </td>
                </tr>
            `;
        });
    }

    tbody.innerHTML = html;
}

function cambiarEstadoPagoChofer(conductor, nuevoEstado, montoNeto) {
    const estadosPagoChoferes = JSON.parse(localStorage.getItem('aravema_pagos_choferes')) || {};
    estadosPagoChoferes[conductor] = nuevoEstado;
    localStorage.setItem('aravema_pagos_choferes', JSON.stringify(estadosPagoChoferes));

    if (nuevoEstado === 'PAGADO') {
        const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];
        gastos.unshift({
            tipo: 'Gasto',
            concepto: `Pago Planilla Conductor - ${conductor}`,
            monto: parseFloat(montoNeto) || 0,
            categoria: 'Sueldos Personal / Planilla Admin'
        });
        localStorage.setItem('aravema_gastos', JSON.stringify(gastos));
        mostrarAlerta(`¡Pago de planilla registrado en caja para ${conductor}!`, 'success');
    }

    renderizarTodo();
}

function renderizarAsistencia() {
    const asistencias = JSON.parse(localStorage.getItem('aravema_asistencia')) || [];
    const tbody = document.getElementById('tabla-asistencia-body');
    if (!tbody) return;

    let laborados = 0, descansos = 0, taller = 0, faltas = 0;
    let html = '';

    asistencias.forEach((a, index) => {
        if (a.estado === 'Laborado / Ruta') laborados++;
        else if (a.estado === 'Descanso') descansos++;
        else if (a.estado === 'En Taller') taller++;
        else if (a.estado === 'Falta') faltas++;

        html += `
            <tr>
                <td class="fw-semibold">${a.fecha}</td>
                <td class="fw-bold text-dark">${a.conductor}</td>
                <td><span class="badge bg-success">${a.estado}</span></td>
                <td class="text-muted small">${a.obs || '-'}</td>
                <td><button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarAsistencia(${index})"><i class="bi bi-trash"></i></button></td>
            </tr>
        `;
    });

    tbody.innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">Sin datos.</td></tr>`;
    document.getElementById('total-dias-laborados').textContent = laborados;
    document.getElementById('total-dias-descanso').textContent = descansos;
    document.getElementById('total-dias-taller').textContent = taller;
    document.getElementById('total-dias-faltas').textContent = faltas;
}

function renderizarMantenimiento() {
    const mantList = JSON.parse(localStorage.getItem('aravema_mantenimiento')) || [];
    const tbody = document.getElementById('tabla-mantenimiento-body');
    if (!tbody) return;

    let html = '';
    mantList.forEach((m, index) => {
        html += `
            <tr>
                <td class="fw-bold">${m.placa}</td>
                <td>${m.desc}</td>
                <td>${m.taller}</td>
                <td><span class="badge bg-warning text-dark">${m.estado}</span></td>
                <td><button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarMantenimiento(${index})"><i class="bi bi-trash"></i></button></td>
            </tr>
        `;
    });
    tbody.innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">Sin mantenimientos.</td></tr>`;
}

function actualizarKPIs() {
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];

    const totalIngresosFletes = guias.reduce((acc, curr) => acc + (parseFloat(curr.totalAFacturar) || 0), 0);
    const totalGastosGrales = gastos.filter(g => g.tipo !== 'Ingreso').reduce((acc, curr) => acc + (parseFloat(curr.monto) || 0), 0);
    const totalCobrado = guias.filter(g => g.estadoPago === 'PAGADO').reduce((acc, curr) => acc + (parseFloat(curr.totalAFacturar) || 0), 0);

    document.getElementById('kpi-ingresos').textContent = `S/ ${totalIngresosFletes.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-gastos').textContent = `S/ ${totalGastosGrales.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-viajes').textContent = guias.length;
    document.getElementById('kpi-completados').textContent = `S/ ${totalCobrado.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;
}

function cambiarEstadoGuiaFactura(index, nuevoEstado) {
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    if (guias[index]) {
        guias[index].estadoFacturacion = nuevoEstado;
        localStorage.setItem('aravema_guias', JSON.stringify(guias));
        renderizarTodo();
    }
}

function cambiarEstadoGuiaPago(index, nuevoEstado) {
    const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
    if (guias[index]) {
        guias[index].estadoPago = nuevoEstado;
        localStorage.setItem('aravema_guias', JSON.stringify(guias));
        renderizarTodo();
    }
}

function eliminarGuia(index) {
    if (confirm('¿Deseas eliminar este servicio?')) {
        const guias = JSON.parse(localStorage.getItem('aravema_guias')) || [];
        guias.splice(index, 1);
        localStorage.setItem('aravema_guias', JSON.stringify(guias));
        renderizarTodo();
    }
}

function eliminarAsistencia(index) {
    const asistencias = JSON.parse(localStorage.getItem('aravema_asistencia')) || [];
    asistencias.splice(index, 1);
    localStorage.setItem('aravema_asistencia', JSON.stringify(asistencias));
    renderizarTodo();
}

function eliminarGasto(index) {
    const gastos = JSON.parse(localStorage.getItem('aravema_gastos')) || [];
    gastos.splice(index, 1);
    localStorage.setItem('aravema_gastos', JSON.stringify(gastos));
    renderizarTodo();
}

function eliminarMantenimiento(index) {
    const mantList = JSON.parse(localStorage.getItem('aravema_mantenimiento')) || [];
    mantList.splice(index, 1);
    localStorage.setItem('aravema_mantenimiento', JSON.stringify(mantList));
    renderizarTodo();
}

function limpiarTodoData() {
    if (confirm('¿Estás seguro de reiniciar todos los datos?')) {
        localStorage.clear();
        location.reload();
    }
}

function cambiarSeccion(sectionId) {
    document.querySelectorAll('.content-section').forEach(sec => sec.classList.add('d-none'));
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.remove('d-none');

    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === sectionId) link.classList.add('active');
    });
}

function mostrarAlerta(mensaje, tipo) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    alertContainer.innerHTML = `
        <div class="alert alert-${tipo} alert-dismissible fade show shadow-sm" role="alert">
            <i class="bi bi-bell-fill me-2"></i> ${mensaje}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;

    setTimeout(() => {
        const alert = alertContainer.querySelector('.alert');
        if (alert) new bootstrap.Alert(alert).close();
    }, 3500);
}