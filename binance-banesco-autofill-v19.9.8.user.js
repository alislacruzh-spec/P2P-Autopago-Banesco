// ==UserScript==
// @name         Binance → Banesco Transferencia telefonica / Transferencia V19.9.8 (+ Auto Select configurable)
// @version      19.9.8.4
// @updateURL    https://raw.githubusercontent.com/alislacruzh-spec/P2P-Autopago-Banesco/main/binance-banesco-autofill-v19.9.8.user.js
// @downloadURL  https://raw.githubusercontent.com/alislacruzh-spec/P2P-Autopago-Banesco/main/binance-banesco-autofill-v19.9.8.user.js
// @match        https://c2c-admin.binance.com/*
// @match        https://p2p.binance.com/*
// @match        https://www.banesconline.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @all-frames   true
// ==/UserScript==

(function () {
    "use strict";

    /* ============================================
       DEBUG — pon en false para producción
    ============================================ */
    const DEBUG = true;
    const log  = (...a) => DEBUG && console.log("[P2P]", ...a);
    const warn = (...a) => console.warn("[P2P]", ...a);
    const err  = (...a) => console.error("[P2P]", ...a);

    /* ============================================
       CONFIGURACIÓN CENTRAL
    ============================================ */
    const CFG = {
        SELECTORS: {
            ordenId: [
                '[data-bn-type="text"].css-14yjdiq',
                '[data-testid="order-number"]',
                '.order-number',
                '.css-14yjdiq',
                '[class*="orderNumber"]',
                '[class*="order-id"]',
                'span[class*="css-"][class*="number"]',
            ],
            monto: [
                'span.sc-jgPyTC',
                'span.sc-jgPyTC.fuJtcf',
                '[data-testid="order-amount"]',
                'span.sc-fFSPTT',
                '.sc-fFSPTT.eEJWPz',
                '.sc-dIvrsQ.biCrYn span',
                'span.sc-fKgJPI',
                'div[class*="fHUQtx"] span:first-child',
                'div[class*="amount"] span',
                'div.sc-ckTSus span.sc-eirqVv',
                '[class*="orderAmount"]',
                '[class*="trade-amount"]',
                'span[class*="amount"]',
            ],
            infoItems: [
                'div.flex.gap-2xs.break-words > div',
                '[class*="paymentInfo"] div',
                '[class*="payment-info"] div',
                '[class*="PaymentMethod"] span',
            ],
            labelRows: [
                'div.flex.justify-between',
                '[class*="labelRow"]',
                '[class*="label-row"]',
                '[class*="field-row"]',
                '[class*="infoRow"]',
            ],
        },
        RETRY_INTERVAL_MS:   50,
        RETRY_MAX_ATTEMPTS:  25,
        RETRY_MIN_SUCCESSES: 2,
        DEBOUNCE_MS:         50,
        REDIRECT_DELAY_MS:   30,
        MAX_PAYLOAD_AGE_MS:  10 * 60 * 1000, // 10 min — payloads más viejos se descartan
        GM_KEY:              "p2p_payload_v3",
        URLS_BANESCO: {
            pago_movil:            "/Mantis/WebSite/aplicacion.aspx?opc=30",
            cuenta_tercero_opc30:  "/Mantis/WebSite/aplicacion.aspx?opc=30", // Mercantil/Provincial: misma página, sub-sección "Código de Cuenta"
            pago_movil_otros:      "/Mantis/WebSite/aplicacion.aspx?opc=24",
            transferencia_banesco: "/Mantis/WebSite/transferencias/tercerosbanesco.aspx",
        },
    };

    /* ============================================
       ★ V19.9.8: AUTO SELECT — cuenta de origen CONFIGURABLE POR USUARIO
       Antes, "cuentaDebitar" e "inputGroupSelect01Valor" eran constantes
       fijas en el código (la cuenta de origen de UNA persona en particular).
       Eso rompía dos cosas:
         1) Al compartir el script con otra persona, quedaba pegada TU
            cuenta en su copia — tenía que editar el archivo a mano.
         2) Cada vez que el script se actualiza (nueva versión bajada por
            @updateURL), el ARCHIVO se reemplaza por completo — cualquier
            edición manual que alguien haya hecho directo en el código se
            perdía con la próxima actualización.

       Ahora estos dos valores se guardan con GM_setValue, en un storage
       SEPARADO del código del script — sobrevive tanto a actualizaciones
       del script como a que otra persona instale la misma copia con SU
       propia cuenta. Se configuran una sola vez desde el menú de
       Tampermonkey/Violentmonkey ("⚙️ Configurar cuenta de origen (Banesco)").

       Si nunca se configuran, se usan los valores originales como
       respaldo (mismo comportamiento que las versiones anteriores) — así
       no se rompe nada para quien ya lo tenía funcionando.
    ============================================ */
    const CFG_KEY_CUENTA_DEBITAR        = 'p2p_auto_select_cuenta_debitar';
    const CFG_KEY_INPUT_GROUP_SELECT01  = 'p2p_auto_select_input_group_select01';

    // Valores originales — se usan solo como respaldo si todavía no se
    // configuró nada (primera vez que corre esta versión).
    const DEFAULT_CUENTA_DEBITAR       = '1039488';
    const DEFAULT_INPUT_GROUP_SELECT01 = '0134-0438-10-4381039488';

    function getCuentaDebitar() {
        return GM_getValue(CFG_KEY_CUENTA_DEBITAR, DEFAULT_CUENTA_DEBITAR);
    }
    function getInputGroupSelect01Valor() {
        return GM_getValue(CFG_KEY_INPUT_GROUP_SELECT01, DEFAULT_INPUT_GROUP_SELECT01);
    }

    // Aviso simple, reutilizado por la config de Auto Select. Estilo propio
    // (esquina superior IZQUIERDA) para no chocar con mostrarNotificacion
    // (arriba derecha), mostrarDiagnostico (abajo izquierda) ni el botón
    // "Forzar opc=30" (abajo derecha).
    function mostrarAvisoConfig(msg, ok = true) {
        document.getElementById('p2p-config-notif')?.remove();
        const div = document.createElement('div');
        div.id = 'p2p-config-notif';
        div.style.cssText = `
            position:fixed;top:20px;left:20px;z-index:999999;
            background:${ok ? '#1a7a1a' : '#7a1a1a'};color:#fff;
            font-family:Arial,sans-serif;font-size:14px;
            padding:12px 16px;border-radius:8px;
            box-shadow:0 4px 18px rgba(0,0,0,0.35);
            max-width:340px;line-height:1.4;
        `;
        div.textContent = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 6000);
    }

    function configurarAutoSelect() {
        const cuentaActual      = getCuentaDebitar();
        const inputGroupActual  = getInputGroupSelect01Valor();

        const nuevaCuenta = window.prompt(
            'Número de cuenta a debitar (el que aparece en "ddlCuentaDebitar", ' +
            'en la página de transferencias a terceros de Banesco).\n' +
            'Ejemplo: 1039488',
            cuentaActual
        );
        if (nuevaCuenta === null) return; // canceló, no cambia nada

        const nuevoInputGroup = window.prompt(
            'Valor EXACTO de la cuenta de origen en opc=30 ("Teléfono Operaciones ' +
            'Inmediatas" / "Código de Cuenta") — el <select> inputGroupSelect01.\n' +
            'Formato: 0134-XXXX-XX-XXXXXXXXXX\n' +
            'Ejemplo: 0134-0438-10-4381039488',
            inputGroupActual
        );
        if (nuevoInputGroup === null) return; // canceló, no cambia nada

        GM_setValue(CFG_KEY_CUENTA_DEBITAR, nuevaCuenta.trim());
        GM_setValue(CFG_KEY_INPUT_GROUP_SELECT01, nuevoInputGroup.trim());

        if (nuevaCuenta.trim() && nuevoInputGroup.trim()) {
            mostrarAvisoConfig('✅ Cuenta de origen guardada. Se usará desde la próxima orden.');
            log('Auto Select: configuración de cuenta de origen actualizada por el usuario.');
        } else {
            mostrarAvisoConfig('⚠️ Dejaste algún campo vacío — revisá la configuración.', false);
        }
    }

    // Aparece en el menú del ícono de Tampermonkey en CUALQUIER pestaña
    // donde corra el script (Binance o Banesco) — se configura una sola vez
    // y queda guardado en el navegador de cada persona, sin depender del
    // contenido del archivo del script.
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚙️ Configurar cuenta de origen (Banesco)', configurarAutoSelect);
    }

    /* ============================================
       AUTO SELECT — otros valores por defecto en formularios de Banesco
       (integrado desde el script "Banesco Auto Select" v1.2). cuentaDebitar
       e inputGroupSelect01Valor SALIERON de acá — ahora son configurables
       (ver arriba, getCuentaDebitar() / getInputGroupSelect01Valor()).
    ============================================ */
    const AUTO_SELECT_CFG = {
        nacionalidad:         'V',
        conceptoDefecto:      'pago',
        tipoTransferencia:    'Teléfono Operaciones Inmediatas',
    };

    /* ============================================
       UTILIDADES
    ============================================ */
    function querySelector(selectors) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of list) {
            try {
                const el = document.querySelector(sel);
                if (el) { log("Selector match:", sel); return el; }
            } catch (_) {}
        }
        return null;
    }

    function querySelectorAll(selectors) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of list) {
            try {
                const els = document.querySelectorAll(sel);
                if (els && els.length > 0) { log("SelectorAll match:", sel, "count:", els.length); return els; }
            } catch (_) {}
        }
        return [];
    }

    // Fallback estructural: <span>número</span> seguido de <span>VES|USD|...</span>
function buscarMontoEstructural(raiz) {
    const moneda = /^(VES|USD|USDT|USDC|BS\.?)$/i;
    for (const s of raiz.querySelectorAll('span')) {
        const sig = s.nextElementSibling;
        if (sig && sig.tagName === 'SPAN' &&
            moneda.test(sig.textContent.trim()) &&
            /^[\d.,]+$/.test(s.textContent.trim())) {
            log("Monto encontrado por estructura (sin clase)");
            return s;
        }
    }
    return null;
}

    function debounce(fn, ms) {
        let t;
        return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    function setInputValue(input, value) {
        if (!input) return false;
        // Si el valor ya es el correcto, NO volvemos a disparar input/change.
        // Esto es crítico: nuestro ciclo de reintentos llama a esta función
        // varias veces incluso después de un pegado exitoso (para confirmar
        // estabilidad), y volver a disparar "change" sobre un campo ya
        // correcto puede re-disparar validaciones propias del sitio
        // (verificación de duplicidad, búsqueda de nombre por cédula, etc.)
        // que en algunos casos terminan recargando la página.
        if (input.value === value) return true;
        const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event("input",  { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    function parseMontoBinance(raw) {
        if (!raw) return null;
        let s = raw.replace(/[^0-9.,]/g, '');
        if (!s) return null;
        const lastDot   = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        let normalized;
        if (lastDot !== -1 && lastComma !== -1) {
            normalized = lastComma > lastDot
                ? s.replace(/\./g, '').replace(',', '.')
                : s.replace(/,/g, '');
        } else if (lastDot !== -1) {
            normalized = (s.match(/\./g) || []).length > 1 ? s.replace(/\./g, '') : s;
        } else if (lastComma !== -1) {
            normalized = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
        } else {
            normalized = s;
        }
        const num = Number(normalized);
        if (!isFinite(num) || num <= 0) return null;
        return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
    }

    const internalToBanesco = str => str.replace('.', ',');

    function extraerCedula(raw) {
        if (!raw) return null;
        const limpio = raw.replace(/[^0-9]/g, '');
        return limpio.length >= 7 ? limpio : null;
    }

    // NOTA: función antigua, ya no se usa (reemplazada por extraerNumeroCuentaGenerico,
    // que reconoce 0134/0105/0108). Se deja aquí solo por si algo externo la referencia.
    function extraerNumeroCuenta(raw) {
        if (!raw) return null;
        let limpio = raw.replace(/[^0-9]/g, '');
        // Cuenta venezolana = exactamente 20 dígitos. Longitud estricta evita
        // falsos positivos por concatenación accidental de otros campos.
        if (limpio.length === 20 && limpio.startsWith('0134')) return limpio;
        if (limpio.length === 19 && limpio.startsWith('134'))  return '0' + limpio;
        return null;
    }

    /* ============================================
       ★ V19.9: cuentas de terceros que se manejan por "Código de Cuenta"
       dentro de opc=30 (Mercantil 0105, Provincial 0108), igual que Banesco
       (0134) pero en la sub-sección "Código de Cuenta" en vez de la página
       de tercerosbanesco.aspx.
    ============================================ */
    const PREFIJOS_CUENTA_RECONOCIDOS = {
        '0134': 'transferencia_banesco',   // va a tercerosbanesco.aspx (sin cambios)
        '0105': 'cuenta_tercero_opc30',    // Mercantil → opc=30, "Código de Cuenta"
        '0108': 'cuenta_tercero_opc30',    // Provincial → opc=30, "Código de Cuenta"
        '0172': 'cuenta_tercero_opc30',    // Bancamiga → opc=30, "Código de Cuenta"
        '0191': 'cuenta_tercero_opc30',    // BNC → opc=30, "Código de Cuenta"
        '0114': 'cuenta_tercero_opc30',    // Bancaribe → opc=30, "Código de Cuenta"
        
    };

    function extraerNumeroCuentaGenerico(raw) {
        if (!raw) return null;
        let limpio = raw.replace(/[^0-9]/g, '');
        if (limpio.length === 19) limpio = '0' + limpio; // normalizar posible cero inicial perdido
        if (limpio.length !== 20) return null;
        const prefijo = limpio.substring(0, 4);
        const tipo = PREFIJOS_CUENTA_RECONOCIDOS[prefijo];
        if (!tipo) return null;
        return { cuenta: limpio, bancoCodigo: prefijo, tipo };
    }

    function extraerTelefono(raw) {
        if (!raw) return null;
        const num = raw.replace(/\D/g, '');
        if (num.length === 10) return { prefijo: '0' + num.substring(0, 3), telefono: num.substring(3) };
        if (num.length === 11) return { prefijo: num.substring(0, 4), telefono: num.substring(4) };
        return null;
    }

    /* ============================================
       ★ V19.7: DOS MAPAS DE BANCOS
       opc=30 (Teléfono Operaciones Inmediatas) → SOLO 0102 (BDV), 0175 (BDT/Bicentenario), 0163 (Tesoro)
       opc=24 → todos los demás bancos (Mercantil 0105 y Provincial 0108 se
       manejan ahora por número de cuenta → tipo "cuenta_tercero_opc30",
       NO por este mapa de texto)
    ============================================ */
    const bancosMapOpc30 = [
        { regex: /\b(0102|banco\s*de\s*venezuela|venezuela|bdv|vzla)\b/i,                  value: "0102|A", priority: 2 },
        { regex: /\b(0175|bicentenario|banco\s*digital\s*de\s*los\s*trabajadores|bdt)\b/i, value: "0175|A", priority: 2 },
        { regex: /\b(0163|banco del tesoro|tesoro)\b/i,                                    value: "0163|A", priority: 2 },
        { regex: /\b0102\b/, value: "0102|A", priority: 1 },
        { regex: /\b0163\b/, value: "0163|A", priority: 1 },
        { regex: /\b0175\b/, value: "0175|A", priority: 1 },
    ];

    const bancosMapOpc24 = [
        { regex: /\b(0105|banesco)\b/i,                                                    value: "0134", priority: 2 },
        { regex: /\b(0191|bnc|banco\s*nacional\s*de\s*credito|nacional\s*credito)\b/i,     value: "0191", priority: 2 },
        { regex: /\b(0172|bancamiga|banca\s*amiga)\b/i,                                    value: "0172", priority: 2 },
        { regex: /\b(0108|provincial|bbva)\b/i,                                            value: "0108", priority: 2 },
        { regex: /\b(0105|mercantil)\b/i,                                                  value: "0105", priority: 2 },
        { regex: /\b(0138|plaza)\b/i,                                                      value: "0138", priority: 2 },
        { regex: /\b(0151|bfc|fondo\s*com[uú]n)\b/i,                                      value: "0151", priority: 2 },
        { regex: /\b(0174|banplus)\b/i,                                                    value: "0174", priority: 2 },
        { regex: /\b(0114|bancaribe|caribe|banco\s*del?\s*caribe)\b/i,                     value: "0114", priority: 2 },
        { regex: /\b(0104|bvc|venezolano\s*de\s*credito|venezolano)\b/i,                   value: "0104", priority: 2 },
        { regex: /\b(0115|exterior)\b/i,                                                   value: "0115", priority: 2 },
        { regex: /\b(0156|100\s*%?\s*banco)\b/i,                                           value: "0156", priority: 2 },
        { regex: /\b(0128|caroni)\b/i,                                                     value: "0128", priority: 2 },
        { regex: /\b(0177|fanb|banco\s*de\s*la\s*fanb)\b/i,                                value: "0177", priority: 2 },
        { regex: /\b(0146|gente\s*emprendedora)\b/i,                                       value: "0146", priority: 2 },
        { regex: /\b(0178|n58)\b/i,                                                        value: "0178", priority: 2 },
        { regex: /\b(0171|activo|banco\s*activo)\b/i,                                      value: "0171", priority: 2 },
        { regex: /\b(0137|sofitasa)\b/i,                                                   value: "0137", priority: 2 },
        { regex: /\b(0168|bancrecer)\b/i,                                                  value: "0168", priority: 2 },
        { regex: /\b(0157|del\s*sur|delsur)\b/i,                                           value: "0157", priority: 2 },
        { regex: /\b(0601|instituto\s*municipal|credito\s*popular)\b/i,                    value: "0601", priority: 2 },
        { regex: /\b(0169|r4)\b/i,                                                         value: "0169", priority: 2 },
        // Fallbacks numéricos
        { regex: /\b0134\b/, value: "01", priority: 1 },
        { regex: /\b0191\b/, value: "0191", priority: 1 },
        { regex: /\b0172\b/, value: "0172", priority: 1 },
        { regex: /\b0114\b/, value: "0114", priority: 1 },
        { regex: /\b0108\b/, value: "0108", priority: 1 },
        { regex: /\b0105\b/, value: "0105", priority: 1 },
        { regex: /\b0174\b/, value: "0174", priority: 1 },
        { regex: /\b0104\b/, value: "0104", priority: 1 },
        { regex: /\b0115\b/, value: "0115", priority: 1 },
        { regex: /\b0156\b/, value: "0156", priority: 1 },
        { regex: /\b0128\b/, value: "0128", priority: 1 },
        { regex: /\b0177\b/, value: "0177", priority: 1 },
        { regex: /\b0146\b/, value: "0146", priority: 1 },
        { regex: /\b0178\b/, value: "0178", priority: 1 },
        { regex: /\b0171\b/, value: "0171", priority: 1 },
        { regex: /\b0138\b/, value: "0138", priority: 1 },
        { regex: /\b0151\b/, value: "0151", priority: 1 },
        { regex: /\b0137\b/, value: "0137", priority: 1 },
        { regex: /\b0168\b/, value: "0168", priority: 1 },
        { regex: /\b0157\b/, value: "0157", priority: 1 },
        { regex: /\b0601\b/, value: "0601", priority: 1 },
        { regex: /\b0169\b/, value: "0169", priority: 1 },
    ];

    // ★ NOTA: en opc=24 (confirmado por HTML real), "Banco Digital de los
    // Trabajadores" usa el código "0007", NO "0175" como en otras páginas del
    // sitio. Si algún día se detecta BDT por TEXTO camino a opc=24 (hoy no
    // ocurre: BDT se enruta primero a opc=30 vía bancosMapOpc30), habría que
    // usar este valor especial, no "0175".
    const BDT_VALOR_OPC24 = '0007';

    function normalizarTexto(txt) {
        return txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    }

    function detectarBanco(items, mapa) {
        let mejorMatch = null, maxPriority = -1;
        for (const texto of items) {
            const norm = normalizarTexto(texto);
            for (const banco of mapa) {
                if (banco.regex.test(norm) && banco.priority > maxPriority) {
                    maxPriority = banco.priority;
                    mejorMatch  = banco.value;
                }
            }
        }
        return mejorMatch;
    }

    /* ============================================
       ★ INTERRUPTOR "Forzar Pago Móvil → opc=30"
       Cuando está ACTIVO, TODAS las órdenes de tipo "Pago Móvil" (sin
       importar si el banco es público o privado) se enrutan a
       opc=30 → "Teléfono Operaciones Inmediatas", ignorando la distinción
       habitual entre bancosMapOpc30 (BDV/Tesoro/BDT) y bancosMapOpc24
       (el resto). El estado se guarda con GM_setValue — es decir,
       INMUNE a recargas de página y compartido entre todas las pestañas
       (Binance y Banesco por igual).
    ============================================ */
    const FORZAR_OPC30_KEY = 'p2p_forzar_opc30_pago_movil';

    function getForzarOpc30() {
        return GM_getValue(FORZAR_OPC30_KEY, false);
    }
    function setForzarOpc30(valor) {
        GM_setValue(FORZAR_OPC30_KEY, !!valor);
    }

    // Todos los bancos de bancosMapOpc24, pero con el sufijo "|A" que usa el
    // <select> "banco" de opc=30 (confirmado por HTML real de esa página).
    function bancosMapOpc24ConSufijoOpc30() {
        return bancosMapOpc24.map(b => ({ regex: b.regex, value: b.value + '|A', priority: b.priority }));
    }

    /* ★ 0102/0175/0163 → opc=30. Todos los demás → opc=24.
       (A MENOS que el interruptor "Forzar opc=30" esté activo, en cuyo caso
       CUALQUIER banco detectado se enruta a opc=30/Teléfono.) */
    function detectarBancoYTipo(items) {
        if (getForzarOpc30()) {
            const mapaCompleto = [...bancosMapOpc30, ...bancosMapOpc24ConSufijoOpc30()];
            const banco = detectarBanco(items, mapaCompleto);
            log(`[Forzar opc=30 ACTIVO] Banco detectado: ${banco} → tipo: pago_movil (forzado)`);
            return { banco, tipo: "pago_movil" };
        }

        const bancoOpc30 = detectarBanco(items, bancosMapOpc30);
        if (bancoOpc30) {
            log(`Banco opc=30 detectado: ${bancoOpc30} → tipo: pago_movil`);
            return { banco: bancoOpc30, tipo: "pago_movil" };
        }
        const bancoOpc24 = detectarBanco(items, bancosMapOpc24);
        log(`Banco opc=24 detectado: ${bancoOpc24} → tipo: pago_movil_otros`);
        return { banco: bancoOpc24, tipo: "pago_movil_otros" };
    }

    // Botón flotante Activar/Desactivar. Se usa tanto en Binance como en
    // Banesco (misma función, mismo estado compartido vía GM storage).
    // Guardado contra iframes: solo se crea en el frame de nivel superior.
    function crearBotonForzarOpc30() {
        if (window.top !== window.self) return;
        if (document.getElementById('p2p-forzar-opc30-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'p2p-forzar-opc30-btn';
        btn.style.cssText = `
            position:fixed; top:60px; right:16px; z-index:999999;
            padding:10px 14px; border:none; border-radius:8px;
            font-family:Arial,sans-serif; font-size:13px; font-weight:bold;
            cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,0.35);
        `;

        function actualizarEstiloBoton() {
            const activo = getForzarOpc30();
            btn.textContent = activo
                ? '✅ Transferencia telefónica: ACTIVADO'
                : '⬜ Transferencia telefónica: DESACTIVADO';
            btn.style.background = activo ? '#1a7a1a' : '#444';
            btn.style.color = '#fff';
        }

        btn.onclick = () => {
            setForzarOpc30(!getForzarOpc30());
            actualizarEstiloBoton();
            log('Interruptor "Forzar opc=30" ahora:', getForzarOpc30() ? 'ACTIVADO' : 'DESACTIVADO');
        };

        actualizarEstiloBoton();
        document.body.appendChild(btn);
    }



    function leerCamposMetodoPago() {
        const resultado = {};

        for (const sel of CFG.SELECTORS.labelRows) {
            try {
                document.querySelectorAll(sel).forEach(row => {
                    const celdas = [...row.children];
                    if (celdas.length < 2) return;
                    const etiqueta = celdas[0].textContent.trim();
                    const valor    = celdas[celdas.length - 1].textContent.trim();
                    if (etiqueta && valor && etiqueta !== valor) resultado[etiqueta] = valor;
                });
            } catch (_) {}
        }

        if (Object.keys(resultado).length === 0) {
            log("Estrategia genérica de extracción de campos activada");
            document.querySelectorAll('div, li').forEach(el => {
                const hijos = [...el.children].filter(h => h.children.length === 0);
                if (hijos.length === 2) {
                    const etiqueta = hijos[0].textContent.trim();
                    const valor    = hijos[1].textContent.trim();
                    if (etiqueta.length > 2 && etiqueta.length < 40 && valor.length > 0) {
                        resultado[etiqueta] = valor;
                    }
                }
            });
        }

        log("Campos método de pago detectados:", resultado);
        return resultado;
    }

    /* Detecta si una etiqueta normalizada corresponde a número de cuenta
       Acepta español ("cuenta") e inglés ("account") */
    function esEtiquetaCuenta(etiqueta) {
        return etiqueta.includes('cuenta') || etiqueta.includes('account');
    }

    /* Detecta si una etiqueta normalizada corresponde a cédula / ID */
    function esEtiquetaCedula(etiqueta) {
        return etiqueta.includes('cedula')    ||
               etiqueta.includes('id number') ||
               etiqueta.includes('identity')  ||
               etiqueta.includes('documento') ||
               etiqueta.includes('doc');
    }

    function detectarTipoPago(campos, infoItems) {
        const etiquetas = Object.keys(campos).map(normalizarTexto);

        // ── 1. Buscar número de cuenta en los campos etiquetados ──────────────
        const tieneCuenta = etiquetas.some(esEtiquetaCuenta);
        const tieneCedula = etiquetas.some(esEtiquetaCedula);

        let cuentaInfo = null; // { cuenta, bancoCodigo, tipo } | null
        let cedulaRaw  = null;

        for (const [k, v] of Object.entries(campos)) {
            const kn = normalizarTexto(k);
            if (!cuentaInfo && esEtiquetaCuenta(kn)) {
                cuentaInfo = extraerNumeroCuentaGenerico(v);
            }
            if (!cedulaRaw && esEtiquetaCedula(kn)) {
                cedulaRaw = v;
            }
        }

        // ── 2. Fallback: buscar el número de cuenta directamente en los infoItems ──
        //    Cubre el caso en que Binance no expone una etiqueta reconocible
        if (!cuentaInfo) {
            for (const texto of infoItems) {
                const candidato = extraerNumeroCuentaGenerico(texto);
                if (candidato) { cuentaInfo = candidato; break; }
            }
        }

        // ── 3. Fallback cédula desde infoItems si no se encontró en campos ────
        if (!cedulaRaw) {
            cedulaRaw = infoItems.find(t => /^\d{7,8}$/.test(t.replace(/\D/g, ''))) || null;
        }

        log("Tipo pago — tieneCuenta:", tieneCuenta, "tieneCedula:", tieneCedula,
            "cuentaInfo:", cuentaInfo, "cedulaRaw:", cedulaRaw);

        // ── 4. Si la cuenta pertenece a un banco reconocido por número de cuenta
        //    (Banesco 0134 → transferencia_banesco; Mercantil 0105 / Provincial
        //    0108 → cuenta_tercero_opc30) ────────────────────────────────────
        if (cuentaInfo) {
            log(`→ ${cuentaInfo.tipo} detectado por cuenta (banco ${cuentaInfo.bancoCodigo})`);
            return {
                tipo:       cuentaInfo.tipo,
                cedula:     extraerCedula(cedulaRaw),
                cuenta:     cuentaInfo.cuenta,
                bancoCodigo: cuentaInfo.bancoCodigo,
            };
        }

        return { tipo: "pago_movil" };
    }

    /* ============================================
       Notificación flotante
    ============================================ */
    function mostrarNotificacion(ok, detalles) {
        document.getElementById('p2p-notif')?.remove();
        const div = document.createElement('div');
        div.id = 'p2p-notif';
        div.style.cssText = `
            position:fixed;top:20px;right:20px;z-index:999999;
            background:${ok ? '#1a7a1a' : '#7a1a1a'};color:#fff;
            font-family:Arial,sans-serif;font-size:14px;
            padding:14px 18px;border-radius:10px;
            box-shadow:0 4px 18px rgba(0,0,0,0.35);
            min-width:280px;max-width:380px;
            border-left:5px solid ${ok ? '#4cff4c' : '#ff4c4c'};
        `;
        const icono  = ok ? '✅' : '❌';
        const titulo = ok ? 'Datos verificados correctamente' : 'Error en los datos pegados';
        let html = `<div style="font-size:16px;font-weight:bold;margin-bottom:8px">${icono} ${titulo}</div>`;
        detalles.forEach(({ campo, esperado, obtenido, coincide }) => {
            const color = coincide ? '#a0ffa0' : '#ffaaaa';
            const mark  = coincide ? '✔' : '✘';
            html += `<div style="margin-bottom:4px;color:${color}">
                ${mark} <b>${campo}:</b> ${obtenido}
                ${!coincide ? `<span style="color:#ffd0d0"> (esperado: ${esperado})</span>` : ''}
            </div>`;
        });
        div.innerHTML = html;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), ok ? 6000 : 12000);
    }

    /* ============================================
       Validar pegado
    ============================================ */
    function validarPegado(p) {
        const detalles = [];
        let todoOk = true;

        function check(campo, selectorInput, esperado, transformar = v => v) {
            if (!esperado) return;
            const el = document.querySelector(selectorInput);
            const obtenido = el ? el.value.trim() : '(campo no encontrado)';
            const esperadoTransformado = transformar(esperado);
            const coincide = obtenido === esperadoTransformado;
            if (!coincide) todoOk = false;
            detalles.push({ campo, esperado: esperadoTransformado, obtenido, coincide });
        }

        if (p.tipo === "transferencia_banesco") {
            check('Cédula',  '#ctl00_cp_wz_txtCedula',           p.cedula);
            check('Cuenta',  '#ctl00_cp_wz_txtCuentaTransferir', p.cuenta);
            check('Monto',   '#ctl00_cp_wz_txtMonto',            p.monto, internalToBanesco);
        } else if (p.tipo === "cuenta_tercero_opc30") {
            check('Banco',   '#bancocta',      p.bancoCodigo, v => v + '|A');
            check('Cédula',  '#cedulacta',     p.cedula);
            check('Cuenta',  '#cuentacliente', p.cuenta);
            check('Monto',   '#montocta',      p.monto, internalToBanesco);
        } else {
            check('Monto',    '#monto, [name="monto"]', p.monto, internalToBanesco);
            check('Cédula',   '#ced',                   p.cedula);
            check('Prefijo',  '#pref',                  p.prefijo);
            check('Teléfono', '#tel',                   p.telefono);
            check('Banco',    '#banco',                 p.banco);
        }

        mostrarNotificacion(todoOk, detalles);
        return todoOk;
    }

    // Revisa si el/los campo(s) que identifican esta transacción están
    // vacíos en el DOM (ej. el sitio los limpió, o el pegado inicial nunca
    // llegó a tiempo). Se usa para el "vigilante" que vuelve a pegar los
    // datos automáticamente si detecta que se perdieron.
    function algunCampoVacio(p) {
        function vacio(selector) {
            const el = document.querySelector(selector);
            return !el || el.value.trim() === '';
        }

        if (p.tipo === "transferencia_banesco") {
            return vacio('#ctl00_cp_wz_txtCuentaTransferir') || vacio('#ctl00_cp_wz_txtMonto');
        }
        if (p.tipo === "cuenta_tercero_opc30") {
            return vacio('#cuentacliente') || vacio('#montocta');
        }
        // pago_movil / pago_movil_otros
        return vacio('#tel') || vacio('#monto, [name="monto"]');
    }

    /* ============================================
       Diagnóstico visual en Binance (solo DEBUG)
    ============================================ */
    function mostrarDiagnostico(msg, color = '#f0c040') {
        if (!DEBUG) return;
        let el = document.getElementById('p2p-debug');
        if (!el) {
            el = document.createElement('div');
            el.id = 'p2p-debug';
            el.style.cssText = `
                position:fixed;bottom:10px;left:10px;z-index:999999;
                background:#111;color:${color};font-family:monospace;font-size:12px;
                padding:8px 12px;border-radius:6px;max-width:500px;
                border:1px solid ${color};pointer-events:none;
            `;
            document.body?.appendChild(el);
        }
        el.style.borderColor = color;
        el.style.color = color;
        el.textContent = '[P2P DEBUG] ' + msg;
    }

    /* ============================================
       BINANCE — captura atómica del payload
    ============================================ */
    if (location.host.includes("binance.com")) {
        log("Script iniciado en Binance:", location.href);

        let ultimaOrden = null;

        function capturarDatos() {
            try {
                if (!document.body) {
                    mostrarDiagnostico("Esperando document.body...");
                    return;
                }

                const ordenEl = querySelector(CFG.SELECTORS.ordenId);
                if (!ordenEl) {
                    mostrarDiagnostico("❌ No se encontró el elemento de orden. Abre una orden P2P.");
                    return;
                }

                const ordenActual = ordenEl.textContent.trim();
                if (!ordenActual) { mostrarDiagnostico("❌ Orden vacía"); return; }
                if (ordenActual === ultimaOrden) return;

                const raiz = ordenEl.closest('[role="dialog"]') || document;
                const montoEl = querySelector(CFG.SELECTORS.monto) || buscarMontoEstructural(raiz);
                if (!montoEl) {
                    mostrarDiagnostico("❌ No se encontró el monto. Selector puede haber cambiado.");
                    return;
                }

                const monto = parseMontoBinance(montoEl.textContent);
                if (!monto) {
                    mostrarDiagnostico("❌ No se pudo parsear el monto: " + montoEl.textContent);
                    return;
                }

                const infoEls   = querySelectorAll(CFG.SELECTORS.infoItems);
                const infoItems = [...infoEls].map(d => d.textContent.trim()).filter(t => t.length > 2);
                log("infoItems:", infoItems);

                const campos   = leerCamposMetodoPago();
                const tipoPago = detectarTipoPago(campos, infoItems);

                let payload;

                if (tipoPago.tipo === "transferencia_banesco") {
                    payload = {
                        orden:  ordenActual,
                        tipo:   "transferencia_banesco",
                        monto,
                        cedula: tipoPago.cedula || null,
                        cuenta: tipoPago.cuenta || null,
                        ts:     Date.now(),
                    };
                } else if (tipoPago.tipo === "cuenta_tercero_opc30") {
                    // Mercantil (0105) / Provincial (0108): misma lógica que
                    // Banesco (cédula + número de cuenta), pero se pega en
                    // opc=30 usando la sub-sección "Código de Cuenta".
                    payload = {
                        orden:       ordenActual,
                        tipo:        "cuenta_tercero_opc30",
                        monto,
                        cedula:      tipoPago.cedula      || null,
                        cuenta:      tipoPago.cuenta       || null,
                        bancoCodigo: tipoPago.bancoCodigo  || null,
                        ts:          Date.now(),
                    };
                } else {
                    let cedulaRaw   = null;
                    let telefonoRaw = null;

                    for (const [k, v] of Object.entries(campos)) {
                        const kn = normalizarTexto(k);
                        if (!cedulaRaw   && (kn.includes('cedula') || kn.includes('cédula')))                                                       cedulaRaw   = v;
                        if (!telefonoRaw && (kn.includes('telefono') || kn.includes('teléfono') || kn.includes('movil') || kn.includes('celular'))) telefonoRaw = v;
                    }

                    if (!cedulaRaw)   cedulaRaw   = infoItems.find(t => /\d{7,8}/.test(t.replace(/\D/g, '')));
                    if (!telefonoRaw) telefonoRaw = infoItems.find(t => /^0?4\d{8,9}$/.test(t.replace(/\D/g, '')));

                    const cedula = extraerCedula(cedulaRaw);
                    const tel    = extraerTelefono(telefonoRaw);

                    // detectarBancoYTipo: 0102/0175/0163 → opc=30, resto → opc=24
                    const { banco, tipo: tipoFinal } = detectarBancoYTipo(infoItems);

                    payload = {
                        orden:    ordenActual,
                        tipo:     tipoFinal,
                        monto,
                        cedula:   cedula        || null,
                        telefono: tel?.telefono || null,
                        prefijo:  tel?.prefijo  || null,
                        banco:    banco         || null,
                        ts:       Date.now(),
                    };
                }

                log("Payload capturado:", payload);
                mostrarDiagnostico(`✅ Capturado: orden ${ordenActual} | ${payload.tipo} | Bs ${monto}`, '#4cff4c');
                GM_setValue(CFG.GM_KEY, JSON.stringify(payload));
                ultimaOrden = ordenActual;

            } catch (e) {
                err("Error capturando datos:", e);
                mostrarDiagnostico("❌ Error: " + e.message, '#ff4c4c');
            }
        }

        const capturarDebounced = debounce(capturarDatos, CFG.DEBOUNCE_MS);

        function iniciarObserver() {
            if (!document.body) {
                setTimeout(iniciarObserver, 100);
                return;
            }
            log("MutationObserver iniciado");
            const observer = new MutationObserver(capturarDebounced);
            observer.observe(document.body, { childList: true, subtree: true });
            capturarDatos();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciarObserver);
        } else {
            iniciarObserver();
        }
    }

    /* ============================================
       BANESCO — pegado con reintentos controlados
       + AUTO SELECT (valores por defecto en los formularios)
    ============================================ */
    if (location.host.includes("banesconline.com")) {
        log("Script iniciado en Banesco:", location.href);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', crearBotonForzarOpc30);
        } else {
            crearBotonForzarOpc30();
        }

        /* ============================================
           REGISTRO DE VUELO — sobrevive recargas (guardado en GM storage,
           no en la consola, que se borra al recargar). Sirve para ver
           EXACTAMENTE qué pasó justo antes de una recarga inesperada.
        ============================================ */
        const FLIGHT_LOG_KEY = 'p2p_flight_log';
        function registrarEvento(msg) {
            try {
                const lista = JSON.parse(GM_getValue(FLIGHT_LOG_KEY, '[]'));
                lista.push({ t: new Date().toISOString().slice(11, 23), url: location.pathname + location.search, msg });
                while (lista.length > 40) lista.shift();
                GM_setValue(FLIGHT_LOG_KEY, JSON.stringify(lista));
            } catch (_) {}
        }
        // Mostrar el registro de la carga ANTERIOR (si existe), antes de que
        // este script agregue sus propios eventos nuevos.
        try {
            const anterior = JSON.parse(GM_getValue(FLIGHT_LOG_KEY, '[]'));
            if (anterior.length) {
                console.log('%c[P2P] Registro de vuelo (carga anterior):', 'color:#f0c040;font-weight:bold');
                console.table(anterior);
            }
        } catch (_) {}
        registrarEvento('Script iniciado en: ' + location.href);
        window.addEventListener('beforeunload', () => registrarEvento('⚠️ beforeunload disparado (la página se va a recargar/navegar)'));

        let payload    = null;
        let intentos   = 0;
        let retryTimer = null;

        function getPayload() {
            const raw = GM_getValue(CFG.GM_KEY);
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (_) { return null; }
        }

        function asegurarPagina(p) {
            const urlDestino = CFG.URLS_BANESCO[p.tipo];
            if (!urlDestino) return true;

            const yaRedirigido = sessionStorage.getItem('p2p_redirected_orden');
            if (yaRedirigido === p.orden) {
                log("Ya redirigimos para la orden:", p.orden);
                return true;
            }

            const actualCompleta = location.pathname + location.search;
            if (actualCompleta !== urlDestino) {
                sessionStorage.setItem('p2p_redirected_orden', p.orden);
                log("Redirigiendo a:", urlDestino, "| tipo:", p.tipo);
                location.href = urlDestino;
                return false;
            }

            return true;
        }

        // Regla compartida: selecciona "V" en el <select> de nacionalidad
        // SOLO si la cédula es menor a 40.000.000. Si es mayor o igual, NO
        // se toca el campo (se deja como esté, sin forzar ningún valor).
        // Se usa en ddlNac (tercerosbanesco.aspx), NacCli (opc=30 y opc=24) y
        // NacCliCta (opc=30, "Código de Cuenta").
        function aplicarNacionalidadSegunCedula(el, cedulaRaw, etiquetaLog) {
            if (!el || !cedulaRaw) return;
            const cedulaNum = parseInt(String(cedulaRaw).replace(/\D/g, ''), 10);
            if (isNaN(cedulaNum)) return;
            if (cedulaNum < 40000000) {
                setSelect(el, 'V');
                log('Auto Select (' + etiquetaLog + '): nacionalidad = "V" (cédula ' + cedulaNum + ' < 40.000.000).');
            } else {
                log('Auto Select (' + etiquetaLog + '): nacionalidad NO se toca (cédula ' + cedulaNum + ' >= 40.000.000).');
            }
        }

        function pegarPagoMovil(p) {
            let ok = true;
            if (p.monto) {
                const i = document.querySelector("#monto") || document.querySelector("[name='monto']");
                if (i) setInputValue(i, internalToBanesco(p.monto)); else ok = false;
            }
            if (p.cedula) {
                const ced = document.querySelector("#ced");
                const nom = document.querySelector("#nom");
                if (ced) setInputValue(ced, p.cedula); else ok = false;
                if (nom) setInputValue(nom, p.cedula);
                // Misma regla que tercerosbanesco.aspx: "V" solo si la cédula
                // es menor a 40.000.000. Cubre tanto opc=30 como opc=24 (ambos
                // usan el mismo id "NacCli").
                aplicarNacionalidadSegunCedula(document.querySelector("#NacCli"), p.cedula, 'NacCli');
            }
            if (p.prefijo) {
                const s = document.querySelector("#pref");
                if (s) setInputValue(s, p.prefijo); else ok = false;
            }
            if (p.telefono) {
                const i = document.querySelector("#tel");
                if (i) setInputValue(i, p.telefono); else ok = false;
            }
            if (p.banco) {
                const s = document.querySelector("#banco");
                if (s) setInputValue(s, p.banco); else ok = false;
            }
            return ok;
        }

        function pegarTransferenciaBanesco(p) {
            let ok = true;
            if (p.cedula) {
                const i = document.querySelector("#ctl00_cp_wz_txtCedula");
                if (i) setInputValue(i, p.cedula); else ok = false;
            }
            if (p.cuenta) {
                const i = document.querySelector("#ctl00_cp_wz_txtCuentaTransferir");
                if (i) setInputValue(i, p.cuenta); else ok = false;
            }
            if (p.monto) {
                const i = document.querySelector("#ctl00_cp_wz_txtMonto");
                if (i) setInputValue(i, internalToBanesco(p.monto)); else ok = false;
            }
            return ok;
        }

        // Mercantil (0105) / Provincial (0108): sub-sección "Código de Cuenta"
        // dentro de opc=30. Usa los campos bancocta/cedulacta/cuentacliente/
        // montocta/conceptocta, distintos de los de "Teléfono Operaciones
        // Inmediatas" (banco/ced/pref/tel/monto/concepto).
        function pegarCuentaTercero(p) {
            let ok = true;

            if (p.bancoCodigo) {
                const s = document.querySelector("#bancocta");
                if (s) setInputValue(s, p.bancoCodigo + '|A'); else ok = false;
            }
            if (p.cedula) {
                const i = document.querySelector("#cedulacta");
                if (i) setInputValue(i, p.cedula); else ok = false;
                // Misma regla que ddlNac/NacCli: "V" solo si la cédula es
                // menor a 40.000.000.
                aplicarNacionalidadSegunCedula(document.querySelector("#NacCliCta"), p.cedula, 'NacCliCta');
                // Igual que #nom en el flujo de Teléfono: el nombre del
                // beneficiario se rellena con la cédula.
                const benef = document.querySelector("#benefcta");
                if (benef) setInputValue(benef, p.cedula);
            }
            if (p.cuenta) {
                const i = document.querySelector("#cuentacliente");
                if (i) setInputValue(i, p.cuenta); else ok = false;
            }
            if (p.monto) {
                const i = document.querySelector("#montocta");
                if (i) setInputValue(i, internalToBanesco(p.monto)); else ok = false;
            }
            // Concepto por defecto si el campo está vacío (no viene en el payload).
            const concepto = document.querySelector("#conceptocta");
            if (concepto && !concepto.value.trim()) setInputValue(concepto, 'pago');

            return ok;
        }

        function pegarTodo(p) {
            if (!asegurarPagina(p)) return false;

            let ok;
            if (p.tipo === "transferencia_banesco") {
                ok = pegarTransferenciaBanesco(p);
            } else if (p.tipo === "cuenta_tercero_opc30") {
                ok = pegarCuentaTercero(p);
            } else {
                ok = pegarPagoMovil(p);
            }

            if (ok) validarPegado(p);
            return ok;
        }

        /* ============================================
           AUTO SELECT (integrado desde "Banesco Auto Select" v1.2)

           IMPORTANTE: separamos los campos en dos grupos.

           - "Estructurales" (TipTrans, NacCli, ddlCuentaDebitar,
             inputGroupSelect01): en un sitio ASP.NET WebForms, cambiar
             el "Método de Transferencia" (TipTrans) suele disparar un
             POSTBACK real (recarga controlada de la página) para que el
             servidor muestre los campos correctos según el método
             elegido. Si esto ocurre DESPUÉS de que ya pegamos los datos
             del payload y lo marcamos como completado (borrándolo),
             la página se recarga, se pierden los valores, y ya no hay
             payload para volver a pegar — esto es lo que estaba
             causando el "redirecciona 2 veces y se borra".

             Por eso estos campos se aplican SOLO UNA VEZ por carga de
             página, y el pegado del payload espera a que esta fase
             termine (y a un pequeño margen extra) antes de empezar.

           - "Seguros" (Concepto): no disparan postback, se pueden
             reaplicar libremente si el campo está vacío.
        ============================================ */
        // "cuentaOrigenAplicada" solo pasa a true cuando CONFIRMAMOS que
        // inputGroupSelect01 quedó con el valor correcto (no incondicionalmente
        // al primer intento, ya que el <select> puede tardar en poblarse con
        // sus opciones tras la carga de la página).
        let cuentaOrigenAplicada = false;
        // TipTrans depende de que la cuenta de origen ya esté seleccionada
        // (si no, el campo queda deshabilitado/sin efecto) — por eso solo se
        // intenta DESPUÉS de confirmar cuentaOrigenAplicada.
        let tipTransAplicado = false;

        function fireEvents(el) {
            ['input', 'change', 'blur'].forEach(evt =>
                el.dispatchEvent(new Event(evt, { bubbles: true }))
            );
            if (typeof el.onchange === 'function') {
                el.onchange({ target: el, type: 'change' });
            }
        }

        // Selecciona en un <select> por texto o value (coincidencia parcial)
        function setSelect(el, match) {
            if (!el || el.tagName !== 'SELECT') return false;
            for (const opt of el.options) {
                const txt = (opt.textContent || '').trim();
                const val = (opt.value || '').trim();
                if (txt.includes(match) || val.includes(match)) {
                    if (el.value !== opt.value) {
                        el.value = opt.value;
                        fireEvents(el);
                    }
                    return true;
                }
            }
            return false;
        }

        // Selecciona por value EXACTO (más fiable)
        function setSelectByValue(el, targetVal) {
            if (!el || el.tagName !== 'SELECT') return false;
            const hasOpt = [...el.options].some(o => o.value === targetVal);
            if (!hasOpt) return false; // opción aún no poblada
            if (el.value !== targetVal) {
                el.value = targetVal;
                fireEvents(el);
            }
            return true;
        }

        function setText(el, value) {
            if (!el) return false;
            if (el.value !== value) {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }

        function byNameOrId(nameOrId) {
            let el = document.querySelector('[name="' + nameOrId.replace(/"/g, '\\"') + '"]');
            if (el) return el;
            return document.getElementById(nameOrId);
        }

        function buscarValorOpcion(el, match) {
            if (!el || el.tagName !== 'SELECT') return null;
            for (const opt of el.options) {
                const txt = (opt.textContent || '').trim();
                const val = (opt.value || '').trim();
                if (txt.includes(match) || val.includes(match)) return opt.value;
            }
            return null;
        }

        // PASO 1 — cuenta de origen (inputGroupSelect01). Se reintenta hasta
        // confirmar éxito real (el <select> puede tardar en poblarse con sus
        // opciones tras la carga de la página).
        function intentarAplicarCuentaOrigen() {
            if (cuentaOrigenAplicada) return true;
            const elGroup = byNameOrId('inputGroupSelect01');
            if (!elGroup) return false; // no existe en esta página (ej. tercerosbanesco.aspx)
            const ok = setSelectByValue(elGroup, getInputGroupSelect01Valor());
            if (ok) {
                cuentaOrigenAplicada = true;
                log('Auto Select: cuenta de origen (inputGroupSelect01) confirmada.');
            }
            return ok;
        }

        // PASO 2 — Método de Transferencia (TipTrans). Solo se intenta DESPUÉS
        // de confirmar la cuenta de origen, y se aplica una única vez (evita
        // volver a dispararlo y potencialmente causar un postback repetido).
        function intentarAplicarTipTrans() {
            if (tipTransAplicado) return true;
            if (!cuentaOrigenAplicada) return false; // esperar a que la cuenta de origen esté lista

            const tipoActual = (payload && payload.tipo) || null;
            const valorTipTrans = tipoActual === 'cuenta_tercero_opc30'
                ? 'Código de Cuenta'
                : AUTO_SELECT_CFG.tipoTransferencia; // 'Teléfono Operaciones Inmediatas'

            const elTip = byNameOrId('TipTrans');
            if (!elTip) return false;

            setSelect(elTip, valorTipTrans);
            tipTransAplicado = true;
            log('Auto Select: TipTrans aplicado a "' + valorTipTrans + '".');
            return true;
        }

        // PASO 3 (best-effort, no bloqueante) — Nacionalidad del documento
        // para el sub-flujo de teléfono. No es crítico si tarda un poco más.
        // NOTA: la nacionalidad de #NacCli ya se maneja con la regla de
        // cédula (<40.000.000 → "V") dentro de pegarPagoMovil, con el
        // payload real. Ya no hace falta un "best-effort" aparte aquí.

        // ============================================
        // Campos específicos de tercerosbanesco.aspx (transferencia_banesco):
        // - ddlCuentaDebitar: siempre "0134-****-**-***1039488 Cuenta Corriente"
        //   (configurable — ver getCuentaDebitar() al inicio del script)
        // - ddlNac: "V" SOLO si la cédula es menor a 40.000.000; si es mayor
        //   o igual, se deja en blanco (no se toca) a propósito.
        // ============================================
        let cuentaDebitarTercerosAplicada = false;
        let ddlNacTercerosEvaluado = false;

        function aplicarCamposTercerosBanesco(p) {
            const elCuenta = byNameOrId('ctl00$cp$wz$ddlCuentaDebitar');
            if (!elCuenta) return false; // el <select> aún no existe (o no es esta página)

            if (!cuentaDebitarTercerosAplicada) {
                const cuentaOk = setSelect(elCuenta, getCuentaDebitar());
                if (cuentaOk) {
                    cuentaDebitarTercerosAplicada = true;
                    log('Auto Select (tercerosbanesco): ddlCuentaDebitar aplicado.');
                }
            }

            // Importante: esto se evalúa de forma INDEPENDIENTE del flag de
            // arriba, para que, si esta función se llama antes de que llegue
            // el payload real (p=null, ej. red de seguridad general), la
            // decisión de ddlNac según la cédula se siga evaluando más tarde
            // cuando sí haya payload — en vez de quedar bloqueada para siempre.
            if (!ddlNacTercerosEvaluado && p && p.cedula) {
                aplicarNacionalidadSegunCedula(byNameOrId('ctl00$cp$wz$ddlNac'), p.cedula, 'ddlNac/tercerosbanesco');
                ddlNacTercerosEvaluado = true;
            }

            // "Listo" para efectos del ciclo de espera: cuenta aplicada Y
            // (ddlNac ya evaluado, o directamente no hay cédula que evaluar
            // todavía — no bloqueamos el pegado esperando algo que no llegó).
            return cuentaDebitarTercerosAplicada && (ddlNacTercerosEvaluado || !(p && p.cedula));
        }

        // Intenta avanzar toda la cadena en orden. Devuelve `true` solo cuando
        // la estructura completa (cuenta de origen + TipTrans) ya quedó lista.
        function intentarAplicarEstructura() {
            const cuentaOk = intentarAplicarCuentaOrigen();
            let tipTransOk = false;
            if (cuentaOk) {
                tipTransOk = intentarAplicarTipTrans();
            }
            return cuentaOk && tipTransOk;
        }

        // Campos seguros: no disparan postback, se pueden reaplicar libremente.
        function aplicarCamposSeguros() {
            const concepto = byNameOrId('ctl00$cp$wz$txtConcepto') || byNameOrId('concepto');
            if (concepto && concepto.value.trim() === '') setText(concepto, AUTO_SELECT_CFG.conceptoDefecto);
        }

        // Se resuelve cuando la estructura del formulario (cuenta de origen +
        // Método de Transferencia) ya quedó lista, reintentando cada 300ms
        // hasta un máximo de 8 segundos. Si tuvo que aplicar TipTrans recién
        // en esta llamada, agrega un margen extra por si eso dispara algún
        // cambio adicional en el DOM antes de empezar a pegar el payload.
        // La espera de "cuenta de origen + TipTrans" SOLO aplica a los tipos
        // que sabemos con certeza que viven en opc=30 (confirmado por HTML
        // real). Para pago_movil_otros (opc=24) esos campos NO existen, así
        // que esperarlos solo agregaba una demora inútil antes de pegar.
        // transferencia_banesco (tercerosbanesco.aspx) tiene su PROPIA espera
        // corta, específica para ddlCuentaDebitar/ddlNac.
        const TIPOS_CON_ESTRUCTURA_OPC30 = ['pago_movil', 'cuenta_tercero_opc30'];

        function prepararEstructuraYObtenerPromesa() {
            const tipoActual = payload && payload.tipo;

            if (tipoActual === 'transferencia_banesco') {
                return new Promise((resolve) => {
                    const inicio = Date.now();
                    const intervalo = setInterval(() => {
                        const listo = aplicarCamposTercerosBanesco(payload);
                        if (listo || Date.now() - inicio > 2000) {
                            clearInterval(intervalo);
                            if (!listo) {
                                warn('Auto Select (tercerosbanesco): no se pudo aplicar ddlCuentaDebitar tras 2s. Continuando de todas formas.');
                            }
                            resolve();
                        }
                    }, 100);
                });
            }

            if (!TIPOS_CON_ESTRUCTURA_OPC30.includes(tipoActual)) {
                log('Auto Select: tipo "' + tipoActual + '" no requiere esperar cuenta de origen/TipTrans; pegando directamente.');
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                const yaEstabaListo = cuentaOrigenAplicada && tipTransAplicado;
                const inicio = Date.now();

                const intervalo = setInterval(() => {
                    const listo = intentarAplicarEstructura();
                    if (listo || Date.now() - inicio > 3000) {
                        clearInterval(intervalo);
                        // El cambio de TipTrans solo alterna visibilidad de divs por
                        // JS del lado del cliente (confirmado por HTML real: todos
                        // los campos ya existen en el DOM desde el inicio, ocultos
                        // con style="display:none"), no es un postback real — así
                        // que el margen extra puede ser mínimo.
                        const margen = (listo && !yaEstabaListo) ? 200 : 0;
                        if (!listo) {
                            warn('Auto Select: no se pudo completar la estructura del formulario (cuenta de origen / Método de Transferencia) tras 3s. Continuando de todas formas.');
                        }
                        setTimeout(resolve, margen);
                    }
                }, 100);
            });
        }

        function iniciarAutoSelect() {
            log('Auto Select iniciado');

            // Reaplica los campos seguros Y sigue intentando completar la
            // estructura (por si el payload todavía no estaba disponible en
            // el primer intento, o si los <select> tardan en poblarse).
            const observerAutoSelect = new MutationObserver(() => {
                aplicarCamposSeguros();
                intentarAplicarEstructura();
                aplicarCamposTercerosBanesco(payload);
            });
            observerAutoSelect.observe(document.body, { childList: true, subtree: true });

            // Red de seguridad: reintenta unos segundos por si algo tarda en cargar.
            let intentosAutoSelect = 0;
            const ivAutoSelect = setInterval(() => {
                aplicarCamposSeguros();
                intentarAplicarEstructura();
                aplicarCamposTercerosBanesco(payload);
                if (++intentosAutoSelect >= 30) clearInterval(ivAutoSelect); // ~15 s (500ms x 30)
            }, 500);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciarAutoSelect);
        } else {
            iniciarAutoSelect();
        }

        function iniciarReintentos(p) {
            payload  = p;
            intentos = 0;
            let exitososConsecutivos = 0;
            clearInterval(retryTimer);

            // PRIMERO nos aseguramos de estar en la página correcta. Si hace
            // falta redirigir, lo hacemos AHORA MISMO — esperar la estructura
            // del formulario (campos que ni siquiera existen todavía porque
            // seguimos en la página equivocada) antes de esto solo agregaba
            // una demora enorme e inútil. Si asegurarPagina() dispara la
            // redirección, esta instancia del script está a punto de morir
            // (la página va a navegar); la NUEVA carga de página recogerá el
            // payload de nuevo desde GM storage y volverá a llamar a esta
            // misma función, esta vez ya en la página correcta.
            if (!asegurarPagina(p)) {
                log('Redirigiendo hacia la página correcta; se reanudará automáticamente al cargar.');
                return;
            }

            log(`Preparando estructura del formulario antes de pegar datos...`);

            // Ahora sí: nos aseguramos de que los campos "estructurales" (los
            // que pueden requerir que otro campo se seleccione primero, como
            // el Método de Transferencia dependiendo de la cuenta de origen)
            // ya se aplicaron, antes de empezar a pegar el payload.
            prepararEstructuraYObtenerPromesa().then(() => {
                setTimeout(() => {
                    retryTimer = setInterval(() => {
                        intentos++;
                        log(`Intento ${intentos}/${CFG.RETRY_MAX_ATTEMPTS} — éxitos consecutivos: ${exitososConsecutivos}/${CFG.RETRY_MIN_SUCCESSES}`);

                        const ok = pegarTodo(payload);

                        if (ok) {
                            exitososConsecutivos++;
                            log(`Pegado exitoso (${exitososConsecutivos}/${CFG.RETRY_MIN_SUCCESSES})`);
                            registrarEvento('Pegado exitoso #' + exitososConsecutivos + ' (tipo=' + payload.tipo + ')');
                        } else {
                            exitososConsecutivos = 0;
                        }

                        const confirmado = exitososConsecutivos >= CFG.RETRY_MIN_SUCCESSES;
                        const agotado    = intentos >= CFG.RETRY_MAX_ATTEMPTS;

                        if (confirmado || agotado) {
                            clearInterval(retryTimer);
                            if (confirmado) {
                                log("Datos confirmados tras", intentos, "intentos.");
                                registrarEvento('Datos CONFIRMADOS tras ' + intentos + ' intentos. Iniciando vigilante.');
                            } else {
                                warn("No se completó tras", intentos, "intentos.");
                                registrarEvento('NO se completó tras ' + intentos + ' intentos. Iniciando vigilante igualmente.');
                            }
                            // IMPORTANTE: NO borramos el payload compartido
                            // (GM_deleteValue) todavía. Si el sitio recarga la
                            // página justo después de pegar (ej. por su propia
                            // validación de duplicidad), necesitamos que el
                            // payload SIGA disponible para que la nueva carga
                            // de página lo recoja de nuevo automáticamente —
                            // ningún intervalo de JS puede "sobrevivir" a una
                            // recarga real, así que la única forma de
                            // recuperarse de eso es dejar el payload guardado
                            // y confiar en que el propio arranque del script
                            // en la página recargada lo vuelva a pegar.
                            iniciarVigilante(payload);
                        }
                    }, CFG.RETRY_INTERVAL_MS);
                }, CFG.REDIRECT_DELAY_MS);
            });
        }

        // Revisa cada 700ms, durante ~15 segundos, si los campos clave siguen
        // vacíos; si es así, vuelve a pegar automáticamente. Se detiene solo
        // si los campos están llenos en 3 revisiones seguidas (ya se considera
        // estable) o al agotar el tiempo máximo. SOLO entonces borra el
        // payload compartido — antes de eso se deja intacto a propósito, para
        // que una recarga inesperada de la página pueda recuperarse sola.
        function iniciarVigilante(payloadFinal) {
            if (!payloadFinal) return;
            let llenosConsecutivos = 0;
            let revisiones = 0;
            const MAX_REVISIONES = 22; // ~15s a 700ms

            const vigilante = setInterval(() => {
                revisiones++;
                if (algunCampoVacio(payloadFinal)) {
                    llenosConsecutivos = 0;
                    warn('Vigilante: detecté campos vacíos, volviendo a pegar el payload...');
                    registrarEvento('Vigilante: campos vacíos detectados en revisión #' + revisiones + ', re-pegando.');
                    pegarTodo(payloadFinal);
                } else {
                    llenosConsecutivos++;
                }

                if (llenosConsecutivos >= 3 || revisiones >= MAX_REVISIONES) {
                    clearInterval(vigilante);
                    log('Vigilante finalizado (' +
                        (llenosConsecutivos >= 3 ? 'campos estables' : 'tiempo máximo alcanzado') + ').');
                    registrarEvento('Vigilante finalizado: ' + (llenosConsecutivos >= 3 ? 'campos estables' : 'tiempo máximo') + '. Borrando payload compartido.');
                    // Recién ahora es seguro borrar el payload compartido:
                    // los campos llevan varias revisiones seguidas llenos
                    // (o agotamos el tiempo de observación de todas formas).
                    GM_deleteValue(CFG.GM_KEY);
                }
            }, 700);
        }

        /* Descarta payloads viejos para no autocompletar con datos obsoletos
           si el flujo se interrumpió y el usuario vuelve a Banesco después. */
        function esPayloadVigente(p) {
            if (!p?.ts) return false;
            const edad = Date.now() - p.ts;
            if (edad > CFG.MAX_PAYLOAD_AGE_MS) {
                warn(`Payload descartado por antigüedad (${Math.round(edad / 1000)}s > ${CFG.MAX_PAYLOAD_AGE_MS / 1000}s)`);
                return false;
            }
            return true;
        }

        GM_addValueChangeListener(CFG.GM_KEY, (_k, _o, newVal) => {
            if (!newVal) return;
            try {
                const p = JSON.parse(newVal);
                if (esPayloadVigente(p)) iniciarReintentos(p);
                else GM_deleteValue(CFG.GM_KEY);
            } catch (_) {}
        });

        const existing = getPayload();
        if (existing) {
            if (esPayloadVigente(existing)) {
                log("Payload existente encontrado:", existing);
                iniciarReintentos(existing);
            } else {
                GM_deleteValue(CFG.GM_KEY);
            }
        }

    }

})();
