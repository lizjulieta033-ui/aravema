// CONEXIÓN CON SUPABASE
const SUPABASE_URL = "https://teqqxsgxzswxlsewbmik.supabase.co";
const SUPABASE_KEY = "sb_publishable_rPrvPQAi7-jvaygPWcPdaw_PiDocX-V";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Worker de PDF.js (misma versión que el <script> de pdf.min.js en index.html)
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Categorías que usa el módulo de pagos (no se eligen a mano en Caja)
const CATEGORIA_PAGO_TERCERO = "Pago Flete Tercero / Vehículo Externo";
const CATEGORIA_ADELANTO_CHOFER = "Viáticos Conductor";
const CATEGORIA_PLANILLA_CHOFER = "Pago Conductor (Planilla)";

// Categorías de Contabilidad General (registro manual en Caja)
const CATEGORIAS_GASTOS = [
    "SUNAT / Impuestos",
    "Honorarios Contador / Asesoría",
    "Sueldos Personal / Planilla Admin",
    "Combustible C5T-850",
    "Peajes",
    "Mantenimiento / Taller",
    "Alquileres / Servicios (Luz, Agua)",
    "Otros Gastos Administrativos"
];

const CATEGORIAS_INGRESOS = [
    "Fletes sin guía registrada",
    "Préstamo Bancario / Financiamiento",
    "Aporte de Capital / Socios",
    "Otros Ingresos"
];

const ESTADOS_ASISTENCIA = {
    'Laborado / Ruta': 'bg-success',
    'Descanso': 'bg-info text-dark',
    'En Taller': 'bg-warning text-dark',
    'Falta': 'bg-danger'
};

const MODALIDADES_CHOFER = {
    QUINCENAL: 'Estable · quincenal',
    MENSUAL: 'Estable · mensual',
    DIARIO: 'Apoyo · diario'
};

// Título y subtítulo de la barra superior según la sección
const TITULOS_SECCION = {
    'section-panel': ['Panel Principal', null], // el subtítulo es el saludo
    'section-guias': ['Guías de Transporte', 'Busca y filtra todos los servicios registrados'],
    'section-prefacturacion': ['Pre-facturación', 'Lo que falta facturar y lo que falta cobrar a cada fundo'],
    'section-choferes': ['Pagos a Choferes y Terceros', 'Liquidaciones, adelantos y saldos pendientes'],
    'section-asistencia': ['Asistencia de Choferes', 'Días laborados, descansos, taller y faltas'],
    'section-bitacora': ['Bitácora de Kilometraje', 'Km diario de cochera a cochera · C5T-850'],
    'section-mantenimiento': ['Mantenimiento de Flota', 'Unidad propia C5T-850'],
    'section-ingresos-gastos': ['Contabilidad / Caja', 'Ingresos, gastos y balance general'],
    'section-usuarios': ['Usuarios', 'Perfiles con acceso al sistema']
};

// Colores de los gráficos (validados para contraste sobre fondo blanco)
const COLOR_GRAFICO_FLETES = '#2e7d32';
const COLOR_GRAFICO_FLETES_HOVER = '#4f9a2f';
const COLOR_GRAFICO_GASTOS = '#c0603a';
const COLOR_GRAFICO_GASTOS_HOVER = '#d4774f';
const COLOR_TEXTO_EJES = '#5f6b57';
const COLOR_GRILLA = '#efebe0';

// Estado de la aplicación
let USUARIO = null; // perfil del usuario conectado (tabla perfiles)
let GRAFICOS = {};       // instancias de Chart.js por id de canvas
let FILTRO_GUIAS = 'TODAS';
let DB = { guias: [], gastos: [], asistencia: [], mantenimiento: [], choferes: [], perfiles: [], bitacora: [] };
let PREFACTURAS = [];   // grupos por cliente pendientes de facturar
let POR_COBRAR = [];    // grupos por cliente facturados sin cobrar
let SALDOS_PAGO = {};   // "CHOFER|NOMBRE" / "TERCERO|NOMBRE" → saldo pendiente
let canalCambios = null;
let temporizadorRender = null;
let modoRecuperacion = false;

// -------------------------------------------------------------
// UTILIDADES
// -------------------------------------------------------------
function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texto como argumento de un onclick="...", seguro aunque tenga comillas o apóstrofes
function jsArg(valor) {
    return esc(JSON.stringify(String(valor ?? '')));
}

// Para comparar nombres sin importar mayúsculas, tildes o espacios
function normNombre(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Para guardar nombres: en mayúsculas (como en la guía SUNAT) pero conservando tildes y Ñ
function nombreGuardado(s) {
    return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function num(valor) {
    return parseFloat(valor) || 0;
}

function soles(n) {
    return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fecha de hoy en hora de Perú (yyyy-mm-dd)
function hoyLocal() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function esGuiaTercero(g) {
    return (g.tipo_vehiculo || '').includes('Tercero');
}

function estadoFacturacion(g) {
    return g.estado_facturacion || 'NO FACTURADO';
}

function estadoPagoGuia(g) {
    return g.estado_pago || 'PENDIENTE';
}

function esAdmin() {
    return USUARIO?.rol === 'ADMIN';
}

function cerrarModal(id) {
    bootstrap.Modal.getInstance(document.getElementById(id))?.hide();
}

// Muestra el error en pantalla. Si hay un modal abierto, usa alert() para que se vea encima.
function mostrarError(mensaje) {
    if (document.querySelector('.modal.show')) alert(mensaje);
    else mostrarAlerta(mensaje, 'danger');
}

// Ejecuta una operación de Supabase y avisa si falla. Devuelve true si salió bien.
async function ejecutar(operacion, mensajeError) {
    const { error } = await operacion;
    if (error) {
        console.error(error);
        mostrarError(`${mensajeError}: ${error.message}`);
        return false;
    }
    return true;
}

// -------------------------------------------------------------
// INICIO
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async function () {
    const hoy = hoyLocal();
    document.getElementById('fechaServicio').value = hoy;
    document.getElementById('asistenciaFecha').value = hoy;
    document.getElementById('fechaGasto').value = hoy;
    document.getElementById('pagoMes').value = hoy.slice(0, 7);
    document.getElementById('asistenciaMes').value = hoy.slice(0, 7);
    document.getElementById('bitacoraMes').value = hoy.slice(0, 7);
    document.getElementById('pagoPeriodo').value = Number(hoy.slice(8, 10)) <= 15 ? 'Q1' : 'Q2';

    actualizarCategoriasMovimiento();

    document.getElementById('numJabas').addEventListener('input', calcularEstibaAutomatica);
    document.getElementById('datosDestinatario').addEventListener('input', autocompletarTarifaCliente);
    document.getElementById('pdfFileinput').addEventListener('change', procesarGuiaRemitentePdf);
    document.getElementById('pagoMes').addEventListener('change', renderizarPagos);
    document.getElementById('pagoPeriodo').addEventListener('change', renderizarPagos);
    document.getElementById('asistenciaMes').addEventListener('change', renderizarAsistencia);
    document.getElementById('buscarGuia').addEventListener('input', renderizarGuias);
    document.getElementById('bitacoraMes').addEventListener('change', renderizarBitacora);
    document.getElementById('form-bitacora').addEventListener('submit', guardarBitacora);
    prepararFormularioViaje();
    document.querySelectorAll('#filtros-guia .chip-filtro').forEach(chip => {
        chip.addEventListener('click', function () {
            FILTRO_GUIAS = this.dataset.filtro;
            document.querySelectorAll('#filtros-guia .chip-filtro').forEach(c => c.classList.toggle('activo', c === this));
            renderizarGuias();
        });
    });

    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            cambiarSeccion(this.getAttribute('data-section'));
        });
    });

    document.getElementById('form-login').addEventListener('submit', iniciarSesion);
    document.getElementById('form-nuevo-viaje').addEventListener('submit', guardarViaje);
    document.getElementById('form-nueva-asistencia').addEventListener('submit', guardarAsistencia);
    document.getElementById('form-registrar-gasto').addEventListener('submit', guardarMovimientoCaja);
    document.getElementById('form-nuevo-pago').addEventListener('submit', guardarPago);
    document.getElementById('form-config-chofer').addEventListener('submit', guardarConfigChofer);
    document.getElementById('form-nuevo-mantenimiento').addEventListener('submit', guardarMantenimiento);
    document.getElementById('form-nuevo-usuario').addEventListener('submit', crearUsuario);
    document.getElementById('form-cambiar-password').addEventListener('submit', guardarNuevaPassword);

    // Enlace de "restablecer contraseña" recibido por correo
    supabaseClient.auth.onAuthStateChange((evento) => {
        if (evento === 'PASSWORD_RECOVERY') {
            modoRecuperacion = true;
            setTimeout(() => abrirCambioPassword(true), 300);
        }
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await cargarPerfilYEntrar();
    else ocultarSistema();
});

// -------------------------------------------------------------
// SESIÓN Y USUARIOS
// -------------------------------------------------------------
function mostrarErrorLogin(mensaje) {
    document.getElementById('login-error-alert').innerHTML = `
        <div class="alert alert-danger text-center py-2" role="alert">
            <i class="bi bi-exclamation-triangle-fill me-1"></i> ${esc(mensaje)}
        </div>
    `;
}

async function iniciarSesion(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        mostrarErrorLogin('Correo o contraseña incorrectos.');
        return;
    }
    document.getElementById('login-error-alert').innerHTML = '';
    document.getElementById('loginPassword').value = '';
    await cargarPerfilYEntrar();
}

async function cargarPerfilYEntrar() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { ocultarSistema(); return; }

    const { data: perfil } = await supabaseClient.from('perfiles').select('*').eq('id', user.id).maybeSingle();
    if (!perfil || !perfil.activo) {
        await supabaseClient.auth.signOut();
        ocultarSistema();
        mostrarErrorLogin('Tu usuario no tiene acceso al sistema. Consulta con el administrador.');
        return;
    }

    USUARIO = perfil;
    await mostrarSistema();
}

async function olvideMiPassword(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    if (!email) {
        mostrarErrorLogin('Escribe tu correo arriba y vuelve a hacer clic en "¿Olvidaste tu contraseña?".');
        return;
    }
    await enviarEnlaceRecuperacion(email);
    document.getElementById('login-error-alert').innerHTML = `
        <div class="alert alert-info text-center py-2 small">Si el correo está registrado, te llegará un enlace para crear una nueva contraseña.</div>
    `;
}

async function enviarEnlaceRecuperacion(email) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
    });
    if (error) console.error(error);
    return !error;
}

async function mostrarSistema() {
    document.getElementById('login-container').classList.add('d-none');
    document.getElementById('wrapper').classList.remove('d-none');

    document.getElementById('user-display-name').textContent = USUARIO.nombre;
    const badgeRol = document.getElementById('user-role-badge');
    badgeRol.textContent = USUARIO.rol;
    badgeRol.className = esAdmin() ? 'badge bg-danger' : 'badge bg-info text-dark';

    document.querySelectorAll('.solo-admin').forEach(el => el.classList.toggle('d-none', !esAdmin()));
    cambiarSeccion('section-panel');

    suscribirCambios();
    await renderizarTodo();
}

function ocultarSistema() {
    USUARIO = null;
    if (canalCambios) {
        supabaseClient.removeChannel(canalCambios);
        canalCambios = null;
    }
    document.getElementById('login-container').classList.remove('d-none');
    document.getElementById('wrapper').classList.add('d-none');
}

async function cerrarSesion() {
    await supabaseClient.auth.signOut();
    ocultarSistema();
}

function abrirCambioPassword(recuperacion) {
    modoRecuperacion = !!recuperacion;
    document.getElementById('form-cambiar-password').reset();
    document.getElementById('passActualGrupo').classList.toggle('d-none', modoRecuperacion);
    document.getElementById('passActual').required = !modoRecuperacion;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('cambiarPasswordModal')).show();
}

async function guardarNuevaPassword(e) {
    e.preventDefault();
    const actual = document.getElementById('passActual').value;
    const nueva = document.getElementById('passNueva').value;
    const confirmar = document.getElementById('passConfirmar').value;

    if (nueva.length < 6) { alert('La nueva contraseña debe tener al menos 6 caracteres.'); return; }
    if (nueva !== confirmar) { alert('Las contraseñas nuevas no coinciden.'); return; }

    if (!modoRecuperacion) {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { error } = await supabaseClient.auth.signInWithPassword({ email: user.email, password: actual });
        if (error) { alert('La contraseña actual no es correcta.'); return; }
    }

    const { error } = await supabaseClient.auth.updateUser({ password: nueva });
    if (error) { alert('No se pudo cambiar la contraseña: ' + error.message); return; }

    modoRecuperacion = false;
    cerrarModal('cambiarPasswordModal');
    mostrarAlerta('¡Contraseña actualizada correctamente!', 'success');
    if (!USUARIO) await cargarPerfilYEntrar();
}

async function crearUsuario(e) {
    e.preventDefault();
    const nombre = document.getElementById('usuarioNombre').value.trim();
    const email = document.getElementById('usuarioEmail').value.trim().toLowerCase();
    const password = document.getElementById('usuarioPassword').value;
    const rol = document.getElementById('usuarioRol').value;

    // Cliente aparte para que crear la cuenta no cierre la sesión del administrador
    const clienteAlta = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'aravema-alta-usuario' }
    });
    const { data, error } = await clienteAlta.auth.signUp({ email, password });
    if (error) { mostrarError('No se pudo crear el usuario: ' + error.message); return; }
    if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
        mostrarError('Ese correo ya está registrado en el sistema.');
        return;
    }

    const ok = await ejecutar(
        supabaseClient.from('perfiles').insert([{ id: data.user.id, email, nombre, rol }]),
        'La cuenta se creó pero no se pudo guardar el perfil'
    );
    if (!ok) return;

    document.getElementById('form-nuevo-usuario').reset();
    await renderizarTodo();
    mostrarAlerta(`Usuario creado. ${nombre} ya puede entrar con ${email} y la contraseña inicial.`, 'success');
}

async function cambiarRolUsuario(id, rol) {
    await ejecutar(supabaseClient.from('perfiles').update({ rol }).eq('id', id), 'No se pudo cambiar el rol');
    await renderizarTodo();
}

async function cambiarEstadoUsuario(id, activo) {
    await ejecutar(supabaseClient.from('perfiles').update({ activo }).eq('id', id), 'No se pudo cambiar el estado');
    await renderizarTodo();
}

async function restablecerPasswordUsuario(id) {
    const perfil = DB.perfiles.find(p => p.id === id);
    if (!perfil) return;
    if (!confirm(`¿Enviar a ${perfil.email} un enlace para crear una nueva contraseña?`)) return;
    const ok = await enviarEnlaceRecuperacion(perfil.email);
    mostrarAlerta(ok ? `Enlace enviado a ${perfil.email}.` : 'No se pudo enviar el correo. Intenta en unos minutos.', ok ? 'success' : 'danger');
}

// -------------------------------------------------------------
// SINCRONIZACIÓN EN VIVO Y CARGA DE DATOS
// -------------------------------------------------------------
function suscribirCambios() {
    if (canalCambios) return;
    canalCambios = supabaseClient.channel('aravema-cambios')
        .on('postgres_changes', { event: '*', schema: 'public' }, programarRender)
        .subscribe();
}

// Agrupa varios cambios seguidos en una sola actualización de pantalla
function programarRender() {
    clearTimeout(temporizadorRender);
    temporizadorRender = setTimeout(renderizarTodo, 400);
}

async function cargarDatos() {
    const tablas = ['guias', 'asistencia', 'mantenimiento', 'choferes', 'bitacora'];
    if (esAdmin()) tablas.push('gastos', 'perfiles');

    const respuestas = await Promise.all(tablas.map(t => supabaseClient.from(t).select('*')));
    const fallidas = [];
    respuestas.forEach((r, i) => {
        if (r.error) {
            console.error(tablas[i], r.error);
            fallidas.push(`${tablas[i]} (${r.error.message})`);
        } else {
            DB[tablas[i]] = r.data || [];
        }
    });
    // Avisar una sola vez por sesión si alguna tabla no se pudo leer (ej. falta ejecutar un SQL)
    const avisoTablas = fallidas.join(', ');
    if (avisoTablas && avisoTablas !== cargarDatos.ultimoAviso) {
        mostrarAlerta(`No se pudieron leer estas tablas de Supabase: ${avisoTablas}`, 'danger');
    }
    cargarDatos.ultimoAviso = avisoTablas;

    const recientePrimero = (a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (b.id - a.id);
    DB.guias.sort((a, b) => b.id - a.id);
    DB.asistencia.sort(recientePrimero);
    DB.gastos.sort(recientePrimero);
    DB.mantenimiento.sort((a, b) => b.id - a.id);
    DB.bitacora.sort(recientePrimero);
    DB.choferes = DB.choferes.map(normalizarChofer).sort((a, b) => a.nombre.localeCompare(b.nombre));
    DB.perfiles.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Valores por defecto si alguna columna viene vacía (por ejemplo, choferes creados antes de la migración)
function normalizarChofer(c) {
    return {
        ...c,
        nombre: c.nombre || '',
        modalidad: MODALIDADES_CHOFER[c.modalidad] ? c.modalidad : 'DIARIO',
        sueldo_mensual: c.sueldo_mensual ?? 2500,
        viaticos_mensual: c.viaticos_mensual ?? 500,
        pago_diario: c.pago_diario ?? 100,
        activo: c.activo !== false // vacío = activo; solo se oculta si se desactivó a propósito
    };
}

// Todo chofer que aparece en una guía de la flota propia debe estar en la lista de choferes
// (para pagarle). Si falta alguno, se agrega solo como apoyo con pago diario.
const CHOFERES_INTENTADOS = new Set(); // evita reintentar en bucle si Supabase rechaza el alta
async function sincronizarChoferes() {
    const registrados = new Set(DB.choferes.map(c => normNombre(c.nombre)));
    const faltantes = new Map();
    DB.guias
        .filter(g => !esGuiaTercero(g) && g.conductor && g.conductor !== '-')
        .forEach(g => {
            const clave = normNombre(g.conductor);
            if (!registrados.has(clave) && !faltantes.has(clave) && !CHOFERES_INTENTADOS.has(clave)) {
                faltantes.set(clave, nombreGuardado(g.conductor));
            }
        });
    if (faltantes.size === 0) return [];

    faltantes.forEach((_, clave) => CHOFERES_INTENTADOS.add(clave));
    const nuevos = [...faltantes.values()];
    const { error } = await supabaseClient.from('choferes').insert(nuevos.map(nombre => ({ nombre, modalidad: 'DIARIO' })));
    if (error) {
        console.error(error);
        mostrarAlerta(`No se pudo agregar a la lista de choferes a ${nuevos.join(', ')}: ${error.message}`, 'danger');
        return [];
    }
    const { data } = await supabaseClient.from('choferes').select('*');
    if (data) DB.choferes = data.map(normalizarChofer).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return nuevos;
}

async function renderizarTodo() {
    if (!USUARIO) return;
    document.body.classList.add('cargando');
    try {
        await cargarDatos();
        const choferesNuevos = await sincronizarChoferes();
        if (choferesNuevos.length) {
            mostrarAlerta(`Chofer agregado desde las guías: ${choferesNuevos.join(', ')} (apoyo, pago diario). Puedes cambiar su modalidad con ⚙ en Pagos.`, 'success');
        }

        renderizarGuias();
        renderizarPrefacturacion();
        renderizarAsistencia();
        renderizarMantenimiento();
        renderizarBitacora();
        actualizarListasSugeridas();

        if (esAdmin()) {
            renderizarPagos();
            renderizarGastos();
            renderizarUsuarios();
            actualizarKPIs();
            renderizarGraficos();
        }
    } finally {
        document.body.classList.remove('cargando');
    }
}

function actualizarListasSugeridas() {
    document.getElementById('lista-choferes').innerHTML = DB.choferes
        .filter(c => c.activo)
        .map(c => `<option value="${esc(c.nombre)}">`).join('');

    const terceros = new Set(DB.guias.filter(esGuiaTercero).map(g => g.tercero).filter(Boolean));
    document.getElementById('lista-terceros').innerHTML = [...terceros]
        .map(t => `<option value="${esc(t)}">`).join('');

    const clientes = new Set(DB.guias.map(g => g.destinatario).filter(d => d && d !== '-'));
    document.getElementById('lista-clientes').innerHTML = [...clientes]
        .map(c => `<option value="${esc(c)}">`).join('');
}

// -------------------------------------------------------------
// REGISTRO DE VIAJES (GUÍAS)
// -------------------------------------------------------------
async function guardarViaje(e) {
    e.preventDefault();
    const form = e.target;

    const tarifaSinIgv = num(document.getElementById('tarifaSinIgv').value);
    const estiba = num(document.getElementById('montoEstiba').value);
    const subtotal = tarifaSinIgv + estiba;
    const totalAFacturar = subtotal * 1.18;

    const tipoVehiculo = document.getElementById('tipoVehiculo').value;
    const esTercero = tipoVehiculo.includes('Tercero');
    const conductor = nombreGuardado(document.getElementById('nombreConductor').value) || '-';
    const tercero = esTercero ? nombreGuardado(document.getElementById('terceroNombre').value) : null;
    const costoTercero = esTercero ? num(document.getElementById('costoTercero').value) : 0;

    if (esTercero && !tercero) {
        alert('Indica el transportista o empresa tercera a quien se le paga el viaje.');
        return;
    }

    const guiaRemitente = document.getElementById('guiaRemitente').value.trim().toUpperCase() || '-';
    const duplicada = DB.guias.find(g => guiaRemitente !== '-' && normNombre(g.guia_remitente) === normNombre(guiaRemitente));
    if (duplicada && !confirm(`La guía ${guiaRemitente} ya está registrada (${duplicada.fecha}, ${duplicada.destinatario}).\n\n¿Registrarla de nuevo de todos modos?`)) {
        return;
    }

    let estadoFact = document.querySelector('input[name="estadoFacturacion"]:checked').value;
    const estadoPago = document.querySelector('input[name="estadoPago"]:checked').value;
    if (estadoPago === 'PAGADO') estadoFact = 'FACTURADO'; // no se puede cobrar algo sin facturar

    const nuevaGuia = {
        fecha: document.getElementById('fechaServicio').value,
        tipo_vehiculo: tipoVehiculo,
        tercero: tercero,
        costo_tercero: costoTercero,
        guia_remitente: guiaRemitente,
        guia_transportista: '-',
        conductor: conductor,
        jabas: parseInt(document.getElementById('numJabas').value) || 0,
        detalle: document.getElementById('detalleProducto').value.trim() || '-',
        peso_bruto: document.getElementById('pesoBruto').value.trim() || '-',
        punto_partida: document.getElementById('puntoPartida').value.trim() || '-',
        punto_llegada: document.getElementById('puntoLlegada').value.trim() || '-',
        destinatario: document.getElementById('datosDestinatario').value.trim() || '-',
        tarifa_sin_igv: tarifaSinIgv,
        estiba: estiba,
        subtotal: subtotal,
        total_a_facturar: totalAFacturar,
        estado_facturacion: estadoFact,
        estado_pago: estadoPago
    };

    const ok = await ejecutar(supabaseClient.from('guias').insert([nuevaGuia]), 'Error al guardar el servicio');
    if (!ok) return;

    // Si el chofer es nuevo, sincronizarChoferes() (dentro de renderizarTodo) lo agrega a la lista de pagos
    const avisoChofer = '';

    borrarBorradorViaje();
    const registrarOtro = e.submitter?.dataset.accion === 'otro';

    if (registrarOtro) {
        // Se conservan fecha, vehículo, chofer y tercero: lo demás se limpia para la siguiente guía
        const conservar = ['fechaServicio', 'tipoVehiculo', 'nombreConductor', 'terceroNombre', 'costoTercero']
            .map(id => [id, document.getElementById(id).value]);
        form.reset();
        conservar.forEach(([id, valor]) => { document.getElementById(id).value = valor; });
        toggleVehiculoTercero(false);
        calcularEstibaAutomatica();
        mostrarEstadoPdf('✔ Guardado. Sube la siguiente guía.', 'success');
        document.querySelector('#nuevoViajeModal .modal-body').scrollTop = 0;
    } else {
        form.reset();
        document.getElementById('fechaServicio').value = hoyLocal();
        mostrarEstadoPdf('', 'muted');
        toggleVehiculoTercero();
        calcularTotalesFlete();
        cerrarModal('nuevoViajeModal');
    }

    await renderizarTodo();
    mostrarAlerta(`¡Servicio ${nuevaGuia.guia_remitente} guardado con éxito!` + avisoChofer, 'success');
}

function toggleVehiculoTercero(limpiar = true) {
    const esTercero = document.getElementById('tipoVehiculo').value.includes('Tercero');
    document.getElementById('divCostoTercero').classList.toggle('d-none', !esTercero);
    document.getElementById('terceroNombre').required = esTercero;
    if (!esTercero && limpiar) {
        document.getElementById('terceroNombre').value = '';
        document.getElementById('costoTercero').value = '0.00';
    }
}

function calcularEstibaAutomatica() {
    const jabas = parseInt(document.getElementById('numJabas').value) || 0;
    const montoEstibaInput = document.getElementById('montoEstiba');

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
    const clienteInput = document.getElementById('datosDestinatario').value.toLowerCase();
    const tarifaInput = document.getElementById('tarifaSinIgv');

    if (clienteInput.includes('aisa') || clienteInput.includes('san antonio') || clienteInput.includes('eco')) {
        tarifaInput.value = (550.00).toFixed(2);
    }

    calcularTotalesFlete();
}

function calcularTotalesFlete() {
    const tarifa = num(document.getElementById('tarifaSinIgv').value);
    const estiba = num(document.getElementById('montoEstiba').value);
    const subtotal = tarifa + estiba;
    document.getElementById('resumenSubtotal').textContent = soles(subtotal);
    document.getElementById('resumenIgv').textContent = soles(subtotal * 0.18);

    const total = document.getElementById('totalAFacturar');
    const nuevo = soles(subtotal * 1.18);
    if (total.textContent !== nuevo) {
        total.textContent = nuevo;
        total.classList.remove('pulso');
        void total.offsetWidth; // reinicia la animación
        total.classList.add('pulso');
    }
}

// -------------------------------------------------------------
// FORMULARIO DE VIAJE: borrador automático, atajos y arrastrar PDF
// -------------------------------------------------------------
const CLAVE_BORRADOR_VIAJE = 'aravema_borrador_viaje';
const CAMPOS_BORRADOR = ['fechaServicio', 'tipoVehiculo', 'nombreConductor', 'terceroNombre', 'costoTercero', 'guiaRemitente',
    'detalleProducto', 'numJabas', 'pesoBruto', 'datosDestinatario', 'puntoPartida', 'puntoLlegada', 'tarifaSinIgv', 'montoEstiba'];
const TEXTO_BORRADOR = '<i class="bi bi-cloud-check me-1"></i>Los datos se guardan como borrador mientras escribes';
let temporizadorBorrador = null;

function prepararFormularioViaje() {
    const form = document.getElementById('form-nuevo-viaje');
    const modal = document.getElementById('nuevoViajeModal');

    // Borrador: se guarda medio segundo después de dejar de escribir
    form.addEventListener('input', (e) => {
        if (e.target.id === 'pdfFileinput') return;
        clearTimeout(temporizadorBorrador);
        temporizadorBorrador = setTimeout(guardarBorradorViaje, 500);
    });
    form.addEventListener('change', (e) => {
        // Cobrado implica facturado; volver a "No facturado" implica pendiente
        if (e.target.id === 'pagoSi') document.getElementById('factSi').checked = true;
        if (e.target.id === 'factNo') document.getElementById('pagoNo').checked = true;
        if (e.target.name === 'estadoFacturacion' || e.target.name === 'estadoPago') guardarBorradorViaje();
    });
    modal.addEventListener('show.bs.modal', restaurarBorradorViaje);

    // Ctrl + Enter = Guardar servicio
    modal.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            form.requestSubmit(form.querySelector('[data-accion="cerrar"]'));
        }
    });

    // Arrastrar y soltar el PDF sobre la zona
    const zona = document.querySelector('.zona-pdf');
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastrando'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove('arrastrando')));
    zona.addEventListener('drop', (e) => {
        e.preventDefault();
        const archivo = e.dataTransfer.files[0];
        if (!archivo) return;
        const input = document.getElementById('pdfFileinput');
        const dt = new DataTransfer();
        dt.items.add(archivo);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
    });
}

function guardarBorradorViaje() {
    const campos = {};
    CAMPOS_BORRADOR.forEach(id => { campos[id] = document.getElementById(id).value; });
    const borrador = {
        campos,
        fact: document.querySelector('input[name="estadoFacturacion"]:checked').value,
        pago: document.querySelector('input[name="estadoPago"]:checked').value,
        hora: Date.now()
    };
    try {
        localStorage.setItem(CLAVE_BORRADOR_VIAJE, JSON.stringify(borrador));
    } catch (err) {
        return; // navegador sin almacenamiento: simplemente no hay borrador
    }
    const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('estado-borrador').innerHTML = `<i class="bi bi-cloud-check-fill text-success me-1"></i>Borrador guardado a las ${hora}`;
}

function restaurarBorradorViaje() {
    let borrador = null;
    try { borrador = JSON.parse(localStorage.getItem(CLAVE_BORRADOR_VIAJE)); } catch (err) { borrador = null; }

    const estado = document.getElementById('estado-borrador');
    const formVacio = !document.getElementById('guiaRemitente').value && !document.getElementById('datosDestinatario').value;
    if (!borrador || !formVacio) {
        if (formVacio) estado.innerHTML = TEXTO_BORRADOR;
        calcularTotalesFlete();
        return;
    }

    Object.entries(borrador.campos || {}).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (el && valor !== undefined) el.value = valor;
    });
    const radioFact = document.querySelector(`input[name="estadoFacturacion"][value="${borrador.fact}"]`);
    const radioPago = document.querySelector(`input[name="estadoPago"][value="${borrador.pago}"]`);
    if (radioFact) radioFact.checked = true;
    if (radioPago) radioPago.checked = true;
    toggleVehiculoTercero(false);
    calcularTotalesFlete();

    const minutos = Math.max(1, Math.round((Date.now() - borrador.hora) / 60000));
    estado.innerHTML = `<i class="bi bi-arrow-counterclockwise text-warning me-1"></i>Se recuperó un borrador de hace ${minutos} min · <a href="#" onclick="descartarBorradorViaje(event)">Descartar</a>`;
}

function borrarBorradorViaje() {
    clearTimeout(temporizadorBorrador);
    try { localStorage.removeItem(CLAVE_BORRADOR_VIAJE); } catch (err) { /* sin almacenamiento */ }
    document.getElementById('estado-borrador').innerHTML = TEXTO_BORRADOR;
}

function descartarBorradorViaje(e) {
    e.preventDefault();
    borrarBorradorViaje();
    document.getElementById('form-nuevo-viaje').reset();
    document.getElementById('fechaServicio').value = hoyLocal();
    toggleVehiculoTercero();
    calcularTotalesFlete();
    mostrarEstadoPdf('', 'muted');
}

// Una fila de la tabla de guías
function filaGuia(g, admin) {
    const esTercero = esGuiaTercero(g);
    const estFact = estadoFacturacion(g);
    const estPago = estadoPagoGuia(g);

    return `
            <tr>
                <td class="fw-semibold">${esc(g.fecha || '-')}</td>
                <td>
                    <span class="badge rounded-pill ${esTercero ? 'bg-warning text-dark' : 'bg-primary'} mb-1"><i class="bi ${esTercero ? 'bi-truck-flatbed' : 'bi-truck'} me-1"></i>${esTercero ? 'Tercero' : 'C5T-850'}</span>
                    ${esTercero ? `<small class="d-block fw-semibold">${esc(g.tercero || '-')}</small><small class="text-danger fw-bold">Acordado: ${soles(g.costo_tercero)}</small>` : ''}
                </td>
                <td><span class="badge bg-light text-dark border d-block">Guía: ${esc(g.guia_remitente || '-')}</span></td>
                <td class="fw-bold">${esc(g.conductor || '-')}</td>
                <td>
                    <div class="fw-bold text-dark">${esc(g.destinatario || '-')}</div>
                    <small class="text-muted d-block">${esc(g.punto_partida || '-')} ➔ ${esc(g.punto_llegada || '-')}</small>
                </td>
                <td>
                    <div>${g.jabas ? esc(g.jabas) + ' jabas' : '-'} (${esc(g.detalle || '-')})</div>
                    <small class="text-primary fw-bold">${esc(g.peso_bruto || '-')}</small>
                </td>
                <td>
                    <div class="small text-muted">Sin IGV: ${soles(g.tarifa_sin_igv)}</div>
                    <div class="fw-bold text-success">Total: ${soles(g.total_a_facturar)}</div>
                </td>
                <td>
                    <select class="form-select form-select-sm badge-select ${estFact === 'FACTURADO' ? 'bg-success text-white' : 'bg-warning text-dark'}" onchange="cambiarEstadoGuiaFactura(${g.id}, this.value)" ${!admin ? 'disabled' : ''}>
                        <option value="NO FACTURADO" ${estFact === 'NO FACTURADO' ? 'selected' : ''}>NO FACTURADO</option>
                        <option value="FACTURADO" ${estFact === 'FACTURADO' ? 'selected' : ''}>FACTURADO</option>
                    </select>
                </td>
                <td>
                    <select class="form-select form-select-sm badge-select ${estPago === 'PAGADO' ? 'bg-success text-white' : 'bg-danger text-white'}" onchange="cambiarEstadoGuiaPago(${g.id}, this.value)" ${!admin ? 'disabled' : ''}>
                        <option value="PENDIENTE" ${estPago === 'PENDIENTE' ? 'selected' : ''}>PENDIENTE</option>
                        <option value="PAGADO" ${estPago === 'PAGADO' ? 'selected' : ''}>PAGADO</option>
                    </select>
                </td>
                <td class="td-acciones">
                    ${admin ? `<button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarGuia(${g.id})"><i class="bi bi-trash"></i></button>` : '<span class="text-muted small">Sin permisos</span>'}
                </td>
            </tr>
        `;
}

// ¿La guía pasa el filtro (chip) y el texto buscado?
function guiaCoincide(g, texto) {
    const fact = estadoFacturacion(g) === 'FACTURADO';
    const pagado = estadoPagoGuia(g) === 'PAGADO';
    const pasaFiltro = {
        TODAS: true,
        POR_FACTURAR: !fact,
        POR_COBRAR: fact && !pagado,
        COBRADAS: pagado,
        PROPIO: !esGuiaTercero(g),
        TERCERO: esGuiaTercero(g)
    }[FILTRO_GUIAS];
    if (!pasaFiltro) return false;
    if (!texto) return true;
    const campos = [g.guia_remitente, g.conductor, g.tercero, g.destinatario, g.detalle, g.punto_partida, g.punto_llegada, g.fecha];
    return normNombre(campos.join(' ')).includes(texto);
}

function renderizarGuias() {
    const admin = esAdmin();
    const vacio = mensaje => `<tr><td colspan="10" class="text-center text-muted p-4"><i class="bi bi-flower2 fs-3 d-block mb-1 text-success opacity-50"></i>${mensaje}</td></tr>`;

    // Panel: solo los 8 más recientes
    document.getElementById('tabla-guias-body').innerHTML = DB.guias.length
        ? DB.guias.slice(0, 8).map(g => filaGuia(g, admin)).join('')
        : vacio('Aún no hay servicios registrados. ¡Registra tu primer viaje!');

    // Listado completo con buscador y filtros
    const texto = normNombre(document.getElementById('buscarGuia').value);
    const filtradas = DB.guias.filter(g => guiaCoincide(g, texto));
    document.getElementById('tabla-guias-completa-body').innerHTML = filtradas.length
        ? filtradas.map(g => filaGuia(g, admin)).join('')
        : vacio(DB.guias.length ? 'Ninguna guía coincide con la búsqueda.' : 'No hay servicios registrados.');

    const totalFiltrado = filtradas.reduce((acc, g) => acc + num(g.total_a_facturar), 0);
    document.getElementById('conteo-guias').textContent =
        `Mostrando ${filtradas.length} de ${DB.guias.length} servicios · Total: ${soles(totalFiltrado)}`;
}

async function cambiarEstadoGuiaFactura(id, nuevoEstado) {
    const cambios = { estado_facturacion: nuevoEstado };
    const guia = DB.guias.find(g => g.id === id);
    if (nuevoEstado === 'NO FACTURADO' && guia && estadoPagoGuia(guia) === 'PAGADO') {
        if (!confirm('Esta guía ya figura como COBRADA. Si la pasas a NO FACTURADO también volverá a PENDIENTE de pago. ¿Continuar?')) {
            renderizarGuias();
            return;
        }
        cambios.estado_pago = 'PENDIENTE';
    }
    await ejecutar(supabaseClient.from('guias').update(cambios).eq('id', id), 'No se pudo actualizar');
    await renderizarTodo();
}

async function cambiarEstadoGuiaPago(id, nuevoEstado) {
    const guia = DB.guias.find(g => g.id === id);
    if (nuevoEstado === 'PAGADO' && guia && estadoFacturacion(guia) !== 'FACTURADO') {
        alert('Primero marca la guía como FACTURADO. El cobro solo se registra sobre servicios facturados.');
        renderizarGuias();
        return;
    }
    await ejecutar(supabaseClient.from('guias').update({ estado_pago: nuevoEstado }).eq('id', id), 'No se pudo actualizar');
    await renderizarTodo();
}

async function eliminarGuia(id) {
    if (!confirm('¿Deseas eliminar este servicio de la base de datos?\n\nSu día de asistencia y lo acordado con el tercero (si aplica) también dejarán de contarse.')) return;
    await ejecutar(supabaseClient.from('guias').delete().eq('id', id), 'No se pudo eliminar');
    await renderizarTodo();
}

// -------------------------------------------------------------
// MOTOR DE LECTURA DE GUÍA DE REMISIÓN DEL REMITENTE (SUNAT)
// -------------------------------------------------------------
// El PDF de SUNAT no guarda el texto en orden de lectura, así que
// cada dato se busca por POSICIÓN: el valor que está a la derecha
// (o debajo) de su etiqueta.

// Campos que se llenan desde el PDF. Km, tarifa y tipo de vehículo quedan manuales.
const CAMPOS_GUIA_PDF = {
    guia: { id: 'guiaRemitente', nombre: 'N° de guía' },
    fecha: { id: 'fechaServicio', nombre: 'Fecha' },
    conductor: { id: 'nombreConductor', nombre: 'Conductor' },
    jabas: { id: 'numJabas', nombre: 'N° jabas' },
    detalle: { id: 'detalleProducto', nombre: 'Bienes' },
    peso: { id: 'pesoBruto', nombre: 'Peso bruto' },
    destinatario: { id: 'datosDestinatario', nombre: 'Destinatario' },
    partida: { id: 'puntoPartida', nombre: 'Punto de partida' },
    llegada: { id: 'puntoLlegada', nombre: 'Punto de llegada' }
};

async function procesarGuiaRemitentePdf(e) {
    const file = e.target.files[0];
    if (!file) return;

    mostrarEstadoPdf('Leyendo guía...', 'secondary');
    try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

        const items = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const textContent = await page.getTextContent();
            const desfase = (p - 1) * 10000; // las páginas siguientes quedan "debajo" de la primera
            textContent.items.forEach(it => {
                const str = it.str.replace(/\s+/g, ' ').trim();
                if (str) items.push({ str, x: it.transform[4], y: it.transform[5] - desfase });
            });
        }

        const datos = leerGuiaRemision(items, file.name);
        console.log('=== DATOS LEÍDOS DE LA GUÍA ===', datos);

        const faltantes = llenarFormularioGuia(datos);
        guardarBorradorViaje();
        if (faltantes.length === Object.keys(CAMPOS_GUIA_PDF).length) {
            mostrarEstadoPdf('No se reconoció el formato de la guía. Llena los datos manualmente.', 'danger');
        } else if (faltantes.length > 0) {
            mostrarEstadoPdf(`Guía leída. No se encontró: ${faltantes.join(', ')}. Complétalo manualmente junto con Km, tarifa y vehículo.`, 'warning');
        } else {
            mostrarEstadoPdf('✔ Guía leída. Completa manualmente: tipo de vehículo, Km inicio/final y tarifa.', 'success');
        }

        const duplicada = datos.guia && DB.guias.find(g => normNombre(g.guia_remitente) === normNombre(datos.guia));
        if (duplicada) {
            mostrarEstadoPdf(`⚠ La guía ${datos.guia} YA está registrada (${duplicada.fecha}, ${duplicada.destinatario}). Revisa antes de guardar.`, 'danger');
        }
    } catch (err) {
        console.error(err);
        mostrarEstadoPdf('Error al leer el PDF. Asegúrate de subir el PDF original descargado de SUNAT.', 'danger');
    } finally {
        e.target.value = ''; // permite volver a subir el mismo archivo
    }
}

function leerGuiaRemision(items, nombreArchivo = '') {
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const buscar = re => items.find(it => re.test(norm(it.str)));
    const textoCompleto = items.map(it => it.str).join(' ');
    const datos = {};

    // Valor a la derecha de una etiqueta, en la misma fila.
    // Con multilinea, suma las líneas siguientes alineadas debajo (direcciones largas).
    function valorDerecha(reEtiqueta, multilinea = false) {
        const etiqueta = buscar(reEtiqueta);
        if (!etiqueta) return '';

        // Formato "Etiqueta: valor" dentro del mismo texto
        const resto = etiqueta.str.split(':').slice(1).join(':').trim();
        if (resto) return resto;

        const primero = items
            .filter(it => it !== etiqueta && Math.abs(it.y - etiqueta.y) < 3 && it.x > etiqueta.x)
            .sort((a, b) => a.x - b.x)[0];
        if (!primero) return '';

        const partes = [primero.str];
        let actual = primero;
        while (multilinea) {
            const siguiente = items.find(it => Math.abs(it.x - primero.x) < 2 && actual.y - it.y > 3 && actual.y - it.y < 16);
            if (!siguiente) break;
            partes.push(siguiente.str);
            actual = siguiente;
        }
        return partes.join(' ').replace(/\s+/g, ' ').trim();
    }

    const quitarDocumento = s => s.replace(/\s*-\s*(REGISTRO [ÚU]NICO|RUC|DOCUMENTO|DNI|CARNET|PASAPORTE).*$/i, '').trim();

    // 1. NÚMERO DE GUÍA (ej. "N° EG07 - 00003545" → "EG07-00003545")
    const reGuia = /([A-Z][A-Z0-9]{3})\s*-\s*(\d{1,8})\b/;
    const itemGuia = items.find(it => /^N\S*\s*[A-Z][A-Z0-9]{3}\s*-\s*\d+$/i.test(it.str));
    const matchGuia = (itemGuia && itemGuia.str.match(reGuia)) || nombreArchivo.match(/(EG\d{2})\s*-\s*(\d+)/i);
    if (matchGuia) datos.guia = `${matchGuia[1].toUpperCase()}-${matchGuia[2].padStart(8, '0')}`;

    // 2. FECHA (inicio de traslado; si no, la de emisión) → formato yyyy-mm-dd
    const textoFecha = valorDerecha(/FECHA DE INICIO DE TRASLADO/) || valorDerecha(/FECHA Y HORA DE EMISION/);
    const matchFecha = textoFecha.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (matchFecha) datos.fecha = `${matchFecha[3]}-${matchFecha[2].padStart(2, '0')}-${matchFecha[1].padStart(2, '0')}`;

    // 3. DESTINATARIO (sin el RUC)
    const destinatario = quitarDocumento(valorDerecha(/DATOS DEL DESTINATARIO/));
    if (destinatario) datos.destinatario = destinatario;

    // 4 y 5. PUNTOS DE PARTIDA Y LLEGADA (pueden ocupar 2 líneas)
    const partida = valorDerecha(/^PUNTO DE PARTIDA/, true);
    if (partida) datos.partida = partida;
    const llegada = valorDerecha(/^PUNTO DE LLEGADA/, true);
    if (llegada) datos.llegada = llegada;

    // 6. CONDUCTOR PRINCIPAL: primer "NOMBRE - DOCUMENTO NACIONAL DE IDENTIDAD N° ..." debajo de "Datos de los conductores"
    const etiquetaConductores = buscar(/DATOS DE LOS CONDUCTORES/);
    const itemConductor = items
        .filter(it => /\s-\s*(DOCUMENTO|DNI|CARNET|PASAPORTE)/.test(norm(it.str)))
        .filter(it => !etiquetaConductores || it.y < etiquetaConductores.y)
        .sort((a, b) => b.y - a.y)[0];
    if (itemConductor) datos.conductor = quitarDocumento(itemConductor.str);

    // 7. PESO BRUTO + UNIDAD (ej. "4,845 KGM")
    const peso = valorDerecha(/PESO BRUTO TOTAL/);
    if (/\d/.test(peso)) {
        const unidad = valorDerecha(/UNIDAD DE MEDIDA DEL PESO/) || 'KGM';
        datos.peso = /[A-Z]/i.test(peso) ? peso : `${peso} ${unidad}`;
    }

    // 8. DESCRIPCIÓN DEL BIEN: columna bajo "Descripción Detallada"
    let descripcion = '';
    const encabezado = buscar(/DESCRIPCION DETALLADA/);
    if (encabezado) {
        const cerca = it => Math.abs(it.y - encabezado.y) < 15;
        const colGtin = items.find(it => cerca(it) && /GTIN/.test(norm(it.str)));
        const colUnidad = items.find(it => cerca(it) && /^UNIDAD/.test(norm(it.str)));
        const xIni = colGtin ? colGtin.x + 25 : encabezado.x - 120;
        const xFin = colUnidad ? colUnidad.x - 5 : encabezado.x + 200;

        const lineas = items
            .filter(it => it.y < encabezado.y - 12 && it.x >= xIni && it.x < xFin)
            .sort((a, b) => b.y - a.y);
        // Solo las líneas seguidas (se corta al primer salto grande)
        const bloque = [];
        for (const l of lineas) {
            if (bloque.length && bloque[bloque.length - 1].y - l.y > 14) break;
            bloque.push(l);
        }
        descripcion = bloque.map(l => l.str).join(' ').replace(/\s+/g, ' ').trim();
    }

    if (descripcion) {
        // "ESPARRAGO VERDE FRESCO - 362 JABAS (...)" → "ESPARRAGO VERDE FRESCO"
        const detalle = descripcion.split(/\s+-\s+/)[0].replace(/\s*\d+\s*(JABAS?|CAJAS?|BULTOS?|PAQUETES?)\b.*$/i, '').trim();
        if (detalle) datos.detalle = detalle;
    } else {
        const matchProducto = textoCompleto.match(/(ESPARRAGO[A-Z\s]*|AJ[IÍ][A-Z\s]*|PALTA[A-Z\s]*|UVA[A-Z\s]*|MANDARINA[A-Z\s]*|ARANDANO[A-Z\s]*)/i);
        if (matchProducto) datos.detalle = matchProducto[1].trim();
    }

    // 9. JABAS: el primer número antes de "JABAS" (el total)
    const matchJabas = (descripcion || textoCompleto).match(/(\d+)\s*(?:JABAS?|CAJAS?|BULTOS?|PAQUETES?)\b/i);
    if (matchJabas) datos.jabas = matchJabas[1];

    return datos;
}

// Llena el formulario y devuelve los nombres de los campos que no se encontraron
function llenarFormularioGuia(datos) {
    const faltantes = [];
    for (const [clave, campo] of Object.entries(CAMPOS_GUIA_PDF)) {
        const input = document.getElementById(campo.id);
        if (!input) continue;
        // Se limpia para no dejar datos de una guía anterior
        input.value = datos[clave] || '';
        if (!datos[clave]) faltantes.push(campo.nombre);
    }
    calcularEstibaAutomatica();
    return faltantes;
}

function mostrarEstadoPdf(mensaje, tipo) {
    const inputPdf = document.getElementById('pdfFileinput');
    if (!inputPdf) return;

    let estado = document.getElementById('pdf-status');
    if (!estado) {
        estado = document.createElement('div');
        estado.id = 'pdf-status';
        // debajo de la zona de subida (el input está dentro de ella)
        (inputPdf.closest('.zona-pdf') || inputPdf.parentElement).insertAdjacentElement('afterend', estado);
    }
    estado.className = `mt-2 small fw-semibold text-${tipo}`;
    estado.textContent = mensaje;
}

// -------------------------------------------------------------
// PRE-FACTURACIÓN Y COBRANZA
// -------------------------------------------------------------
function agruparPorCliente(guias) {
    const grupos = {};
    guias.forEach(g => {
        const clave = normNombre(g.destinatario) || 'CLIENTE GENERAL';
        if (!grupos[clave]) grupos[clave] = { cliente: g.destinatario || 'Cliente General', guias: [], subtotal: 0, total: 0 };
        const sub = num(g.subtotal || g.tarifa_sin_igv);
        grupos[clave].guias.push(g);
        grupos[clave].subtotal += sub;
        grupos[clave].total += num(g.total_a_facturar) || sub * 1.18;
    });
    return Object.values(grupos).sort((a, b) => b.total - a.total);
}

function renderizarPrefacturacion() {
    const admin = esAdmin();
    PREFACTURAS = agruparPorCliente(DB.guias.filter(g => estadoFacturacion(g) !== 'FACTURADO'));
    POR_COBRAR = agruparPorCliente(DB.guias.filter(g => estadoFacturacion(g) === 'FACTURADO' && estadoPagoGuia(g) !== 'PAGADO'));

    document.getElementById('tabla-prefacturacion-body').innerHTML = PREFACTURAS.map((grupo, i) => `
        <tr>
            <td class="fw-bold text-dark">${esc(grupo.cliente)}</td>
            <td>${grupo.guias.length} viajes</td>
            <td>${soles(grupo.subtotal)}</td>
            <td class="fw-bold text-success">${soles(grupo.total)}</td>
            <td><span class="badge bg-info text-dark">POR FACTURAR</span></td>
            <td class="td-acciones">
                <button class="btn btn-sm btn-success fw-bold shadow-sm mb-1" onclick="generarDocumentoPrefactura(${i})">
                    <i class="bi bi-printer me-1"></i> Imprimir Pre-factura
                </button>
                ${admin ? `<button class="btn btn-sm btn-outline-primary fw-bold shadow-sm mb-1" onclick="marcarClienteFacturado(${i})">
                    <i class="bi bi-check2-all me-1"></i> Marcar Facturado
                </button>` : ''}
            </td>
        </tr>
    `).join('') || `<tr><td colspan="6" class="text-center text-muted">No hay servicios pendientes de facturar.</td></tr>`;

    document.getElementById('tabla-por-cobrar-body').innerHTML = POR_COBRAR.map((grupo, i) => `
        <tr>
            <td class="fw-bold text-dark">${esc(grupo.cliente)}</td>
            <td>${grupo.guias.length} viajes <small class="text-muted d-block">${grupo.guias.map(g => esc(g.guia_remitente)).join(', ')}</small></td>
            <td class="fw-bold text-warning-emphasis">${soles(grupo.total)}</td>
            <td class="td-acciones">
                ${admin ? `<button class="btn btn-sm btn-success fw-bold shadow-sm" onclick="marcarClienteCobrado(${i})">
                    <i class="bi bi-cash-coin me-1"></i> Marcar Cobrado
                </button>` : '<span class="text-muted small">Sin permisos</span>'}
            </td>
        </tr>
    `).join('') || `<tr><td colspan="4" class="text-center text-muted">No hay facturas pendientes de cobro.</td></tr>`;

    const totalPorFacturar = PREFACTURAS.reduce((acc, g) => acc + g.total, 0);
    const totalPorCobrar = POR_COBRAR.reduce((acc, g) => acc + g.total, 0);
    document.getElementById('total-prefactura').textContent = `Por facturar: ${soles(totalPorFacturar)}`;
    document.getElementById('total-por-cobrar').textContent = `Por cobrar: ${soles(totalPorCobrar)}`;
}

async function marcarClienteFacturado(indice) {
    const grupo = PREFACTURAS[indice];
    if (!grupo) return;
    if (!confirm(`¿Marcar como FACTURADO los ${grupo.guias.length} servicios de ${grupo.cliente} (${soles(grupo.total)})?\n\nPasarán a "Por cobrar".`)) return;
    const ids = grupo.guias.map(g => g.id);
    await ejecutar(supabaseClient.from('guias').update({ estado_facturacion: 'FACTURADO' }).in('id', ids), 'No se pudo actualizar');
    await renderizarTodo();
}

async function marcarClienteCobrado(indice) {
    const grupo = POR_COBRAR[indice];
    if (!grupo) return;
    if (!confirm(`¿Confirmas que ${grupo.cliente} pagó ${soles(grupo.total)} (${grupo.guias.length} servicios)?\n\nEl monto pasará a la caja.`)) return;
    const ids = grupo.guias.map(g => g.id);
    await ejecutar(supabaseClient.from('guias').update({ estado_pago: 'PAGADO' }).in('id', ids), 'No se pudo actualizar');
    await renderizarTodo();
}

function generarDocumentoPrefactura(indice) {
    const info = PREFACTURAS[indice];
    if (!info) return;

    const cliente = esc(info.cliente);
    const fechaHoy = new Date().toLocaleDateString('es-PE');

    let filasDetalle = '';
    info.guias.forEach((g) => {
        const subVal = num(g.subtotal || g.tarifa_sin_igv);
        const placa = esGuiaTercero(g) ? 'VEHÍCULO TERCERO' : 'C5T-850';
        filasDetalle += `
            <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #000;">1.00</td>
                <td style="text-align: center; padding: 6px; border: 1px solid #000;">UNIDAD</td>
                <td style="padding: 6px; border: 1px solid #000;">
                    SERVICIO TRASLADO DE ${esc((g.detalle || 'CARGA AGRÍCOLA').toUpperCase())}, DE ${esc((g.punto_partida || 'ICA').toUpperCase())} A ${esc((g.punto_llegada || 'DESTINO').toUpperCase())}, SEGÚN GUÍA DE REMISIÓN N° ${esc(g.guia_remitente || '-')}, EN EL VEHÍCULO CON PLACA: ${placa}
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
            <\/script>
        </body>
        </html>
    `);
    win.document.close();
}

// -------------------------------------------------------------
// ASISTENCIA (automática desde las guías + registros manuales)
// -------------------------------------------------------------
function renderizarAsistencia() {
    const admin = esAdmin();
    const mes = document.getElementById('asistenciaMes').value; // "yyyy-mm" o vacío = todo
    const enMes = f => !mes || String(f || '').startsWith(mes);

    // Choferes de la empresa: un día por chofer y fecha con guía propia
    const filas = [];
    const porDia = {};
    DB.guias.filter(g => !esGuiaTercero(g) && enMes(g.fecha)).forEach(g => {
        const clave = normNombre(g.conductor) + '|' + g.fecha;
        if (porDia[clave]) {
            porDia[clave].guias.push(g.guia_remitente);
            return;
        }
        porDia[clave] = { fecha: g.fecha, conductor: g.conductor, estado: 'Laborado / Ruta', guias: [g.guia_remitente], obs: g.destinatario, manual: false };
        filas.push(porDia[clave]);
    });
    DB.asistencia.filter(a => enMes(a.fecha)).forEach(a => {
        filas.push({ id: a.id, fecha: a.fecha, conductor: a.conductor, estado: a.estado, guias: [], obs: a.obs, manual: true });
    });
    filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(a.conductor).localeCompare(String(b.conductor)));

    // Contadores (un día laborado con guía y además registrado a mano cuenta una sola vez)
    const laborados = new Set(filas.filter(f => f.estado === 'Laborado / Ruta').map(f => normNombre(f.conductor) + '|' + f.fecha));
    const contar = estado => filas.filter(f => f.estado === estado).length;
    document.getElementById('total-dias-laborados').textContent = laborados.size;
    document.getElementById('total-dias-descanso').textContent = contar('Descanso');
    document.getElementById('total-dias-taller').textContent = contar('En Taller');
    document.getElementById('total-dias-faltas').textContent = contar('Falta');

    document.getElementById('tabla-asistencia-body').innerHTML = filas.map(f => `
        <tr>
            <td class="fw-semibold">${esc(f.fecha)}</td>
            <td class="fw-bold text-dark">${esc(f.conductor)}</td>
            <td><span class="badge ${ESTADOS_ASISTENCIA[f.estado] || 'bg-secondary'}">${esc(f.estado)}</span></td>
            <td>${f.manual
                ? '<span class="badge bg-light text-dark border"><i class="bi bi-pencil me-1"></i>Manual</span>'
                : `<span class="badge bg-primary bg-opacity-75"><i class="bi bi-file-earmark-text me-1"></i>Guía ${esc(f.guias.join(', '))}</span>`}</td>
            <td class="text-muted small">${esc(f.obs || '-')}</td>
            <td class="td-acciones">
                ${!f.manual ? '<span class="text-muted small">Automático</span>'
                    : admin ? `<button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarAsistencia(${f.id})"><i class="bi bi-trash"></i></button>`
                    : '<span class="text-muted small">Sin permisos</span>'}
            </td>
        </tr>
    `).join('') || `<tr><td colspan="6" class="text-center text-muted">Sin registros en este mes.</td></tr>`;

    // Choferes contratados (terceros)
    document.getElementById('tabla-asistencia-terceros-body').innerHTML = DB.guias
        .filter(g => esGuiaTercero(g) && enMes(g.fecha))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
        .map(g => `
            <tr>
                <td class="fw-semibold">${esc(g.fecha)}</td>
                <td class="fw-bold text-dark">${esc(g.conductor)}</td>
                <td>${esc(g.tercero || '-')}</td>
                <td><span class="badge bg-light text-dark border">${esc(g.guia_remitente)}</span></td>
                <td><div>${esc(g.destinatario)}</div><small class="text-muted">${esc(g.punto_partida)} ➔ ${esc(g.punto_llegada)}</small></td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="text-center text-muted">Sin viajes de terceros en este mes.</td></tr>`;
}

async function guardarAsistencia(e) {
    e.preventDefault();
    const nuevaAsist = {
        fecha: document.getElementById('asistenciaFecha').value,
        conductor: nombreGuardado(document.getElementById('asistenciaConductor').value),
        estado: document.getElementById('asistenciaEstado').value,
        obs: document.getElementById('asistenciaObs').value.trim() || '-'
    };
    const ok = await ejecutar(supabaseClient.from('asistencia').insert([nuevaAsist]), 'No se pudo registrar la asistencia');
    if (!ok) return;

    e.target.reset();
    document.getElementById('asistenciaFecha').value = hoyLocal();
    cerrarModal('nuevaAsistenciaModal');
    await renderizarTodo();
    mostrarAlerta('¡Asistencia registrada correctamente!', 'success');
}

async function eliminarAsistencia(id) {
    if (!confirm('¿Eliminar este registro de asistencia?')) return;
    await ejecutar(supabaseClient.from('asistencia').delete().eq('id', id), 'No se pudo eliminar');
    await renderizarTodo();
}

// -------------------------------------------------------------
// PAGOS A CHOFERES DE LA EMPRESA Y A TERCEROS
// -------------------------------------------------------------
function rangoPagos() {
    const mes = document.getElementById('pagoMes').value || hoyLocal().slice(0, 7);
    const periodo = document.getElementById('pagoPeriodo').value;
    const [anio, numMes] = mes.split('-').map(Number);
    const ultimoDia = new Date(anio, numMes, 0).getDate();
    const desde = `${mes}-${periodo === 'Q2' ? '16' : '01'}`;
    const hasta = `${mes}-${periodo === 'Q1' ? '15' : String(ultimoDia).padStart(2, '0')}`;
    return { desde, hasta };
}

// Fechas trabajadas por cada chofer de la empresa: guías propias + "Laborado" manual
function diasLaboradosPorChofer() {
    const mapa = {};
    const agregar = (nombre, fecha) => {
        if (!nombre || !fecha) return;
        const clave = normNombre(nombre);
        (mapa[clave] = mapa[clave] || new Set()).add(fecha);
    };
    DB.guias.filter(g => !esGuiaTercero(g)).forEach(g => agregar(g.conductor, g.fecha));
    DB.asistencia.filter(a => a.estado === 'Laborado / Ruta').forEach(a => agregar(a.conductor, a.fecha));
    return mapa;
}

// Período de pago al que pertenece una fecha según la modalidad del chofer
function clavePeriodoPago(fecha, modalidad) {
    if (modalidad === 'DIARIO') return fecha;
    const mes = fecha.slice(0, 7);
    if (modalidad === 'MENSUAL') return mes;
    return mes + (Number(fecha.slice(8, 10)) <= 15 ? '-Q1' : '-Q2');
}

// Lo ganado en UN período de pago con cierta cantidad de días trabajados
function ganadoEnUnPeriodo(chofer, dias) {
    if (chofer.modalidad === 'DIARIO') return dias * num(chofer.pago_diario);
    const mensual = num(chofer.sueldo_mensual) + num(chofer.viaticos_mensual);
    const esQuincena = chofer.modalidad === 'QUINCENAL';
    const completo = esQuincena ? mensual / 2 : mensual;
    const diasParaCompleto = esQuincena ? 13 : 26;
    return dias >= diasParaCompleto ? completo : Math.min(dias * mensual / 30, completo);
}

// Suma lo ganado en un conjunto de fechas, agrupándolas por período de pago
function ganadoEnFechas(chofer, fechas) {
    const diasPorPeriodo = {};
    fechas.forEach(f => {
        const clave = clavePeriodoPago(f, chofer.modalidad);
        diasPorPeriodo[clave] = (diasPorPeriodo[clave] || 0) + 1;
    });
    return Object.values(diasPorPeriodo).reduce((acc, dias) => acc + ganadoEnUnPeriodo(chofer, dias), 0);
}

function renderizarPagos() {
    const { desde, hasta } = rangoPagos();
    const enRango = f => f && f >= desde && f <= hasta;
    document.getElementById('pago-rango-texto').textContent = `Mostrando del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}`;

    // Pagos registrados (son gastos de caja con chofer o tercero asociado)
    const pagosChofer = {};
    const pagosTercero = {};
    const acumular = (mapa, nombre, g) => {
        const clave = normNombre(nombre);
        const m = mapa[clave] = mapa[clave] || { total: 0, rango: 0, nombre };
        m.total += num(g.monto);
        if (enRango(g.fecha)) m.rango += num(g.monto);
    };
    const pagos = DB.gastos.filter(g => g.tipo !== 'Ingreso' && (g.conductor || g.tercero));
    pagos.forEach(g => {
        if (g.conductor) acumular(pagosChofer, g.conductor, g);
        else acumular(pagosTercero, g.tercero, g);
    });

    SALDOS_PAGO = {};

    // --- Choferes de la empresa ---
    const dias = diasLaboradosPorChofer();
    // Activos primero; los desactivados al final en gris, para poder reactivarlos con ⚙
    const choferesOrdenados = [...DB.choferes.filter(c => c.activo), ...DB.choferes.filter(c => !c.activo)];
    document.getElementById('tabla-choferes-body').innerHTML = choferesOrdenados.map(c => {
        const clave = normNombre(c.nombre);
        const fechas = [...(dias[clave] || [])];
        const fechasRango = fechas.filter(enRango);
        const pagado = pagosChofer[clave] || { total: 0, rango: 0 };
        const saldo = ganadoEnFechas(c, fechas) - pagado.total;
        SALDOS_PAGO[`CHOFER|${c.nombre}`] = saldo;

        const tarifa = c.modalidad === 'DIARIO'
            ? `${soles(c.pago_diario)} / día`
            : `${soles(num(c.sueldo_mensual) + num(c.viaticos_mensual))} / mes`;

        if (!c.activo) {
            return `
                <tr class="chofer-inactivo">
                    <td class="fw-bold"><i class="bi bi-person-dash me-2"></i>${esc(c.nombre)} <span class="badge bg-secondary ms-1">DESACTIVADO</span></td>
                    <td colspan="4" class="small">No aparece en la lista de pagos. Usa ⚙ y marca "Activo" para volver a habilitarlo.</td>
                    <td>${etiquetaSaldo(saldo)}</td>
                    <td class="td-acciones">
                        <button class="btn btn-sm btn-outline-primary shadow-sm" onclick="abrirConfigChofer(${c.id})" title="Reactivar o configurar"><i class="bi bi-gear"></i> Reactivar</button>
                    </td>
                </tr>
            `;
        }

        return `
            <tr>
                <td class="fw-bold text-dark"><i class="bi bi-person-fill text-primary me-2"></i>${esc(c.nombre)}</td>
                <td><span class="badge ${c.modalidad === 'DIARIO' ? 'bg-info text-dark' : 'bg-primary'}">${MODALIDADES_CHOFER[c.modalidad] || c.modalidad}</span><small class="d-block text-muted">${tarifa}</small></td>
                <td><span class="badge bg-secondary fs-6">${fechasRango.length} días</span></td>
                <td class="fw-semibold">${soles(ganadoEnFechas(c, fechasRango))}</td>
                <td class="text-danger fw-semibold">${soles(pagado.rango)}</td>
                <td>${etiquetaSaldo(saldo)}</td>
                <td class="td-acciones text-nowrap">
                    <button class="btn btn-sm btn-success shadow-sm" onclick="abrirPago(${jsArg('CHOFER|' + c.nombre)})" title="Registrar pago o adelanto"><i class="bi bi-cash"></i> Pagar</button>
                    <button class="btn btn-sm btn-outline-secondary shadow-sm" onclick="abrirConfigChofer(${c.id})" title="Configurar sueldo / modalidad"><i class="bi bi-gear"></i></button>
                </td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="7" class="text-center text-muted p-3">Aún no hay choferes de la empresa. Se agregan solos al guardar una guía de la flota propia.</td></tr>`;

    // --- Terceros: lo acordado en sus guías vs lo pagado ---
    const terceros = {};
    DB.guias.filter(esGuiaTercero).forEach(g => {
        const nombre = g.tercero || g.conductor;
        const clave = normNombre(nombre);
        const t = terceros[clave] = terceros[clave] || { nombre, viajes: 0, viajesRango: 0, acordado: 0, acordadoRango: 0 };
        t.viajes++;
        t.acordado += num(g.costo_tercero);
        if (enRango(g.fecha)) {
            t.viajesRango++;
            t.acordadoRango += num(g.costo_tercero);
        }
    });
    Object.entries(pagosTercero).forEach(([clave, p]) => {
        terceros[clave] = terceros[clave] || { nombre: p.nombre, viajes: 0, viajesRango: 0, acordado: 0, acordadoRango: 0 };
    });

    document.getElementById('tabla-terceros-body').innerHTML = Object.entries(terceros)
        .map(([clave, t]) => ({ ...t, pagado: (pagosTercero[clave] || { total: 0 }).total }))
        .sort((a, b) => (b.acordado - b.pagado) - (a.acordado - a.pagado))
        .map(t => {
            const saldo = t.acordado - t.pagado;
            SALDOS_PAGO[`TERCERO|${t.nombre}`] = saldo;
            return `
                <tr>
                    <td class="fw-bold text-dark"><i class="bi bi-building text-warning me-2"></i>${esc(t.nombre)}</td>
                    <td>${t.viajesRango} viajes</td>
                    <td>${soles(t.acordadoRango)}</td>
                    <td class="fw-semibold">${soles(t.acordado)} <small class="text-muted d-block">${t.viajes} viajes en total</small></td>
                    <td class="text-danger fw-semibold">${soles(t.pagado)}</td>
                    <td>${etiquetaSaldo(saldo)}</td>
                    <td class="td-acciones">
                        <button class="btn btn-sm btn-success shadow-sm" onclick="abrirPago(${jsArg('TERCERO|' + t.nombre)})"><i class="bi bi-cash"></i> Pagar</button>
                    </td>
                </tr>
            `;
        }).join('') || `<tr><td colspan="7" class="text-center text-muted p-3">No hay viajes con vehículos de terceros.</td></tr>`;

    // --- Historial de pagos del período ---
    document.getElementById('tabla-historial-pagos-body').innerHTML = pagos
        .filter(g => enRango(g.fecha))
        .map(g => `
            <tr>
                <td class="fw-semibold">${esc(g.fecha)}</td>
                <td><span class="badge ${g.conductor ? 'bg-primary' : 'bg-warning text-dark'} me-1">${g.conductor ? 'Chofer' : 'Tercero'}</span>${esc(g.conductor || g.tercero)}</td>
                <td class="small">${esc(g.concepto)}</td>
                <td class="fw-bold text-danger">${soles(g.monto)}</td>
                <td class="td-acciones"><button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarGasto(${g.id})"><i class="bi bi-trash"></i></button></td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="text-center text-muted">Sin pagos registrados en este período.</td></tr>`;
}

function etiquetaSaldo(saldo) {
    if (saldo > 0.009) return `<span class="fw-bold text-danger fs-6">${soles(saldo)}</span><small class="d-block text-danger">Pendiente de pago</small>`;
    if (saldo < -0.009) return `<span class="fw-bold text-primary fs-6">${soles(-saldo)}</span><small class="d-block text-primary">Adelantado (a favor de la empresa)</small>`;
    return `<span class="badge bg-success">AL DÍA</span>`;
}

function abrirPago(destino) {
    const select = document.getElementById('pagoA');
    const choferes = DB.choferes.filter(c => c.activo).map(c => `CHOFER|${c.nombre}`);
    const terceros = Object.keys(SALDOS_PAGO).filter(k => k.startsWith('TERCERO|'));
    const opcion = valor => `<option value="${esc(valor)}">${esc(valor.split('|')[1])}</option>`;
    const vacio = texto => `<option value="" disabled>(${texto})</option>`;

    select.innerHTML = `
        <option value="">— Selecciona —</option>
        <optgroup label="Choferes de la empresa">
            ${choferes.length ? choferes.map(opcion).join('') : vacio('aún no hay choferes registrados')}
            <option value="__NUEVO__">➕ Agregar chofer nuevo…</option>
        </optgroup>
        <optgroup label="Transportistas terceros">
            ${terceros.length ? terceros.map(opcion).join('') : vacio('aparecen al registrar una guía con vehículo tercero')}
        </optgroup>
    `;
    select.value = destino || '';

    document.getElementById('pagoFecha').value = hoyLocal();
    document.getElementById('pagoTipo').value = 'PAGO';
    document.getElementById('pagoMonto').value = '';
    document.getElementById('pagoNota').value = '';
    mostrarSaldoPago();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('nuevoPagoModal')).show();
}

function mostrarSaldoPago() {
    const valor = document.getElementById('pagoA').value;
    const info = document.getElementById('pago-saldo-info');
    if (valor === '__NUEVO__') {
        cerrarModal('nuevoPagoModal');
        setTimeout(() => abrirConfigChofer(null), 350);
        return;
    }
    if (!valor) { info.textContent = ''; return; }
    const saldo = SALDOS_PAGO[valor] || 0;
    info.className = `form-text fw-semibold ${saldo > 0 ? 'text-danger' : 'text-success'}`;
    info.textContent = saldo > 0 ? `Saldo pendiente: ${soles(saldo)}` : saldo < 0 ? `Tiene adelantado ${soles(-saldo)}` : 'Está al día.';
    if (saldo > 0) document.getElementById('pagoMonto').placeholder = saldo.toFixed(2);
}

async function guardarPago(e) {
    e.preventDefault();
    const valor = document.getElementById('pagoA').value;
    if (!valor) { alert('Selecciona a quién se le paga.'); return; }

    const [destino, nombre] = valor.split('|');
    const esAdelanto = document.getElementById('pagoTipo').value === 'ADELANTO';
    const nota = document.getElementById('pagoNota').value.trim();
    const esTercero = destino === 'TERCERO';

    const registro = {
        tipo: 'Gasto',
        fecha: document.getElementById('pagoFecha').value,
        monto: num(document.getElementById('pagoMonto').value),
        categoria: esTercero ? CATEGORIA_PAGO_TERCERO : (esAdelanto ? CATEGORIA_ADELANTO_CHOFER : CATEGORIA_PLANILLA_CHOFER),
        concepto: `${esAdelanto ? 'Adelanto' : 'Pago'} ${esTercero ? 'transportista' : 'chofer'} - ${nombre}${nota ? ' (' + nota + ')' : ''}`,
        conductor: esTercero ? null : nombre,
        tercero: esTercero ? nombre : null
    };

    const ok = await ejecutar(supabaseClient.from('gastos').insert([registro]), 'No se pudo registrar el pago');
    if (!ok) return;

    cerrarModal('nuevoPagoModal');
    await renderizarTodo();
    mostrarAlerta(`¡${esAdelanto ? 'Adelanto' : 'Pago'} de ${soles(registro.monto)} a ${nombre} registrado y descontado de caja!`, 'success');
}

// id = null → agregar un chofer nuevo; con id → editar su configuración
function abrirConfigChofer(id) {
    const nuevo = id === null;
    const c = nuevo
        ? { id: '', nombre: '', modalidad: 'QUINCENAL', sueldo_mensual: 2500, viaticos_mensual: 500, pago_diario: 100, activo: true }
        : DB.choferes.find(ch => ch.id === id);
    if (!c) return;

    const inputNombre = document.getElementById('choferNombre');
    inputNombre.readOnly = !nuevo; // el nombre no se cambia después: así se enlaza con sus guías
    document.querySelector('#configChoferModal .modal-title').innerHTML =
        `<i class="bi ${nuevo ? 'bi-person-plus' : 'bi-gear'} me-2"></i>${nuevo ? 'Agregar Chofer' : 'Configurar Chofer'}`;

    document.getElementById('choferId').value = c.id;
    inputNombre.value = c.nombre;
    document.getElementById('choferModalidad').value = c.modalidad;
    document.getElementById('choferSueldo').value = num(c.sueldo_mensual).toFixed(2);
    document.getElementById('choferViaticos').value = num(c.viaticos_mensual).toFixed(2);
    document.getElementById('choferDiario').value = num(c.pago_diario).toFixed(2);
    document.getElementById('choferActivo').checked = !!c.activo;
    toggleCamposChofer();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('configChoferModal')).show();
    if (nuevo) setTimeout(() => inputNombre.focus(), 400);
}

function toggleCamposChofer() {
    const diario = document.getElementById('choferModalidad').value === 'DIARIO';
    document.getElementById('grupoSueldoChofer').classList.toggle('d-none', diario);
    document.getElementById('grupoDiarioChofer').classList.toggle('d-none', !diario);
}

async function guardarConfigChofer(e) {
    e.preventDefault();
    const id = Number(document.getElementById('choferId').value);
    const cambios = {
        modalidad: document.getElementById('choferModalidad').value,
        sueldo_mensual: num(document.getElementById('choferSueldo').value),
        viaticos_mensual: num(document.getElementById('choferViaticos').value),
        pago_diario: num(document.getElementById('choferDiario').value),
        activo: document.getElementById('choferActivo').checked
    };
    let operacion;
    if (id) {
        operacion = supabaseClient.from('choferes').update(cambios).eq('id', id);
    } else {
        const nombre = nombreGuardado(document.getElementById('choferNombre').value);
        if (!nombre) { alert('Escribe el nombre del chofer.'); return; }
        const existente = DB.choferes.find(c => normNombre(c.nombre) === normNombre(nombre));
        if (existente && existente.activo) {
            alert(`${existente.nombre} ya está registrado. Búscalo en la lista y usa el botón ⚙ para configurarlo.`);
            return;
        }
        if (existente) {
            if (!confirm(`${existente.nombre} ya estaba registrado pero DESACTIVADO.\n\n¿Reactivarlo con la modalidad y montos que elegiste?`)) return;
            cambios.activo = true;
            const ok = await ejecutar(supabaseClient.from('choferes').update(cambios).eq('id', existente.id), 'No se pudo reactivar el chofer');
            if (!ok) return;
            cerrarModal('configChoferModal');
            await renderizarTodo();
            mostrarAlerta(`¡${existente.nombre} reactivado! Ya aparece en la lista de pagos.`, 'success');
            return;
        }
        operacion = supabaseClient.from('choferes').insert([{ nombre, ...cambios }]);
    }

    const ok = await ejecutar(operacion, 'No se pudo guardar el chofer');
    if (!ok) return;
    cerrarModal('configChoferModal');
    await renderizarTodo();
    mostrarAlerta(id ? '¡Datos del chofer actualizados!' : '¡Chofer agregado! Ya puedes registrarle pagos y adelantos.', 'success');
}

// -------------------------------------------------------------
// CONTABILIDAD / CAJA
// -------------------------------------------------------------
function actualizarCategoriasMovimiento() {
    const tipo = document.getElementById('tipoMovimiento').value;
    const lista = (tipo === 'Ingreso') ? CATEGORIAS_INGRESOS : CATEGORIAS_GASTOS;
    document.getElementById('categoriaGasto').innerHTML = lista.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

async function guardarMovimientoCaja(e) {
    e.preventDefault();
    const nuevoGasto = {
        tipo: document.getElementById('tipoMovimiento').value,
        fecha: document.getElementById('fechaGasto').value,
        concepto: document.getElementById('conceptoGasto').value.trim(),
        monto: num(document.getElementById('montoGasto').value),
        categoria: document.getElementById('categoriaGasto').value
    };
    const ok = await ejecutar(supabaseClient.from('gastos').insert([nuevoGasto]), 'No se pudo registrar el movimiento');
    if (!ok) return;

    e.target.reset();
    document.getElementById('fechaGasto').value = hoyLocal();
    actualizarCategoriasMovimiento();
    await renderizarTodo();
    mostrarAlerta('¡Movimiento contable registrado con éxito!', 'success');
}

function totalesFletes() {
    const total = DB.guias.reduce((acc, g) => acc + num(g.total_a_facturar), 0);
    const porCobrar = DB.guias
        .filter(g => estadoFacturacion(g) === 'FACTURADO' && estadoPagoGuia(g) !== 'PAGADO')
        .reduce((acc, g) => acc + num(g.total_a_facturar), 0);
    const cobrado = DB.guias
        .filter(g => estadoPagoGuia(g) === 'PAGADO')
        .reduce((acc, g) => acc + num(g.total_a_facturar), 0);
    return { total, porCobrar, cobrado };
}

function renderizarGastos() {
    let ingresos = 0;
    let gastos = 0;

    document.getElementById('tabla-gastos-body').innerHTML = DB.gastos.map((g) => {
        const esIngreso = g.tipo === 'Ingreso';
        const monto = num(g.monto);
        if (esIngreso) ingresos += monto;
        else gastos += monto;

        return `
            <tr>
                <td class="fw-semibold">${esc(g.fecha || '-')}</td>
                <td><span class="badge ${esIngreso ? 'bg-success' : 'bg-danger'}">${esc(g.tipo || 'Gasto')}</span></td>
                <td class="fw-semibold text-dark">${esc(g.concepto)}</td>
                <td><span class="badge bg-secondary">${esc(g.categoria || 'Gastos Administrativos')}</span></td>
                <td class="fw-bold ${esIngreso ? 'text-success' : 'text-danger'}">${esIngreso ? '+' : '-'} ${soles(monto)}</td>
                <td class="td-acciones"><button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarGasto(${g.id})"><i class="bi bi-trash"></i></button></td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="6" class="text-center text-muted">No hay movimientos registrados.</td></tr>`;

    const { porCobrar, cobrado } = totalesFletes();
    const balance = cobrado + ingresos - gastos;
    document.getElementById('balance-caja').textContent = `Balance de Caja: ${soles(balance)}`;
    document.getElementById('balance-caja').className = `badge ${balance >= 0 ? 'bg-success' : 'bg-danger'} fs-6 d-block mb-1 shadow-sm`;
    document.getElementById('por-cobrar-caja').textContent = `Por cobrar (facturado): ${soles(porCobrar)}`;
}

async function eliminarGasto(id) {
    const gasto = DB.gastos.find(g => g.id === id);
    const aviso = gasto && (gasto.conductor || gasto.tercero)
        ? `\n\nEs un pago a ${gasto.conductor || gasto.tercero}: su saldo pendiente volverá a subir.`
        : '';
    if (!confirm('¿Eliminar este movimiento de caja?' + aviso)) return;
    await ejecutar(supabaseClient.from('gastos').delete().eq('id', id), 'No se pudo eliminar');
    await renderizarTodo();
}

function actualizarKPIs() {
    const { total, porCobrar, cobrado } = totalesFletes();
    const gastos = DB.gastos.filter(g => g.tipo !== 'Ingreso').reduce((acc, g) => acc + num(g.monto), 0);

    animarSoles('kpi-fletes', total);
    animarSoles('kpi-por-cobrar', porCobrar);
    animarSoles('kpi-cobrado', cobrado);
    animarSoles('kpi-gastos', gastos);
    document.getElementById('kpi-viajes').textContent = DB.guias.length;
}

// El número "sube" desde el valor anterior hasta el nuevo
function animarSoles(id, valor) {
    const el = document.getElementById(id);
    const inicio = num(el.dataset.valor);
    el.dataset.valor = valor;
    if (inicio === valor || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = soles(valor);
        return;
    }
    const t0 = performance.now();
    const duracion = 800;
    const paso = ahora => {
        const p = Math.min((ahora - t0) / duracion, 1);
        const suave = 1 - Math.pow(1 - p, 3);
        el.textContent = soles(inicio + (valor - inicio) * suave);
        if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
}

// -------------------------------------------------------------
// GRÁFICOS DEL PANEL
// -------------------------------------------------------------
function renderizarGraficos() {
    if (!window.Chart) return;

    // Fletes de los últimos 6 meses
    const [anio, mes] = hoyLocal().slice(0, 7).split('-').map(Number);
    const meses = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(anio, mes - 1 - i, 1);
        meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const guiasDelMes = m => DB.guias.filter(g => String(g.fecha || '').startsWith(m));
    const totales = meses.map(m => guiasDelMes(m).reduce((acc, g) => acc + num(g.total_a_facturar), 0));
    const viajes = meses.map(m => guiasDelMes(m).length);
    const etiquetasMes = meses.map(m => {
        const texto = new Date(m + '-15T12:00:00').toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    });

    dibujarBarras('grafico-fletes', etiquetasMes, totales, {
        color: COLOR_GRAFICO_FLETES,
        hover: COLOR_GRAFICO_FLETES_HOVER,
        detalle: i => `${viajes[i]} ${viajes[i] === 1 ? 'viaje' : 'viajes'}`
    });
    document.getElementById('grafico-fletes-total').textContent = `${soles(totales.reduce((a, b) => a + b, 0))} en 6 meses`;

    // Gastos del mes actual por categoría (las 5 mayores + "Otros")
    const mesActual = hoyLocal().slice(0, 7);
    const porCategoria = {};
    DB.gastos
        .filter(g => g.tipo !== 'Ingreso' && String(g.fecha || '').startsWith(mesActual))
        .forEach(g => {
            const cat = g.categoria || 'Otros';
            porCategoria[cat] = (porCategoria[cat] || 0) + num(g.monto);
        });
    let categorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    if (categorias.length > 6) {
        const otros = categorias.slice(5).reduce((acc, [, v]) => acc + v, 0);
        categorias = [...categorias.slice(0, 5), ['Otros', otros]];
    }

    const nombreMes = new Date(mesActual + '-15T12:00:00').toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    const totalGastosMes = categorias.reduce((acc, [, v]) => acc + v, 0);
    document.getElementById('grafico-gastos-subtitulo').textContent = `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} · Total ${soles(totalGastosMes)}`;

    const hayGastos = categorias.length > 0;
    document.getElementById('grafico-gastos').parentElement.classList.toggle('d-none', !hayGastos);
    document.getElementById('grafico-gastos-vacio').classList.toggle('d-none', hayGastos);
    if (hayGastos) {
        dibujarBarras('grafico-gastos', categorias.map(([c]) => c.length > 26 ? c.slice(0, 25) + '…' : c), categorias.map(([, v]) => v), {
            color: COLOR_GRAFICO_GASTOS,
            hover: COLOR_GRAFICO_GASTOS_HOVER,
            horizontal: true,
            detalle: i => `${Math.round(categorias[i][1] / totalGastosMes * 100)}% de los gastos del mes`
        });
    }
}

// Gráfico de barras de una sola serie (crea o actualiza)
function dibujarBarras(idCanvas, etiquetas, valores, opciones) {
    const ejeValor = opciones.horizontal ? 'x' : 'y';
    const ejeCategoria = opciones.horizontal ? 'y' : 'x';
    const existente = GRAFICOS[idCanvas];

    if (existente) {
        existente.data.labels = etiquetas;
        existente.data.datasets[0].data = valores;
        existente.update();
        return;
    }

    const formatoEje = v => 'S/ ' + Number(v).toLocaleString('es-PE', { maximumFractionDigits: 0 });
    GRAFICOS[idCanvas] = new Chart(document.getElementById(idCanvas), {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [{
                data: valores,
                backgroundColor: opciones.color,
                hoverBackgroundColor: opciones.hover,
                borderRadius: 4,
                borderSkipped: 'start',
                maxBarThickness: opciones.horizontal ? 22 : 38
            }]
        },
        options: {
            indexAxis: ejeCategoria === 'y' ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 800, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1c2a1e',
                    titleFont: { family: 'Poppins', weight: '600' },
                    bodyFont: { family: 'Nunito', weight: '700' },
                    padding: 12,
                    cornerRadius: 10,
                    displayColors: false,
                    callbacks: {
                        label: c => soles(c.parsed[ejeValor]),
                        afterLabel: c => opciones.detalle ? opciones.detalle(c.dataIndex) : ''
                    }
                }
            },
            scales: {
                [ejeValor]: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: COLOR_GRILLA },
                    ticks: { color: COLOR_TEXTO_EJES, font: { family: 'Nunito', size: 11 }, callback: formatoEje, maxTicksLimit: 5 }
                },
                [ejeCategoria]: {
                    border: { display: false },
                    grid: { display: false },
                    ticks: { color: COLOR_TEXTO_EJES, font: { family: 'Nunito', size: 11, weight: '700' } }
                }
            }
        }
    });
}

// -------------------------------------------------------------
// MANTENIMIENTO
// -------------------------------------------------------------
async function guardarMantenimiento(e) {
    e.preventDefault();
    const nuevoMant = {
        placa: document.getElementById('mantPlaca').value.trim(),
        desc_trabajo: document.getElementById('mantDesc').value.trim(),
        taller: document.getElementById('mantTaller').value.trim(),
        estado: document.getElementById('mantEstado').value
    };
    const ok = await ejecutar(supabaseClient.from('mantenimiento').insert([nuevoMant]), 'No se pudo registrar el mantenimiento');
    if (!ok) return;

    e.target.reset();
    cerrarModal('nuevoMantenimientoModal');
    await renderizarTodo();
    mostrarAlerta('¡Mantenimiento programado con éxito!', 'warning');
}

function renderizarMantenimiento() {
    const admin = esAdmin();
    document.getElementById('tabla-mantenimiento-body').innerHTML = DB.mantenimiento.map((m) => `
        <tr>
            <td class="fw-bold">${esc(m.placa)}</td>
            <td>${esc(m.desc_trabajo)}</td>
            <td>${esc(m.taller)}</td>
            <td><span class="badge ${m.estado === 'Operativo' ? 'bg-success' : 'bg-warning text-dark'}">${esc(m.estado)}</span></td>
            <td class="td-acciones">
                ${admin ? `<button class="btn btn-sm btn-outline-danger shadow-sm" onclick="eliminarMantenimiento(${m.id})"><i class="bi bi-trash"></i></button>` : '<span class="text-muted small">Sin permisos</span>'}
            </td>
        </tr>
    `).join('') || `<tr><td colspan="5" class="text-center text-muted">Sin mantenimientos.</td></tr>`;
}

async function eliminarMantenimiento(id) {
    if (!confirm('¿Eliminar este registro de mantenimiento?')) return;
    await ejecutar(supabaseClient.from('mantenimiento').delete().eq('id', id), 'No se pudo eliminar');
    await renderizarTodo();
}

// -------------------------------------------------------------
// BITÁCORA DIARIA DE KILOMETRAJE (cochera → cochera, unidad propia)
// -------------------------------------------------------------
const UNIDAD_PROPIA = 'C5T-850';

function guiasPropiasDelDia(fecha) {
    return DB.guias.filter(g => !esGuiaTercero(g) && g.fecha === fecha);
}

function tieneLlegada(b) {
    return b.km_llegada !== null && b.km_llegada !== undefined && b.km_llegada !== '';
}

function formatoKm(n) {
    return Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 }) + ' km';
}

// El registro del día anterior más cercano (para revisar que el odómetro sea continuo)
function bitacoraAnterior(fecha) {
    return DB.bitacora
        .filter(b => b.unidad === UNIDAD_PROPIA && b.fecha < fecha)
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
}

function revisarBitacora(b) {
    if (!tieneLlegada(b)) return { clase: 'bg-info text-dark', texto: 'Falta km de llegada', icono: 'bi-hourglass-split' };
    const previo = bitacoraAnterior(b.fecha);
    if (previo && tieneLlegada(previo)) {
        const diferencia = num(b.km_salida) - num(previo.km_llegada);
        if (diferencia > 0) return { clase: 'bg-warning text-dark', texto: `${formatoKm(diferencia)} sin registrar desde el ${previo.fecha}`, icono: 'bi-exclamation-triangle-fill' };
        if (diferencia < 0) return { clase: 'bg-danger', texto: `Salida menor que la llegada del ${previo.fecha}`, icono: 'bi-x-octagon-fill' };
    }
    return { clase: 'bg-success', texto: 'Correcto', icono: 'bi-check-circle-fill' };
}

function renderizarBitacora() {
    const admin = esAdmin();
    const mes = document.getElementById('bitacoraMes').value;
    const enMes = f => !mes || String(f || '').startsWith(mes);

    // Registros del mes + días con viajes propios que no tienen registro
    const filas = DB.bitacora.filter(b => b.unidad === UNIDAD_PROPIA && enMes(b.fecha)).map(b => ({ fecha: b.fecha, b }));
    const fechasRegistradas = new Set(DB.bitacora.map(b => b.fecha));
    new Set(DB.guias.filter(g => !esGuiaTercero(g) && enMes(g.fecha)).map(g => g.fecha))
        .forEach(fecha => { if (!fechasRegistradas.has(fecha)) filas.push({ fecha, b: null }); });
    filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    let kmMes = 0, diasCompletos = 0, fletesConKm = 0;

    document.getElementById('tabla-bitacora-body').innerHTML = filas.map(({ fecha, b }) => {
        const guias = guiasPropiasDelDia(fecha);
        const fletes = guias.reduce((acc, g) => acc + num(g.subtotal || g.tarifa_sin_igv), 0);
        const viajes = guias.length
            ? `<span class="fw-bold">${guias.length} ${guias.length === 1 ? 'viaje' : 'viajes'}</span><small class="d-block text-muted">${guias.map(g => esc(g.destinatario)).join(', ')}</small>`
            : '<span class="text-muted">Sin guías</span>';

        if (!b) {
            return `
                <tr class="fila-pendiente">
                    <td class="fw-semibold">${esc(fecha)}</td>
                    <td>${esc(guias[0]?.conductor || '-')}</td>
                    <td colspan="3" class="text-warning-emphasis fw-semibold"><i class="bi bi-exclamation-triangle-fill me-1"></i>Hubo viajes pero no se anotó el kilometraje</td>
                    <td>${viajes}</td>
                    <td>${soles(fletes)}</td>
                    <td class="text-muted">—</td>
                    <td><span class="badge bg-warning text-dark">Sin registro</span></td>
                    <td class="td-acciones"><button class="btn btn-sm btn-primary" onclick="abrirBitacora(null, ${jsArg(fecha)})"><i class="bi bi-plus-lg"></i> Registrar</button></td>
                </tr>
            `;
        }

        const recorrido = tieneLlegada(b) ? num(b.km_llegada) - num(b.km_salida) : null;
        if (recorrido !== null) {
            kmMes += recorrido;
            diasCompletos++;
            fletesConKm += fletes;
        }
        const revision = revisarBitacora(b);
        const solesKm = recorrido > 0 && fletes > 0 ? soles(fletes / recorrido) : '—';

        return `
            <tr>
                <td class="fw-semibold">${esc(b.fecha)}</td>
                <td>${esc(b.conductor || '-')}${b.obs ? `<small class="d-block text-muted">${esc(b.obs)}</small>` : ''}</td>
                <td class="font-monospace">${Number(b.km_salida).toLocaleString('es-PE')}</td>
                <td class="font-monospace">${tieneLlegada(b) ? Number(b.km_llegada).toLocaleString('es-PE') : '<span class="text-muted">—</span>'}</td>
                <td>${recorrido !== null ? `<span class="badge rounded-pill bg-primary fs-6">${formatoKm(recorrido)}</span>` : '<span class="text-muted">En ruta…</span>'}</td>
                <td>${viajes}</td>
                <td>${soles(fletes)}</td>
                <td class="fw-bold">${solesKm}</td>
                <td><span class="badge ${revision.clase}"><i class="bi ${revision.icono} me-1"></i>${esc(revision.texto)}</span></td>
                <td class="td-acciones text-nowrap">
                    <button class="btn btn-sm btn-outline-primary" onclick="abrirBitacora(${b.id})" title="${tieneLlegada(b) ? 'Editar' : 'Completar km de llegada'}"><i class="bi ${tieneLlegada(b) ? 'bi-pencil' : 'bi-flag-fill'}"></i></button>
                    ${admin ? `<button class="btn btn-sm btn-outline-danger" onclick="eliminarBitacora(${b.id})"><i class="bi bi-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="10" class="text-center text-muted p-4"><i class="bi bi-speedometer fs-3 d-block mb-1 text-success opacity-50"></i>Sin registros en este mes. Registra el km de salida al empezar el día.</td></tr>`;

    document.getElementById('bit-km-mes').textContent = formatoKm(kmMes);
    document.getElementById('bit-dias').textContent = diasCompletos;
    document.getElementById('bit-promedio').textContent = formatoKm(diasCompletos ? kmMes / diasCompletos : 0);
    document.getElementById('bit-soles-km').textContent = kmMes > 0 ? soles(fletesConKm / kmMes) : 'S/ 0.00';
}

function llenarFormBitacora(b) {
    document.getElementById('bitacoraId').value = b.id;
    document.getElementById('bitacoraFecha').value = b.fecha;
    document.getElementById('bitacoraConductor').value = b.conductor || '';
    document.getElementById('bitacoraSalida').value = b.km_salida;
    document.getElementById('bitacoraLlegada').value = tieneLlegada(b) ? b.km_llegada : '';
    document.getElementById('bitacoraObs').value = b.obs || '';
    document.getElementById('bitacoraTitulo').textContent = tieneLlegada(b) ? 'Editar Día' : 'Completar Llegada';
}

function abrirBitacora(id, fecha) {
    document.getElementById('form-bitacora').reset();
    document.getElementById('bitacoraId').value = '';
    document.getElementById('bitacoraTitulo').textContent = 'Registrar Día';

    const b = id ? DB.bitacora.find(x => x.id === id) : null;
    if (b) {
        llenarFormBitacora(b);
        calcularRecorridoBitacora();
    } else {
        document.getElementById('bitacoraFecha').value = fecha || hoyLocal();
        alCambiarFechaBitacora();
    }

    const modal = document.getElementById('bitacoraModal');
    bootstrap.Modal.getOrCreateInstance(modal).show();
    setTimeout(() => {
        const llegada = document.getElementById('bitacoraLlegada');
        (document.getElementById('bitacoraId').value && !llegada.value ? llegada : document.getElementById('bitacoraSalida')).focus();
    }, 400);
}

// Al elegir la fecha: si ya hay registro se pasa a completarlo; si no, se sugieren chofer y km de salida
function alCambiarFechaBitacora() {
    if (document.getElementById('bitacoraId').value) {
        calcularRecorridoBitacora();
        return;
    }
    const fecha = document.getElementById('bitacoraFecha').value;
    const existente = DB.bitacora.find(b => b.fecha === fecha && b.unidad === UNIDAD_PROPIA);
    if (existente) {
        llenarFormBitacora(existente);
        calcularRecorridoBitacora();
        return;
    }

    const guias = guiasPropiasDelDia(fecha);
    if (guias.length && !document.getElementById('bitacoraConductor').value) {
        document.getElementById('bitacoraConductor').value = guias[0].conductor;
    }
    const previo = bitacoraAnterior(fecha);
    if (previo && tieneLlegada(previo) && !document.getElementById('bitacoraSalida').value) {
        document.getElementById('bitacoraSalida').value = num(previo.km_llegada);
    }
    calcularRecorridoBitacora();
}

function calcularRecorridoBitacora() {
    const caja = document.getElementById('bitacoraRecorrido');
    const aviso = document.getElementById('bitacoraAviso');
    const fecha = document.getElementById('bitacoraFecha').value;
    const salidaTxt = document.getElementById('bitacoraSalida').value;
    const llegadaTxt = document.getElementById('bitacoraLlegada').value;
    const salida = num(salidaTxt);
    const llegada = num(llegadaTxt);

    caja.className = 'recorrido-caja';
    if (salidaTxt && llegadaTxt) {
        const recorrido = llegada - salida;
        if (recorrido < 0) {
            caja.classList.add('recorrido-error');
            caja.innerHTML = '<i class="bi bi-x-octagon-fill"></i> <span>El km de regreso no puede ser menor que el de salida</span>';
        } else {
            const guias = guiasPropiasDelDia(fecha);
            const fletes = guias.reduce((acc, g) => acc + num(g.subtotal || g.tarifa_sin_igv), 0);
            const extra = guias.length && recorrido > 0 ? ` · ${guias.length} ${guias.length === 1 ? 'viaje' : 'viajes'} · ${soles(fletes / recorrido)} por km` : '';
            caja.classList.add('recorrido-ok');
            caja.innerHTML = `<i class="bi bi-signpost-split-fill"></i> <span>Recorrido del día: <strong>${formatoKm(recorrido)}</strong>${extra}</span>`;
        }
    } else if (salidaTxt) {
        caja.innerHTML = '<i class="bi bi-truck"></i> <span>Salida registrada. Completa el km al regresar a la cochera.</span>';
    } else {
        caja.innerHTML = '<i class="bi bi-signpost-split"></i> <span>Escribe los km para calcular el recorrido</span>';
    }

    // Continuidad del odómetro con el día anterior
    const previo = bitacoraAnterior(fecha);
    aviso.className = 'd-block mt-1';
    aviso.textContent = '';
    if (salidaTxt && previo && tieneLlegada(previo)) {
        const diferencia = salida - num(previo.km_llegada);
        if (diferencia > 0) {
            aviso.classList.add('text-warning-emphasis');
            aviso.textContent = `⚠ El ${previo.fecha} llegó con ${Number(previo.km_llegada).toLocaleString('es-PE')} km: hay ${formatoKm(diferencia)} sin registrar.`;
        } else if (diferencia < 0) {
            aviso.classList.add('text-danger');
            aviso.textContent = `⚠ El ${previo.fecha} llegó con ${Number(previo.km_llegada).toLocaleString('es-PE')} km: la salida no puede ser menor.`;
        } else {
            aviso.classList.add('text-success');
            aviso.textContent = `✔ Coincide con la llegada del ${previo.fecha}.`;
        }
    }
}

async function guardarBitacora(e) {
    e.preventDefault();
    const llegadaTxt = document.getElementById('bitacoraLlegada').value;
    const registro = {
        fecha: document.getElementById('bitacoraFecha').value,
        unidad: UNIDAD_PROPIA,
        conductor: nombreGuardado(document.getElementById('bitacoraConductor').value) || null,
        km_salida: num(document.getElementById('bitacoraSalida').value),
        km_llegada: llegadaTxt === '' ? null : num(llegadaTxt),
        obs: document.getElementById('bitacoraObs').value.trim() || null
    };
    if (registro.km_llegada !== null && registro.km_llegada < registro.km_salida) {
        alert('El km de regreso no puede ser menor que el km de salida.');
        return;
    }

    const id = Number(document.getElementById('bitacoraId').value);
    const operacion = id
        ? supabaseClient.from('bitacora').update(registro).eq('id', id)
        : supabaseClient.from('bitacora').insert([registro]);
    const ok = await ejecutar(operacion, 'No se pudo guardar la bitácora');
    if (!ok) return;

    cerrarModal('bitacoraModal');
    await renderizarTodo();
    mostrarAlerta(registro.km_llegada !== null
        ? `¡Día ${registro.fecha} registrado: ${formatoKm(registro.km_llegada - registro.km_salida)} recorridos!`
        : `¡Salida del ${registro.fecha} registrada! Recuerda completar el km al regresar.`, 'success');
}

async function eliminarBitacora(id) {
    if (!confirm('¿Eliminar este registro de kilometraje?')) return;
    await ejecutar(supabaseClient.from('bitacora').delete().eq('id', id), 'No se pudo eliminar');
    await renderizarTodo();
}

// -------------------------------------------------------------
// USUARIOS (solo administrador)
// -------------------------------------------------------------
function renderizarUsuarios() {
    document.getElementById('tabla-usuarios-body').innerHTML = DB.perfiles.map(p => {
        const esYo = p.id === USUARIO.id;
        return `
            <tr>
                <td class="fw-bold text-dark">${esc(p.nombre)} ${esYo ? '<span class="badge bg-secondary ms-1">Tú</span>' : ''}</td>
                <td>${esc(p.email)}</td>
                <td>
                    <select class="form-select form-select-sm" style="width: 140px;" onchange="cambiarRolUsuario('${p.id}', this.value)" ${esYo ? 'disabled' : ''}>
                        <option value="ASISTENTE" ${p.rol === 'ASISTENTE' ? 'selected' : ''}>ASISTENTE</option>
                        <option value="ADMIN" ${p.rol === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
                    </select>
                </td>
                <td>
                    <select class="form-select form-select-sm badge-select ${p.activo ? 'bg-success text-white' : 'bg-secondary text-white'}" style="width: 130px;" onchange="cambiarEstadoUsuario('${p.id}', this.value === 'true')" ${esYo ? 'disabled' : ''}>
                        <option value="true" ${p.activo ? 'selected' : ''}>ACTIVO</option>
                        <option value="false" ${!p.activo ? 'selected' : ''}>DESACTIVADO</option>
                    </select>
                </td>
                <td class="td-acciones">
                    <button class="btn btn-sm btn-outline-secondary shadow-sm" onclick="restablecerPasswordUsuario('${p.id}')" title="Enviar enlace para crear nueva contraseña">
                        <i class="bi bi-envelope-arrow-up me-1"></i> Restablecer contraseña
                    </button>
                </td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="5" class="text-center text-muted">Sin usuarios.</td></tr>`;
}

// -------------------------------------------------------------
// NAVEGACIÓN Y ALERTAS
// -------------------------------------------------------------
function cambiarSeccion(sectionId) {
    const link = document.querySelector(`.sidebar .nav-link[data-section="${sectionId}"]`);
    if (link && link.classList.contains('solo-admin') && !esAdmin()) return;

    document.querySelectorAll('.content-section').forEach(sec => sec.classList.add('d-none'));
    document.getElementById(sectionId)?.classList.remove('d-none');

    document.querySelectorAll('.sidebar .nav-link').forEach(l => {
        l.classList.toggle('active', l.getAttribute('data-section') === sectionId);
    });

    const [titulo, subtitulo] = TITULOS_SECCION[sectionId] || ['Aravema Group', ''];
    document.getElementById('page-title').textContent = titulo;
    document.getElementById('page-subtitle').textContent = subtitulo || saludo();

    toggleMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saludo() {
    const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Lima', hour: 'numeric', hour12: false }));
    const momento = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    const nombre = (USUARIO?.nombre || '').split(' ')[0];
    return `${momento}${nombre ? ', ' + nombre : ''} 🌱 Así va tu operación`;
}

// Abre o cierra el menú lateral en celular (sin argumento: alterna)
function toggleMenu(abrir) {
    document.body.classList.toggle('menu-abierto', abrir);
}

function mostrarAlerta(mensaje, tipo) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    // Los avisos se apilan (como máximo 3) para que un error no quede tapado por otro mensaje
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo} alert-dismissible fade show shadow-sm`;
    alerta.setAttribute('role', 'alert');
    alerta.innerHTML = `
        <i class="bi ${tipo === 'danger' ? 'bi-exclamation-octagon-fill' : 'bi-bell-fill'} me-2"></i> ${esc(mensaje)}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    alertContainer.appendChild(alerta);
    while (alertContainer.children.length > 3) alertContainer.firstElementChild.remove();

    setTimeout(() => {
        if (alerta.isConnected) bootstrap.Alert.getOrCreateInstance(alerta).close();
    }, tipo === 'danger' ? 10000 : 5000);
}
