/* ==========================================================================
   DASHBOARD STATE & CONFIGURATION
   ========================================================================== */
let allRecords = [];
let filteredRecords = [];
let selectedPatientKey = null;

// Instancias de Gráficos ApexCharts
let chartTrend = null;
let chartCategoryTrend = null; // Gráfico nuevo de solicitudes por categoría
let chartCenters = null;
let chartObras = null;

// Filtros Activos
const activeFilters = {
    search: '',
    year: '',
    period: '',
    sucursal: '',
    obrasocial: '',
    estado: '',
    evento: '',               // Filtro por Denominación del Evento
    category: '',             // Categoría (Pañales vs Asignaciones)
    selectedTroqueles: []     // Listado de troqueles seleccionados
};

/* ==========================================================================
   APP INITIALIZATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos de Lucide
    lucide.createIcons();
    
    // Cargar datos por primera vez
    loadDashboardData();
    
    // Registrar Event Listeners
    setupEventListeners();
});

/* ==========================================================================
   DATA LOADING
   ========================================================================== */
async function loadDashboardData() {
    updateStatusIndicator('orange', 'Cargando datos...');
    try {
        // 1. Cargar los datos. Si estamos en modo local (archivo compartido sin servidor), usamos data.js
        if (window.location.protocol === 'file:') {
            if (!window.dashboardData) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'data.js';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('No se pudo cargar data.js'));
                    document.head.appendChild(script);
                });
            }
            if (window.dashboardData && Array.isArray(window.dashboardData) && window.dashboardData.length > 0) {
                allRecords = window.dashboardData;
                console.log("Datos cargados exitosamente desde data.js (Red local)");
                showLastUpdated(window.lastUpdated || 'Desconocido');
            } else {
                throw new Error('No se pudo encontrar window.dashboardData');
            }
        } else {
            // Si estamos en HTTP (servidor local), descargamos data.json directamente (evitando el cache de data.js)
            console.log("Descargando data.json fresco...");
            const response = await fetch(`data.json?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error('No se pudo leer el archivo data.json');
            }
            allRecords = await response.json();

            // Intentar cargar la fecha de actualización desde metadata.json del directorio padre
            try {
                const metaRes = await fetch(`metadata.json?t=${Date.now()}`);
                if (metaRes.ok) {
                    const meta = await metaRes.json();
                    showLastUpdated(meta.last_updated);
                }
            } catch (err) {
                console.warn("No se pudo cargar la metadata de actualización:", err);
            }
        }
        
        // Categorizar cada registro dinámicamente según la Descripción
        allRecords.forEach(rec => {
            const descLower = (rec.descripcion || '').toLowerCase().trim();
            if (descLower.startsWith('asignacion') || descLower.startsWith('asignación')) {
                rec.categoria = 'Asignacion';
            } else if (descLower.includes('pañal') || descLower.includes('panal')) {
                rec.categoria = 'Pañales';
            } else {
                rec.categoria = 'Otro';
            }
        });
        
        // 2. Ocultar sincronización si se abre directamente como archivo compartido (CORS/protocolo file:)
        if (window.location.protocol === 'file:') {
            document.getElementById('btn-sync-db').style.display = 'none';
            updateStatusIndicator('green', 'Red Compartida (Lectura)');
        } else {
            updateStatusIndicator('green', 'Base de Datos (belgdbpa) En Vivo');
        }
        
        // Inicializar filtros y visualizaciones
        initFilterDropdowns();
        applyFilters();
        
    } catch (error) {
        console.error('Error al cargar datos:', error);
        updateStatusIndicator('red', 'Error al cargar datos locales');
        showToast('Error al cargar los datos. Genera una sincronización.', 'error');
    }
}

/* ==========================================================================
   STATUS INDICATOR & NOTIFICATIONS
   ========================================================================== */
function updateStatusIndicator(color, text) {
    const dot = document.querySelector('#db-status-indicator .status-dot');
    const label = document.getElementById('status-label');
    
    dot.className = 'status-dot ' + color;
    label.textContent = text;
}

function showLastUpdated(dateStr) {
    const label = document.getElementById('last-updated-label');
    if (label) {
        label.textContent = `Actualizado: ${dateStr}`;
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast-msg');
    const toastText = document.getElementById('toast-text');
    const toastIcon = document.getElementById('toast-icon');
    
    toastText.textContent = message;
    
    // Cambiar icono y estilo según tipo
    if (type === 'error') {
        toast.style.borderColor = 'var(--color-rejected)';
        toastIcon.setAttribute('data-lucide', 'alert-circle');
    } else if (type === 'success') {
        toast.style.borderColor = 'var(--color-approved)';
        toastIcon.setAttribute('data-lucide', 'check-circle');
    } else {
        toast.style.borderColor = 'var(--accent)';
        toastIcon.setAttribute('data-lucide', 'info');
    }
    
    lucide.createIcons();
    
    // Mostrar Toast animado
    toast.classList.add('active');
    
    // Ocultar tras 4 segundos
    setTimeout(() => {
        toast.classList.remove('active');
    }, 4000);
}

/* ==========================================================================
   FILTER MENUS POPULATION
   ========================================================================== */
function initFilterDropdowns() {
    // Obtener valores únicos de los datos cargados
    const years = new Set();
    const periods = new Set();
    const sucursales = new Set();
    const obrasSociales = new Set();
    const uniqueTroqueles = new Set();
    const uniqueEventos = new Set();
    
    allRecords.forEach(rec => {
        if (rec.fecha) {
            const yearStr = rec.fecha.substring(0, 4);
            if (yearStr && !isNaN(yearStr)) years.add(yearStr);
        }
        if (rec.periodo) periods.add(rec.periodo);
        if (rec.sucursal) sucursales.add(rec.sucursal);
        if (rec.obrasocial) obrasSociales.add(rec.obrasocial);
        if (rec.evento && rec.evento.trim()) uniqueEventos.add(rec.evento.trim());
        
        // Recopilar troqueles de los ítems
        if (rec.items && Array.isArray(rec.items)) {
            rec.items.forEach(item => {
                if (item.prac) uniqueTroqueles.add(item.prac);
            });
        }
    });
    
    // Poblar Selector de Año
    const selectYear = document.getElementById('filter-year');
    selectYear.innerHTML = '<option value="">Todos los años</option>';
    Array.from(years).sort().reverse().forEach(y => {
        selectYear.innerHTML += `<option value="${y}">${y}</option>`;
    });
    
    // Poblar Selector de Periodo (Mes)
    const selectPeriod = document.getElementById('filter-period');
    selectPeriod.innerHTML = '<option value="">Todos los períodos</option>';
    Array.from(periods).sort().reverse().forEach(p => {
        const pStr = p.toString();
        if (pStr.length === 6) {
            const year = pStr.substring(0, 4);
            const monthVal = parseInt(pStr.substring(4, 6));
            const monthNames = [
                "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
            ];
            const name = `${monthNames[monthVal - 1]} ${year}`;
            selectPeriod.innerHTML += `<option value="${p}">${name}</option>`;
        } else {
            selectPeriod.innerHTML += `<option value="${p}">${p}</option>`;
        }
    });
    
    // Poblar Selector de Centro Médico
    const selectSuc = document.getElementById('filter-sucursal');
    selectSuc.innerHTML = '<option value="">Todos los centros médicos</option>';
    Array.from(sucursales).sort().forEach(s => {
        selectSuc.innerHTML += `<option value="${s}">${s}</option>`;
    });
    
    // Poblar Selector de Obra Social
    const selectObra = document.getElementById('filter-obra-social');
    selectObra.innerHTML = '<option value="">Todas</option>';
    Array.from(obrasSociales).sort().forEach(o => {
        selectObra.innerHTML += `<option value="${o}">${o}</option>`;
    });

    // Poblar Selector de Eventos
    const selectEvento = document.getElementById('filter-evento');
    if (selectEvento) {
        selectEvento.innerHTML = '<option value="">Todos los eventos</option>';
        Array.from(uniqueEventos).sort().forEach(ev => {
            selectEvento.innerHTML += `<option value="${ev}">${ev}</option>`;
        });
    }

    // Poblar Lista de Troqueles en el Multiselect
    const optionsUl = document.getElementById('troqueles-options-ul');
    optionsUl.innerHTML = '';
    const sortedTroqueles = Array.from(uniqueTroqueles).sort((a, b) => parseInt(a) - parseInt(b));
    
    sortedTroqueles.forEach(tr => {
        optionsUl.innerHTML += `
            <li class="multiselect-option" data-value="${tr}">
                <input type="checkbox" id="chk-troquel-${tr}" value="${tr}">
                <span>${tr}</span>
            </li>
        `;
    });

    // Registrar Event listeners a las opciones dinámicas del multiselect
    document.querySelectorAll('.multiselect-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return; // Evitar doble disparo
            const chk = opt.querySelector('input[type="checkbox"]');
            chk.checked = !chk.checked;
            handleTroquelCheckboxChange();
        });
        
        opt.querySelector('input[type="checkbox"]').addEventListener('change', () => {
            handleTroquelCheckboxChange();
        });
    });
}

/* ==========================================================================
   EVENT LISTENERS Setup
   ========================================================================== */
function setupEventListeners() {
    // Sincronización de Base de Datos
    document.getElementById('btn-sync-db').addEventListener('click', syncDatabase);
    
    // Auditoria Asignaciones omitida en esta version
    
    // Cambios en los filtros
    document.getElementById('search-input').addEventListener('input', (e) => {
        activeFilters.search = e.target.value;
        const clearBtn = document.getElementById('btn-clear-search');
        clearBtn.style.display = e.target.value ? 'block' : 'none';
        applyFilters();
    });
    
    document.getElementById('btn-clear-search').addEventListener('click', () => {
        const input = document.getElementById('search-input');
        input.value = '';
        activeFilters.search = '';
        document.getElementById('btn-clear-search').style.display = 'none';
        applyFilters();
    });
    
    document.getElementById('filter-year').addEventListener('change', (e) => {
        activeFilters.year = e.target.value;
        applyFilters();
    });
    
    document.getElementById('filter-period').addEventListener('change', (e) => {
        activeFilters.period = e.target.value;
        applyFilters();
    });
    
    document.getElementById('filter-sucursal').addEventListener('change', (e) => {
        activeFilters.sucursal = e.target.value;
        applyFilters();
    });
    
    document.getElementById('filter-obra-social').addEventListener('change', (e) => {
        activeFilters.obrasocial = e.target.value;
        applyFilters();
    });
    
    document.getElementById('filter-status').addEventListener('change', (e) => {
        activeFilters.estado = e.target.value;
        applyFilters();
    });

    const filterEvento = document.getElementById('filter-evento');
    if (filterEvento) {
        filterEvento.addEventListener('change', (e) => {
            activeFilters.evento = e.target.value;
            applyFilters();
        });
    }

    document.getElementById('filter-category').addEventListener('change', (e) => {
        activeFilters.category = e.target.value;
        applyFilters();
    });

    // No amparo filter listener

    // LÓGICA DE CONTROL DEL MULTISELECT DE TROQUELES
    const dropdownBtn = document.getElementById('troqueles-dropdown-btn');
    const dropdownPanel = document.getElementById('troqueles-dropdown-panel');
    
    dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownBtn.classList.toggle('active');
        const isHidden = dropdownPanel.style.display === 'none';
        dropdownPanel.style.display = isHidden ? 'flex' : 'none';
    });

    // Cerrar menú al hacer clic fuera del control
    document.addEventListener('click', (e) => {
        const container = document.getElementById('multiselect-troqueles-container');
        if (container && !container.contains(e.target)) {
            dropdownBtn.classList.remove('active');
            dropdownPanel.style.display = 'none';
        }
    });

    // Buscador interno en el multiselect
    document.getElementById('troqueles-search-input').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('#troqueles-options-ul .multiselect-option').forEach(opt => {
            const val = opt.getAttribute('data-value').toLowerCase();
            if (val.includes(query)) {
                opt.style.display = 'flex';
            } else {
                opt.style.display = 'none';
            }
        });
    });

    // Botones de acción del multiselect
    document.getElementById('btn-troqueles-select-all').addEventListener('click', () => {
        document.querySelectorAll('#troqueles-options-ul .multiselect-option').forEach(opt => {
            if (opt.style.display !== 'none') {
                opt.querySelector('input[type="checkbox"]').checked = true;
            }
        });
        handleTroquelCheckboxChange();
    });

    document.getElementById('btn-troqueles-clear-all').addEventListener('click', () => {
        document.querySelectorAll('#troqueles-options-ul input[type="checkbox"]').forEach(chk => {
            chk.checked = false;
        });
        handleTroquelCheckboxChange();
    });
    
    // Botón de restablecer filtros
    document.getElementById('btn-reset-filters').addEventListener('click', resetFilters);
    
    // Botón de exportar a Excel
    document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
}

// Handler de cambio de estado en checkboxes de troqueles
function handleTroquelCheckboxChange() {
    const checkedBoxes = document.querySelectorAll('#troqueles-options-ul input[type="checkbox"]:checked');
    activeFilters.selectedTroqueles = Array.from(checkedBoxes).map(cb => cb.value);
    
    const label = document.getElementById('troqueles-selected-label');
    const totalSelected = activeFilters.selectedTroqueles.length;
    if (totalSelected === 0) {
        label.textContent = "Todos los troqueles";
    } else if (totalSelected === 1) {
        label.textContent = activeFilters.selectedTroqueles[0];
    } else {
        label.textContent = `${totalSelected} seleccionados`;
    }
    
    applyFilters();
}

/* ==========================================================================
   RESET FILTERS
   ========================================================================== */
function resetFilters() {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-year').value = '';
    document.getElementById('filter-period').value = '';
    document.getElementById('filter-sucursal').value = '';
    document.getElementById('filter-obra-social').value = '';
    document.getElementById('filter-status').value = '';
    if (document.getElementById('filter-evento')) document.getElementById('filter-evento').value = '';
    document.getElementById('filter-category').value = '';
    // No amparo field reset
    
    document.getElementById('btn-clear-search').style.display = 'none';
    
    // Limpiar multiselect
    document.querySelectorAll('#troqueles-options-ul input[type="checkbox"]').forEach(chk => {
        chk.checked = false;
    });
    document.getElementById('troqueles-selected-label').textContent = "Todos los troqueles";
    document.getElementById('troqueles-search-input').value = '';
    document.querySelectorAll('#troqueles-options-ul .multiselect-option').forEach(opt => {
        opt.style.display = 'flex';
    });
    
    activeFilters.search = '';
    activeFilters.year = '';
    activeFilters.period = '';
    activeFilters.sucursal = '';
    activeFilters.obrasocial = '';
    activeFilters.estado = '';
    activeFilters.evento = '';
    activeFilters.category = '';
    activeFilters.selectedTroqueles = [];
    // No amparo filter reset
    
    applyFilters();
    showToast('Filtros restablecidos');
}

/* ==========================================================================
   APPLY FILTERS & RE-RENDER EVERYTHING
   ========================================================================== */
function applyFilters() {
    const searchLower = activeFilters.search.toLowerCase().trim();
    
    filteredRecords = allRecords.filter(rec => {
        // 1. Filtro por buscador (Afiliado, CUIL, Historia clínica o Expediente)
        if (searchLower) {
            const afNombre = (rec.afiliado || '').toLowerCase();
            const cuilStr = (rec.cuil || '').toString().toLowerCase();
            const hiscliStr = (rec.hiscli || '').toString().toLowerCase();
            const numeroStr = (rec.numero || '').toString().toLowerCase();
            
            const matchSearch = afNombre.includes(searchLower) || 
                                cuilStr.includes(searchLower) || 
                                hiscliStr.includes(searchLower) ||
                                numeroStr.includes(searchLower);
            if (!matchSearch) return false;
        }
        
        // 2. Filtro Año
        if (activeFilters.year) {
            const y = rec.fecha ? rec.fecha.substring(0, 4) : '';
            if (y !== activeFilters.year) return false;
        }
        
        // 3. Filtro Periodo
        if (activeFilters.period) {
            if (rec.periodo.toString() !== activeFilters.period) return false;
        }
        
        // 4. Filtro Sucursal
        if (activeFilters.sucursal) {
            if (rec.sucursal !== activeFilters.sucursal) return false;
        }
        
        // 5. Filtro Obra Social
        if (activeFilters.obrasocial) {
            if (rec.obrasocial !== activeFilters.obrasocial) return false;
        }
        
        // 6. Filtro Estado
        if (activeFilters.estado) {
            if (rec.estado !== activeFilters.estado) return false;
        }

        // 6.5. Filtro Evento
        if (activeFilters.evento) {
            if (rec.evento !== activeFilters.evento) return false;
        }
        
        // 7. Filtro Categoría (Pañales vs Asignaciones)
        if (activeFilters.category) {
            if (rec.categoria !== activeFilters.category) return false;
        }

        // 8. Filtro Troqueles (Multiselect)
        if (activeFilters.selectedTroqueles && activeFilters.selectedTroqueles.length > 0) {
            const items = rec.items || [];
            const hasMatchingTroquel = items.some(item => activeFilters.selectedTroqueles.includes(String(item.prac)));
            if (!hasMatchingTroquel) return false;
        }

        // No amparo filter logic
        
        return true;
    });
    
    // Verificar si el paciente seleccionado sigue presente en los registros filtrados
    if (selectedPatientKey) {
        const patientExists = filteredRecords.some(rec => {
            const key = rec.hiscli || rec.cuil || rec.afiliado;
            return key === selectedPatientKey;
        });
        if (!patientExists) {
            selectedPatientKey = null;
        }
    }
    
    // Actualizar contador
    document.getElementById('txt-results-count').textContent = 
        `Mostrando ${filteredRecords.length} de ${allRecords.length} registros`;
        
    // Renderizar KPIs, Gráficos y Lista
    renderKPIs();
    renderCharts();
    renderPatientList();
}

/* ==========================================================================
   KPI CALCULATIONS & RENDERING
   ========================================================================== */
function renderKPIs() {
    // Si hay un paciente seleccionado, aislar sus datos de los registros filtrados para KPIs
    let recordsToUse = filteredRecords;
    if (selectedPatientKey) {
        recordsToUse = filteredRecords.filter(rec => {
            const key = rec.hiscli || rec.cuil || rec.afiliado;
            return key === selectedPatientKey;
        });
    }

    const totalExp = recordsToUse.length;
    
    // Calcular total de pañales (unidades entregadas en expedientes Aprobados)
    let totalUnits = 0;
    // Calcular importe estimado total de expedientes aprobados
    let totalCost = 0;
    
    // Pacientes únicos en el filtrado
    const uniquePatients = new Set();
    
    // Contadores de estado
    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    
    recordsToUse.forEach(rec => {
        // Clave única del paciente
        const pKey = rec.hiscli || rec.cuil || rec.afiliado;
        if (pKey) uniquePatients.add(pKey);
        
        // Sumar unidades de pañales e importe estimado si está Aprobado
        if (rec.estado === 'Aprobado') {
            approvedCount++;
            if (rec.items && Array.isArray(rec.items)) {
                rec.items.forEach(item => {
                    totalUnits += (item.can || 0);
                });
            }
            totalCost += (rec.valoresti || 0);
        } else if (rec.estado === 'Pendiente') {
            pendingCount++;
        } else if (rec.estado === 'Rechazado') {
            rejectedCount++;
        }
    });
    
    // Escribir valores en la interfaz
    document.getElementById('kpi-total-exp').textContent = totalExp.toLocaleString('es-AR');
    document.getElementById('kpi-total-units').textContent = totalUnits.toLocaleString('es-AR');
    document.getElementById('kpi-total-patients').textContent = uniquePatients.size.toLocaleString('es-AR');
    document.getElementById('kpi-total-cost').textContent = `$ ${totalCost.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    // Barra de distribución de estados
    const barApp = document.getElementById('bar-approved');
    const barPen = document.getElementById('bar-pending');
    const barRej = document.getElementById('bar-rejected');
    
    const pctApp = totalExp ? (approvedCount / totalExp) * 100 : 0;
    const pctPen = totalExp ? (pendingCount / totalExp) * 100 : 0;
    const pctRej = totalExp ? (rejectedCount / totalExp) * 100 : 0;
    
    if (barApp) barApp.style.width = `${pctApp}%`;
    if (barPen) barPen.style.width = `${pctPen}%`;
    if (barRej) barRej.style.width = `${pctRej}%`;
    
    document.getElementById('txt-approved').textContent = `Aprobados: ${approvedCount.toLocaleString('es-AR')} (${pctApp.toFixed(1)}%)`;
    document.getElementById('txt-pending').textContent = `Pendientes: ${pendingCount.toLocaleString('es-AR')} (${pctPen.toFixed(1)}%)`;
    document.getElementById('txt-rejected').textContent = `Rechazados: ${rejectedCount.toLocaleString('es-AR')} (${pctRej.toFixed(1)}%)`;
}

/* ==========================================================================
   CHARTS RENDERING & DYNAMIC UPDATING
   ========================================================================== */
function renderCharts() {
    // Si hay un paciente seleccionado, aislar sus datos de los registros filtrados para los gráficos
    let recordsToUse = filteredRecords;
    if (selectedPatientKey) {
        recordsToUse = filteredRecords.filter(rec => {
            const key = rec.hiscli || rec.cuil || rec.afiliado;
            return key === selectedPatientKey;
        });
    }

    // Opción base común para ApexCharts
    const chartBaseOptions = {
        theme: { mode: 'dark' },
        chart: {
            background: 'transparent',
            foreColor: '#94a3b8',
            fontFamily: 'Outfit, sans-serif',
            toolbar: { show: false }
        },
        grid: {
            borderColor: 'rgba(255, 255, 255, 0.05)',
            xaxis: { lines: { show: false } }
        }
    };

    // ----------------------------------------------------
    // 1. AGRUPACIÓN PARA EL GRÁFICO DE TENDENCIA MENSUAL Y DE CATEGORÍAS
    // ----------------------------------------------------
    const trendMap = {};
    const catTrendMap = {};
    
    recordsToUse.forEach(rec => {
        const p = rec.periodo;
        if (!p) return;
        
        if (!trendMap[p]) {
            trendMap[p] = { aprobado: 0, pendiente: 0, rechazado: 0 };
        }
        if (!catTrendMap[p]) {
            catTrendMap[p] = { panales: 0, asignacion: 0 };
        }
        
        if (rec.estado === 'Aprobado') trendMap[p].aprobado++;
        else if (rec.estado === 'Pendiente') trendMap[p].pendiente++;
        else if (rec.estado === 'Rechazado') trendMap[p].rechazado++;
        
        if (rec.categoria === 'Pañales') catTrendMap[p].panales++;
        else if (rec.categoria === 'Asignacion') catTrendMap[p].asignacion++;
    });
    
    // Obtener y ordenar periodos consolidados de ambas tendencias
    const sortedPeriods = Object.keys({ ...trendMap, ...catTrendMap }).sort();
    
    const trendCategories = sortedPeriods.map(p => {
        const pStr = p.toString();
        const yearShort = pStr.substring(2, 4);
        const month = pStr.substring(4, 6);
        return `${month}/${yearShort}`;
    });
    
    const seriesApproved = sortedPeriods.map(p => trendMap[p] ? trendMap[p].aprobado : 0);
    const seriesPending = sortedPeriods.map(p => trendMap[p] ? trendMap[p].pendiente : 0);
    const seriesRejected = sortedPeriods.map(p => trendMap[p] ? trendMap[p].rechazado : 0);
    
    const seriesPanales = sortedPeriods.map(p => catTrendMap[p] ? catTrendMap[p].panales : 0);
    const seriesAsignacion = sortedPeriods.map(p => catTrendMap[p] ? catTrendMap[p].asignacion : 0);

    // 1.1 Inicializar o actualizar Gráfico de Tendencia de Estados
    const trendOptions = {
        ...chartBaseOptions,
        chart: {
            ...chartBaseOptions.chart,
            type: 'area',
            height: 280,
            stacked: false
        },
        colors: ['#10b981', '#f59e0b', '#ef4444'], // Emerald, Amber, Red
        stroke: { curve: 'smooth', width: 2 },
        fill: {
            type: 'gradient',
            gradient: {
                opacityFrom: 0.4,
                opacityTo: 0.05
            }
        },
        series: [
            { name: 'Aprobados', data: seriesApproved },
            { name: 'Pendientes', data: seriesPending },
            { name: 'Rechazados', data: seriesRejected }
        ],
        xaxis: {
            categories: trendCategories,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                formatter: (val) => Math.round(val)
            }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (chartTrend) {
        chartTrend.updateOptions({
            xaxis: { categories: trendCategories }
        });
        chartTrend.updateSeries([
            { name: 'Aprobados', data: seriesApproved },
            { name: 'Pendientes', data: seriesPending },
            { name: 'Rechazados', data: seriesRejected }
        ]);
    } else {
        chartTrend = new ApexCharts(document.querySelector("#chart-trend"), trendOptions);
        chartTrend.render();
    }
    
    // 1.2 Inicializar o actualizar Gráfico de Tendencia de Categorías
    const categoryTrendOptions = {
        ...chartBaseOptions,
        chart: {
            ...chartBaseOptions.chart,
            type: 'line',
            height: 280
        },
        colors: ['#10b981', '#06b6d4'], // Emerald, Cyan
        stroke: { curve: 'smooth', width: 3 },
        markers: { size: 4 },
        series: [
            { name: 'Pañales', data: seriesPanales },
            { name: 'Asignaciones', data: seriesAsignacion }
        ],
        xaxis: {
            categories: trendCategories,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                formatter: (val) => Math.round(val)
            }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (chartCategoryTrend) {
        chartCategoryTrend.updateOptions({
            xaxis: { categories: trendCategories }
        });
        chartCategoryTrend.updateSeries([
            { name: 'Pañales', data: seriesPanales },
            { name: 'Asignaciones', data: seriesAsignacion }
        ]);
    } else {
        chartCategoryTrend = new ApexCharts(document.querySelector("#chart-category-trend"), categoryTrendOptions);
        chartCategoryTrend.render();
    }
    
    // ----------------------------------------------------
    // 2. AGRUPACIÓN PARA EL GRÁFICO DE TOP SUCURSALES (CENTROS MÉDICOS)
    // ----------------------------------------------------
    const centerMap = {};
    recordsToUse.forEach(rec => {
        const c = rec.sucursal || 'SIN CENTRO MÉDICO';
        centerMap[c] = (centerMap[c] || 0) + 1;
    });
    
    // Ordenar y tomar los top 5 centros médicos
    const sortedCenters = Object.entries(centerMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
        
    const centerCategories = sortedCenters.map(e => e[0]);
    const centerData = sortedCenters.map(e => e[1]);
    
    const centersOptions = {
        ...chartBaseOptions,
        chart: {
            ...chartBaseOptions.chart,
            type: 'bar',
            height: 280
        },
        colors: ['#06b6d4'], // Cyan
        plotOptions: {
            bar: {
                horizontal: true,
                barHeight: '60%',
                borderRadius: 4
            }
        },
        series: [{
            name: 'Solicitudes',
            data: centerData
        }],
        xaxis: {
            categories: centerCategories,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (chartCenters) {
        chartCenters.updateOptions({
            xaxis: { categories: centerCategories }
        });
        chartCenters.updateSeries([{
            name: 'Solicitudes',
            data: centerData
        }]);
    } else {
        chartCenters = new ApexCharts(document.querySelector("#chart-centers"), centersOptions);
        chartCenters.render();
    }
    
    // ----------------------------------------------------
    // 3. AGRUPACIÓN PARA EL GRÁFICO DE OBRAS SOCIALES
    // ----------------------------------------------------
    const obrasMap = {};
    recordsToUse.forEach(rec => {
        const o = rec.obrasocial || 'OTRA';
        obrasMap[o] = (obrasMap[o] || 0) + 1;
    });
    
    const sortedObras = Object.entries(obrasMap)
        .sort((a, b) => b[1] - a[1]);
        
    // Tomar las top 4 y agrupar el resto en "Otros"
    const topObras = sortedObras.slice(0, 4);
    let topObrasLabels = topObras.map(e => e[0]);
    let topObrasData = topObras.map(e => e[1]);
    
    if (sortedObras.length > 4) {
        const othersSum = sortedObras.slice(4).reduce((sum, e) => sum + e[1], 0);
        topObrasLabels.push('Otros');
        topObrasData.push(othersSum);
    }
    
    const obrasOptions = {
        ...chartBaseOptions,
        chart: {
            ...chartBaseOptions.chart,
            type: 'donut',
            height: 280
        },
        stroke: { show: false },
        colors: ['#06b6d4', '#0284c7', '#3b82f6', '#8b5cf6', '#64748b'], // Cyan a gris
        labels: topObrasLabels,
        series: topObrasData,
        legend: {
            position: 'bottom',
            horizontalAlign: 'center',
            fontSize: '11px',
            fontFamily: 'Outfit'
        },
        plotOptions: {
            pie: {
                donut: {
                    size: '70%',
                    labels: {
                        show: true,
                        total: {
                            show: true,
                            label: 'Total',
                            formatter: () => recordsToUse.length.toLocaleString('es-AR'),
                            color: '#fff',
                            fontSize: '15px',
                            fontWeight: '600'
                        },
                        value: {
                            color: '#94a3b8',
                            fontSize: '18px',
                            fontWeight: '700',
                            formatter: (val) => parseInt(val).toLocaleString('es-AR')
                        }
                    }
                }
            }
        },
        tooltip: { theme: 'dark' }
    };
    
    if (chartObras) {
        chartObras.updateOptions({
            labels: topObrasLabels
        });
        chartObras.updateSeries(topObrasData);
    } else {
        chartObras = new ApexCharts(document.querySelector("#chart-obras"), obrasOptions);
        chartObras.render();
    }
}

/* ==========================================================================
   RENDER PATIENT LIST (Left Column)
   ========================================================================== */
function renderPatientList() {
    const listContainer = document.getElementById('patient-ul-list');
    listContainer.innerHTML = '';
    
    // Group filtered records by Patient
    const patientsMap = {};
    filteredRecords.forEach(rec => {
        const key = rec.hiscli || rec.cuil || rec.afiliado;
        if (!key) return;
        
        if (!patientsMap[key]) {
            patientsMap[key] = {
                name: rec.afiliado || 'SIN NOMBRE',
                cuil: rec.cuil,
                hiscli: rec.hiscli,
                sucursal: rec.sucursal,
                obrasocial: rec.obrasocial,
                plan: rec.plan,
                expedientes: [],
                amparo: null
            };
        }
        patientsMap[key].expedientes.push(rec);
        if (rec.amparo) {
            patientsMap[key].amparo = rec.amparo;
        }
    });
    
    const patientsList = Object.values(patientsMap);
    
    // Ordenar alfabéticamente por nombre de afiliado
    patientsList.sort((a, b) => a.name.localeCompare(b.name));
    
    if (patientsList.length === 0) {
        listContainer.innerHTML = `
            <li class="list-placeholder">
                <i data-lucide="user-x"></i>
                <p>No se encontraron afiliados</p>
                <span style="font-size: 0.8rem; color: var(--text-dark);">Prueba cambiando los términos de búsqueda o filtros.</span>
            </li>
        `;
        lucide.createIcons();
        return;
    }
    
    patientsList.forEach(p => {
        const key = p.hiscli || p.cuil || p.name;
        const isSelected = key === selectedPatientKey;
        
        const amparoBadgeHtml = '';
        
        // Crear elemento de lista
        const li = document.createElement('li');
        li.className = `patient-item ${isSelected ? 'selected' : ''}`;
        li.setAttribute('data-patient-key', key);
        
        // Contenido de la fila
        li.innerHTML = `
            <div class="patient-info">
                <span class="patient-name">
                    ${p.name}
                    ${amparoBadgeHtml}
                </span>
                <span class="patient-meta">
                    CUIL: ${p.cuil || 'S/D'} | Hist: ${p.hiscli || 'S/D'}
                </span>
                <span class="patient-meta" style="font-size: 0.75rem; color: var(--text-dark);">
                    ${p.sucursal} | OS: ${p.obrasocial}
                </span>
            </div>
            <span class="patient-badge" title="Cantidad de expedientes">${p.expedientes.length}</span>
        `;
        
        // Clic para seleccionar paciente
        li.addEventListener('click', () => selectPatient(key, p));
        
        listContainer.appendChild(li);
    });
    
    // Si hay un paciente seleccionado pero no está en la lista actual, vaciar el detalle
    if (selectedPatientKey && !patientsMap[selectedPatientKey]) {
        clearPatientDetails();
    } else if (selectedPatientKey && patientsMap[selectedPatientKey]) {
        // Si sigue seleccionado, refrescar sus datos por si cambiaron con los filtros de expedientes sin bucles
        selectPatient(selectedPatientKey, patientsMap[selectedPatientKey], true);
    } else {
        const detailBody = document.getElementById('patient-detail-body');
        if (detailBody && !detailBody.querySelector('.detail-placeholder')) {
            clearPatientDetails();
        }
    }

    // Renderizar iconos de Lucide (martillo de amparo)
    lucide.createIcons();
}

/* ==========================================================================
   SELECT PATIENT & RENDER DETAIL PANEL (Right Column)
   ========================================================================== */
function selectPatient(key, patientData, skipReRender = false) {
    if (selectedPatientKey === key && !skipReRender) {
        // Toggle: si se vuelve a hacer click en el ya seleccionado, deseleccionar
        clearPatientDetails();
        renderKPIs();
        renderCharts();
        return;
    }

    selectedPatientKey = key;
    
    // Marcar en la lista visualmente
    document.querySelectorAll('.patient-item').forEach(item => {
        if (item.getAttribute('data-patient-key') === key) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
    
    const detailBody = document.getElementById('patient-detail-body');
    
    // Ordenar expedientes del paciente: Fecha descendente (más nuevo arriba)
    const expedientesSorted = [...patientData.expedientes].sort((a, b) => {
        return new Date(b.fecha) - new Date(a.fecha);
    });
    
    // Generar las tarjetas de expedientes
    let expedientesHtml = '';
    
    expedientesSorted.forEach(exp => {
        const estadoClass = exp.estado.toLowerCase();
        
        // Generar tabla de items
        let itemsRows = '';
        if (exp.items && exp.items.length > 0) {
            exp.items.forEach(item => {
                itemsRows += `
                    <tr>
                        <td><strong>${item.prac || '-'}</strong></td>
                        <td>${item.desc}</td>
                        <td class="text-right"><strong>${item.can}</strong></td>
                    </tr>
                `;
            });
        } else {
            itemsRows = `
                <tr>
                    <td colspan="3" class="text-center" style="color: var(--text-dark);">
                        No hay ítems detallados cargados en este expediente.
                    </td>
                </tr>
            `;
        }
        
        // Determinar valores económicos
        const valorUnitario = exp.valor ? `$ ${exp.valor.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : 'S/D';
        const valorEstimado = exp.valoresti ? `$ ${exp.valoresti.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : 'S/D';
        
        let docsHtml = '';
        
        expedientesHtml += `
            <div class="expediente-card">
                <div class="exp-header">
                    <span class="exp-title">Nº Expediente: ${exp.numero}</span>
                    <span class="badge ${estadoClass}">${exp.estado}</span>
                </div>
                
                <div class="exp-details-grid">
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Fecha de Carga</span>
                        <span class="exp-detail-value">${exp.fecha || 'S/D'}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Plan Asignado</span>
                        <span class="exp-detail-value">${exp.plan || 'Ninguno'}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Evento</span>
                        <span class="exp-detail-value" style="color: #c084fc; font-weight: 600;">${exp.evento || 'S/D'}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Fecha Autoriz.</span>
                        <span class="exp-detail-value">${exp.fecha_auto || 'Pendiente'}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Usuario Autoriz.</span>
                        <span class="exp-detail-value">${exp.usuario_auto || 'Pendiente'}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Valor Unitario</span>
                        <span class="exp-detail-value">${valorUnitario}</span>
                    </div>
                    <div class="exp-detail-field">
                        <span class="exp-detail-label">Costo Estimado</span>
                        <span class="exp-detail-value">${valorEstimado}</span>
                    </div>
                </div>
                
                ${docsHtml}
                
                <!-- Tabla de Prácticas -->
                <table class="items-table">
                    <thead>
                        <tr>
                            <th style="width: 15%">Troquel</th>
                            <th style="width: 70%">Detalle del Pañal Asignado</th>
                            <th style="width: 15%" class="text-right">Cantidad</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>
            </div>
        `;
    });
    
    let amparoCardHtml = '';
    
    // Armar el panel completo
    detailBody.innerHTML = `
        <div class="patient-profile">
            ${amparoCardHtml}
            
            <!-- Ficha de Datos Personales -->
            <div class="profile-card">
                <div class="profile-title-row" style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2>${patientData.name}</h2>
                        <p>Ficha de Afiliado Activo</p>
                    </div>
                    <button class="btn btn-outline btn-sm" id="btn-clear-patient-selection" style="padding: 6px 12px; font-size: 0.75rem; border-color: rgba(255,255,255,0.1); height: auto; display: flex; align-items: center; gap: 4px;">
                        <i data-lucide="eye-off" style="width: 14px; height: 14px;"></i>
                        <span>Ver Todos</span>
                    </button>
                </div>
                
                <div class="profile-field">
                    <span class="field-label">CUIL / DNI</span>
                    <span class="field-value">${patientData.cuil || 'Sin Datos'}</span>
                </div>
                
                <div class="profile-field">
                    <span class="field-label">Hist. Clínica</span>
                    <span class="field-value">${patientData.hiscli || 'Sin Datos'}</span>
                </div>
                
                <div class="profile-field">
                    <span class="field-label">Obra Social Principal</span>
                    <span class="field-value">${patientData.obrasocial || 'Sin Datos'}</span>
                </div>
                
                <div class="profile-field">
                    <span class="field-label">Centro Médico del Trámite</span>
                    <span class="field-value">${patientData.sucursal || 'Sin Datos'}</span>
                </div>
            </div>
            
            <!-- Listado de expedientes -->
            <div class="expedientes-section">
                <h4>
                    <i data-lucide="archive" style="width: 18px; height: 18px;"></i>
                    <span>Historial de Expedientes (${expedientesSorted.length})</span>
                </h4>
                
                <div class="expedientes-list-container">
                    ${expedientesHtml}
                </div>
            </div>
        </div>
    `;
    
    lucide.createIcons();

    // Event listener para el botón de deselección
    const clearSelectBtn = document.getElementById('btn-clear-patient-selection');
    if (clearSelectBtn) {
        clearSelectBtn.addEventListener('click', () => {
            clearPatientDetails();
            renderKPIs();
            renderCharts();
        });
    }

    if (!skipReRender) {
        renderKPIs();
        renderCharts();
    }
}

function clearPatientDetails() {
    selectedPatientKey = null;
    // Limpiar selección visual en la lista
    document.querySelectorAll('.patient-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    const detailBody = document.getElementById('patient-detail-body');
    if (detailBody) {
        detailBody.innerHTML = `
            <div class="detail-placeholder">
                <i data-lucide="hand" class="placeholder-icon"></i>
                <h4>Selecciona un paciente</h4>
                <p>Haz clic en un paciente de la lista de la izquierda para ver su historial completo de expedientes, plan, autorizaciones y pañales asignados.</p>
            </div>
        `;
    }
    lucide.createIcons();
}

/* ==========================================================================
   LIVE DATABASE SYNC (API Integration)
   ========================================================================== */
async function syncDatabase() {
    const btnSync = document.getElementById('btn-sync-db');
    const syncIcon = document.getElementById('sync-icon');
    
    // Iniciar loading
    btnSync.disabled = true;
    syncIcon.classList.add('spinning');
    updateStatusIndicator('orange', 'Sincronizando con base de datos...');
    showToast('Iniciando sincronización con SQL Server en vivo...');
    
    try {
        // Consumir el endpoint /api/sync expuesto por server.py
        const response = await fetch('/api/sync');
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || 'Error en la sincronización del servidor.');
        }
        
        const data = await response.json();
        
        showToast(`¡Sincronización Exitosa! Se cargaron ${data.records.toLocaleString('es-AR')} registros.`, 'success');
        
        // Recargar los datos del JSON recién escrito
        await loadDashboardData();
        
    } catch (error) {
        console.error('Error al sincronizar:', error);
        showToast(`Sincronización Fallida. Usando datos de respaldo.`, 'error');
        // Asegurar que el estado vuelva a verde si tenemos datos cargados, de lo contrario rojo
        if (allRecords.length > 0) {
            updateStatusIndicator('green', 'Base de Datos (belgdbpa) - Desconectado (Usando respaldo)');
        } else {
            updateStatusIndicator('red', 'Error de conexión y sin datos');
        }
    } finally {
        // Detener loading
        btnSync.disabled = false;
        syncIcon.classList.remove('spinning');
    }
}

/* ==========================================================================
   EXPORT TO EXCEL (CSV Format compatible with Excel Spanish)
   ========================================================================== */
function exportToExcel() {
    if (filteredRecords.length === 0) {
        showToast("No hay registros para exportar", "error");
        return;
    }
    
    // Define headers for the CSV
    const headers = [
        "Nº Expediente", "Historia Clinica", "CUIL", "Fecha Carga", "Obra Social", 
        "Sucursal", "Paciente", "Plan", "Estado", "Evento", "Fecha Autoriz", "Usuario Autoriz",
        "Periodo", "Codigo Practica 1", "Detalle Practica 1", "Cantidad 1",
        "Codigo Practica 2", "Detalle Practica 2", "Cantidad 2",
        "Codigo Practica 3", "Detalle Practica 3", "Cantidad 3",
        "Codigo Practica 4", "Detalle Practica 4", "Cantidad 4",
        "Codigo Practica 5", "Detalle Practica 5", "Cantidad 5",
        "Codigo Practica 6", "Detalle Practica 6", "Cantidad 6"
    ];
    
    let csvContent = "\ufeff"; // UTF-8 BOM for Excel Spanish accents
    csvContent += headers.join(";") + "\n";
    
    filteredRecords.forEach(rec => {
        // Extraer hasta 6 prácticas
        const items = rec.items || [];
        const item1 = items[0] || {};
        const item2 = items[1] || {};
        const item3 = items[2] || {};
        const item4 = items[3] || {};
        const item5 = items[4] || {};
        const item6 = items[5] || {};
        
        const row = [
            rec.numero || "",
            rec.hiscli || "",
            rec.cuil || "",
            rec.fecha || "",
            rec.obrasocial || "",
            rec.sucursal || "",
            rec.afiliado || "",
            rec.plan || "",
            rec.estado || "",
            rec.evento || "",
            rec.fecha_auto || "",
            rec.usuario_auto || "",
            rec.periodo || "",
            item1.prac || "",
            item1.desc || "",
            item1.can || "",
            item2.prac || "",
            item2.desc || "",
            item2.can || "",
            item3.prac || "",
            item3.desc || "",
            item3.can || "",
            item4.prac || "",
            item4.desc || "",
            item4.can || "",
            item5.prac || "",
            item5.desc || "",
            item5.can || "",
            item6.prac || "",
            item6.desc || "",
            item6.can || ""
        ];
        
        // Clean each cell from newlines and escape semicolons
        const cleanRow = row.map(val => {
            let str = String(val).replace(/\r?\n|\r/g, " ").trim();
            // escape quotes and semicolons
            if (str.includes(";") || str.includes('"')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        
        csvContent += cleanRow.join(";") + "\n";
    });
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    // Generate filename based on active filters
    let filename = "Reporte_Panales";
    if (activeFilters.sucursal) {
        // Clean special characters and spaces for filename
        const cleanSuc = activeFilters.sucursal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "_");
        filename += `_${cleanSuc}`;
    }
    if (activeFilters.estado) filename += `_${activeFilters.estado}`;
    filename += `_${new Date().toISOString().slice(0,10)}.csv`;
    
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("¡Reporte exportado con éxito!", "success");
}



/* ==========================================================================
   AUTHENTICATION, USER PROFILE & AUDIT LOGS MODAL (ADMIN)
   ========================================================================== */
let currentUser = null;

// Verificar sesión al cargar
async function checkAuthSession() {
    if (window.location.protocol === 'file:') {
        // Modo archivo local (red compartida)
        document.getElementById('current-user-name').textContent = 'Local';
        document.getElementById('current-user-role').textContent = 'Offline';
        document.getElementById('btn-logout').style.display = 'none';
        return;
    }

    try {
        const res = await fetch('/api/me');
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        if (res.ok) {
            const data = await res.json();
            currentUser = data;
            document.getElementById('current-user-name').textContent = data.full_name || data.username;
            document.getElementById('current-user-role').textContent = data.role === 'admin' ? 'Administrador' : 'Operador';
            
            // Si es admin, habilitar botón de Auditoría de Accesos
            if (data.role === 'admin') {
                const btnAdmin = document.getElementById('btn-open-audit-logs');
                if (btnAdmin) btnAdmin.style.display = 'inline-flex';
            }
        }
    } catch (e) {
        console.warn('No se pudo verificar la sesión de usuario:', e);
    }
}

// Inicializar listeners de autenticación y modal
function setupAuthAndAuditListeners() {
    // Pestañas del Modal de Administración (Logs vs Usuarios)
    const tabLogs = document.getElementById('tab-btn-logs');
    const tabUsers = document.getElementById('tab-btn-users');
    const paneLogs = document.getElementById('pane-logs');
    const paneUsers = document.getElementById('pane-users');

    if (tabLogs && tabUsers && paneLogs && paneUsers) {
        tabLogs.addEventListener('click', () => {
            tabLogs.classList.add('active');
            tabUsers.classList.remove('active');
            paneLogs.style.display = 'block';
            paneUsers.style.display = 'none';
            loadAuditLogs();
        });

        tabUsers.addEventListener('click', () => {
            tabUsers.classList.add('active');
            tabLogs.classList.remove('active');
            paneUsers.style.display = 'block';
            paneLogs.style.display = 'none';
            loadUsers();
        });
    }

    // Buscador y refresh de Usuarios
    const searchUsersInput = document.getElementById('user-search-input');
    const btnRefreshUsers = document.getElementById('btn-refresh-users');
    if (searchUsersInput) {
        let timer;
        searchUsersInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(loadUsers, 300);
        });
    }
    if (btnRefreshUsers) {
        btnRefreshUsers.addEventListener('click', loadUsers);
    }

    // Cerrar Sesión
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm('¿Está seguro de que desea cerrar la sesión actual?')) {
                try {
                    await fetch('/api/logout', { method: 'POST' });
                } catch (e) {}
                window.location.href = '/login.html';
            }
        });
    }

    // Abrir Modal de Auditoría
    const btnOpenAudit = document.getElementById('btn-open-audit-logs');
    const modalOverlay = document.getElementById('audit-modal-overlay');
    const btnCloseAudit = document.getElementById('btn-close-audit-modal');

    if (btnOpenAudit && modalOverlay) {
        btnOpenAudit.addEventListener('click', () => {
            modalOverlay.style.display = 'flex';
            loadAuditLogs();
        });
    }

    if (btnCloseAudit && modalOverlay) {
        btnCloseAudit.addEventListener('click', () => {
            modalOverlay.style.display = 'none';
        });
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.style.display = 'none';
            }
        });
    }

    // Filtros de Auditoría
    const searchAudit = document.getElementById('modal-search-input');
    const statusAudit = document.getElementById('modal-filter-status');
    const btnRefreshAudit = document.getElementById('btn-refresh-audit-logs');

    if (searchAudit) {
        let debounceTimer;
        searchAudit.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(loadAuditLogs, 300);
        });
    }

    if (statusAudit) {
        statusAudit.addEventListener('change', loadAuditLogs);
    }

    if (btnRefreshAudit) {
        btnRefreshAudit.addEventListener('click', loadAuditLogs);
    }
}

// Cargar registros de auditoría de ingresos desde la API
async function loadAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    const search = document.getElementById('modal-search-input')?.value.trim() || '';
    const status = document.getElementById('modal-filter-status')?.value || 'TODOS';

    tbody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align: center; padding: 20px; color: #94a3b8;">
                <i data-lucide="loader" class="icon-spin" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle;"></i>
                Cargando registros...
            </td>
        </tr>
    `;
    lucide.createIcons();

    try {
        const queryParams = new URLSearchParams({ search, status, limit: 150 });
        const res = await fetch(`/api/admin/audit-logs?${queryParams.toString()}`);
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error al consultar registros de auditoría.</td></tr>`;
            return;
        }

        const data = await res.json();
        
        // Actualizar estadísticas del modal
        if (data.stats) {
            document.getElementById('stat-total-exitosos').textContent = (data.stats.total_exitosos || 0).toLocaleString();
            document.getElementById('stat-usuarios-unicos').textContent = (data.stats.usuarios_unicos || 0).toLocaleString();
            document.getElementById('stat-total-fallidos').textContent = (data.stats.total_fallidos || 0).toLocaleString();
        }

        const logs = data.logs || [];
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">No se encontraron registros de ingreso con los filtros seleccionados.</td></tr>`;
            return;
        }

        let html = '';
        logs.forEach(log => {
            const isExitoso = log.status === 'EXITOSO';
            const statusClass = isExitoso ? 'exitoso' : 'fallido';
            const statusIcon = isExitoso ? 'check-circle-2' : 'alert-circle';
            const roleBadge = log.role === 'admin' ? '<span style="color: #818cf8; font-weight: 600;">Admin</span>' : '<span style="color: #94a3b8;">Operador</span>';

            // Formatear fecha
            let fechaStr = log.login_time || '-';

            // Limpiar User-Agent
            let uaShort = log.user_agent || '-';
            if (uaShort.length > 55) {
                uaShort = uaShort.substring(0, 55) + '...';
            }

            html += `
                <tr>
                    <td style="font-weight: 500; font-variant-numeric: tabular-nums;">${fechaStr}</td>
                    <td>
                        <div class="user-cell-badge">
                            <i data-lucide="user"></i>
                            <span>${log.username}</span>
                        </div>
                    </td>
                    <td>${roleBadge}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            <i data-lucide="${statusIcon}" style="width: 13px; height: 13px;"></i>
                            ${log.status}
                        </span>
                    </td>
                    <td style="font-family: monospace; font-size: 0.8rem; color: #cbd5e1;">${log.ip_address || '-'}</td>
                    <td title="${log.user_agent || ''}" class="ua-text">${uaShort}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        lucide.createIcons();

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error de red al cargar auditoría.</td></tr>`;
    }
}

// Iniciar verificación al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
    checkAuthSession();
    setupAuthAndAuditListeners();
});


// ==============================================================================
// GESTIÓN DE USUARIOS Y BLANQUEO DE CLAVES (ADMIN)
// ==============================================================================
let cachedUsers = [];

async function loadUsers() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">
                <i data-lucide="loader" class="icon-spin" style="width: 20px; height: 20px; display: inline-block; vertical-align: middle;"></i>
                Cargando lista de usuarios...
            </td>
        </tr>
    `;
    lucide.createIcons();

    try {
        const res = await fetch('/api/admin/users');
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Error al obtener usuarios.</td></tr>`;
            return;
        }

        const data = await res.json();
        cachedUsers = data.users || [];
        renderUsersTable();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Error de red al cargar usuarios.</td></tr>`;
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    const query = document.getElementById('user-search-input')?.value.trim().toLowerCase() || '';
    const filtered = cachedUsers.filter(u => {
        return (u.username || '').toLowerCase().includes(query) ||
               (u.full_name || '').toLowerCase().includes(query) ||
               (u.role || '').toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 20px;">No se encontraron usuarios.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach(u => {
        const isAdmin = u.role === 'admin';
        const roleLabel = isAdmin ? '<span style="color: #818cf8; font-weight: 600;">Administrador</span>' : '<span style="color: #94a3b8;">Operador</span>';
        
        html += `
            <tr>
                <td>
                    <div class="user-cell-badge">
                        <i data-lucide="${isAdmin ? 'shield' : 'user'}"></i>
                        <span>${u.username}</span>
                    </div>
                </td>
                <td style="font-weight: 500;">${u.full_name || '-'}</td>
                <td>${roleLabel}</td>
                <td style="font-size: 0.8rem; color: #94a3b8;">${u.created_at || '-'}</td>
                <td style="text-align: right;">
                    <button class="btn btn-reset-key" onclick="blanquearClave(${u.id}, '${u.username}')" title="Asignar una nueva clave para este usuario">
                        <i data-lucide="key-round"></i>
                        <span>Blanquear Clave</span>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    lucide.createIcons();
}

window.blanquearClave = async function(userId, username) {
    const newPass = prompt(`¿Desea blanquear la clave del usuario "${username}"?\n\nIngrese la nueva contraseña:`, 'panales2026');
    if (newPass === null) return; // Cancelado por el usuario
    
    const passTrimmed = newPass.trim();
    if (!passTrimmed) {
        alert('La contraseña no puede estar vacía.');
        return;
    }

    try {
        const res = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, new_password: passTrimmed })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`¡Clave de "${username}" blanqueada con éxito!`, 'success');
            loadUsers();
        } else {
            alert(data.message || 'Error al blanquear la clave.');
        }
    } catch (err) {
        alert('Error de conexión al blanquear la contraseña.');
    }
};
