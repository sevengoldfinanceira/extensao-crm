(function () {
  'use strict';

  function safeStringify(value) {
    try {
      if (typeof value === "string") return value;
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  const STORAGE_KEY = 'seven_gold_leads';
  const PANEL_ID = 'seven-gold-crm-panel';
  const TOGGLE_ID = 'seven-gold-crm-toggle';
  const FORM_ID = 'seven-gold-crm-form';
  const STATUS_ID = 'seven-gold-crm-status';
  const CAPTURE_BTN_ID = 'seven-gold-capture-btn';
  const CONTACT_BTN_ID = 'seven-gold-contact-btn';
  const LEAD_BTN_ID = 'seven-gold-lead-btn';
  const PANEL_WIDTH = 340;
  const MIN_DOCK_WIDTH = 1200;
  const DEBUG = false;
  const APPOINTMENTS_TABLE = 'appointments';
  const APPOINTMENT_DATE_FIELD = 'data_agendamento';
  const APPOINTMENT_TIME_FIELD = 'hora_agendamento';
  const CRM_WEB_URL = 'https://crmficapital.base44.app';
  let activeTab = 'capture';
  let currentUserPermissions = null;
  let currentUserRole = "";
  let currentCrmUser = null;

  async function getCurrentActor() {
    let user = currentCrmUser || null;
    let authUserId = null;

    try {
      const stored = await chrome.storage.local.get(['sevenGoldCrmUser', 'sevenGoldAuthSession']);
      user = user?.email ? user : (stored.sevenGoldCrmUser || null);
      authUserId = stored.sevenGoldAuthSession?.user?.id || null;
    } catch (e) {
      console.warn("[Seven Gold CRM][Actor] Erro ao ler storage:", e);
    }

    if (!user?.email) {
      throw new Error("Usuário logado não identificado.");
    }

    return {
      email: String(user.email).trim().toLowerCase(),
      name: user.nome || user.name || user.email,
      role: user.cargo || user.role || null,
      id: authUserId || user.auth_user_id || user.user_id || user.id || null,
    };
  }

  function cleanUndefinedFields(payload) {
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });
    return payload;
  }

  /* ------------------------------------------------------------------ */
  /*  Lead Activity Log – History                                        */
  /* ------------------------------------------------------------------ */

  async function createLeadActivityLog({ leadId, actionType, actionLabel, description, oldValue, newValue }) {
    try {
      if (!leadId) {
        console.warn("[Seven Gold CRM][Histórico] leadId ausente, log ignorado.");
        return;
      }

      const actor = await getCurrentActor();

      const payload = {
        lead_id: leadId,
        action_type: actionType,
        action_label: actionLabel,
        description: description || null,
        old_value: oldValue || null,
        new_value: newValue || null,
        created_by_email: actor?.email || null,
        created_by_name: actor?.name || null,
        created_by_role: actor?.role || null,
        created_at: new Date().toISOString(),
      };

      console.log("[Seven Gold CRM][Histórico] Criando log:", payload);

      const { error } = await supabase
        .from("lead_activity_logs")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error("[Seven Gold CRM][Histórico] Erro ao criar log:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          raw: error,
        });
      }
    } catch (error) {
      console.error("[Seven Gold CRM][Histórico] Falha inesperada:", error);
    }
  }

  async function loadLeadHistory(leadId) {
    const container = document.getElementById('sg-crm-lead-history-container');
    if (!container) return;

    if (!leadId) {
      container.innerHTML = `<div class="sg-empty-state">Nenhuma atividade registrada.</div>`;
      return;
    }

    container.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; padding: 8px; color: #8a9fc4; gap: 6px;">
      <span class="sg-spinner" style="border-top-color: #d4af37; width: 10px; height: 10px;"></span>
      <span style="font-size: 10px;">Carregando...</span>
    </div>`;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LEAD_ACTIVITY_LOGS',
        lead_id: leadId
      });

      if (!response?.ok) {
        container.innerHTML = `<div style="color: #f44336; font-size: 10px;">Erro ao carregar histórico.</div>`;
        return;
      }

      const logs = response.logs || [];

      if (logs.length === 0) {
        container.innerHTML = `<div class="sg-empty-state">Nenhuma atividade registrada.</div>`;
        return;
      }

      container.innerHTML = '';

      logs.forEach((log, index) => {
        const item = document.createElement('div');
        item.className = 'sg-history-item';

        const dateStr = new Date(log.created_at).toLocaleString('pt-BR');
        const actorName = log.created_by_name || log.created_by_email || 'Sistema';

        const actionIcons = {
          lead_created: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
          lead_edited: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>',
          stage_changed: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2196f3" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
          appointment_created: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ff9800" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
          task_created: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9c27b0" stroke-width="2.5"><rect x="5" y="4" width="14" height="17" rx="2"/><polyline points="8 10 10 12 13 8"/></svg>',
          task_completed: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
        };

        const icon = actionIcons[log.action_type] || '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8a9fc4" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

        item.innerHTML = `
          <div style="display: flex; align-items: flex-start; gap: 6px;">
            <span style="flex-shrink: 0; margin-top: 2px;">${icon}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 4px;">
                <span style="font-weight: 600; color: #fff; font-size: 10.5px;">${log.action_label}</span>
                <span style="font-size: 9px; color: #8a9fc4; white-space: nowrap;">${dateStr}</span>
              </div>
              <div style="font-size: 10px; color: #8a9fc4; margin-top: 1px;">
                <span style="color: #d4af37;">${actorName}</span>
                ${log.description ? `— ${log.description}` : ''}
              </div>
            </div>
          </div>
          ${index < logs.length - 1 ? `<div style="border-top: 1px solid rgba(29, 47, 90, 0.5); margin: 4px 0;"></div>` : ''}
        `;

        container.appendChild(item);
      });
    } catch (err) {
      console.error("[Histórico Lead] Erro:", err);
      container.innerHTML = `<div style="color: #f44336; font-size: 10px;">Erro ao carregar histórico.</div>`;
    }
  }

  const CRM_STAGES = [
    { value: 'lead_recebido', label: 'Lead Recebido' },
    { value: 'primeiro_contato', label: 'Primeiro Contato' },
    { value: 'agendamento', label: 'Agendamento' },
    { value: 'cliente_em_loja', label: 'Cliente em Loja' },
    { value: 'proposta_enviada', label: 'Proposta Enviada' },
    { value: 'venda_fechada', label: 'Venda Fechada' }
  ];

  function getStageLabel(value) {
    const stage = CRM_STAGES.find(s => s.value === value);
    return stage ? stage.label : 'Etapa desconhecida';
  }

  function normalizeRole(role) {
    if (!role) return "";
    return role
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function isAdminRole(role) {
    const norm = normalizeRole(role);
    return (
      norm === "diretor-ceo" ||
      norm === "dono" ||
      norm === "administrador"
    );
  }

  async function loadCurrentUserPermissions(crmUser) {
    const role = crmUser?.cargo;
    if (!role) return [];

    currentUserRole = role;
    currentCrmUser = crmUser;

    if (isAdminRole(role)) {
      return [
        { area_key: "crm_pipeline", permitido: true },
        { area_key: "calendario", permitido: true },
        { area_key: "tarefas", permitido: true },
        { area_key: "retornos", permitido: true },
      ];
    }

    try {
      const { data, error } = await supabase
        .from("crm_role_permissions")
        .select("cargo,area_key,area_label,permitido")
        .eq("cargo", normalizeRole(role));

      if (error) {
        console.error(
          "[Seven Gold CRM][Permissões] Erro ao buscar permissões:",
          error
        );
        return [];
      }
      return data || [];
    } catch (err) {
      console.error(
        "[Seven Gold CRM][Permissões] Falha ao consultar permissões:",
        err
      );
      return [];
    }
  }

  function canUseExtensionArea(areaKey) {
    if (currentUserRole && isAdminRole(currentUserRole)) return true;
    if (!currentUserPermissions) return false;

    const perm = currentUserPermissions.find(
      (p) => p.area_key === areaKey && p.permitido === true
    );
    return !!perm;
  }

  function canUseTasksTab() {
    return (
      canUseExtensionArea("tarefas") ||
      canUseExtensionArea("retornos") ||
      canUseExtensionArea("crm_pipeline")
    );
  }

  function showPermissionError(msg) {
    showStatus(msg, 'error');
    console.warn("[Seven Gold CRM][Permissões] Acesso negado:", msg);
  }

  /* ------------------------------------------------------------------ */
  /*  Data Service — HTTP API first, chrome.storage.local as fallback    */
  /* ------------------------------------------------------------------ */

  const DataService = {
    async saveLead(data) {
      const actor = await getCurrentActor();

      const apiPayload = {
        name: data.nome,
        phone: data.telefone,
        stage: data.etapa,
        tags: data.etiquetas,
        notes: data.observacoes,
        property_region: data.property_region,
        credit_value: data.credit_value,
        down_payment_value: data.down_payment_value,
        installment_value: data.installment_value,
        source: 'whatsapp_web_extension',
        owner_id: actor.id,
        owner_email: actor.email,
        owner_name: actor.name,
        assigned_to_email: actor.email,
        assigned_to_name: actor.name,
        created_by_email: actor.email,
        created_by_name: actor.name,
        updated_by_email: actor.email,
        updated_by_name: actor.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      cleanUndefinedFields(apiPayload);

      console.log("[Seven Gold CRM][Responsável] Usuário logado:", actor);
      console.log("[Seven Gold CRM][Responsável] Payload lead:", apiPayload);

      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_LEAD',
          data: apiPayload,
        });

        if (DEBUG) console.log('[Seven Gold CRM] Resposta do background:', result);

        if (result && result.ok) {
          console.log('[Seven Gold CRM] Lead salvo via API.');
          return { ok: true, source: 'api', lead: result.lead };
        }

        if (result && result.action === 'duplicate') {
          console.log('[Seven Gold CRM] Duplicado detectado.');
          return { ok: false, action: 'duplicate', lead: result.lead, error: result.error };
        }

        const errorMsg = (result && result.error) || 'Resposta inválida do servidor';
        console.warn('[Seven Gold CRM] API retornou erro:', errorMsg);
        const localResult = await saveLocally(apiPayload);
        return { ...localResult, errorDetail: errorMsg };
      } catch (err) {
        console.warn(
          '[Seven Gold CRM] API indisponível, salvando offline.'
        );
        const localResult = await saveLocally(apiPayload);
        return { ...localResult, errorDetail: err.message };
      }
    },
  };

  async function saveLocally(apiPayload) {
    if (!chrome?.storage?.local) {
      console.warn('[Seven Gold CRM] chrome.storage.local não disponível — impossível salvar localmente.');
      return { ok: false, source: 'local', error: 'Armazenamento local não disponível' };
    }

    console.log('[Seven Gold CRM] Salvando localmente (fallback offline).');
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const leads = result[STORAGE_KEY] || [];
    const lead = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ...apiPayload,
      savedLocally: true,
      createdAt: new Date().toISOString(),
    };
    leads.push(lead);
    await chrome.storage.local.set({ [STORAGE_KEY]: leads });
    return { ok: true, source: 'local', lead };
  }

  /* ------------------------------------------------------------------ */
  /*  Capture current WhatsApp Web conversation                          */
  /* ------------------------------------------------------------------ */

  const STATUS_KEYWORDS = [
    'visto por', 'last seen', 'online', 'digitando', 'gravando',
    'playing', 'cancelado', 'unread', 'unread message',
  ];

  const DATE_KEYWORDS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'janero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    'janeiro', 'fevereiro', 'março', 'abril', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  function isStatusText(text) {
    const lower = text.toLowerCase();
    if (STATUS_KEYWORDS.some((kw) => lower.includes(kw))) return true;
    if (DATE_KEYWORDS.some((kw) => lower.includes(kw))) return true;
    if (/^\d{1,2}[:/]\d{2}/.test(text)) return true;
    if (/^\d{1,2}\s+de\s+\w+/i.test(text)) return true;
    if (/yesterday|hoje|ontem|today/i.test(text)) return true;
    return false;
  }

  const BLOCKED_NAME_PATTERNS = [
    'clique',
    'mostrar os dados',
    'dados do contato',
    'visto por último',
    'online',
    'digitando',
    'abra uma conversa',
    'não consegui',
    'nao consegui',
    'telefone',
    'mensagens',
    'criptografia',
    'etiquetar conversa'
  ];

  function validateCapturedName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length < 2) return false;
    const lower = trimmed.toLowerCase();
    if (BLOCKED_NAME_PATTERNS.some((p) => lower.includes(p))) return false;
    if (/^\d+$/.test(trimmed)) return false;
    return true;
  }

  function extractNameFromHeader() {
    const selectors = [
      'header span[title]',
      '[data-testid="conversation-header"] span[title]',
      'header span[dir="auto"]',
    ];

    for (const sel of selectors) {
      try {
        const spans = document.querySelectorAll(sel);
        for (const el of spans) {
          const val = (el.getAttribute('title') || el.textContent || '').trim();
          if (val && val.length >= 2 && val.length < 80 && !isStatusText(val)) {
            return val;
          }
        }
      } catch { /* skip */ }
    }

    try {
      const header = document.querySelector('header');
      if (header) {
        const spans = header.querySelectorAll('span[dir="auto"]');
        for (const el of spans) {
          const val = (el.textContent || '').trim();
          if (val && val.length >= 2 && val.length < 80 && !isStatusText(val)) {
            return val;
          }
        }
      }
    } catch { /* skip */ }

    return '';
  }

  function extractPhoneFromNumber(text) {
    const cleaned = text.replace(/[^\d+]/g, '');
    const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    if (digits.length >= 10 && digits.length <= 15 && /^\d+$/.test(digits)) {
      return cleaned;
    }
    return '';
  }

  function captureCurrentConversation() {
    const form = document.getElementById(FORM_ID);
    if (!form) return;

    // Clear old status messages
    clearStatus();

    // Clear name field if it currently holds an invalid name
    const currentName = form.nome.value.trim();
    if (!validateCapturedName(currentName)) {
      form.nome.value = '';
    }

    const name = extractNameFromHeader();
    if (!name || !validateCapturedName(name)) {
      showStatus('Não consegui capturar um nome válido. Preencha manualmente.', 'warning');
      return;
    }

    form.nome.value = name;
    form.telefone.value = '';
    showStatus(
      'Conversa capturada! Não consegui capturar o telefone na tela principal. Abra os dados do contato e tente capturar novamente.',
      'warning'
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Capture from WhatsApp Web contact info panel                       */
  /* ------------------------------------------------------------------ */

  function normalizePhone(text) {
    return text.replace(/[^\d]/g, '');
  }

  function normalizeText(text) {
    return text
      .replace(/\u00A0/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function findBrazilianPhone(text) {
    const patterns = [
      /\+55\s*\d{2}\s*\d{4,5}-?\d{4}/g,
      /\+55\d{10,11}/g,
      /\(\d{2}\)\s*\d{4,5}-?\d{4}/g,
      /\d{2}\s*\d{4,5}-?\d{4}/g,
      /\d{10,11}/g,
    ];

    for (const re of patterns) {
      const matches = text.match(re);
      if (matches) {
        for (const m of matches) {
          const digits = normalizePhone(m);
          if (digits.length === 11 || digits.length === 12 || digits.length === 13) {
            return digits;
          }
        }
      }
    }
    return '';
  }

  function isInsideExtension(el) {
    const ext = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (ext && ext.contains(el)) return true;
    if (toggle && toggle.contains(el)) return true;
    return false;
  }

  function findContactPanelHeader() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = normalizeText(node.textContent);
      if (/dados\s+do\s+contato/i.test(t)) {
        let el = node.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 10) return rect;
          el = el.parentElement;
        }
      }
    }
    return null;
  }

  function findContactPanelContainer() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = normalizeText(node.textContent);
      if (/dados\s+do\s+contato/i.test(t)) {
        let el = node.parentElement;
        while (el && el !== document.body) {
          const rect = el.getBoundingClientRect();
          if (rect.width >= 250 && rect.width <= 500 && rect.height > 400) {
            const extPanel = document.getElementById(PANEL_ID);
            if (extPanel && extPanel.contains(el)) {
              el = el.parentElement;
              continue;
            }
            return el;
          }
          el = el.parentElement;
        }
      }
    }
    return null;
  }

  function captureContactDetails() {
    const form = document.getElementById(FORM_ID);
    if (!form) return;

    // Clear old status messages
    clearStatus();
    
    // Clear CRM mini panel
    const crmDetails = document.getElementById('seven-gold-crm-lead-details');
    const crmStatus = document.getElementById('seven-gold-crm-lead-status');
    if (crmDetails) crmDetails.style.display = 'none';
    if (crmStatus) {
      crmStatus.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span>Nenhum lead consultado ainda.</span>`;
      crmStatus.style.color = '#ff9800';
    }

    // Clear name field if it currently holds an invalid name
    const currentName = form.nome.value.trim();
    if (!validateCapturedName(currentName)) {
      form.nome.value = '';
    }

    const container = findContactPanelContainer();
    if (!container) {
      showStatus(
        'Abra os dados do contato para capturar o telefone.',
        'warning'
      );
      return;
    }

    const rawText = container.innerText || container.textContent || '';
    const text = normalizeText(rawText);
    const phone = extractPhoneFromText(text);

    if (!phone) {
      form.telefone.value = '';
      showStatus(
        'Não encontrei telefone com formato internacional (+). Preencha manualmente.',
        'warning'
      );
      return;
    }

    // Find contact name from panel or current conversation header
    const contactName = extractLeadNameFromContactPanel(rawText, phone) || extractNameFromHeader();

    // Apply results
    form.telefone.value = phone;

    // Only update name if it was empty/invalid and we captured a valid contactName
    const isFormNameValid = validateCapturedName(form.nome.value.trim());

    if (contactName && validateCapturedName(contactName) && !isFormNameValid) {
      form.nome.value = contactName;
    }
    showStatus('Lead capturado. Confira os dados antes de salvar.', 'success');
  }

  /* ------------------------------------------------------------------ */
  /*  Capture lead — name + auto-open panel + phone                      */
  /* ------------------------------------------------------------------ */

  function closeContactInfoPanel() {
    // Try to find and click the close/back button of the contact info panel
    const closeSelectors = [
      '[data-testid="contact-info-close"]',
      '[data-testid="panel-header-back"]',
      'section[data-animate-modal-popup="true"] span[data-icon="x"]',
      'section[data-animate-modal-popup="true"] span[data-icon="back"]',
      'div[role="dialog"] span[data-icon="x"]',
      'div[role="dialog"] span[data-icon="back"]',
    ];

    for (const sel of closeSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && !isInsideExtension(el)) {
          const clickable = el.closest('button') || el.closest('[role="button"]') || el;
          clickable.click();
          return true;
        }
      } catch { /* skip */ }
    }

    // Fallback: find a visible element with "X" or back arrow near the panel header
    const headerRect = findContactPanelHeader();
    if (headerRect) {
      // Look for clickable elements to the left of the "Dados do contato" text
      const candidates = document.querySelectorAll('span, div, button');
      for (const el of candidates) {
        if (isInsideExtension(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // Must be near the header level and to the left of the text
        if (
          Math.abs(rect.top - headerRect.top) < 30 &&
          rect.right <= headerRect.left + 10 &&
          rect.right > headerRect.left - 60
        ) {
          el.click();
          return true;
        }
      }
    }

    return false;
  }

  function isContactPanelOfCurrentChat(activeChatName) {
    const container = findContactPanelContainer();
    if (!container) return false;

    const text = normalizeText((container.innerText || container.textContent || ''));
    return text.includes(activeChatName);
  }

  const FORBIDDEN_NAME_WORDS = [
    'criptografia', 'mensagens', 'mídia', 'midia', 'links', 'docs',
    'dias', 'online', 'visto por último', 'visto por ultimo',
    'clique', 'dados do contato', 'conversa', 'grupo', 'participante'
  ];

  function extractLeadNameFromContactPanel(panelText, capturedPhone) {
    if (!panelText) return '';

    // Divide em linhas limpas
    const lines = panelText.split('\n')
      .map(line => line.replace(/\u00A0/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean);

    if (lines.length === 0) return '';

    // Filtrar linhas de instruções e metadados comuns logo no início para encontrar a primeira relevante
    const relevantLines = [];
    for (const line of lines) {
      const lower = line.toLowerCase();
      const hasForbiddenWord = FORBIDDEN_NAME_WORDS.some(word => lower.includes(word));
      if (hasForbiddenWord) continue;
      relevantLines.push(line);
    }

    if (relevantLines.length === 0) return '';

    const firstLine = relevantLines[0];

    // Checar se primeira linha é telefone
    const isFirstLinePhone = firstLine.startsWith('+') && (firstLine.replace(/[^\d]/g, '').length >= 10 && firstLine.replace(/[^\d]/g, '').length <= 15);

    if (isFirstLinePhone) {
      // Caso 1: Primeira linha relevante começa com +
      // Procurar logo abaixo uma linha que comece com ~
      for (let i = 1; i < relevantLines.length; i++) {
        const line = relevantLines[i];
        if (line.startsWith('~')) {
          // Remover o ~ do começo do nome e retornar
          return line.slice(1).trim();
        }
      }
      // Se não houver linha com ~ abaixo, usar o próprio telefone como Nome temporário
      return firstLine;
    } else {
      // Caso 2: Primeira linha relevante não começa com +
      return firstLine;
    }
  }

  const FORBIDDEN_WORDS = [
    'criptografia', 'mensagens', 'mídia', 'midia', 'links', 'docs',
    'dias', 'online', 'visto por último', 'visto por ultimo',
    'clique', 'dados do contato'
  ];

  function findCandidatesFromContainer(container) {
    if (!container) return [];

    const segments = [];
    const elements = container.querySelectorAll('*');

    for (const el of elements) {
      if (isInsideExtension(el)) continue;

      const title = (el.getAttribute('title') || '').trim();
      if (title) {
        segments.push({ source: 'title', text: title, el });
      }

      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      if (ariaLabel) {
        segments.push({ source: 'aria-label', text: ariaLabel, el });
      }

      if (el.children.length === 0) {
        const text = (el.textContent || '').trim();
        if (text) {
          segments.push({ source: 'text', text, el });
        }
      }
    }

    const candidates = [];

    // Individual segments
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const normalized = seg.text.replace(/\u00A0/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!normalized) continue;

      const digits = normalized.replace(/[^\d]/g, '');
      const startsWithPlus = normalized.startsWith('+');
      const hasLetters = /[a-zA-Z]/g.test(normalized);
      const hasForbiddenWord = FORBIDDEN_WORDS.some(word => normalized.toLowerCase().includes(word));
      const phoneRegex = /^\+\d[\d\s().-]{8,25}$/;
      const isRegexMatch = phoneRegex.test(normalized);
      const validDigitsLength = digits.length >= 10 && digits.length <= 15;

      let rejectedReason = '';
      if (!startsWithPlus) rejectedReason = 'Não começa com +';
      else if (hasLetters) rejectedReason = 'Contém letras';
      else if (hasForbiddenWord) rejectedReason = 'Contém palavra proibida';
      else if (!isRegexMatch) rejectedReason = 'Não passou na regex';
      else if (!validDigitsLength) rejectedReason = `Dígitos inválidos (${digits.length})`;

      if (startsWithPlus && !hasLetters && !hasForbiddenWord && isRegexMatch && validDigitsLength) {
        candidates.push({
          raw: normalized,
          digits: digits,
          source: `Seg. Individual (${seg.source})`,
          score: normalized.startsWith('+55') ? 100 : 50
        });
      } else {
        candidates.push({
          raw: normalized,
          digits: digits,
          source: `Seg. Individual (${seg.source})`,
          rejected: true,
          reason: rejectedReason
        });
      }
    }

    // Consecutive segments (for broken spans / lines)
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].text.includes('+')) {
        let accumulatedText = '';
        let accumDigits = '';
        let j = i;
        let segmentSources = [];

        while (j < segments.length) {
          const segText = segments[j].text.trim();
          if (/[a-zA-Z]/g.test(segText)) break;
          const hasForbiddenWord = FORBIDDEN_WORDS.some(word => segText.toLowerCase().includes(word));
          if (hasForbiddenWord) break;

          accumulatedText += (accumulatedText ? ' ' : '') + segText;
          segmentSources.push(segments[j].source);
          accumDigits = accumulatedText.replace(/[^\d]/g, '');

          const normalized = accumulatedText.replace(/\u00A0/g, ' ').replace(/\s{2,}/g, ' ').trim();
          const startsWithPlus = normalized.startsWith('+');
          const phoneRegex = /^\+\d[\d\s().-]{8,25}$/;
          const isRegexMatch = phoneRegex.test(normalized);
          const validDigitsLength = accumDigits.length >= 10 && accumDigits.length <= 15;

          if (startsWithPlus && isRegexMatch && validDigitsLength) {
            candidates.push({
              raw: normalized,
              digits: accumDigits,
              source: `Consecutivo (${segmentSources.join('+')})`,
              score: normalized.startsWith('+55') ? 110 : 60
            });
          }

          if (accumDigits.length > 15) break;
          j++;
        }
      }
    }

    return candidates;
  }

  function extractPhoneFromText(text) {
    const container = findContactPanelContainer();
    if (!container) return '';

    const candidates = findCandidatesFromContainer(container);
    const validCandidates = candidates.filter(c => !c.rejected);

    if (validCandidates.length === 0) return '';

    // Sort valid candidates by score descending
    validCandidates.sort((a, b) => b.score - a.score);

    return validCandidates[0].digits;
  }

  async function captureLeadWithAutoRetry() {
    if (!canUseExtensionArea("crm_pipeline")) {
      showPermissionError("Você não tem permissão para capturar leads.");
      return;
    }
    const form = document.getElementById(FORM_ID);
    if (!form) return;

    // Desabilitar temporariamente o botão e alterar texto para "Capturando..."
    const btn = document.getElementById(LEAD_BTN_ID);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Capturando...';
    }

    try {
      // Etapa 1: Limpar estado
      clearStatus();
      form.nome.value = '';
      form.telefone.value = '';

      // Clear CRM mini panel
      const crmDetails = document.getElementById('seven-gold-crm-lead-details');
      const crmStatus = document.getElementById('seven-gold-crm-lead-status');
      if (crmDetails) crmDetails.style.display = 'none';
      if (crmStatus) {
        crmStatus.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span>Nenhum lead consultado ainda.</span>`;
        crmStatus.style.color = '#ff9800';
      }

      // Capturar nome temporário do header da conversa atual
      const headerName = extractNameFromHeader() || '';

      // Etapa 2: verificar se “Dados do contato” já está aberto
      let panelAlreadyOpen = false;
      const container = findContactPanelContainer();
      if (container) {
        if (isContactPanelOfCurrentChat(headerName)) {
          panelAlreadyOpen = true;
        } else {
          // Se for de outro contato, fechar
          closeContactInfoPanel();
          await new Promise((resolve) => setTimeout(resolve, 500));
          panelAlreadyOpen = false;
        }
      }

      // Se não estiver aberto, clicar uma única vez no #main header para abrir
      if (!panelAlreadyOpen) {
        const headerClicked = clickConversationHeader();
        if (!headerClicked) {
          return; // clickConversationHeader já mostra a mensagem "Abra uma conversa..."
        }
      }

      // Mostrar status temporário durante as tentativas
      showStatus('Aguardando dados do contato...', 'warning');

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const attemptDelays = [1200, 1200, 1800, 2500];

      let phone = '';
      let finalName = '';

      for (let i = 0; i < attemptDelays.length; i++) {
        // Aguardar o delay correspondente da etapa
        await sleep(attemptDelays[i]);

        // Verificar se "Dados do contato" está aberto
        const currentContainer = findContactPanelContainer();
        if (currentContainer) {
          const rawText = currentContainer.innerText || currentContainer.textContent || '';
          const text = normalizeText(rawText);
          phone = extractPhoneFromText(text);
          if (phone) {
            // Extrair o nome do lead a partir do painel
            finalName = extractLeadNameFromContactPanel(rawText, phone);

            // Fallback para o nome do header caso o do painel seja inválido ou vazio
            if (!finalName || !validateCapturedName(finalName)) {
              if (headerName && validateCapturedName(headerName)) {
                finalName = headerName;
              }
            }

            form.telefone.value = phone;
            form.nome.value = finalName;
            showStatus('Lead capturado. Confira os dados antes de salvar.', 'success');
            break;
          }
        }
      }

      if (!phone) {
        // Se após todas as tentativas não encontrar telefone, mostrar erro final:
        form.telefone.value = '';
        if (headerName && validateCapturedName(headerName)) {
          form.nome.value = headerName;
        }
        showStatus(
          'Não encontrei telefone com formato internacional (+). Preencha manualmente.',
          'warning'
        );
      }

    } catch (err) {
      if (DEBUG) console.error('[Seven Gold CRM] Erro na captura com auto retry:', err);
      showStatus('Erro ao capturar lead: ' + err.message, 'error');
    } finally {
      // Reativar o botão ao final
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Capturar lead
        `;
      }
    }
  }

  function captureLead() {
    return captureLeadWithAutoRetry();
  }

  async function captureAndQueryLead() {
    const queryBtn = document.getElementById('seven-gold-query-crm-btn');
    const statusEl = document.getElementById('seven-gold-crm-lead-status');

    queryBtn.disabled = true;
    queryBtn.textContent = 'Capturando dados...';

    const capturePromise = captureLead();
    statusEl.innerHTML = `<span class="sg-spinner" style="border-top-color: #d4af37; width: 12px; height: 12px; margin-right: 6px;"></span> <span>Capturando nome e telefone da conversa...</span>`;
    statusEl.style.color = '#aaa';

    await capturePromise;

    queryBtn.disabled = false;
    await handleCrmQuery();
  }

  function clickConversationHeader() {
    const mainHeader = document.querySelector("#main header");
    if (!mainHeader) {
      showStatus('Abra uma conversa no WhatsApp Web antes de capturar.', 'warning');
      return false;
    }

    try {
      const rect = mainHeader.getBoundingClientRect();
      const x = rect.left + 90;
      const y = rect.top + rect.height / 2;

      const targetEl = document.elementFromPoint(x, y);
      if (targetEl) {
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y
        });
        targetEl.dispatchEvent(clickEvent);
        return true;
      } else {
        mainHeader.click();
        return true;
      }
    } catch (err) {
      if (DEBUG) console.error('[Seven Gold CRM] Erro ao clicar no header:', err);
    }

    return false;
  }
  /* ------------------------------------------------------------------ */

  function isDockable() {
    return window.innerWidth >= MIN_DOCK_WIDTH;
  }

  function applyDockLayout(isOpen) {
    const app = document.getElementById('app');
    if (!app) return;

    document.body.classList.toggle('sg-crm-panel-open', isOpen);

    if (isOpen && isDockable()) {
      document.body.classList.add('sg-crm-docked');
      app.style.width = `calc(100vw - ${PANEL_WIDTH}px)`;
      app.style.maxWidth = `calc(100vw - ${PANEL_WIDTH}px)`;
    } else {
      document.body.classList.remove('sg-crm-docked');
      app.style.width = '';
      app.style.maxWidth = '';
    }
  }

  /* ------------------------------------------------------------------ */
  /*  UI helpers                                                         */
  /* ------------------------------------------------------------------ */

  function setActiveTab(tabName) {
    if (currentUserPermissions && !hasPermissionForTab(tabName)) {
      showPermissionError("Você não tem permissão para acessar esta função.");
      return;
    }
    activeTab = tabName;

    document.querySelectorAll('.sg-tab-content').forEach((section) => {
      section.classList.toggle('active', section.dataset.tab === tabName);
    });

    document.querySelectorAll('.sg-side-tab').forEach((button) => {
      const isActive = button.dataset.tab === tabName;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    if (tabName === 'calendar') {
      initCalendarTab();
    } else if (tabName === 'tasks') {
      loadTasksDesteLead();
    } else if (tabName === 'returns') {
      loadTodosOsRetornos();
    }
  }

  function createToggle() {
    const nav = document.createElement('div');
    nav.id = TOGGLE_ID;
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Acessos do Seven Gold CRM');
    nav.innerHTML = `
      <button type="button" class="sg-side-tab active" data-tab="capture" aria-pressed="true" title="Salvar lead">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span>Salvar lead</span>
      </button>
      <button type="button" class="sg-side-tab" data-tab="view" aria-pressed="false" title="CRM">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
        <span>CRM</span>
      </button>
      <button type="button" class="sg-side-tab" data-tab="tasks" aria-pressed="false" title="Tarefas">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><polyline points="8 10 10 12 13 8"/><line x1="14" y1="11" x2="16" y2="11"/><polyline points="8 16 10 18 13 14"/><line x1="14" y1="17" x2="16" y2="17"/></svg>
        <span>Tarefas</span>
      </button>
      <button type="button" class="sg-side-tab" data-tab="returns" aria-pressed="false" title="Retornos">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        <span>Retornos</span>
      </button>
      <button type="button" class="sg-side-tab" data-tab="calendar" aria-pressed="false" title="Calendário">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>Calendário</span>
      </button>
    `;

    nav.querySelectorAll('.sg-side-tab').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = document.getElementById(PANEL_ID);
        const selectedTab = button.dataset.tab;
        const isSameOpenTab = panel.classList.contains('open') && activeTab === selectedTab;

        if (isSameOpenTab) {
          panel.classList.remove('open');
          applyDockLayout(false);
          return;
        }

        setActiveTab(selectedTab);
        panel.classList.add('open');
        applyDockLayout(true);
      });
    });

    document.body.appendChild(nav);
  }

  function createPanel() {
    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Seven Gold CRM - Painel do Lead');

    panel.innerHTML = `
      <div class="sg-header">
        <button class="sg-close" id="seven-gold-close" aria-label="Fechar painel">&times;</button>
      </div>

      <section class="sg-tab-content active" data-tab="capture" aria-label="Capturar lead">
      <div class="sg-scroll-body">
        <button type="button" id="seven-gold-help-toggle" class="sg-help-toggle" aria-expanded="false" aria-controls="seven-gold-help-content">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Como usar</span>
        </button>

        <div id="seven-gold-help-content" class="sg-info-box" hidden>
          <div style="line-height: 1.4;">
            1. Abra uma conversa no WhatsApp.<br/>
            2. Clique em <strong>Capturar lead</strong>.<br/>
            3. Confira os dados e salve no funil.
          </div>
        </div>

        <button type="button" id="${LEAD_BTN_ID}" class="sg-lead-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Capturar lead
        </button>

        <div class="sg-capture-row" style="display: none !important;">
          <button type="button" id="${CAPTURE_BTN_ID}" class="sg-capture-btn">Capturar conversa</button>
          <button type="button" id="${CONTACT_BTN_ID}" class="sg-capture-btn">Capturar contato</button>
        </div>

        <form id="${FORM_ID}" class="sg-form">
          <label class="sg-field">
            <span class="sg-label">Nome do Lead</span>
            <input type="text" name="nome" placeholder="Ex: João Silva" required />
          </label>

          <label class="sg-field">
            <span class="sg-label">Telefone</span>
            <input type="tel" name="telefone" placeholder="Ex: (11) 99999-8888" />
          </label>

          <input type="hidden" name="etapa" value="lead_recebido" />

          <label class="sg-field">
            <span class="sg-label">Anotações</span>
            <textarea name="observacoes" rows="3" placeholder="Anotações sobre o lead..."></textarea>
          </label>

          <div id="${STATUS_ID}" class="sg-status" aria-live="polite"></div>

          <div class="sg-form-section-title">Informações gerais</div>

          <label class="sg-field">
            <span class="sg-label">Região</span>
            <input type="text" name="property_region" placeholder="Região do imóvel" />
          </label>

          <label class="sg-field">
            <span class="sg-label">Crédito</span>
            <input type="text" name="credit_value" inputmode="decimal" placeholder="R$ 0,00" />
          </label>

          <label class="sg-field">
            <span class="sg-label">Entrada</span>
            <input type="text" name="down_payment_value" inputmode="decimal" placeholder="R$ 0,00" />
          </label>

          <label class="sg-field">
            <span class="sg-label">Parcela</span>
            <input type="text" name="installment_value" inputmode="decimal" placeholder="R$ 0,00" />
          </label>

          <button type="submit" class="sg-submit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Salvar lead no funil
          </button>
        </form>
      </div>
      </section>

      <section class="sg-tab-content" data-tab="view" aria-label="Ver lead">
      <div class="sg-scroll-body">
        <div class="sg-tab-heading">
          <h2>Ver lead no CRM</h2>
          <p>Consulte o lead desta conversa e edite as informações principais.</p>
        </div>

        <button type="button" class="sg-help-toggle" aria-expanded="false" style="margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Como usar</span>
        </button>
        <div class="sg-info-box" style="margin-top: 8px; margin-bottom: 12px;" hidden>
          <div style="line-height: 1.4;">
            1. Abra a conversa de um lead cadastrado.<br/>
            2. Clique em <strong>Consultar lead</strong> para carregar os dados.<br/>
            3. Use os botões abaixo para mover a etapa do funil.
          </div>
        </div>


        <!-- Mini painel CRM -->
        <div id="seven-gold-crm-mini-panel">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="font-weight: bold; color: #d4af37; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Lead desta conversa</div>
            <a href="https://painel.sevengoldfinanceira.com.br/crm.html" target="_blank" class="sg-btn-link">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Abrir CRM
            </a>
          </div>
          <div style="font-size: 11px; color: #8a9fc4; line-height: 1.3;">
            Consulte se este telefone já está no funil e mova a etapa sem sair do WhatsApp.
          </div>
          
          <button type="button" id="seven-gold-query-crm-btn" class="sg-query-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Consultar lead
          </button>

          <div id="seven-gold-crm-lead-details" style="display: none; font-size: 12px; line-height: 1.6; color: #ccc;">
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #1d2f5a; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2" style="flex-shrink: 0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span style="color: #8a9fc4; width: 60px; flex-shrink: 0;">Nome:</span>
                <span id="sg-crm-lead-name" class="sg-display-value">-</span>
                <input id="sg-crm-edit-name" class="sg-edit-field" type="text" aria-label="Nome do lead" />
                <button type="button" id="sg-crm-edit-toggle" class="sg-edit-pencil" aria-label="Editar informações do lead" title="Editar informações">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>
                </button>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2" style="flex-shrink: 0;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span style="color: #8a9fc4; width: 60px; flex-shrink: 0;">Telefone:</span>
                <span id="sg-crm-lead-phone" class="sg-display-value">-</span>
                <input id="sg-crm-edit-phone" class="sg-edit-field" type="tel" aria-label="Telefone do lead" />
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2" style="flex-shrink: 0;"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                <span style="color: #8a9fc4; width: 72px; flex-shrink: 0; white-space: nowrap;">Etapa atual:</span>
                <span id="sg-crm-lead-stage" style="padding: 2px 8px; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 12px; color: #d4af37; font-size: 11px; font-weight: 600;">-</span>
              </div>
              <div id="sg-crm-lead-interaction-row" style="display: none; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span style="color: #8a9fc4; width: 60px; flex-shrink: 0;">Interação:</span>
                <span id="sg-crm-lead-interaction" style="font-weight: 600; color: #fff; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
              </div>

              <div id="sg-crm-lead-assigned-row" style="display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: rgba(29, 47, 90, 0.2); border: 1px solid #1d2f5a; border-radius: 6px; margin-top: 4px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #d4af37; font-weight: 600;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Responsável
                </div>
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11px;">
                  <span style="color: #8a9fc4; width: 40px; flex-shrink: 0;">Nome:</span>
                  <span id="sg-crm-lead-assigned-name" style="color: #fff; font-weight: 500;">Sem responsável</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11px;">
                  <span style="color: #8a9fc4; width: 40px; flex-shrink: 0;">E-mail:</span>
                  <span id="sg-crm-lead-assigned-email" style="color: #fff; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
                </div>
              </div>

              <div style="font-size: 11px; font-weight: bold; color: #d4af37; margin: 10px 0 4px; display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #d4af37; flex-shrink: 0;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                MOVER RAPIDAMENTE
              </div>
              <div id="sg-crm-stage-buttons-container"></div>

              <!-- Info bar at the bottom of buttons -->
              <div class="sg-info-bar" style="display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: rgba(29, 47, 90, 0.2); border: 1px solid #1d2f5a; border-radius: 6px; font-size: 10.5px; color: #8a9fc4; margin-top: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>Selecione a próxima etapa para mover este lead no CRM.</span>
              </div>

              <div class="sg-additional-card">
                <div class="sg-additional-card-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Informações adicionais
                </div>
                <div class="sg-additional-row"><span>Origem</span><strong id="sg-crm-lead-origin" class="sg-display-value">Não informado</strong><input id="sg-crm-edit-origin" class="sg-edit-field" type="text" /></div>
                <div class="sg-additional-row"><span>Região do imóvel</span><strong id="sg-crm-property-region" class="sg-display-value">Não informado</strong><input id="sg-crm-edit-property-region" class="sg-edit-field" type="text" /></div>
                <div class="sg-additional-row"><span>Valor do crédito</span><strong id="sg-crm-credit-value" class="sg-display-value">Não informado</strong><input id="sg-crm-edit-credit-value" class="sg-edit-field" type="text" inputmode="decimal" placeholder="R$ 0,00" /></div>
                <div class="sg-additional-row"><span>Valor da entrada</span><strong id="sg-crm-down-payment-value" class="sg-display-value">Não informado</strong><input id="sg-crm-edit-down-payment-value" class="sg-edit-field" type="text" inputmode="decimal" placeholder="R$ 0,00" /></div>
                <div class="sg-additional-row"><span>Valor da parcela</span><strong id="sg-crm-installment-value" class="sg-display-value">Não informado</strong><input id="sg-crm-edit-installment-value" class="sg-edit-field" type="text" inputmode="decimal" placeholder="R$ 0,00" /></div>
                <div class="sg-additional-row sg-additional-row--notes"><span>Observações</span><strong id="sg-crm-lead-note" class="sg-display-value">Não informado</strong><textarea id="sg-crm-edit-note" class="sg-edit-field" rows="5" placeholder="Anotações sobre o lead"></textarea></div>
                <div class="sg-edit-actions">
                  <button type="button" id="sg-crm-cancel-edit" class="sg-edit-action sg-edit-action--secondary">Cancelar</button>
                  <button type="button" id="sg-crm-save-edit" class="sg-edit-action sg-edit-action--primary">Salvar alterações</button>
                </div>
              </div>

              <div class="sg-additional-card" style="margin-top: 4px;">
                <div class="sg-additional-card-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Histórico do lead
                </div>
                <div id="sg-crm-lead-history-container">
                  <div class="sg-empty-state" style="font-size: 10px; padding: 8px;">Nenhuma atividade registrada.</div>
                </div>
              </div>
            </div>
          </div>

          <div id="seven-gold-crm-lead-status" style="font-size: 11.5px; margin-top: 8px; font-weight: 600; line-height: 1.3; color: #ff9800; display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span>Nenhum lead consultado ainda.</span>
          </div>
        </div>
      </div>
      </section>

      <section class="sg-tab-content" data-tab="tasks" aria-label="Tarefas">
      <div class="sg-scroll-body">
        <div class="sg-tab-heading">
          <h2>Tarefas</h2>
          <p>Crie e acompanhe tarefas e retornos deste lead.</p>
        </div>

        <button type="button" class="sg-help-toggle" aria-expanded="false" style="margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Como usar</span>
        </button>
        <div class="sg-info-box" style="margin-top: 8px; margin-bottom: 12px;" hidden>
          <div style="line-height: 1.4;">
            1. Clique em <strong>Criar tarefa</strong>.<br/>
            2. Selecione o tipo de tarefa e agende o horário do retorno.<br/>
            3. Salve para acompanhar as atividades agendadas para este lead.
          </div>
        </div>


        <button type="button" id="seven-gold-create-return-btn" class="sg-query-btn" aria-expanded="false" aria-controls="seven-gold-return-form-card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar tarefa
        </button>

        <div id="seven-gold-return-form-card" class="sg-return-card" hidden>
          <form id="seven-gold-return-form" class="sg-form">
            <div class="sg-field">
              <span class="sg-label">Tipo de tarefa</span>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                <button type="button" id="sg-task-type-wa" class="sg-task-type-btn active" style="text-align: left; padding: 10px; background: rgba(212, 175, 55, 0.15); border: 2px solid #d4af37; color: #fff; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;">
                  <strong style="color: #d4af37; font-size: 12.5px;">Mensagem WhatsApp</strong>
                  <span style="font-size: 10.5px; color: #8a9fc4; font-weight: normal; line-height: 1.3;">Abre a conversa no horário e deixa a mensagem pronta.</span>
                </button>
                <button type="button" id="sg-task-type-reminder" class="sg-task-type-btn" style="text-align: left; padding: 10px; background: #081026; border: 2px solid #1d2f5a; color: #fff; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;">
                  <strong style="color: #fff; font-size: 12.5px;">Lembrete</strong>
                  <span style="font-size: 10.5px; color: #8a9fc4; font-weight: normal; line-height: 1.3;">Mostra um alerta para você lembrar de agir.</span>
                </button>
              </div>
              <input type="hidden" id="sg-task-selected-type" name="tipo" value="whatsapp_message" />
            </div>

            <label class="sg-field">
              <span class="sg-label">Data e hora *</span>
              <input type="datetime-local" name="dataHora" required />
            </label>

            <label class="sg-field" id="sg-task-title-field" style="display: none;">
              <span class="sg-label">Título do lembrete *</span>
              <input type="text" name="titulo" placeholder="Ex: Retornar ligação, confirmar agendamento, enviar proposta" />
            </label>

            <label class="sg-field" id="sg-task-message-field">
              <span class="sg-label">Mensagem WhatsApp *</span>
              <textarea name="mensagem" rows="3" placeholder="Mensagem que será deixada pronta no WhatsApp" required></textarea>
            </label>

            <label class="sg-field">
              <span class="sg-label">Anotação interna</span>
              <textarea name="observacao" rows="3" placeholder="Anotação apenas para você/CRM"></textarea>
            </label>

            <button type="submit" class="sg-submit">Salvar tarefa</button>
          </form>
          <div id="seven-gold-return-status" class="sg-return-status" aria-live="polite"></div>
        </div>

        <div class="sg-return-card">
          <div class="sg-card-title">Tarefas deste lead</div>
          <div id="sg-tasks-list-container" style="display: flex; flex-direction: column; gap: 8px;">
            <div class="sg-empty-state">Nenhuma tarefa cadastrada.</div>
          </div>
        </div>
      </div>
      </section>

      <section class="sg-tab-content" data-tab="returns" aria-label="Retornos">
      <div class="sg-scroll-body">
        <div class="sg-tab-heading">
          <h2>Retornos</h2>
          <p>Acompanhe os retornos programados de todos os leads.</p>
        </div>

        <button type="button" class="sg-help-toggle" aria-expanded="false" style="margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Como usar</span>
        </button>
        <div class="sg-info-box" style="margin-top: 8px; margin-bottom: 12px;" hidden>
          <div style="line-height: 1.4;">
            1. Veja a lista de retornos pendentes organizados por data.<br/>
            2. Identifique os leads agendados para hoje ou datas futuras.<br/>
            3. Clique no atalho correspondente para iniciar o contato.
          </div>
        </div>


        <div class="sg-return-card">
          <div class="sg-card-title">Retornos de hoje</div>
          <div id="sg-returns-today-container" style="display: flex; flex-direction: column; gap: 8px;">
            <div class="sg-empty-state">Nenhum retorno para hoje.</div>
          </div>
        </div>

        <div class="sg-return-card">
          <div id="sg-returns-all-toggle" class="sg-card-title" style="cursor: pointer; user-select: none;">
            Todos os retornos
            <svg id="sg-returns-all-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left: 6px; transition: transform 0.2s; vertical-align: middle;"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="sg-returns-all-container" style="display: none; flex-direction: column; gap: 8px;">
            <div class="sg-empty-state">Nenhum retorno cadastrado.</div>
          </div>
        </div>
      </div>
      </section>

      <section class="sg-tab-content" data-tab="calendar" aria-label="Calendário">
      <div class="sg-scroll-body">
        <div class="sg-tab-heading" style="margin-bottom: 8px;">
          <h2>Calendário</h2>
          <p>Agendamentos dos clientes</p>
        </div>

        <button type="button" class="sg-help-toggle" aria-expanded="false" style="margin-left: 16px; margin-bottom: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          <span>Como usar</span>
        </button>
        <div class="sg-info-box" style="margin-left: 16px; margin-right: 16px; margin-top: 8px; margin-bottom: 12px;" hidden>
          <div style="line-height: 1.4;">
            1. Visualize os agendamentos semanais da sua equipe.<br/>
            2. Use os botões de navegação para alternar as semanas.<br/>
            3. Clique em <strong>WhatsApp</strong> para falar com o cliente ou em <strong>Ver lead</strong> para consultar detalhes.
          </div>
        </div>


        <div style="padding: 0 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span id="sg-calendar-week-label" style="font-size: 12px; font-weight: 700; color: #d4af37;">Semana: --/-- a --/--</span>
          <a href="${CRM_WEB_URL}/calendar" target="_blank" class="sg-btn-link" style="font-size: 11px;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Calendário completo
          </a>
        </div>

        <div class="sg-calendar-nav" style="border-top: 1px solid #1d2f5a; margin-bottom: 12px; padding: 10px 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; width: 100%; background: #081026;">
          <button type="button" id="sg-calendar-prev-btn" class="sg-calendar-nav-btn" style="min-width: 0; padding: 8px 6px; white-space: nowrap;">&lt; Semana anterior</button>
          <button type="button" id="sg-calendar-today-btn" class="sg-calendar-nav-btn" style="padding: 8px 12px; white-space: nowrap;">Hoje</button>
          <button type="button" id="sg-calendar-next-btn" class="sg-calendar-nav-btn" style="min-width: 0; padding: 8px 6px; white-space: nowrap;">Próxima semana &gt;</button>
        </div>

        <div id="sg-calendar-week-list-container" class="sg-calendar-week-list" style="padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px;">
          <!-- Lista semanal renderizada dinamicamente -->
        </div>
      </div>
      </section>

      <div style="text-align: center; font-size: 10px; color: #555; padding: 12px 16px; border-top: 1px solid #1d2f5a; background-color: #0d1730; flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 4px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #d4af37;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Seven Gold CRM • Extensão v1.1</span>
      </div>
    `;

    panel.querySelector('#seven-gold-close').addEventListener('click', () => {
      panel.classList.remove('open');
      applyDockLayout(false);
    });

    panel.querySelectorAll('.sg-help-toggle').forEach((button) => {
      button.addEventListener('click', (event) => {
        const btn = event.currentTarget;
        const infoBox = btn.nextElementSibling;
        if (infoBox && infoBox.classList.contains('sg-info-box')) {
          const willExpand = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', String(willExpand));
          infoBox.hidden = !willExpand;
        }
      });
    });

    panel.querySelector(`#${FORM_ID}`).addEventListener('submit', handleSubmit);

    panel.querySelector(`#${CAPTURE_BTN_ID}`).addEventListener('click', captureCurrentConversation);

    panel.querySelector(`#${CONTACT_BTN_ID}`).addEventListener('click', captureContactDetails);

    panel.querySelector(`#${LEAD_BTN_ID}`).addEventListener('click', captureLead);

    panel.querySelector('#seven-gold-query-crm-btn').addEventListener('click', captureAndQueryLead);

    panel.querySelector('#sg-crm-edit-toggle').addEventListener('click', () => setCrmEditMode(true));
    panel.querySelector('#sg-crm-cancel-edit').addEventListener('click', () => setCrmEditMode(false));
    panel.querySelector('#sg-crm-save-edit').addEventListener('click', handleCrmEditSave);

    panel.querySelector('#seven-gold-create-return-btn').addEventListener('click', (event) => {
      const button = event.currentTarget;
      const card = panel.querySelector('#seven-gold-return-form-card');
      const willExpand = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(willExpand));
      card.hidden = !willExpand;
    });

    panel.querySelector('#seven-gold-return-form').addEventListener('submit', handleReturnSubmit);

    // Alternar tipos de tarefas na criação
    const btnTypeWa = panel.querySelector('#sg-task-type-wa');
    const btnTypeReminder = panel.querySelector('#sg-task-type-reminder');
    const inputType = panel.querySelector('#sg-task-selected-type');
    const fieldTitle = panel.querySelector('#sg-task-title-field');
    const fieldMessage = panel.querySelector('#sg-task-message-field');

    if (btnTypeWa && btnTypeReminder) {
      btnTypeWa.addEventListener('click', () => {
        btnTypeWa.classList.add('active');
        btnTypeWa.style.background = 'rgba(212, 175, 55, 0.15)';
        btnTypeWa.style.borderColor = '#d4af37';
        btnTypeWa.querySelector('strong').style.color = '#d4af37';

        btnTypeReminder.classList.remove('active');
        btnTypeReminder.style.background = '#081026';
        btnTypeReminder.style.borderColor = '#1d2f5a';
        btnTypeReminder.querySelector('strong').style.color = '#fff';

        inputType.value = 'whatsapp_message';
        fieldTitle.style.display = 'none';
        fieldTitle.querySelector('input').required = false;
        fieldMessage.style.display = 'block';
        fieldMessage.querySelector('textarea').required = true;
      });

      btnTypeReminder.addEventListener('click', () => {
        btnTypeReminder.classList.add('active');
        btnTypeReminder.style.background = 'rgba(212, 175, 55, 0.15)';
        btnTypeReminder.style.borderColor = '#d4af37';
        btnTypeReminder.querySelector('strong').style.color = '#d4af37';

        btnTypeWa.classList.remove('active');
        btnTypeWa.style.background = '#081026';
        btnTypeWa.style.borderColor = '#1d2f5a';
        btnTypeWa.querySelector('strong').style.color = '#fff';

        inputType.value = 'reminder';
        fieldTitle.style.display = 'block';
        fieldTitle.querySelector('input').required = true;
        fieldMessage.style.display = 'none';
        fieldMessage.querySelector('textarea').required = false;
      });
    }

    panel.querySelector('#sg-calendar-today-btn').addEventListener('click', goToCalendarToday);
    panel.querySelector('#sg-calendar-prev-btn').addEventListener('click', () => navigateCalendarWeek(-1));
    panel.querySelector('#sg-calendar-next-btn').addEventListener('click', () => navigateCalendarWeek(1));

    document.body.appendChild(panel);
  }

  async function handleReturnSubmit(event) {
    event.preventDefault();
    if (!canUseTasksTab()) {
      showPermissionError("Você não tem permissão para criar tarefas.");
      return;
    }
    const form = event.currentTarget;
    const status = document.getElementById('seven-gold-return-status');
    const submitBtn = form.querySelector('button[type="submit"]');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const detailsEl = document.getElementById('seven-gold-crm-lead-details');
    const leadId = detailsEl ? detailsEl.dataset.leadId : '';
    const leadName = document.getElementById('sg-crm-lead-name').textContent;
    const leadPhone = document.getElementById('sg-crm-lead-phone').textContent;

    if (!leadId) {
      status.textContent = 'Erro: Consulte o lead no CRM antes de criar uma tarefa.';
      status.className = 'sg-return-status sg-return-status--warning';
      return;
    }

    const type = form.tipo.value;
    const dataHora = form.dataHora.value;
    const anotacao = form.observacao.value;

    const actor = await getCurrentActor();

    const payload = {
      lead_id: leadId,
      lead_nome: leadName,
      lead_telefone: leadPhone && leadPhone !== '-' ? leadPhone : null,
      type,
      scheduled_at: new Date(dataHora).toISOString(),
      internal_note: anotacao || null
    };

    if (actor) {
      payload.created_by_email = actor.email;
      payload.created_by_name = actor.name;

      console.log("[Seven Gold CRM][Actor] Usuário da ação:", actor);
      console.log("[Seven Gold CRM][Actor] Payload com usuário:", payload);
    }

    if (type === 'whatsapp_message') {
      const msg = form.mensagem.value.trim();
      if (!msg) {
        status.textContent = 'Informe a mensagem a ser deixada pronta.';
        status.className = 'sg-return-status sg-return-status--warning';
        return;
      }
      if (!leadPhone || leadPhone === '-') {
        status.textContent = 'Este lead não possui telefone para abrir no WhatsApp.';
        status.className = 'sg-return-status sg-return-status--warning';
        return;
      }
      payload.whatsapp_message = msg;
      payload.title = 'Mensagem WhatsApp';
    } else {
      const tit = form.titulo.value.trim();
      if (!tit) {
        status.textContent = 'Informe o título do lembrete.';
        status.className = 'sg-return-status sg-return-status--warning';
        return;
      }
      payload.title = tit;
      payload.whatsapp_message = null;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';
    status.textContent = '';
    status.className = 'sg-return-status';

    console.log("[Seven Gold CRM][Tarefas] Tipo selecionado:", type);
    console.log("[Seven Gold CRM][Tarefas] Payload tarefa:", payload);

    try {
      const { data: savedTask, error } = await supabase
        .from('tasks')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw new Error(error.message || 'Erro ao salvar tarefa');

      console.log("[Seven Gold CRM][Tarefas] Tarefa salva:", savedTask);

      await createLeadActivityLog({
        leadId: savedTask?.lead_id || leadId,
        actionType: "task_created",
        actionLabel: type === "whatsapp_message"
          ? "Mensagem WhatsApp agendada"
          : "Lembrete criado",
        description: savedTask?.title || savedTask?.whatsapp_message || payload.title || "Tarefa",
        oldValue: null,
        newValue: dataHora,
      });

      status.textContent = 'Tarefa agendada com sucesso!';
      status.className = 'sg-return-status sg-return-status--success';
      form.reset();

      // Resetar form visual para Whatsapp Message
      const btnTypeWa = document.getElementById('sg-task-type-wa');
      if (btnTypeWa) btnTypeWa.click();

      loadTasksDesteLead();
      loadTodosOsRetornos();
    } catch (err) {
      console.error('[Seven Gold CRM][Tarefas] Erro:', err);
      status.textContent = 'Falha ao salvar tarefa: ' + err.message;
      status.className = 'sg-return-status sg-return-status--danger';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar tarefa';
    }
  }

  async function storeTaskForAlarm(task) {
    const key = `sevenGoldTask:${task.id}`;
    await chrome.storage.local.set({
      [key]: task,
    });
  }

  function scheduleTaskAlarm(task) {
    if (!task?.id || !task?.scheduled_at) return;

    const when = new Date(task.scheduled_at).getTime();

    if (Number.isNaN(when)) {
      console.error("[Seven Gold CRM][Tarefas] Data inválida:", task);
      return;
    }

    chrome.alarms.create(`sevenGoldTask:${task.id}`, { when });

    console.log("[Seven Gold CRM][Tarefas] Alarme criado:", {
      alarmName: `sevenGoldTask:${task.id}`,
      when,
      task,
    });
  }

  async function completeTask(taskId) {
    if (!canUseTasksTab()) {
      showPermissionError("Você não tem permissão para atualizar tarefas.");
      return;
    }
    const doneBtn = document.querySelector(`.sg-app-btn--done[data-id="${taskId}"]`);
    const cancelBtn = document.querySelector(`.sg-app-btn--cancel[data-id="${taskId}"]`);
    
    if (doneBtn) doneBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const actor = await getCurrentActor();
    const donePayload = { status: 'done' };
    if (actor) {
      donePayload.completed_by_email = actor.email;
      donePayload.completed_by_name = actor.name;
      donePayload.completed_at = new Date().toISOString();

      console.log("[Seven Gold CRM][Actor] Usuário da ação:", actor);
      console.log("[Seven Gold CRM][Actor] Payload com usuário:", donePayload);
    }

    try {
      const { data: updatedTask, error } = await supabase
        .from('tasks')
        .update(donePayload)
        .eq('id', taskId)
        .select('*')
        .single();

      if (error) throw new Error(error.message || 'Erro ao atualizar tarefa');

      showStatus('Tarefa concluída com sucesso!', 'success');

      if (updatedTask?.lead_id) {
        await createLeadActivityLog({
          leadId: updatedTask.lead_id,
          actionType: "task_completed",
          actionLabel: "Tarefa concluída",
          description: `Tarefa concluída: ${updatedTask.title || updatedTask.type || "sem título"}.`,
          oldValue: updatedTask.status || "pending",
          newValue: "done",
        });
        await loadLeadHistory(updatedTask.lead_id);
      }

      const card = doneBtn ? doneBtn.closest('.sg-return-card') : null;
      if (card) {
        card.style.opacity = '0.7';
        card.style.borderColor = 'rgba(76, 175, 80, 0.5)';
        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px; color: #4caf50; font-weight: bold;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Tarefa Feita!
          </div>
        `;
      }

      setTimeout(() => {
        loadTasksDesteLead();
        loadTodosOsRetornos();
      }, 1000);
    } catch (e) {
      console.error('[Seven Gold CRM][Tarefas] Falha ao marcar feito:', e);
      showStatus('Falha ao concluir tarefa: ' + e.message, 'error');
      if (doneBtn) doneBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  async function cancelTask(taskId) {
    if (!canUseTasksTab()) {
      showPermissionError("Você não tem permissão para atualizar tarefas.");
      return;
    }
    const doneBtn = document.querySelector(`.sg-app-btn--done[data-id="${taskId}"]`);
    const cancelBtn = document.querySelector(`.sg-app-btn--cancel[data-id="${taskId}"]`);
    
    if (doneBtn) doneBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const actor = await getCurrentActor();
    const cancelPayload = { status: 'cancelled' };
    if (actor) {
      cancelPayload.completed_by_email = actor.email;
      cancelPayload.completed_by_name = actor.name;

      console.log("[Seven Gold CRM][Actor] Usuário da ação:", actor);
      console.log("[Seven Gold CRM][Actor] Payload com usuário:", cancelPayload);
    }

    try {
      const { data: updatedTask, error } = await supabase
        .from('tasks')
        .update(cancelPayload)
        .eq('id', taskId)
        .select('*')
        .single();

      if (error) throw new Error(error.message || 'Erro ao atualizar tarefa');

      showStatus('Tarefa cancelada com sucesso!', 'success');

      if (updatedTask?.lead_id) {
        await createLeadActivityLog({
          leadId: updatedTask.lead_id,
          actionType: "task_cancelled",
          actionLabel: "Tarefa cancelada",
          description: `Tarefa cancelada: ${updatedTask.title || updatedTask.type || "sem título"}.`,
          oldValue: updatedTask.status || "pending",
          newValue: "cancelled",
        });
        await loadLeadHistory(updatedTask.lead_id);
      }

      const card = cancelBtn ? cancelBtn.closest('.sg-return-card') : null;
      if (card) {
        card.style.opacity = '0.7';
        card.style.borderColor = 'rgba(244, 67, 54, 0.5)';
        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px; color: #f44336; font-weight: bold;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Tarefa Cancelada!
          </div>
        `;
      }

      setTimeout(() => {
        loadTasksDesteLead();
        loadTodosOsRetornos();
      }, 1000);
    } catch (e) {
      console.error('[Seven Gold CRM][Tarefas] Falha ao cancelar:', e);
      showStatus('Falha ao cancelar tarefa: ' + e.message, 'error');
      if (doneBtn) doneBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  async function syncPendingTasksAlarms() {
    // No-op (alarm sync handled in background.js startup)
  }

  async function loadTasksDesteLead() {
    const container = document.getElementById('sg-tasks-list-container');
    if (!container) return;

    const detailsEl = document.getElementById('seven-gold-crm-lead-details');
    const leadId = detailsEl ? detailsEl.dataset.leadId : '';

    if (!leadId) {
      container.innerHTML = `<div class="sg-empty-state">Consulte o lead no CRM primeiro.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; padding: 10px; color: #8a9fc4; gap: 8px;">
        <span class="sg-spinner" style="border-top-color: #d4af37; width: 12px; height: 12px;"></span>
        <span style="font-size: 11px;">Carregando tarefas...</span>
      </div>
    `;

    try {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('lead_id', leadId);

      if (error) throw error;

      const activeTasks = (tasks || []).filter(t => t.status === 'pending' || t.status === 'triggered');

      if (activeTasks.length === 0) {
        container.innerHTML = `<div class="sg-empty-state">Nenhuma tarefa ativa cadastrada.</div>`;
        return;
      }

      container.innerHTML = '';
      activeTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'sg-return-card';
        card.style.margin = '4px 0';
        card.style.padding = '10px';
        card.style.background = 'rgba(29, 47, 90, 0.2)';
        card.style.border = '1px solid #1d2f5a';
        card.style.borderRadius = '6px';

        const dateStr = new Date(task.scheduled_at).toLocaleString('pt-BR');
        const typeLabel = task.type === 'whatsapp_message' ? 'Mensagem WhatsApp' : 'Lembrete';
        const titleContent = task.type === 'whatsapp_message' ? task.whatsapp_message : task.title;

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-weight: bold; font-size: 11.5px; color: #d4af37;">${typeLabel}</span>
            <span style="font-size: 10px; color: #8a9fc4;">${dateStr}</span>
          </div>
          <div style="font-size: 12px; color: #fff; margin-bottom: 6px; font-weight: 500; white-space: pre-wrap;">${titleContent}</div>
          ${task.internal_note ? `<div style="font-size: 11px; color: #8a9fc4; margin-bottom: 8px; font-style: italic; background: rgba(0,0,0,0.1); padding: 4px 8px; border-radius: 4px;">Obs: ${task.internal_note}</div>` : ''}
          <div style="display: flex; gap: 6px;">
            ${task.type === 'whatsapp_message' && task.lead_telefone ? `<button type="button" class="sg-app-btn sg-app-btn--whatsapp" style="font-size: 10.5px; padding: 4px 8px;" data-id="${task.id}">Abrir WhatsApp</button>` : ''}
            <button type="button" class="sg-app-btn sg-app-btn--done" style="font-size: 10.5px; padding: 4px 8px; background: rgba(76, 175, 80, 0.15); border-color: rgba(76, 175, 80, 0.4); color: #4caf50;" data-id="${task.id}">Feito</button>
            <button type="button" class="sg-app-btn sg-app-btn--cancel" style="font-size: 10.5px; padding: 4px 8px; background: rgba(244, 67, 54, 0.1); border-color: rgba(244, 67, 54, 0.4); color: #f44336;" data-id="${task.id}">Cancelar</button>
          </div>
        `;

        const btnWa = card.querySelector('.sg-app-btn--whatsapp');
        if (btnWa) {
          btnWa.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_WHATSAPP_TASK', task });
          });
        }

        card.querySelector('.sg-app-btn--done').addEventListener('click', () => {
          completeTask(task.id);
        });

        card.querySelector('.sg-app-btn--cancel').addEventListener('click', () => {
          cancelTask(task.id);
        });

        container.appendChild(card);
      });
    } catch (err) {
      console.error('[Seven Gold CRM][Tarefas] Falha ao carregar tarefas:', err);
      container.innerHTML = `<div class="sg-empty-state" style="color: #f44336;">Erro ao carregar tarefas: ${err.message || 'de rede'}</div>`;
    }
  }

  async function loadTodosOsRetornos() {
    const todayContainer = document.getElementById('sg-returns-today-container');
    const allContainer = document.getElementById('sg-returns-all-container');
    if (!todayContainer || !allContainer) return;

    todayContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; padding: 10px; color: #8a9fc4; gap: 8px;">
        <span class="sg-spinner" style="border-top-color: #d4af37; width: 12px; height: 12px;"></span>
        <span style="font-size: 11px;">Carregando retornos...</span>
      </div>
    `;
    allContainer.innerHTML = todayContainer.innerHTML;

    try {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*');

      if (error) throw error;

      const activeTasks = (tasks || []).filter(t => t.status === 'pending' || t.status === 'triggered');

      if (activeTasks.length === 0) {
        todayContainer.innerHTML = `<div class="sg-empty-state">Nenhum retorno para hoje.</div>`;
        allContainer.innerHTML = `<div class="sg-empty-state">Nenhum retorno cadastrado.</div>`;
        return;
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const todayTasks = [];
      const futureTasks = [];

      activeTasks.forEach(task => {
        const time = new Date(task.scheduled_at).getTime();
        if (time >= startOfToday.getTime() && time <= endOfToday.getTime()) {
          todayTasks.push(task);
        } else {
          futureTasks.push(task);
        }
      });

      const renderList = (taskList, el, emptyMsg) => {
        if (taskList.length === 0) {
          el.innerHTML = `<div class="sg-empty-state">${emptyMsg}</div>`;
          return;
        }
        el.innerHTML = '';
        taskList.forEach(task => {
          const card = document.createElement('div');
          card.className = 'sg-return-card';
          card.style.margin = '4px 0';
          card.style.padding = '10px';
          card.style.background = 'rgba(29, 47, 90, 0.2)';
          card.style.border = '1px solid #1d2f5a';
          card.style.borderRadius = '6px';

          const dateStr = new Date(task.scheduled_at).toLocaleString('pt-BR');
          const typeLabel = task.type === 'whatsapp_message' ? 'Mensagem WhatsApp' : 'Lembrete';
          const titleContent = task.type === 'whatsapp_message' ? task.whatsapp_message : task.title;

          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: bold; font-size: 11.5px; color: #d4af37;">${typeLabel}</span>
              <span style="font-size: 10px; color: #8a9fc4;">${dateStr}</span>
            </div>
            <div style="font-size: 12px; color: #fff; font-weight: bold; margin-bottom: 2px;">Cliente: ${task.lead_nome}</div>
            <div style="font-size: 12px; color: #fff; margin-bottom: 6px; white-space: pre-wrap;">${titleContent}</div>
            ${task.internal_note ? `<div style="font-size: 11px; color: #8a9fc4; margin-bottom: 8px; font-style: italic; background: rgba(0,0,0,0.1); padding: 4px 8px; border-radius: 4px;">Obs: ${task.internal_note}</div>` : ''}
            <div style="display: flex; gap: 6px;">
              ${task.type === 'whatsapp_message' && task.lead_telefone ? `<button type="button" class="sg-app-btn sg-app-btn--whatsapp" style="font-size: 10.5px; padding: 4px 8px;" data-id="${task.id}">Abrir WhatsApp</button>` : ''}
              <button type="button" class="sg-app-btn sg-app-btn--done" style="font-size: 10.5px; padding: 4px 8px; background: rgba(76, 175, 80, 0.15); border-color: rgba(76, 175, 80, 0.4); color: #4caf50;" data-id="${task.id}">Feito</button>
              <button type="button" class="sg-app-btn sg-app-btn--cancel" style="font-size: 10.5px; padding: 4px 8px; background: rgba(244, 67, 54, 0.1); border-color: rgba(244, 67, 54, 0.4); color: #f44336;" data-id="${task.id}">Cancelar</button>
            </div>
          `;

          const btnWa = card.querySelector('.sg-app-btn--whatsapp');
          if (btnWa) {
            btnWa.addEventListener('click', () => {
              chrome.runtime.sendMessage({ type: 'OPEN_WHATSAPP_TASK', task });
            });
          }

          card.querySelector('.sg-app-btn--done').addEventListener('click', () => {
            completeTask(task.id);
          });

          card.querySelector('.sg-app-btn--cancel').addEventListener('click', () => {
            cancelTask(task.id);
          });

          el.appendChild(card);
        });
      };

      renderList(todayTasks, todayContainer, 'Nenhum retorno para hoje.');
      renderList([...todayTasks, ...futureTasks], allContainer, 'Nenhum retorno cadastrado.');
    } catch (err) {
      console.error('[Seven Gold CRM][Tarefas] Falha ao carregar todos os retornos:', err);
      todayContainer.innerHTML = `<div class="sg-empty-state" style="color: #f44336;">Erro ao carregar retornos: ${err.message || 'de rede'}</div>`;
      allContainer.innerHTML = todayContainer.innerHTML;
    }
  }

  const returnsAllToggle = document.getElementById('sg-returns-all-toggle');
  const returnsAllArrow = document.getElementById('sg-returns-all-arrow');
  const returnsAllContainer = document.getElementById('sg-returns-all-container');
  if (returnsAllToggle && returnsAllContainer) {
    returnsAllToggle.addEventListener('click', () => {
      const isHidden = returnsAllContainer.style.display === 'none';
      returnsAllContainer.style.display = isHidden ? 'flex' : 'none';
      if (returnsAllArrow) {
        returnsAllArrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Form handling                                                      */
  /* ------------------------------------------------------------------ */

  function parseOptionalMoney(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    let normalized = raw.replace(/R\$/gi, '').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    } else {
      normalized = normalized.replace(/,/g, '');
    }

    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  function formatMoneyDisplay(value) {
    if (value === null || value === undefined || value === '') return 'Não informado';
    const amount = Number(value);
    if (!Number.isFinite(amount)) return String(value);
    return amount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canUseExtensionArea("crm_pipeline")) {
      showPermissionError("Você não tem permissão para capturar leads.");
      return;
    }
    const form = e.target;

    const nomeVal = form.nome.value.trim();
    const telefoneVal = form.telefone.value.trim();

    // Validate name: cannot be empty, and cannot be invalid/instruction
    if (!nomeVal || !validateCapturedName(nomeVal)) {
      showStatus('Nome inválido. Preencha o nome do lead manualmente.', 'error');
      form.nome.focus();
      return;
    }

    // Validate phone: cannot be empty, must be only numbers, and must have valid minimum length (10 digits)
    if (!telefoneVal || !/^\d+$/.test(telefoneVal) || telefoneVal.length < 10) {
      showStatus('Telefone inválido. Capture ou preencha o telefone manualmente.', 'error');
      form.telefone.focus();
      return;
    }

    const data = {
      nome: nomeVal,
      telefone: telefoneVal,
      etapa: 'lead_recebido',
      etiquetas: [],
      observacoes: form.observacoes.value.trim(),
      property_region: form.property_region.value.trim() || null,
      credit_value: parseOptionalMoney(form.credit_value.value),
      down_payment_value: parseOptionalMoney(form.down_payment_value.value),
      installment_value: parseOptionalMoney(form.installment_value.value),
    };

    const btn = form.querySelector('.sg-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="sg-spinner"></span> Salvando...';

    try {
      const result = await DataService.saveLead(data);
      if (result.ok) {
        if (result.source === 'api') {
          showStatus('Lead salvo no funil com sucesso.', 'success');

          const savedLead = result.lead;
          if (savedLead?.id) {
            const logActor = await getCurrentActor().catch(() => null);
            await createLeadActivityLog({
              leadId: savedLead.id,
              actionType: "lead_created",
              actionLabel: "Lead criado pela extensão",
              description: `Lead capturado pelo WhatsApp e atribuído para ${logActor?.name || 'desconhecido'}.`,
              oldValue: null,
              newValue: logActor?.email || null,
            });
          }
        } else {
          showStatus(`Salvo offline. Motivo: ${result.errorDetail || 'não informado'}`, 'warning');
        }

        // Limpeza automática após delay de 1000ms
        setTimeout(() => {
          form.reset();

          const crmDetails = document.getElementById('seven-gold-crm-lead-details');
          const crmStatus = document.getElementById('seven-gold-crm-lead-status');
          if (crmDetails) crmDetails.style.display = 'none';
          if (crmStatus) {
            crmStatus.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span>Nenhum lead consultado ainda.</span>`;
            crmStatus.style.color = '#ff9800';
          }

          if (result.source === 'api') {
            showStatus('Lead salvo no funil com sucesso. Campos limpos, pronto para o próximo lead.', 'success');
          } else {
            showStatus(`Salvo offline. Motivo: ${result.errorDetail || 'não informado'}. Campos limpos, pronto para o próximo lead.`, 'warning');
          }
        }, 1000);
      } else if (result.action === 'duplicate') {
        showStatus('Número já cadastrado no CRM. Edite esse lead diretamente no CRM ou use outro número.', 'warning');
      } else {
        showStatus(`Erro ao salvar lead: ${result.error || 'desconhecido'}`, 'error');
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('não identificado')) {
        showStatus('Não foi possível identificar o usuário responsável pelo lead.', 'error');
      } else {
        showStatus('Não foi possível conectar ao CRM agora. Tente novamente.', 'error');
      }
      if (DEBUG) console.error('[Seven Gold CRM]', err);
    } finally {
      btn.disabled = false;
      btn.innerHTML =
        '<span class="sg-submit-icon">&#10022;</span> Salvar lead no funil';
    }
  }

  function normalizeCrmPhone(phoneInput) {
    if (!phoneInput) return '';
    const digits = phoneInput.replace(/[^\d]/g, '');
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      return '55' + digits;
    }
    return digits;
  }

  function displayValueToInput(value) {
    const text = String(value || '').trim();
    return text === 'Não informado' || text === '-' ? '' : text;
  }

  function buildSafeLeadUpdatePayload() {
    const activeStageBtn = document.querySelector('.sg-crm-stage-btn.active');
    const currentStage = activeStageBtn ? activeStageBtn.dataset.value : 'lead_recebido';
    const phone = normalizeCrmPhone(document.getElementById('sg-crm-edit-phone').value);
    const name = document.getElementById('sg-crm-edit-name').value.trim();
    const origin = document.getElementById('sg-crm-edit-origin').value.trim();
    const note = document.getElementById('sg-crm-edit-note').value.trim();
    const propertyRegion = document.getElementById('sg-crm-edit-property-region').value.trim() || null;
    const creditValue = parseOptionalMoney(document.getElementById('sg-crm-edit-credit-value').value);
    const downPaymentValue = parseOptionalMoney(document.getElementById('sg-crm-edit-down-payment-value').value);
    const installmentValue = parseOptionalMoney(document.getElementById('sg-crm-edit-installment-value').value);

    const payload = {
      name,
      phone,
      status: currentStage,
      source: origin || null,
      note: note || null,
      property_region: propertyRegion,
      credit_value: creditValue,
      down_payment_value: downPaymentValue,
      installment_value: installmentValue,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || (typeof payload[key] === 'number' && !Number.isFinite(payload[key]))) {
        delete payload[key];
      }
    });

    console.log('[Seven Gold CRM] Payload montado:', JSON.stringify(payload, null, 2));
    console.log('[Seven Gold CRM] Note length:', (payload.note || '').length, 'chars');

    return payload;
  }

  function setCrmEditMode(enabled) {
    const details = document.getElementById('seven-gold-crm-lead-details');
    if (!details) return;

    if (enabled) {
      document.getElementById('sg-crm-edit-name').value = displayValueToInput(document.getElementById('sg-crm-lead-name').textContent);
      document.getElementById('sg-crm-edit-phone').value = displayValueToInput(document.getElementById('sg-crm-lead-phone').textContent);
      document.getElementById('sg-crm-edit-origin').value = displayValueToInput(document.getElementById('sg-crm-lead-origin').textContent);
      document.getElementById('sg-crm-edit-property-region').value = displayValueToInput(document.getElementById('sg-crm-property-region').textContent);
      document.getElementById('sg-crm-edit-credit-value').value = displayValueToInput(document.getElementById('sg-crm-credit-value').textContent);
      document.getElementById('sg-crm-edit-down-payment-value').value = displayValueToInput(document.getElementById('sg-crm-down-payment-value').textContent);
      document.getElementById('sg-crm-edit-installment-value').value = displayValueToInput(document.getElementById('sg-crm-installment-value').textContent);
      document.getElementById('sg-crm-edit-note').value = displayValueToInput(document.getElementById('sg-crm-lead-note').textContent);
    }

    details.classList.toggle('is-editing', enabled);
  }

  async function handleCrmEditSave() {
    const details = document.getElementById('seven-gold-crm-lead-details');
    const statusEl = document.getElementById('seven-gold-crm-lead-status');
    const saveBtn = document.getElementById('sg-crm-save-edit');
    const leadId = details?.dataset.leadId || '';
    const lookupPhone = details?.dataset.lookupPhone || '';
    const data = buildSafeLeadUpdatePayload();
    const name = data.name;
    const newPhone = data.phone;

    if (!name) {
      statusEl.textContent = 'Informe o nome do lead.';
      statusEl.style.color = '#ff9800';
      return;
    }
    if (newPhone.length < 10 || !lookupPhone || !leadId) {
      statusEl.textContent = 'Informe um telefone válido.';
      statusEl.style.color = '#ff9800';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    statusEl.textContent = 'Atualizando informações do lead...';
    statusEl.style.color = '#aaa';

    try {
      const actor = await getCurrentActor();
      data.updated_by_email = actor.email;
      data.updated_by_name = actor.name;
      data.updated_at = new Date().toISOString();

      cleanUndefinedFields(data);

      console.log("[Seven Gold CRM][Responsável] Usuário logado:", actor);
      console.log("[Seven Gold CRM][Responsável] Payload lead:", data);

      console.log('[Seven Gold CRM] ID do lead:', leadId);
      console.log('[Seven Gold CRM] Phone lookup:', lookupPhone);
      console.log('[Seven Gold CRM] Payload enviado:', JSON.stringify(data, null, 2));

      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_LEAD_DETAILS',
        id: leadId,
        phone: lookupPhone,
        data,
      });

      console.log('[Seven Gold CRM] Resposta do update:', JSON.stringify(response, null, 2));

      if (!response || response.ok !== true) {
        const rawError = response?.error || 'Não foi possível atualizar o lead.';
        const rawDetails = response?.details || '';
        const rawHint = response?.hint || '';
        const rawStatus = response?.status || '';
        const rawResponse = response?.response ? JSON.stringify(response.response) : '';

        console.error('[Seven Gold CRM] Erro do update:', {
          error: rawError,
          details: rawDetails,
          hint: rawHint,
          status: rawStatus,
          fullResponse: rawResponse,
          raw: JSON.stringify(response),
        });

        const detailMsg = [rawError, rawDetails, rawHint].filter(Boolean).join(' | ') || `HTTP ${rawStatus || 'desconhecido'}`;
        throw new Error(detailMsg);
      }

      console.log('[Seven Gold CRM] PATCH ok. Re-consultando para confirmar...');

      const verifyResponse = await chrome.runtime.sendMessage({
        type: 'GET_LEAD_BY_PHONE',
        phone: newPhone || lookupPhone,
      });

      console.log('[Seven Gold CRM] Re-consulta:', JSON.stringify(verifyResponse, null, 2));

      if (!verifyResponse || verifyResponse.ok !== true || !verifyResponse.found || !verifyResponse.lead) {
        console.error('[Seven Gold CRM] Re-consulta falhou:', verifyResponse);
        throw new Error('Update retornou ok, mas não foi possível confirmar os dados no servidor.');
      }

      const lead = verifyResponse.lead;
      console.log('[Seven Gold CRM] Lead confirmado no banco:', JSON.stringify(lead, null, 2));

      const leadDbName = lead.name || lead.nome || '';
      const leadDbPhone = lead.telefone || lead.phone || '';
      const leadDbStatus = lead.status || lead.stage || '';
      const leadDbOrigin = lead.origin || lead.source || lead.origem || '';
      const leadDbNote = lead.note || '';
      const leadDbRegion = lead.property_region || '';
      const leadDbCredit = lead.credit_value;
      const leadDbDown = lead.down_payment_value;
      const leadDbInstallment = lead.installment_value;

      console.log('[Seven Gold CRM] Colunas disponíveis no lead:', Object.keys(lead || {}));
      console.log('[Seven Gold CRM] Valores do banco:', JSON.stringify({
        name: leadDbName, phone: leadDbPhone, status: leadDbStatus,
        origin: leadDbOrigin, note: lead.note, property_region: leadDbRegion,
        credit_value: leadDbCredit, down_payment_value: leadDbDown,
        installment_value: leadDbInstallment
      }, null, 2));

      const mismatchedFields = [];

      if (data.name && leadDbName.toLowerCase().trim() !== data.name.toLowerCase().trim()) {
        mismatchedFields.push(`nome (esperado: "${data.name}", banco: "${leadDbName}")`);
      }
      if (leadDbPhone && normalizeCrmPhone(leadDbPhone) !== normalizeCrmPhone(newPhone)) {
        mismatchedFields.push(`telefone (esperado: "${newPhone}", banco: "${leadDbPhone}")`);
      }
      if (data.status && leadDbStatus !== data.status) {
        mismatchedFields.push(`status (esperado: "${data.status}", banco: "${leadDbStatus}")`);
      }
      if (data.source !== null && data.source !== undefined && data.source !== '') {
        const dbOrigin = leadDbOrigin.toLowerCase().trim();
        const sentOrigin = (data.source || '').toLowerCase().trim();
        if (sentOrigin && dbOrigin !== sentOrigin) {
          mismatchedFields.push(`origem (esperado: "${data.source}", banco: "${leadDbOrigin}")`);
        }
      }

      const sentNote = (data.note || '').trim();
      const dbNote = (leadDbNote || '').trim();
      if (sentNote !== '' && dbNote !== sentNote) {
        mismatchedFields.push(`note (esperado: "${sentNote}", banco: "${dbNote}")`);
      }

      if (data.property_region !== null && data.property_region !== undefined) {
        if ((leadDbRegion || '').toLowerCase().trim() !== (data.property_region || '').toLowerCase().trim()) {
          mismatchedFields.push(`regiao_imovel (esperado: "${data.property_region}", banco: "${leadDbRegion}")`);
        }
      }
      if (data.credit_value !== null && data.credit_value !== undefined) {
        if (Number(leadDbCredit) !== Number(data.credit_value)) {
          mismatchedFields.push(`valor_credito (esperado: ${data.credit_value}, banco: ${leadDbCredit})`);
        }
      }
      if (data.down_payment_value !== null && data.down_payment_value !== undefined) {
        if (Number(leadDbDown) !== Number(data.down_payment_value)) {
          mismatchedFields.push(`valor_entrada (esperado: ${data.down_payment_value}, banco: ${leadDbDown})`);
        }
      }
      if (data.installment_value !== null && data.installment_value !== undefined) {
        if (Number(leadDbInstallment) !== Number(data.installment_value)) {
          mismatchedFields.push(`valor_parcela (esperado: ${data.installment_value}, banco: ${leadDbInstallment})`);
        }
      }

      if (mismatchedFields.length > 0) {
        const errorMsg = `Banco não confirmou alteração: ${mismatchedFields.join('; ')}`;
        console.error('[Seven Gold CRM]', errorMsg);
        throw new Error(errorMsg);
      }

      const stageFromDb = lead.status || lead.stage || data.status || 'lead_recebido';

      document.getElementById('sg-crm-lead-name').textContent = leadDbName || name;
      document.getElementById('sg-crm-lead-phone').textContent = leadDbPhone || newPhone;
      document.getElementById('sg-crm-lead-stage').textContent = getStageLabel(stageFromDb);
      document.getElementById('sg-crm-lead-origin').textContent = leadDbOrigin || 'Não informado';
      document.getElementById('sg-crm-property-region').textContent = leadDbRegion || 'Não informado';
      document.getElementById('sg-crm-credit-value').textContent = formatMoneyDisplay(leadDbCredit);
      document.getElementById('sg-crm-down-payment-value').textContent = formatMoneyDisplay(leadDbDown);
      document.getElementById('sg-crm-installment-value').textContent = formatMoneyDisplay(leadDbInstallment);
      document.getElementById('sg-crm-lead-note').textContent = leadDbNote || 'Não informado';

      const assignedNameAfterEdit = lead.assigned_to_name || lead.created_by_name || null;
      const assignedEmailAfterEdit = lead.assigned_to_email || lead.created_by_email || null;
      const assignedNameElAfterEdit = document.getElementById('sg-crm-lead-assigned-name');
      const assignedEmailElAfterEdit = document.getElementById('sg-crm-lead-assigned-email');
      if (assignedNameAfterEdit || assignedEmailAfterEdit) {
        assignedNameElAfterEdit.textContent = assignedNameAfterEdit || '-';
        assignedEmailElAfterEdit.textContent = assignedEmailAfterEdit || '-';
      } else {
        assignedNameElAfterEdit.textContent = 'Sem responsável';
        assignedEmailElAfterEdit.textContent = '-';
      }

      renderCrmStageButtons(stageFromDb);

      const form = document.getElementById(FORM_ID);
      form.nome.value = leadDbName || name;
      form.telefone.value = leadDbPhone || newPhone;
      details.dataset.lookupPhone = form.telefone.value;
      details.dataset.leadId = String(lead.id);

      setCrmEditMode(false);
      statusEl.textContent = 'Informações do lead atualizadas com sucesso.';
      statusEl.style.color = '#4caf50';

      if (lead?.id) {
        await createLeadActivityLog({
          leadId: lead.id,
          actionType: "lead_updated",
          actionLabel: "Lead editado pela extensão",
          description: "Informações do lead foram atualizadas pela extensão.",
          oldValue: null,
          newValue: null,
        });
      }
      await loadLeadHistory(lead.id);
    } catch (err) {
      console.error('[Seven Gold CRM] Exceção ao salvar lead:', err);
      statusEl.textContent = `Erro ao salvar: ${err.message || 'Não foi possível atualizar o lead.'}`;
      statusEl.style.color = '#f44336';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar alterações';
    }
  }

  async function handleCrmQuery() {
    if (!canUseExtensionArea("crm_pipeline")) {
      showPermissionError("Você não tem permissão para consultar leads.");
      return;
    }
    const form = document.getElementById(FORM_ID);
    if (!form) return;
    
    const phoneInput = form.telefone.value.trim();
    const statusEl = document.getElementById('seven-gold-crm-lead-status');
    const detailsEl = document.getElementById('seven-gold-crm-lead-details');
    const queryBtn = document.getElementById('seven-gold-query-crm-btn');

    // Estado visual inicial
    document.getElementById('sg-crm-lead-name').textContent = '-';
    document.getElementById('sg-crm-lead-phone').textContent = '-';
    document.getElementById('sg-crm-lead-stage').textContent = '-';
    document.getElementById('sg-crm-lead-origin').textContent = 'Não informado';
    document.getElementById('sg-crm-property-region').textContent = 'Não informado';
    document.getElementById('sg-crm-credit-value').textContent = 'Não informado';
    document.getElementById('sg-crm-down-payment-value').textContent = 'Não informado';
    document.getElementById('sg-crm-installment-value').textContent = 'Não informado';
    document.getElementById('sg-crm-lead-note').textContent = 'Não informado';
    detailsEl.dataset.lookupPhone = '';
    detailsEl.dataset.leadId = '';
    setCrmEditMode(false);
    detailsEl.style.display = 'none';

    if (!phoneInput) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span>Preencha ou capture um telefone antes de consultar.</span>`;
      statusEl.style.color = '#ff9800'; // laranja
      return;
    }

    const phone = normalizeCrmPhone(phoneInput);
    if (phone.length < 10) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span>Telefone inválido para consulta.</span>`;
      statusEl.style.color = '#f44336'; // vermelho
      return;
    }

    queryBtn.disabled = true;
    queryBtn.textContent = 'Consultando CRM...';
    statusEl.innerHTML = `<span class="sg-spinner" style="border-top-color: #d4af37; width: 12px; height: 12px; margin-right: 6px;"></span> <span>Consultando CRM...</span>`;
    statusEl.style.color = '#aaa';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LEAD_BY_PHONE',
        phone: phone
      });

      if (response && response.ok === true) {
        if (response.found === true) {
          const lead = response.lead;
          
          // Validação obrigatória dos campos do lead
          const hasTelefone = lead && (lead.telefone !== undefined || lead.phone !== undefined);
          const hasStatus = lead && (lead.status !== undefined || lead.stage !== undefined);

          if (lead && lead.id && hasTelefone && hasStatus) {
            const leadName = lead.name || lead.nome || '-';
            const leadPhone = lead.telefone || lead.phone || '-';
            const leadStageRaw = lead.status || lead.stage || 'lead_recebido';

            document.getElementById('sg-crm-lead-name').textContent = leadName;
            document.getElementById('sg-crm-lead-phone').textContent = leadPhone;
            const stageLabel = getStageLabel(leadStageRaw);
            document.getElementById('sg-crm-lead-stage').textContent = stageLabel;
            document.getElementById('sg-crm-lead-origin').textContent = lead.origin || lead.source || lead.origem || 'Não informado';
            document.getElementById('sg-crm-property-region').textContent = lead.property_region || 'Não informado';
            document.getElementById('sg-crm-credit-value').textContent = formatMoneyDisplay(lead.credit_value);
            document.getElementById('sg-crm-down-payment-value').textContent = formatMoneyDisplay(lead.down_payment_value);
            document.getElementById('sg-crm-installment-value').textContent = formatMoneyDisplay(lead.installment_value);
            document.getElementById('sg-crm-lead-note').textContent = lead.note || 'Não informado';
            detailsEl.dataset.lookupPhone = normalizeCrmPhone(leadPhone);
            detailsEl.dataset.leadId = String(lead.id);

            const assignedName = lead.assigned_to_name || lead.created_by_name || null;
            const assignedEmail = lead.assigned_to_email || lead.created_by_email || null;
            const assignedNameEl = document.getElementById('sg-crm-lead-assigned-name');
            const assignedEmailEl = document.getElementById('sg-crm-lead-assigned-email');
            if (assignedName || assignedEmail) {
              assignedNameEl.textContent = assignedName || '-';
              assignedEmailEl.textContent = assignedEmail || '-';
            } else {
              assignedNameEl.textContent = 'Sem responsável';
              assignedEmailEl.textContent = '-';
            }

            loadLeadHistory(lead.id);

            const interactionEl = document.getElementById('sg-crm-lead-interaction');
            const interactionRow = document.getElementById('sg-crm-lead-interaction-row');
            if (lead.last_interaction || lead.ultima_interacao || lead.updated_at) {
              const rawDate = lead.last_interaction || lead.ultima_interacao || lead.updated_at;
              try {
                interactionEl.textContent = new Date(rawDate).toLocaleString('pt-BR');
              } catch {
                interactionEl.textContent = rawDate;
              }
              interactionRow.style.display = 'flex';
            } else {
              interactionRow.style.display = 'none';
            }

            renderCrmStageButtons(leadStageRaw);

            detailsEl.style.display = 'block';
            statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4caf50; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>Lead encontrado no CRM</span>`;
            statusEl.style.color = '#4caf50';
          } else {
            statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="line-height: 1.3;">Não foi possível confirmar este lead no CRM. Tente consultar novamente.</span>`;
            statusEl.style.color = '#f44336'; // vermelho
          }
        } else {
          statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <span style="line-height: 1.3;">Este número ainda não está no funil. Capture e salve o lead primeiro.</span>`;
          statusEl.style.color = '#ff9800'; // laranja
        }
      } else {
        statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="line-height: 1.3;">Não foi possível consultar o CRM agora. Tente novamente.</span>`;
        statusEl.style.color = '#f44336'; // vermelho
      }
    } catch (err) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="line-height: 1.3;">Não foi possível consultar o CRM agora. Tente novamente.</span>`;
      statusEl.style.color = '#f44336'; // vermelho
    } finally {
      queryBtn.disabled = false;
      queryBtn.textContent = 'Consultar lead';
    }
  }

  function renderCrmStageButtons(currentStage) {
    const container = document.getElementById('sg-crm-stage-buttons-container');
    if (!container) return;

    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '6px';
    container.style.marginTop = '8px';

    const stageIcons = {
      lead_recebido: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      primeiro_contato: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
      agendamento: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      cliente_em_loja: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      proposta_enviada: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      venda_fechada: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; flex-shrink: 0;"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34M12 2a4 4 0 0 0-4 4v4.5A4.5 4.5 0 0 0 12.5 15h0a4.5 4.5 0 0 0 4.5-4.5V6a4 4 0 0 0-4-4z"/></svg>'
    };

    CRM_STAGES.forEach(stage => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sg-crm-stage-btn';
      btn.dataset.value = stage.value;

      btn.innerHTML = `${stageIcons[stage.value] || ''} <span>${stage.label}</span>`;

      if (stage.value === currentStage) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => handleCrmStageButtonClick(stage.value));
      container.appendChild(btn);
    });
  }

  async function handleCrmStageButtonClick(newStage) {
    const form = document.getElementById(FORM_ID);
    if (!form) return;

    const phoneInput = form.telefone.value.trim();
    const phone = normalizeCrmPhone(phoneInput);
    const statusEl = document.getElementById('seven-gold-crm-lead-status');

    // Identificar a etapa atual com base no botão que possui a classe active
    const activeBtn = document.querySelector('.sg-crm-stage-btn.active');
    const currentStage = activeBtn ? activeBtn.dataset.value : '';

    if (newStage === currentStage) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ff9800; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> <span>Este lead já está nessa etapa.</span>`;
      statusEl.style.color = '#ff9800'; // laranja/aviso
      return;
    }

    if (newStage === 'agendamento') {
      const detailsEl = document.getElementById('seven-gold-crm-lead-details');
      const leadId = detailsEl ? detailsEl.dataset.leadId : '';
      const leadName = document.getElementById('sg-crm-lead-name').textContent;
      const leadPhone = document.getElementById('sg-crm-lead-phone').textContent;
      const lead = {
        id: leadId,
        nome: leadName,
        telefone: leadPhone
      };
      openAppointmentModal(lead);
      return;
    }

    const buttons = document.querySelectorAll('.sg-crm-stage-btn');
    buttons.forEach(b => b.disabled = true);

    statusEl.innerHTML = `<span class="sg-spinner" style="border-top-color: #d4af37; width: 12px; height: 12px; margin-right: 6px;"></span> <span>Atualizando etapa...</span>`;
    statusEl.style.color = '#aaa';

    try {
      const actor = await getCurrentActor();
      const stageMessage = {
        type: 'UPDATE_LEAD_STAGE',
        phone: phone,
        status: newStage,
        updated_by_email: actor.email,
        updated_by_name: actor.name,
        updated_at: new Date().toISOString(),
      };

      cleanUndefinedFields(stageMessage);

      console.log("[Seven Gold CRM][Responsável] Usuário logado:", actor);
      console.log("[Seven Gold CRM][Responsável] Payload etapa:", stageMessage);

      const response = await chrome.runtime.sendMessage(stageMessage);

      if (response && response.ok === true) {
        statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4caf50; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>Etapa atualizada no CRM com sucesso.</span>`;
        statusEl.style.color = '#4caf50'; // verde

        const stageLabel = getStageLabel(newStage);
        document.getElementById('sg-crm-lead-stage').textContent = stageLabel;

        renderCrmStageButtons(newStage);

        const detailsEl = document.getElementById('seven-gold-crm-lead-details');
        const leadId = detailsEl?.dataset.leadId;
        await createLeadActivityLog({
          leadId,
          actionType: "stage_changed",
          actionLabel: "Etapa alterada",
          description: `Lead movido de ${currentStage || "não informado"} para ${newStage}.`,
          oldValue: currentStage || null,
          newValue: newStage,
        });
        await loadLeadHistory(leadId);

      } else {
        statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="line-height: 1.3;">Não foi possível atualizar a etapa no CRM. Verifique se a etapa existe no funil.</span>`;
        statusEl.style.color = '#f44336'; // vermelho
        buttons.forEach(b => b.disabled = false);
      }
    } catch (err) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #f44336; flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="line-height: 1.3;">Não foi possível atualizar a etapa no CRM. Verifique se a etapa existe no funil.</span>`;
      statusEl.style.color = '#f44336'; // vermelho
      buttons.forEach(b => b.disabled = false);
    }
  }

  function openAppointmentModal(lead) {
    const existing = document.getElementById('sg-appointment-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sg-appointment-modal';
    modal.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(8, 16, 38, 0.96);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      padding: 20px;
      box-sizing: border-box;
      color: #fff;
    `;

    modal.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #1d2f5a; padding-bottom: 12px; flex-shrink: 0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style="font-size: 13.5px; font-weight: bold; color: #d4af37; text-transform: uppercase; letter-spacing: 0.5px;">Novo Agendamento</span>
      </div>

      <div style="flex: 1; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 4px; padding-bottom: 8px;">
        <div class="sg-field">
          <span class="sg-label">Nome do Cliente</span>
          <div style="background: rgba(29, 47, 90, 0.3); padding: 8px 12px; border-radius: 4px; color: #fff; font-size: 12.5px; border: 1px solid #1d2f5a;">${lead.nome}</div>
        </div>

        <div class="sg-field">
          <span class="sg-label">Telefone</span>
          <div style="background: rgba(29, 47, 90, 0.3); padding: 8px 12px; border-radius: 4px; color: #fff; font-size: 12.5px; border: 1px solid #1d2f5a;">${lead.telefone}</div>
        </div>

        <label class="sg-field">
          <span class="sg-label">Data do Agendamento *</span>
          <input type="date" id="sg-appt-date" class="sg-edit-field" style="display: block; width: 100%; box-sizing: border-box;" required />
        </label>

        <label class="sg-field">
          <span class="sg-label">Horário do Agendamento *</span>
          <input type="time" id="sg-appt-time" class="sg-edit-field" style="display: block; width: 100%; box-sizing: border-box;" required />
        </label>

        <label class="sg-field">
          <span class="sg-label">Observação Opcional</span>
          <textarea id="sg-appt-note" class="sg-edit-field" rows="3" style="display: block; width: 100%; box-sizing: border-box; font-family: inherit; font-size: 12px;" placeholder="Ex: Lead prefere ligação de vídeo..."></textarea>
        </label>

        <div id="sg-appt-status" class="sg-status" style="margin-top: 8px;" aria-live="polite"></div>
      </div>

      <div style="display: flex; gap: 8px; border-top: 1px solid #1d2f5a; padding-top: 16px; margin-top: 16px; flex-shrink: 0;">
        <button type="button" id="sg-appt-cancel-btn" class="sg-app-btn" style="flex: 1; padding: 10px; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.4); color: #f44336; border-radius: 4px; font-weight: bold; cursor: pointer;">Cancelar</button>
        <button type="button" id="sg-appt-confirm-btn" class="sg-app-btn sg-app-btn--primary" style="flex: 1; padding: 10px; background: #d4af37; border: 1px solid #d4af37; color: #081026; border-radius: 4px; font-weight: bold; cursor: pointer;">Confirmar</button>
      </div>
    `;

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.appendChild(modal);
    }

    // Cancel Button
    modal.querySelector('#sg-appt-cancel-btn').addEventListener('click', () => {
      modal.remove();
    });

    // Confirm Button
    modal.querySelector('#sg-appt-confirm-btn').addEventListener('click', async () => {
      const date = modal.querySelector('#sg-appt-date').value;
      const time = modal.querySelector('#sg-appt-time').value;
      const note = modal.querySelector('#sg-appt-note').value;
      const statusEl = modal.querySelector('#sg-appt-status');
      const confirmBtn = modal.querySelector('#sg-appt-confirm-btn');

      if (!date || !time) {
        statusEl.textContent = 'Informe a data e o horário do agendamento.';
        statusEl.className = 'sg-status sg-status--warning';
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="sg-spinner" style="border-top-color: #081026; width: 12px; height: 12px; margin-right: 6px;"></span> Salvando...`;
      statusEl.textContent = '';
      statusEl.className = 'sg-status';

      try {
        await confirmAppointmentSchedule({ lead, date, time, note });
        modal.remove();
      } catch (err) {
        statusEl.textContent = err.message || 'Erro ao agendar';
        statusEl.className = 'sg-status sg-status--danger';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar';
      }
    });
  }

  async function confirmAppointmentSchedule({ lead, date, time, note }) {
    const leadAtual = lead;
    const appointmentNote = note;

    // Terceiro passo: Garantir validações antes do insert
    if (!leadAtual?.id) {
      throw new Error("Lead sem ID. Consulte o lead novamente antes de agendar.");
    }

    if (!date || !time) {
      throw new Error("Informe data e horário do agendamento.");
    }

    const actor = await getCurrentActor();

    // Quinto passo: Montar payload
    const appointmentPayload = {
      lead_id: leadAtual.id,
      nome_cliente: leadAtual.nome || leadAtual.name || "Cliente sem nome",
      telefone_cliente: leadAtual.telefone || leadAtual.phone || "",
      nome_usuario: actor ? actor.name : "Extensão WhatsApp",
      data_agendamento: date,
      hora_agendamento: time,
      observacao: appointmentNote || null,
      status: "agendado",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (actor) {
      console.log("[Seven Gold CRM][Actor] Usuário da ação:", actor);
      console.log("[Seven Gold CRM][Actor] Payload com usuário:", appointmentPayload);
    }

    // Limpar campos undefined
    Object.keys(appointmentPayload).forEach((key) => {
      if (appointmentPayload[key] === undefined) {
        delete appointmentPayload[key];
      }
    });

    // Segundo passo: Antes de salvar, logar o lead e o payload
    console.log("[Seven Gold CRM][Agendamento] Lead atual:", safeStringify(leadAtual));
    console.log("[Seven Gold CRM][Agendamento] Data escolhida:", date);
    console.log("[Seven Gold CRM][Agendamento] Hora escolhida:", time);
    console.log("[Seven Gold CRM][Agendamento] Tabela de agendamentos:", APPOINTMENTS_TABLE);
    console.log("[Seven Gold CRM][Agendamento] Payload antes do insert:", safeStringify(appointmentPayload));

    // Sexto passo: Salvar o agendamento primeiro (usando direct runtime messaging)
    const response = await chrome.runtime.sendMessage({
      type: "INSERT_APPOINTMENT",
      payload: appointmentPayload,
    });

    if (!response?.ok) {
      console.error("[Seven Gold CRM][Agendamento] Resposta de erro do background:", safeStringify(response));

      throw new Error(
        typeof response?.error === "string"
          ? response.error
          : JSON.stringify(response?.error || response?.details?.message || "Erro ao criar agendamento.", null, 2)
      );
    }

    const appointment = response.appointment;

    if (!appointment) {
      throw new Error("O agendamento não retornou do banco após salvar.");
    }

    // Sétimo passo: Depois de salvar o agendamento, atualizar o lead
    const stageMsg = {
      type: "UPDATE_LEAD_STAGE",
      phone: normalizeCrmPhone(leadAtual.telefone || ""),
      status: "agendamento",
    };
    if (actor) {
      stageMsg.updated_by_email = actor.email;
      stageMsg.updated_by_name = actor.name;
      stageMsg.updated_at = new Date().toISOString();
    }
    const leadResponse = await chrome.runtime.sendMessage(stageMsg);

    if (!leadResponse?.ok) {
      console.error("[Seven Gold CRM][Agendamento] Agendamento criado, mas erro ao mover lead:", safeStringify(leadResponse));

      throw new Error(
        typeof leadResponse?.error === "string"
          ? leadResponse.error
          : JSON.stringify(leadResponse?.error || "Agendamento criado, mas houve erro ao mover o lead para Agendamento.", null, 2)
      );
    }

    const updatedLead = leadResponse.lead;

    // Oitavo passo: Confirmar que salvou mesmo
    if (!appointment.id) {
      throw new Error("Banco não confirmou a criação do agendamento (ID ausente).");
    }

    // Nono passo: Depois de sucesso
    const statusEl = document.getElementById('seven-gold-crm-lead-status');
    if (statusEl) {
      statusEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4caf50; flex-shrink: 0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>Agendamento salvo com sucesso.</span>`;
      statusEl.style.color = '#4caf50';
    }

    const stageLabel = getStageLabel('agendamento');
    const stageEl = document.getElementById('sg-crm-lead-stage');
    if (stageEl) {
      stageEl.textContent = stageLabel;
    }

    renderCrmStageButtons('agendamento');

    await createLeadActivityLog({
      leadId: leadAtual.id,
      actionType: "appointment_created",
      actionLabel: "Agendamento criado",
      description: `Agendamento criado para ${date} às ${time}.`,
      oldValue: null,
      newValue: `${date} ${time}`,
    });
    await loadLeadHistory(leadAtual.id);

    if (typeof loadCalendarAppointments === "function") {
      loadCalendarAppointments(currentCalendarBaseDate || new Date());
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Supabase Client Wrapper for Extension                             */
  /* ------------------------------------------------------------------ */
  const supabase = {
    from(table) {
      let startVal = '';
      let endVal = '';
      let eqKey = '';
      let eqVal = '';
      const chain = {
        select() { return chain; },
        gte(field, val) { startVal = val; return chain; },
        lte(field, val) { endVal = val; return chain; },
        order() { return chain; },
        eq(field, val) {
          eqKey = field;
          eqVal = val;
          return chain;
        },
        insert(payload) {
          return {
            select() {
              return {
                async single() {
                  try {
                    let typeName = 'INSERT_APPOINTMENT';
                    if (table === 'tasks') {
                      typeName = 'INSERT_TASK';
                    } else if (table === 'lead_activity_logs') {
                      typeName = 'INSERT_LEAD_ACTIVITY_LOG';
                    }
                    const response = await chrome.runtime.sendMessage({
                      type: typeName,
                      table,
                      payload
                    });
                    if (response && response.ok) {
                      const resData = table === 'tasks' ? response.task : response.appointment;
                      return { data: resData, error: null };
                    } else {
                      return { data: null, error: { message: response?.error || 'Erro ao criar' } };
                    }
                  } catch (err) {
                    return { data: null, error: { message: err.message || 'Erro de rede' } };
                  }
                }
              };
            }
          };
        },
        update(payload) {
          return {
            eq(field, val) {
              return {
                select() {
                  return {
                    async single() {
                      try {
                        let response;
                        if (table === 'leads') {
                          const form = document.getElementById(FORM_ID);
                          const leadPhoneEl = document.getElementById('sg-crm-lead-phone');
                          const phoneInput = (leadPhoneEl && leadPhoneEl.textContent !== '-') 
                            ? leadPhoneEl.textContent.trim() 
                            : (form ? form.telefone.value.trim() : '');
                          const phone = normalizeCrmPhone(phoneInput);
                          const statusVal = String(payload.status || '').toLowerCase();
                          const stageMsg = {
                            type: 'UPDATE_LEAD_STAGE',
                            phone: phone,
                            status: statusVal
                          };
                          const actor = await getCurrentActor();
                          if (actor) {
                            stageMsg.updated_by_email = actor.email;
                            stageMsg.updated_by_name = actor.name;
                            stageMsg.updated_at = new Date().toISOString();
                          }
                          response = await chrome.runtime.sendMessage(stageMsg);
                        } else if (table === 'tasks') {
                          response = await chrome.runtime.sendMessage({
                            type: 'UPDATE_TASK',
                            id: val,
                            status: payload.status,
                            data: payload
                          });
                        }
                        if (response && response.ok) {
                          const resData = table === 'tasks' ? response.task : { id: val, status: payload.status };
                          return { data: resData, error: null };
                        } else {
                          return { data: null, error: { message: response?.error || 'Erro ao atualizar' } };
                        }
                      } catch (err) {
                        return { data: null, error: { message: err.message || 'Erro de rede' } };
                      }
                    }
                  };
                }
              };
            }
          };
        },
        async then(resolve, reject) {
          try {
            let response;
            if (table === 'tasks') {
              const lead_id = eqKey === 'lead_id' ? eqVal : null;
              response = await chrome.runtime.sendMessage({
                type: 'GET_TASKS',
                lead_id
              });
            } else if (table === 'crm_role_permissions') {
              response = await chrome.runtime.sendMessage({
                type: 'GET_ROLE_PERMISSIONS',
                cargo: eqVal
              });
            } else {
              response = await chrome.runtime.sendMessage({
                type: 'GET_APPOINTMENTS',
                start: startVal,
                end: endVal
              });
            }
            if (response && response.ok) {
              const resData = table === 'tasks' 
                ? response.tasks 
                : (table === 'crm_role_permissions' ? response.permissions : response.appointments);
              resolve({ data: resData, error: null });
            } else {
              resolve({ data: null, error: { message: response?.error || 'Erro ao buscar dados' } });
            }
          } catch (err) {
            resolve({ data: null, error: { message: err.message || 'Erro de rede' } });
          }
        }
      };
      return chain;
    },
    auth: {
      async getSession() {
        return { data: null, error: { message: "Usar loadSessionFromBackground para auth" } };
      },
      async signOut() {
        return { error: null };
      },
      async setSession() {
        return { data: null, error: { message: "Usar background message para auth" } };
      },
    }
  };

  async function requestGoogleLoginFromBackground() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "AUTH_LOGIN_GOOGLE" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Erro ao fazer login."));
            return;
          }
          resolve(response.session);
        }
      );
    });
  }

  async function loadSessionFromBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "AUTH_GET_SESSION" },
        (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve({ session: null, crmUser: null });
            return;
          }
          resolve({
            session: response.session || null,
            crmUser: response.crmUser || null,
          });
        }
      );
    });
  }

  async function revalidateUserInBackground() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "AUTH_REVALIDATE" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Erro ao validar acesso."));
            return;
          }
          resolve(response.crmUser);
        }
      );
    });
  }

  async function requestLogoutFromBackground() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "AUTH_LOGOUT" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Erro ao sair."));
            return;
          }
          resolve();
        }
      );
    });
  }

  async function renderAuthenticatedPanelAfterLogin() {
    const existingPanel = document.getElementById(PANEL_ID);
    const existingToggle = document.getElementById(TOGGLE_ID);

    if (existingPanel) existingPanel.remove();
    if (existingToggle) existingToggle.remove();

    activeTab = 'capture';
    createToggle();
    createPanel();

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.classList.add('open');
      applyDockLayout(true);
    }

    await checkAuthAndRender();
  }

  function renderLoginScreen(previousError) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.innerHTML = `
      <div class="sg-header">
        <div class="sg-brand">
          <img src="${chrome.runtime.getURL('icons/logo-panel.png')}" alt="Seven Gold Logo" style="width: 20px; height: 20px; object-fit: contain; border-radius: 4px;" />
          <span class="sg-brand-text">Seven Gold CRM</span>
        </div>
        <button class="sg-close" id="seven-gold-close" aria-label="Fechar painel">&times;</button>
      </div>
      <div class="sg-login-screen" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100% - 48px); padding: 32px 24px; text-align: center; background: #0d1730;">
        <img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="Seven Gold CRM" style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.9;" />
        <h1 style="font-size: 20px; font-weight: 700; color: #d4af37; margin-bottom: 8px;">Seven Gold CRM</h1>
        <p style="font-size: 13px; color: #8a9fc4; margin-bottom: 24px; line-height: 1.5;">Entre com sua conta autorizada para usar a extensão.</p>
        <div id="sg-login-error" style="font-size: 12px; color: #f44336; margin-bottom: 12px; line-height: 1.4; display: ${previousError ? 'block' : 'none'};">${previousError || ''}</div>
        <button type="button" id="sg-login-btn" style="background: linear-gradient(135deg, #b8860b 0%, #d4af37 100%); color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar com Google
        </button>
        <p style="font-size: 11px; color: #555; margin-top: 16px;">Use o mesmo login do CRM.</p>
      </div>
    `;

    const closeBtn = document.getElementById('seven-gold-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.classList.remove('open');
      });
    }

    const loginBtn = document.getElementById('sg-login-btn');
    const errorEl = document.getElementById('sg-login-error');
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        loginBtn.disabled = true;
        loginBtn.innerHTML = `<span class="sg-spinner" style="border-top-color: #fff; width: 16px; height: 16px;"></span> Entrando...`;
        if (errorEl) errorEl.style.display = 'none';
        try {
          await requestGoogleLoginFromBackground();
          await renderAuthenticatedPanelAfterLogin();
        } catch (err) {
          console.error("[Seven Gold CRM][Auth] Erro no login:", err);
          if (errorEl) {
            errorEl.textContent = err.message || "Erro ao entrar com Google.";
            errorEl.style.display = 'block';
          }
          loginBtn.disabled = false;
          loginBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Entrar com Google`;
        }
      });
    }
  }

  async function logoutSevenGold() {
    try {
      await requestLogoutFromBackground();
      renderLoginScreen();
    } catch (err) {
      console.error("[Seven Gold CRM][Auth] Erro ao sair:", err);
    }
  }

  function renderAuthHeader(crmUser) {
    const header = document.querySelector('.sg-header');
    if (!header) return;

    // Remove any legacy elements or structures
    const existingAuth = header.querySelector('.sg-auth-info');
    if (existingAuth) existingAuth.remove();

    let userEl = header.querySelector('#sg-header-user-info');
    let logoutBtn = header.querySelector('#sg-logout-btn');

    if (!userEl) {
      userEl = document.createElement('div');
      userEl.id = 'sg-header-user-info';
      userEl.style.cssText = 'font-size: 13.5px; font-weight: 700; color: #ffffff; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 auto; padding: 0 8px; flex: 1; min-width: 0;';
      header.appendChild(userEl);
    }

    if (!logoutBtn) {
      logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.id = 'sg-logout-btn';
      header.appendChild(logoutBtn);
    }

    // Set absolute flex structure in header to guarantee symmetric spacing
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: linear-gradient(135deg, #b8860b 0%, #d4af37 100%); color: #fff; flex-shrink: 0; gap: 8px;';

    const closeBtn = header.querySelector('.sg-close');
    if (closeBtn) {
      closeBtn.style.cssText = 'background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; padding: 0; opacity: 0.8; line-height: 1; width: 45px; text-align: left; margin-right: auto; flex-shrink: 0;';
    }

    const nameSpan = crmUser?.nome || 'Usuário';
    const cargoSpan = crmUser?.cargo ? ` — ${String(crmUser.cargo).toUpperCase()}` : '';
    userEl.textContent = `${nameSpan}${cargoSpan}`;
    userEl.title = crmUser?.email || '';

    logoutBtn.style.cssText = 'background: rgba(244,67,54,0.15); border: 1px solid rgba(244,67,54,0.4); color: #f44336; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; flex-shrink: 0; transition: all 0.2s; width: 45px; text-align: center; margin-left: auto;';
    logoutBtn.textContent = 'Sair';
    logoutBtn.style.display = 'block';
    userEl.style.display = 'block';

    logoutBtn.onclick = logoutSevenGold;
  }

  function hasPermissionForTab(tabName) {
    if (tabName === 'capture' || tabName === 'view') {
      return canUseExtensionArea('crm_pipeline');
    }
    if (tabName === 'tasks' || tabName === 'returns') {
      return canUseTasksTab();
    }
    if (tabName === 'calendar') {
      return canUseExtensionArea('calendario');
    }
    return false;
  }

  function applyTabPermissions() {
    const hasCapture = canUseExtensionArea('crm_pipeline');
    const hasView = canUseExtensionArea('crm_pipeline');
    const hasTasks = canUseTasksTab();
    const hasCalendar = canUseExtensionArea('calendario');

    // Hide or show side buttons
    const btnCapture = document.querySelector(`.sg-side-tab[data-tab="capture"]`);
    const btnView = document.querySelector(`.sg-side-tab[data-tab="view"]`);
    const btnTasks = document.querySelector(`.sg-side-tab[data-tab="tasks"]`);
    const btnReturns = document.querySelector(`.sg-side-tab[data-tab="returns"]`);
    const btnCalendar = document.querySelector(`.sg-side-tab[data-tab="calendar"]`);

    if (btnCapture) btnCapture.style.display = hasCapture ? '' : 'none';
    if (btnView) btnView.style.display = hasView ? '' : 'none';
    if (btnTasks) btnTasks.style.display = hasTasks ? '' : 'none';
    if (btnReturns) btnReturns.style.display = hasTasks ? '' : 'none';
    if (btnCalendar) btnCalendar.style.display = hasCalendar ? '' : 'none';

    // Check if at least one tab is allowed
    const hasAnyTab = hasCapture || hasView || hasTasks || hasCalendar;
    if (!hasAnyTab) {
      const panel = document.getElementById(PANEL_ID);
      const cargoDebug = currentUserRole ? ` (cargo: "${currentUserRole}")` : '';
      const permsDebug = currentUserPermissions?.length
        ? `Permissões: ${currentUserPermissions.map(p => p.area_key + '=' + p.permitido).join(', ')}`
        : 'Nenhuma permissão encontrada para este cargo.';
      if (panel) {
        panel.innerHTML = `
          <div class="sg-header">
            <button class="sg-close" id="seven-gold-close" aria-label="Fechar painel">&times;</button>
          </div>
          <div class="sg-login-screen" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100% - 48px); padding: 32px 24px; text-align: center; background: #0d1730; color: #fff;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2" style="margin-bottom: 16px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <h1 style="font-size: 16px; font-weight: 700; color: #f44336; margin-bottom: 12px; line-height: 1.4;">Acesso Bloqueado</h1>
            <p style="font-size: 13px; color: #8a9fc4; line-height: 1.5; margin: 0;">Seu usuário não possui permissões liberadas para a extensão.</p>
            <p style="font-size: 11px; color: #5a6d8c; line-height: 1.4; margin: 8px 0 0 0;">${cargoDebug}</p>
            <p style="font-size: 11px; color: #5a6d8c; line-height: 1.4; margin: 4px 0 0 0;">${permsDebug}</p>
            <button type="button" id="sg-logout-blocked-btn" style="margin-top: 24px; background: rgba(244,67,54,0.1); border: 1px solid rgba(244,67,54,0.3); color: #f44336; padding: 8px 16px; border-radius: 6px; font-size: 12px; cursor: pointer;">Sair</button>
          </div>
        `;
        const closeBtn = document.getElementById('seven-gold-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            panel.classList.remove('open');
            applyDockLayout(false);
          });
        }
        const blockedLogoutBtn = document.getElementById('sg-logout-blocked-btn');
        if (blockedLogoutBtn) {
          blockedLogoutBtn.addEventListener('click', logoutSevenGold);
        }
      }
      return;
    }

    // Set active tab to the first allowed tab if the current active tab is not allowed
    if (!hasPermissionForTab(activeTab)) {
      if (hasCapture) {
        setActiveTab('capture');
      } else if (hasView) {
        setActiveTab('view');
      } else if (hasTasks) {
        setActiveTab('tasks');
      } else if (hasCalendar) {
        setActiveTab('calendar');
      }
    }
  }

  async function checkAuthAndRender() {
    const result = await loadSessionFromBackground();
    if (!result?.session) {
      renderLoginScreen();
      return;
    }

    try {
      const crmUser = await revalidateUserInBackground();
      renderAuthHeader(crmUser);

      console.log("[Seven Gold CRM][Permissões] Usuário CRM:", crmUser);
      console.log("[Seven Gold CRM][Permissões] Cargo:", crmUser?.cargo);
      currentUserPermissions = await loadCurrentUserPermissions(crmUser);
      console.log("[Seven Gold CRM][Permissões] Permissões carregadas:", currentUserPermissions);

      applyTabPermissions();
    } catch (err) {
      console.warn("[Seven Gold CRM][Auth] Usuário bloqueado na validação ou falha nas permissões:", err.message);
      await requestLogoutFromBackground();
      renderLoginScreen(err.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Calendário Tab Logic                                              */
  /* ------------------------------------------------------------------ */
  let currentCalendarBaseDate = new Date();
  let calendarAppointments = [];

  function getWeekRange(baseDate = new Date()) {
    const date = new Date(baseDate);
    date.setHours(0, 0, 0, 0);

    const day = date.getDay(); // domingo = 0
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const start = new Date(date);
    start.setDate(date.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  function formatDateBR(date) {
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  }

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function normalizeAppointment(item) {
    const scheduledDate =
      item.scheduled_at ||
      item.start_time ||
      item.data_hora ||
      null;

    let dateObj = null;

    if (scheduledDate) {
      dateObj = new Date(scheduledDate);
    } else if (item.data_agendamento) {
      dateObj = new Date(`${item.data_agendamento}T${item.hora_agendamento || "00:00"}`);
    }

    return {
      id: item.id,
      leadId: item.lead_id || item.cliente_id || null,
      cliente:
        item.nome_cliente ||
        item.customer_name ||
        item.cliente_nome ||
        item.nome ||
        "Cliente sem nome",
      telefone:
        item.telefone_cliente ||
        item.phone ||
        item.telefone ||
        "",
      vendedor:
        item.nome_usuario ||
        item.vendedor ||
        item.user_name ||
        item.created_by_name ||
        "Vendedor não informado",
      observacao:
        item.observacao ||
        item.notes ||
        item.note ||
        "",
      dateObj,
      raw: item,
    };
  }

  function groupAppointmentsByDay(appointments, baseDate) {
    const { start } = getWeekRange(baseDate);

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);

      return {
        key: formatDateKey(date),
        date,
        label: date.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        }),
        appointments: [],
      };
    });

    appointments.map(normalizeAppointment).forEach((appt) => {
      if (!appt.dateObj || Number.isNaN(appt.dateObj.getTime())) return;

      const key = formatDateKey(appt.dateObj);
      const day = days.find((d) => d.key === key);

      if (day) {
        day.appointments.push(appt);
      }
    });

    days.forEach((day) => {
      day.appointments.sort((a, b) => a.dateObj - b.dateObj);
    });

    return days;
  }

  function formatAppointmentHour(appt) {
    if (!appt.dateObj || Number.isNaN(appt.dateObj.getTime())) return "--:--";

    return appt.dateObj.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function initCalendarTab() {
    if (!canUseExtensionArea("calendario")) {
      showPermissionError("Você não tem permissão para acessar o calendário.");
      return;
    }
    loadCalendarAppointments(currentCalendarBaseDate);
  }

  async function loadCalendarAppointments(baseDate = new Date()) {
    const container = document.getElementById('sg-calendar-week-list-container');
    if (!container) return;

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; padding: 20px; color: #8a9fc4; gap: 8px;">
        <span class="sg-spinner" style="border-top-color: #d4af37; width: 16px; height: 16px;"></span>
        <span>Carregando agendamentos...</span>
      </div>
    `;

    const { start, end } = getWeekRange(baseDate);
    
    // Atualizar o cabeçalho imediatamente com as datas corretas
    const label = document.getElementById('sg-calendar-week-label');
    if (label) {
      label.textContent = `Semana: ${formatDateBR(start)} a ${formatDateBR(end)}`;
    }

    const startDateStr = formatDateKey(start);
    const endDateStr = formatDateKey(end);

    // Logs obrigatórios de depuração solicitados pelo usuário
    console.log("[Seven Gold CRM][Calendário] Supabase disponível?", !!supabase);
    console.log("[Seven Gold CRM][Calendário] Tabela usada:", APPOINTMENTS_TABLE);
    console.log("[Seven Gold CRM][Calendário] Semana calculada:", getWeekRange(currentCalendarBaseDate));
    console.log("[Seven Gold CRM][Calendário] Buscando Supabase:", {
      table: APPOINTMENTS_TABLE,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const { data, error } = await supabase
      .from(APPOINTMENTS_TABLE)
      .select("*")
      .gte("data_agendamento", startDateStr)
      .lte("data_agendamento", endDateStr)
      .order("data_agendamento", { ascending: true })
      .order("hora_agendamento", { ascending: true });

    if (error) {
      console.error("[Seven Gold CRM][Calendário] Erro Supabase:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        raw: error,
      });

      container.innerHTML = `
        <div style="padding: 16px; color: #f44336; font-weight: 600; text-align: center; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Erro ao carregar calendário: ${error.message || "Erro desconhecido."}</span>
        </div>
      `;
      return;
    }

    // Log sanitizado sem expor dados pessoais no console
    const sanitizedData = (data || []).map(a => ({
      id: a.id,
      lead_id: a.lead_id,
      data_agendamento: a.data_agendamento,
      hora_agendamento: a.hora_agendamento,
      status: a.status
    }));
    console.log("[Seven Gold CRM][Calendário] Agendamentos retornados:", sanitizedData);

    calendarAppointments = data || [];
    renderCalendarWeek();
  }

  function renderCalendarWeek() {
    const container = document.getElementById('sg-calendar-week-list-container');
    if (!container) return;

    container.innerHTML = '';
    
    // Obter agendamentos agrupados
    const days = groupAppointmentsByDay(calendarAppointments, currentCalendarBaseDate);

    // Se todos os dias estiverem vazios
    const totalApps = days.reduce((sum, d) => sum + d.appointments.length, 0);
    if (totalApps === 0) {
      container.innerHTML = `<div class="sg-empty-state">Nenhum agendamento nesta semana</div>`;
      return;
    }

    days.forEach((day, index) => {
      // Domingo: ocultar se não houver agendamento
      if (index === 6 && day.appointments.length === 0) {
        return;
      }

      const daySection = document.createElement('div');
      daySection.className = 'sg-calendar-day-section';
      
      // Capitalizar a primeira letra do dia da semana
      const dayLabel = day.label.charAt(0).toUpperCase() + day.label.slice(1);
      daySection.innerHTML = `<div style="font-weight: 700; color: #d4af37; font-size: 12.5px; border-bottom: 1px solid #1d2f5a; padding-bottom: 4px; margin-bottom: 6px;">${dayLabel}</div>`;

      if (day.appointments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sg-calendar-empty-day';
        empty.style.color = '#556c94';
        empty.style.fontSize = '11px';
        empty.style.fontStyle = 'italic';
        empty.style.padding = '2px 0 8px 12px';
        empty.textContent = 'Nenhum agendamento';
        daySection.appendChild(empty);
      } else {
        const appsContainer = document.createElement('div');
        appsContainer.style.display = 'flex';
        appsContainer.style.flexDirection = 'column';
        appsContainer.style.gap = '8px';
        appsContainer.style.paddingBottom = '8px';

        day.appointments.forEach(appt => {
          const card = document.createElement('div');
          card.className = `sg-appointment-card sg-appointment-card--${appt.raw.status || 'agendado'}`;
          
          let notesHtml = '';
          if (appt.observacao) {
            notesHtml = `<div class="sg-appointment-notes">Obs: ${appt.observacao}</div>`;
          }

          card.innerHTML = `
            <div style="font-weight: bold; color: #fff; margin-bottom: 2px;">
              ${formatAppointmentHour(appt)} — ${appt.cliente}
            </div>
            <div style="color: #8a9fc4; margin-bottom: 2px;">Vendedor: ${appt.vendedor}</div>
            ${appt.telefone ? `<div style="color: #8a9fc4; margin-bottom: 6px;">Telefone: ${appt.telefone}</div>` : ''}
            ${notesHtml}
            <div class="sg-appointment-actions" style="margin-top: 8px; display: flex; gap: 6px;">
              ${appt.telefone ? `<button type="button" class="sg-app-btn sg-app-btn--whatsapp" data-phone="${appt.telefone}">WhatsApp</button>` : ''}
              <button type="button" class="sg-app-btn sg-app-btn--view-lead" data-phone="${appt.telefone || ''}">Ver lead</button>
              <a href="${CRM_WEB_URL}" target="_blank" class="sg-app-link">Abrir no CRM</a>
            </div>
          `;

          // WhatsApp Button Listener
          const waBtn = card.querySelector('.sg-app-btn--whatsapp');
          if (waBtn) {
            waBtn.addEventListener('click', () => {
              const cleanPhone = String(appt.telefone).replace(/\D/g, '');
              let phoneWithDdi = cleanPhone;
              if (cleanPhone.length === 10 || cleanPhone.length === 11) {
                phoneWithDdi = '55' + cleanPhone;
              }
              window.open(`https://web.whatsapp.com/send?phone=${phoneWithDdi}`, '_blank');
            });
          }

          // Ver Lead Button Listener
          const viewLeadBtn = card.querySelector('.sg-app-btn--view-lead');
          if (viewLeadBtn) {
            viewLeadBtn.addEventListener('click', () => {
              const phone = appt.telefone ? normalizeCrmPhone(appt.telefone) : '';
              if (phone) {
                const form = document.getElementById(FORM_ID);
                if (form) {
                  form.telefone.value = phone;
                }
                setActiveTab('view');
                handleCrmQuery();
              } else {
                showStatus('Este agendamento não possui telefone cadastrado.', 'warning');
              }
            });
          }

          appsContainer.appendChild(card);
        });

        daySection.appendChild(appsContainer);
      }

      container.appendChild(daySection);
    });
  }

  function navigateCalendarWeek(direction) {
    currentCalendarBaseDate.setDate(currentCalendarBaseDate.getDate() + direction * 7);
    loadCalendarAppointments(currentCalendarBaseDate);
  }

  function goToCalendarToday() {
    currentCalendarBaseDate = new Date();
    loadCalendarAppointments(currentCalendarBaseDate);
  }


  function showStatus(message, type) {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = message;
    el.className = 'sg-status';
    if (type) el.classList.add('sg-status--' + type);
    clearTimeout(el._timer);
  }

  function clearStatus() {
    const el = document.getElementById(STATUS_ID);
    if (el) {
      el.textContent = '';
      el.className = 'sg-status';
      clearTimeout(el._timer);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Bootstrap                                                          */
  /* ------------------------------------------------------------------ */

  function inject() {
    if (document.getElementById(PANEL_ID)) return;
    createToggle();
    createPanel();
    syncPendingTasksAlarms();
    window.addEventListener('resize', () => {
      const panel = document.getElementById(PANEL_ID);
      if (panel && panel.classList.contains('open')) {
        applyDockLayout(true);
      }
    });
    checkAuthAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
